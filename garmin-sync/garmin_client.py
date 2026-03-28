"""Garmin Connect client with token persistence, singleton pattern, and retry logic.

Handles authentication (tokens first, credentials fallback), rate-limit
backoff, automatic re-auth on stale sessions, and login cooldown to avoid
triggering Garmin's SSO rate limits.
"""

import logging
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any, TypeVar

from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectTooManyRequestsError,
)
from garth.exc import GarthHTTPError
import garth.sso as _garth_sso
from urllib.parse import parse_qs

import config


# ── Monkey-patch garth's OAuth1 token exchange ────────────────
# garth 0.7.x uses mobile.integration.garmin.com as the login-url
# and follows redirects to that host. That hostname doesn't resolve
# from cloud servers (e.g. GitHub Actions). We patch get_oauth1_token
# to disable redirect following — the preauthorized endpoint returns
# the OAuth1 tokens directly in the response body, no redirect needed.

_orig_get_oauth1_token = _garth_sso.get_oauth1_token


def _patched_get_oauth1_token(
    ticket: str, client: "garth.http.Client",
) -> "_garth_sso.OAuth1Token":
    sess = _garth_sso.GarminOAuth1Session(parent=client.sess)
    base_url = f"https://connectapi.{client.domain}/oauth-service/oauth/"
    login_url = f"https://mobile.integration.{client.domain}/gcm/android"
    url = (
        f"{base_url}preauthorized?ticket={ticket}&login-url={login_url}"
        "&accepts-mfa-tokens=true"
    )
    resp = sess.get(
        url,
        headers=_garth_sso.OAUTH_USER_AGENT,
        timeout=client.timeout,
        allow_redirects=False,
    )
    # With allow_redirects=False, the preauthorized endpoint returns
    # either the tokens directly (200) or a redirect (302/303).
    # If redirected, the tokens are in the response body, not at the
    # redirect target. If body is empty, try the Location header query.
    body = resp.text.strip()
    if body and "oauth_token" in body:
        parsed = parse_qs(body)
    elif resp.is_redirect and resp.headers.get("Location"):
        from urllib.parse import urlparse
        loc = resp.headers["Location"]
        parsed = parse_qs(urlparse(loc).query)
    else:
        # Fall back to original behavior but catch DNS errors
        try:
            resp2 = sess.get(
                url,
                headers=_garth_sso.OAUTH_USER_AGENT,
                timeout=client.timeout,
                allow_redirects=True,
            )
            resp2.raise_for_status()
            parsed = parse_qs(resp2.text)
        except Exception:
            raise
    log.info("OAuth1 token exchange completed (patched)")
    token = {k: v[0] for k, v in parsed.items()}
    return _garth_sso.OAuth1Token(domain=client.domain, **token)


_garth_sso.get_oauth1_token = _patched_get_oauth1_token

log = logging.getLogger(__name__)

T = TypeVar("T")

RATE_LIMIT_BASE_DELAY = 60
RATE_LIMIT_MAX_DELAY = 900
RATE_LIMIT_MAX_RETRIES = 5

# Login cooldown: prevent repeated SSO login attempts that trigger 429s
LOGIN_COOLDOWN_SECONDS = 300  # 5 minutes between credential login attempts
_last_login_attempt: float = 0.0
_consecutive_login_failures: int = 0

_client: Garmin | None = None


def _save_tokens(client: Garmin, token_dir: Path) -> None:
    """Persist garth session tokens to disk."""
    token_dir.mkdir(parents=True, exist_ok=True)
    client.garth.dump(str(token_dir))
    log.info("Saved tokens to %s", token_dir)


def _check_login_cooldown() -> None:
    """Raise if we're within the login cooldown window to avoid SSO rate limits."""
    global _consecutive_login_failures
    elapsed = time.monotonic() - _last_login_attempt
    # Exponential cooldown: 5min, 10min, 20min... up to 30min based on failures
    cooldown = min(LOGIN_COOLDOWN_SECONDS * (2 ** _consecutive_login_failures), 1800)
    if _last_login_attempt > 0 and elapsed < cooldown:
        remaining = int(cooldown - elapsed)
        raise GarminConnectTooManyRequestsError(
            f"Login cooldown active ({remaining}s remaining). "
            f"Skipping SSO login to avoid Garmin 429 rate limit."
        )


def _login_with_retry(client: Garmin, token_path: str | None = None) -> None:
    """Call client.login() with exponential backoff on rate limits (429s).

    The garminconnect library wraps 429 responses from Garmin's SSO as a
    GarminConnectConnectionError with "Login failed" in the message, so we
    catch both that and GarminConnectTooManyRequestsError.
    """
    delay = RATE_LIMIT_BASE_DELAY

    for attempt in range(1, RATE_LIMIT_MAX_RETRIES + 1):
        try:
            client.login(token_path) if token_path else client.login()
            return
        except (GarminConnectTooManyRequestsError, GarminConnectConnectionError) as exc:
            is_rate_limit = (
                isinstance(exc, GarminConnectTooManyRequestsError)
                or "429" in str(exc)
                or "Too Many Requests" in str(exc)
            )
            if not is_rate_limit:
                raise
            if attempt == RATE_LIMIT_MAX_RETRIES:
                log.error("Login rate-limited after %d attempts, giving up", attempt)
                raise
            log.warning(
                "Login rate-limited (attempt %d/%d), backing off %ds",
                attempt, RATE_LIMIT_MAX_RETRIES, delay,
            )
            time.sleep(delay)
            delay = min(delay * 2, RATE_LIMIT_MAX_DELAY)


