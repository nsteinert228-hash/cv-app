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


def _login_with_credentials() -> Garmin:
    """Authenticate with email/password and save tokens."""
    log.info("Logging in with credentials")
    client = Garmin(email=config.GARMIN_EMAIL, password=config.GARMIN_PASSWORD)
    client.login()
    _save_tokens(client, Path(config.GARMIN_TOKEN_DIR).expanduser())
    return client


def _login_with_tokens(token_dir: Path) -> Garmin:
    """Load a session from saved tokens. Raises on failure."""
    log.info("Loading session from tokens: %s", token_dir)
    client = Garmin()
    client.login(str(token_dir))
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
