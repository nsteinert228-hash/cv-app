"""Garmin Connect client with token persistence, singleton pattern, and retry logic.

Handles authentication (tokens first, credentials fallback), rate-limit
backoff, and automatic re-auth on stale sessions.
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

import config

log = logging.getLogger(__name__)

T = TypeVar("T")

RATE_LIMIT_BASE_DELAY = 60
RATE_LIMIT_MAX_DELAY = 900
RATE_LIMIT_MAX_RETRIES = 5

_client: Garmin | None = None


def _save_tokens(client: Garmin, token_dir: Path) -> None:
    """Persist garth session tokens to disk."""
    token_dir.mkdir(parents=True, exist_ok=True)
    client.garth.dump(str(token_dir))
    log.info("Saved tokens to %s", token_dir)


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
    log.info("Logging in with credentials")
    client = Garmin(email=config.GARMIN_EMAIL, password=config.GARMIN_PASSWORD)
    _login_with_retry(client)
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
    """
    if token_dir:
        td = Path(token_dir).expanduser()
        try:
            client = _login_with_tokens(td)
            return client
        except (FileNotFoundError, GarthHTTPError, GarminConnectAuthenticationError) as exc:
            log.warning("Token login failed for %s (%s), using credentials", email, type(exc).__name__)

    log.info("Logging in user %s with credentials", email)
    client = Garmin(email=email, password=password)
    _login_with_retry(client)
    if token_dir:
        _save_tokens(client, Path(token_dir).expanduser())
    return client


def reset_client() -> None:
    """Clear the singleton so the next get_client() re-authenticates."""
    global _client
    _client = None
    log.info("Client reset")


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
            _refresh = get_client()
            # Replace the client reference in args if it was the first positional arg
            # and retry once — do NOT loop on auth errors
            return fn(*args, **kwargs)

        except GarminConnectConnectionError:
            log.error("Connection error calling Garmin API")
            raise
