"""Supabase upsert functions for each Garmin health table.

Daily tables use upsert with on_conflict on the date PK.
Intraday tables (heart_rate_intraday, stress_details) use delete-for-date
then chunked insert — their UUID PKs have no natural unique constraint,
so delete+insert ensures idempotent re-runs without duplicates.
"""

import logging
import time
from collections.abc import Callable
from datetime import datetime, timezone
from typing import TypeVar

from supabase import create_client, Client

import config

log = logging.getLogger(__name__)

T = TypeVar("T")

CHUNK_SIZE = 500
MAX_RETRIES = 3
RETRY_BASE_DELAY = 2


def get_client() -> Client:
    """Create a Supabase client using the service_role key (bypasses RLS)."""
    return create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY)


def _now_iso() -> str:
    """Return the current UTC time as an ISO 8601 string."""
    return datetime.now(timezone.utc).isoformat()


def _with_retry(fn: Callable[..., T]) -> T:
    """Retry a Supabase operation with exponential backoff on connection errors."""
    last_exc = None
    delay = RETRY_BASE_DELAY
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return fn()
        except Exception as exc:
            last_exc = exc
            if attempt == MAX_RETRIES:
                break
            log.warning("Supabase error (attempt %d/%d): %s — retrying in %ds",
                        attempt, MAX_RETRIES, exc, delay)
            time.sleep(delay)
            delay *= 2
    raise last_exc


# ── Single-row upserts (daily tables with date PK) ────────────


def _upsert_daily(client: Client, table: str, data: dict, user_id: str) -> int:
    """Upsert a single row into a (user_id, date) PK table. Returns 1 on success, 0 on skip."""
    if not data:
        return 0
    data["user_id"] = user_id
    data["synced_at"] = _now_iso()

    def _do():
        client.table(table).upsert(data, on_conflict="user_id,date").execute()

    _with_retry(_do)
    log.info("Upserted 1 row into %s for %s", table, data.get("date"))
    return 1


def upsert_daily_summary(client: Client, data: dict, user_id: str) -> int:
    """Upsert a daily summary row."""
    return _upsert_daily(client, "daily_summaries", data, user_id)


def upsert_hrv(client: Client, data: dict, user_id: str) -> int:
    """Upsert an HRV summary row."""
    return _upsert_daily(client, "hrv_summaries", data, user_id)


def upsert_sleep(client: Client, data: dict, user_id: str) -> int:
    """Upsert a sleep summary row."""
    return _upsert_daily(client, "sleep_summaries", data, user_id)


def upsert_body_composition(client: Client, data: dict, user_id: str) -> int:
    """Upsert a body composition row."""
    return _upsert_daily(client, "body_composition", data, user_id)


def upsert_spo2(client: Client, data: dict, user_id: str) -> int:
    """Upsert a daily SpO2 row."""
    return _upsert_daily(client, "spo2_daily", data, user_id)


def upsert_respiration(client: Client, data: dict, user_id: str) -> int:
    """Upsert a daily respiration row."""
    return _upsert_daily(client, "respiration_daily", data, user_id)


# ── Activities (activity_id PK) ────────────────────────────────


def upsert_activities(client: Client, rows: list[dict], user_id: str) -> int:
    """Upsert activity rows, keyed on (user_id, activity_id)."""
    if not rows:
        return 0
    now = _now_iso()
    for row in rows:
        row["user_id"] = user_id
        row["synced_at"] = now

    def _do():
        client.table("activities").upsert(rows, on_conflict="user_id,activity_id").execute()

    _with_retry(_do)
    log.info("Upserted %d activities", len(rows))
    return len(rows)


def upsert_activity_metrics(client: Client, data: dict, user_id: str) -> int:
    """Upsert a single activity metrics row, keyed on (user_id, activity_id)."""
    if not data:
        return 0
    data["user_id"] = user_id
    data["synced_at"] = _now_iso()

    def _do():
        client.table("activity_metrics").upsert(
            data, on_conflict="user_id,activity_id"
        ).execute()

    _with_retry(_do)
    log.info("Upserted activity metrics for activity %s", data.get("activity_id"))
    return 1


# ── Intraday tables (delete-for-date + chunked insert) ────────


def _replace_intraday(client: Client, table: str, date_str: str, rows: list[dict], user_id: str) -> int:
    """Replace all rows for a user+date: delete existing, then chunked insert.

    This is idempotent — safe to re-run for the same date.
    Returns the number of rows inserted.
    """
    if not rows:
        return 0

    for row in rows:
        row["user_id"] = user_id

    # Delete existing rows for this user+date
    def _delete():
        client.table(table).delete().eq("user_id", user_id).eq("date", date_str).execute()

    _with_retry(_delete)

    # Insert in chunks
    inserted = 0
    for i in range(0, len(rows), CHUNK_SIZE):
        chunk = rows[i : i + CHUNK_SIZE]

        def _insert(c=chunk):
            client.table(table).insert(c).execute()

        _with_retry(_insert)
        inserted += len(chunk)

    log.info("Inserted %d rows into %s for %s", inserted, table, date_str)
    return inserted


