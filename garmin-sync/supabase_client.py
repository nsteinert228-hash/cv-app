"""Supabase upsert functions for each Garmin health table.

Daily tables use upsert with on_conflict on the date PK.
Intraday tables (heart_rate_intraday, stress_details) use delete-for-date
then chunked insert — their UUID PKs have no natural unique constraint,
so delete+insert ensures idempotent re-runs without duplicates.
"""

import logging
import time
from datetime import datetime, timezone

from supabase import create_client, Client

import config

log = logging.getLogger(__name__)

CHUNK_SIZE = 500
MAX_RETRIES = 3
RETRY_BASE_DELAY = 2


def get_client() -> Client:
    """Create a Supabase client using the service_role key (bypasses RLS)."""
    return create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _with_retry(fn):
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


def _upsert_daily(client: Client, table: str, data: dict) -> int:
    """Upsert a single row into a date-PK table. Returns 1 on success, 0 on skip."""
    if not data:
        return 0
    data["synced_at"] = _now_iso()

    def _do():
        client.table(table).upsert(data, on_conflict="date").execute()

    _with_retry(_do)
    log.info("Upserted 1 row into %s for %s", table, data.get("date"))
    return 1


def upsert_daily_summary(client: Client, data: dict) -> int:
    return _upsert_daily(client, "daily_summaries", data)


def upsert_hrv(client: Client, data: dict) -> int:
    return _upsert_daily(client, "hrv_summaries", data)


def upsert_sleep(client: Client, data: dict) -> int:
    return _upsert_daily(client, "sleep_summaries", data)


def upsert_body_composition(client: Client, data: dict) -> int:
    return _upsert_daily(client, "body_composition", data)


def upsert_spo2(client: Client, data: dict) -> int:
    return _upsert_daily(client, "spo2_daily", data)


def upsert_respiration(client: Client, data: dict) -> int:
    return _upsert_daily(client, "respiration_daily", data)


# ── Activities (activity_id PK) ────────────────────────────────


def upsert_activities(client: Client, rows: list[dict]) -> int:
    """Upsert activity rows, keyed on activity_id."""
    if not rows:
        return 0
    now = _now_iso()
    for row in rows:
        row["synced_at"] = now

    def _do():
        client.table("activities").upsert(rows, on_conflict="activity_id").execute()

    _with_retry(_do)
    log.info("Upserted %d activities", len(rows))
    return len(rows)


# ── Intraday tables (delete-for-date + chunked insert) ────────


def _replace_intraday(client: Client, table: str, date_str: str, rows: list[dict]) -> int:
    """Replace all rows for a date: delete existing, then chunked insert.

    This is idempotent — safe to re-run for the same date.
    Returns the number of rows inserted.
    """
    if not rows:
        return 0

    # Delete existing rows for this date
    def _delete():
        client.table(table).delete().eq("date", date_str).execute()

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


def upsert_heart_rate_intraday(client: Client, date_str: str, rows: list[dict]) -> int:
    return _replace_intraday(client, "heart_rate_intraday", date_str, rows)


def upsert_stress_details(client: Client, date_str: str, rows: list[dict]) -> int:
    return _replace_intraday(client, "stress_details", date_str, rows)


# ── Sync log ───────────────────────────────────────────────────


def log_sync(
    client: Client,
    data_type: str,
    sync_date: str,
    status: str,
    records_synced: int = 0,
    error_message: str | None = None,
    started_at: str | None = None,
) -> None:
    """Write an entry to the sync_log table."""
    row = {
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
