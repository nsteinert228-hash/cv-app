"""Centralized Garmin Connect client via garmy.

This is the ONLY module that imports from garmy. All other modules should
import from here. Provides:
  - Singleton and per-user authenticated APIClient instances
  - Wrapper functions for every metric the sync pipeline needs
  - Raw connectapi() fallback for endpoints garmy doesn't wrap natively
    (activity details, activity splits, body composition, SpO2)
"""

import logging
import os
import time
from datetime import date
from functools import wraps
from typing import Any

from garmy import APIClient, AuthClient
from garmy.core.exceptions import APIError

import config

log = logging.getLogger(__name__)

# ── Rate-limit / cooldown state ────────────────────────────────
RATE_LIMIT_BASE_DELAY = 60
RATE_LIMIT_MAX_DELAY = 900
RATE_LIMIT_MAX_RETRIES = 5
LOGIN_COOLDOWN_SECONDS = 300
_last_login_attempt: float = 0.0
_consecutive_login_failures: int = 0

# Singleton client
_api_client: APIClient | None = None


# ── Auth helpers ───────────────────────────────────────────────


def _check_login_cooldown() -> None:
    """Raise if we're within the login cooldown window."""
    elapsed = time.monotonic() - _last_login_attempt
    cooldown = min(LOGIN_COOLDOWN_SECONDS * (2 ** _consecutive_login_failures), 1800)
    if _last_login_attempt > 0 and elapsed < cooldown:
        remaining = int(cooldown - elapsed)
        raise RuntimeError(
            f"Login cooldown active ({remaining}s remaining). "
            f"Skipping login to avoid Garmin rate limit."
        )


def _do_login(api_client: APIClient, email: str, password: str) -> None:
    """Perform login with cooldown tracking."""
    global _last_login_attempt, _consecutive_login_failures
    _check_login_cooldown()
    _last_login_attempt = time.monotonic()
    try:
        api_client.login(email, password)
        _consecutive_login_failures = 0
        log.info("Garmin auth successful")
    except Exception:
        _consecutive_login_failures += 1
        log.warning(
            "Login failed (attempt %d), cooldown will increase",
            _consecutive_login_failures,
        )
        raise


def get_client() -> APIClient:
    """Return a singleton authenticated APIClient.

    Tries cached tokens first (loaded by AuthClient.__init__). Only
    falls back to SSO login if no valid tokens exist on disk.
    """
    global _api_client
    if _api_client is not None:
        return _api_client

    token_dir = os.getenv(
        "GARMIN_TOKEN_DIR", os.path.expanduser("~/.garmy")
    )
    email = config.GARMIN_EMAIL
    password = config.GARMIN_PASSWORD

    if not email or not password:
        raise RuntimeError("GARMIN_EMAIL and GARMIN_PASSWORD must be set")

    auth_client = AuthClient(token_dir=token_dir)
    _api_client = APIClient(auth_client=auth_client)

    # AuthClient loads tokens from disk on init. Only hit SSO if needed.
    if auth_client.is_authenticated:
        log.info("Resumed session from cached tokens in %s", token_dir)
    else:
        log.info("No valid cached tokens, performing SSO login")
        _do_login(_api_client, email, password)

    return _api_client


def get_client_for_user(
    email: str, password: str, token_dir: str | None = None
) -> APIClient:
    """Create an authenticated APIClient for a specific user (no caching).

    Tries cached tokens first, falls back to SSO login.
    """
    td = token_dir or os.path.expanduser("~/.garmy")
    auth_client = AuthClient(token_dir=td)
    api_client = APIClient(auth_client=auth_client)

    if auth_client.is_authenticated:
        log.info("Resumed session for user from cached tokens in %s", td)
    else:
        log.info("No valid cached tokens for user, performing SSO login")
        _do_login(api_client, email, password)

    return api_client


def reset_client() -> None:
    """Clear the singleton so the next get_client() re-authenticates."""
    global _api_client
    _api_client = None
    log.info("Client reset")


def reset_login_cooldown() -> None:
    """Reset login cooldown state (for testing / manual recovery)."""
    global _last_login_attempt, _consecutive_login_failures
    _last_login_attempt = 0.0
    _consecutive_login_failures = 0


# ── Retry wrapper ──────────────────────────────────────────────


def with_retry(fn: Any, *args: Any, **kwargs: Any) -> Any:
    """Call *fn* with exponential backoff on API errors and auto-reauth.

    Handles rate limits (429), auth expiry, and connection errors.
    """
    delay = RATE_LIMIT_BASE_DELAY

    for attempt in range(1, RATE_LIMIT_MAX_RETRIES + 1):
        try:
            return fn(*args, **kwargs)

        except APIError as exc:
            err_str = str(exc)
            is_rate_limit = "429" in err_str or "Too Many" in err_str

            if is_rate_limit:
                if attempt == RATE_LIMIT_MAX_RETRIES:
                    log.error("Rate limited after %d retries, giving up", attempt)
                    raise
                log.warning(
                    "Rate limited (attempt %d/%d), backing off %ds",
                    attempt, RATE_LIMIT_MAX_RETRIES, delay,
                )
                time.sleep(delay)
                delay = min(delay * 2, RATE_LIMIT_MAX_DELAY)
                continue

            is_auth = "401" in err_str or "403" in err_str
            if is_auth:
                log.warning("Auth error during API call, re-authenticating")
                reset_client()
                try:
                    get_client()
                except Exception as reauth_exc:
                    log.error("Re-authentication failed: %s", reauth_exc)
                    raise
                return fn(*args, **kwargs)

            # Other API errors — propagate immediately
            raise

        except Exception:
            raise