def _login_with_credentials() -> Garmin:
    """Authenticate with email/password and save tokens."""
    global _last_login_attempt, _consecutive_login_failures
    _check_login_cooldown()
    _last_login_attempt = time.monotonic()
    log.info("Logging in with credentials")
    try:
        client = Garmin(email=config.GARMIN_EMAIL, password=config.GARMIN_PASSWORD)
        _login_with_retry(client)
    except (GarminConnectTooManyRequestsError, GarminConnectAuthenticationError):
        _consecutive_login_failures += 1
        log.warning("Credential login failed (attempt %d), cooldown will increase",
                     _consecutive_login_failures)
        raise
    _consecutive_login_failures = 0
    _save_tokens(client, Path(config.GARMIN_TOKEN_DIR).expanduser())
    return client


def _login_with_tokens(token_dir: Path) -> Garmin:
    """Load a session from saved tokens. Raises on failure."""
    log.info("Loading session from tokens: %s", token_dir)
    client = Garmin()
    _login_with_retry(client, str(token_dir))
    log.info("Session loaded from tokens")
    return client


def get_client() -> Garmin:
    """Return a singleton Garmin client, authenticating as needed.

    Tries saved tokens first. If they're stale or missing, falls back to
    email/password login and persists new tokens for next run.
    """
    global _client
    if _client is not None:
        return _client

    token_dir = Path(config.GARMIN_TOKEN_DIR).expanduser()

    # Try tokens first
    try:
        _client = _login_with_tokens(token_dir)
        return _client
    except (FileNotFoundError, GarthHTTPError, GarminConnectAuthenticationError) as exc:
        log.warning("Token login failed (%s), falling back to credentials", type(exc).__name__)

    # Fall back to credentials
    _client = _login_with_credentials()
    return _client


def get_client_for_user(email: str, password: str, token_dir: str | None = None) -> Garmin:
    """Create a Garmin client for a specific user (no singleton caching).

    Tries saved tokens first if token_dir is provided, then falls back to credentials.
    Respects login cooldown to avoid triggering Garmin SSO rate limits.
    """
    if token_dir:
        td = Path(token_dir).expanduser()
        try:
            client = _login_with_tokens(td)
            return client
        except (FileNotFoundError, GarthHTTPError, GarminConnectAuthenticationError) as exc:
            log.warning("Token login failed for %s (%s), using credentials", email, type(exc).__name__)

    global _last_login_attempt, _consecutive_login_failures
    _check_login_cooldown()
    _last_login_attempt = time.monotonic()
    log.info("Logging in user %s with credentials", email)
    try:
        client = Garmin(email=email, password=password)
        _login_with_retry(client)
    except (GarminConnectTooManyRequestsError, GarminConnectAuthenticationError):
        _consecutive_login_failures += 1
        log.warning("Credential login failed for %s (attempt %d), cooldown will increase",
                     email, _consecutive_login_failures)
        raise
    _consecutive_login_failures = 0
    if token_dir:
        _save_tokens(client, Path(token_dir).expanduser())
    return client


def reset_client() -> None:
    """Clear the singleton so the next get_client() re-authenticates."""
    global _client
    _client = None
    log.info("Client reset")


def reset_login_cooldown() -> None:
    """Reset the login cooldown state. Useful for testing or manual recovery."""
    global _last_login_attempt, _consecutive_login_failures
    _last_login_attempt = 0.0
    _consecutive_login_failures = 0


def with_retry(fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    """Call *fn* with exponential backoff on rate limits and auto-reauth on stale tokens.

    Handles:
    - GarminConnectTooManyRequestsError: exponential backoff (60s → 900s max)
    - GarminConnectAuthenticationError: one re-login attempt then re-call
    - GarminConnectConnectionError: propagated after logging
    """
    delay = RATE_LIMIT_BASE_DELAY

    for attempt in range(1, RATE_LIMIT_MAX_RETRIES + 1):
        try:
            return fn(*args, **kwargs)

        except GarminConnectTooManyRequestsError:
            if attempt == RATE_LIMIT_MAX_RETRIES:
                log.error("Rate limited after %d retries, giving up", attempt)
                raise
            log.warning("Rate limited (attempt %d/%d), backing off %ds",
                        attempt, RATE_LIMIT_MAX_RETRIES, delay)
            time.sleep(delay)
            delay = min(delay * 2, RATE_LIMIT_MAX_DELAY)

        except GarminConnectAuthenticationError:
            log.warning("Auth error during API call, re-authenticating")
            reset_client()
            try:
                get_client()
            except (GarminConnectTooManyRequestsError, GarminConnectAuthenticationError) as exc:
                log.error("Re-authentication failed: %s", exc)
                raise
            # Retry once with the refreshed singleton — do NOT loop on auth errors
            return fn(*args, **kwargs)

        except GarminConnectConnectionError:
            log.error("Connection error calling Garmin API")
            raise