def upsert_heart_rate_intraday(client: Client, date_str: str, rows: list[dict], user_id: str) -> int:
    """Replace all intraday heart rate rows for a user+date."""
    return _replace_intraday(client, "heart_rate_intraday", date_str, rows, user_id)


def upsert_stress_details(client: Client, date_str: str, rows: list[dict], user_id: str) -> int:
    """Replace all intraday stress detail rows for a user+date."""
    return _replace_intraday(client, "stress_details", date_str, rows, user_id)


# ── Sync log ───────────────────────────────────────────────────


def log_sync(
    client: Client,
    data_type: str,
    sync_date: str,
    status: str,
    user_id: str,
    records_synced: int = 0,
    error_message: str | None = None,
    started_at: str | None = None,
) -> None:
    """Write an entry to the sync_log table."""
    row = {
        "user_id": user_id,
        "data_type": data_type,
        "sync_date": sync_date,
        "status": status,
        "records_synced": records_synced,
        "error_message": error_message,
        "started_at": started_at or _now_iso(),
        "completed_at": _now_iso(),
    }

    def _do():
        client.table("sync_log").insert(row).execute()

    try:
        _with_retry(_do)
        log.info("Logged sync: %s %s → %s (%d records)",
                 data_type, sync_date, status, records_synced)
    except Exception as exc:
        log.error("Failed to write sync log: %s", exc)


# ── Plan matching queries ──────────────────────────────────────


def fetch_active_season(client: Client, user_id: str) -> dict | None:
    """Return the active training season for a user, or None."""
    def _do():
        return (
            client.table("training_seasons")
            .select("id, name, plan_json, duration_weeks, start_date, end_date, status")
            .eq("user_id", user_id)
            .eq("status", "active")
            .limit(1)
            .execute()
        )
    result = _with_retry(_do)
    return result.data[0] if result.data else None


def fetch_season_workouts(client: Client, user_id: str, season_id: str,
                          start_date: str, end_date: str) -> list[dict]:
    """Fetch planned workouts for a season within a date range."""
    def _do():
        return (
            client.table("season_workouts")
            .select("id, date, week_number, workout_type, title, intensity, duration_minutes, prescription_json")
            .eq("user_id", user_id)
            .eq("season_id", season_id)
            .gte("date", start_date)
            .lte("date", end_date)
            .order("date")
            .execute()
        )
    result = _with_retry(_do)
    return result.data or []


def fetch_activities_in_range(client: Client, user_id: str,
                              start_date: str, end_date: str) -> list[dict]:
    """Fetch Garmin activities in a date range."""
    def _do():
        return (
            client.table("activities")
            .select("activity_id, date, activity_type, name, duration_seconds, distance_meters, avg_heart_rate, max_heart_rate, calories, aerobic_training_effect, anaerobic_training_effect")
            .eq("user_id", user_id)
            .gte("date", start_date)
            .lte("date", end_date)
            .order("date")
            .execute()
        )
    result = _with_retry(_do)
    return result.data or []


def fetch_activity_metrics_map(client: Client, user_id: str,
                               activity_ids: list[int]) -> dict[int, dict]:
    """Fetch activity_metrics for a list of activity IDs, keyed by activity_id."""
    if not activity_ids:
        return {}

    def _do():
        return (
            client.table("activity_metrics")
            .select("activity_id, workout_classification, classification_details, duration_seconds, distance_meters, heart_rate_samples, pace_samples, splits")
            .eq("user_id", user_id)
            .in_("activity_id", activity_ids)
            .execute()
        )
    try:
        result = _with_retry(_do)
        return {r["activity_id"]: r for r in (result.data or [])}
    except Exception:
        return {}


def fetch_plan_completions(client: Client, user_id: str,
                           season_id: str) -> list[dict]:
    """Fetch all existing plan_completions for a season."""
    def _do():
        return (
            client.table("plan_completions")
            .select("*")
            .eq("user_id", user_id)
            .eq("season_id", season_id)
            .execute()
        )
    try:
        result = _with_retry(_do)
        return result.data or []
    except Exception:
        return []


def upsert_plan_completion(client: Client, row: dict, user_id: str) -> int:
    """Upsert a plan_completion row (keyed on workout_id)."""
    row["user_id"] = user_id
    row["updated_at"] = _now_iso()

    def _do():
        client.table("plan_completions").upsert(
            row, on_conflict="workout_id"
        ).execute()

    _with_retry(_do)
    return 1


def update_workout_log_adherence(client: Client, workout_id: str,
                                 adherence_score: float) -> int:
    """Update adherence_score on an existing workout_log."""
    def _do():
        client.table("workout_logs").update(
            {"adherence_score": adherence_score}
        ).eq("workout_id", workout_id).execute()

    try:
        _with_retry(_do)
        return 1
    except Exception:
        return 0


def upsert_workout_log(client: Client, row: dict) -> int:
    """Upsert a workout_log row (keyed on workout_id)."""
    def _do():
        client.table("workout_logs").upsert(
            row, on_conflict="workout_id"
        ).execute()

    _with_retry(_do)
    return 1