# ── Transient-error retry decorator ────────────────────────────


def retry_transient(max_attempts: int = 3, backoff_seconds: float = 5.0):
    """Decorator: retry on transient network/server errors with exponential backoff.

    This handles connection resets, timeouts, and 5xx responses at the
    individual fetch level. Garmin-specific rate limits (429) and auth
    errors are handled separately by with_retry() at the orchestration layer.
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            last_exc = None
            for attempt in range(max_attempts):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    last_exc = e
                    # Don't retry on rate limits or auth — those are handled
                    # by with_retry() in sync.py
                    err_str = str(e)
                    if "429" in err_str or "401" in err_str or "403" in err_str:
                        raise
                    if attempt < max_attempts - 1:
                        wait = backoff_seconds * (2 ** attempt)
                        log.warning(
                            "%s attempt %d/%d failed: %s. Retrying in %ds...",
                            func.__name__, attempt + 1, max_attempts, e, wait,
                        )
                        time.sleep(wait)
            log.error("%s failed after %d attempts", func.__name__, max_attempts)
            raise last_exc
        return wrapper
    return decorator


# ── Metric wrappers ────────────────────────────────────────────
# Thin wrappers that translate garminconnect method names to garmy calls.
# @retry_transient handles transient network errors at the fetch level.
# Rate limits (429) and auth errors propagate to with_retry() in sync.py.


@retry_transient()
def fetch_stats_raw(client: APIClient, date_str: str) -> dict | None:
    """Fetch daily stats via garmy's daily_summary metric.

    Returns the same field names as the old garminconnect get_stats()
    (totalSteps, totalKilocalories, restingHeartRate, etc.).
    """
    return client.metrics.get("daily_summary").raw(date_input=date_str)


@retry_transient()
def fetch_heart_rate_raw(client: APIClient, date_str: str) -> dict | None:
    """Fetch heart rate data (summary + intraday readings)."""
    return client.metrics.get("heart_rate").raw(date_input=date_str)


@retry_transient()
def fetch_hrv_raw(client: APIClient, date_str: str) -> dict | None:
    """Fetch HRV summary data."""
    return client.metrics.get("hrv").raw(date_input=date_str)


@retry_transient()
def fetch_sleep_raw(client: APIClient, date_str: str) -> dict | None:
    """Fetch sleep data."""
    return client.metrics.get("sleep").raw(date_input=date_str)


@retry_transient()
def fetch_stress_raw(client: APIClient, date_str: str) -> dict | None:
    """Fetch stress data (summary + intraday values)."""
    return client.metrics.get("stress").raw(date_input=date_str)


@retry_transient()
def fetch_respiration_raw(client: APIClient, date_str: str) -> dict | None:
    """Fetch respiration data."""
    return client.metrics.get("respiration").raw(date_input=date_str)


@retry_transient()
def fetch_activities_raw(client: APIClient, date_str: str) -> list[dict]:
    """Fetch activities for a single date.

    garmy's activities accessor is list-based (not date-based), so we
    fetch recent activities and filter to the target date.
    """
    accessor = client.metrics.get("activities")
    raw_list = accessor.raw(limit=50, start=0)
    if not raw_list or not isinstance(raw_list, list):
        return []

    # Filter to target date by startTimeLocal
    return [
        act for act in raw_list
        if act.get("startTimeLocal", "")[:10] == date_str
    ]


# ── Raw connectapi() calls for endpoints garmy doesn't wrap ────


@retry_transient()
def fetch_body_composition_raw(client: APIClient, date_str: str) -> dict | None:
    """Fetch body composition data via raw Connect API."""
    path = f"/weight-service/weight/dateRange?startDate={date_str}&endDate={date_str}"
    result = client.connectapi(path)
    return result if isinstance(result, dict) else None


@retry_transient()
def fetch_spo2_raw(client: APIClient, date_str: str) -> dict | None:
    """Fetch SpO2 data from the daily summary.

    Garmin's standalone SpO2 endpoints are not accessible via garmy's
    iOS user-agent. SpO2 fields are available in the daily_summary.
    """
    raw = client.metrics.get("daily_summary").raw(date_input=date_str)
    if not raw:
        return None
    avg = raw.get("averageSpo2")
    lowest = raw.get("lowestSpo2")
    latest = raw.get("latestSpo2")
    if avg is None and lowest is None and latest is None:
        return None
    return {
        "averageSpO2": avg,
        "lowestSpO2": lowest,
        "latestSpO2": latest,
    }


@retry_transient()
def fetch_activity_details_raw(client: APIClient, activity_id: int) -> dict | None:
    """Fetch detailed metrics for a single activity via raw Connect API."""
    path = f"/activity-service/activity/{activity_id}/details"
    result = client.connectapi(path)
    return result if isinstance(result, dict) else None


@retry_transient()
def fetch_activity_splits_raw(client: APIClient, activity_id: int) -> dict | None:
    """Fetch split/lap data for a single activity via raw Connect API."""
    path = f"/activity-service/activity/{activity_id}/splits"
    result = client.connectapi(path)
    return result if isinstance(result, dict) else None
