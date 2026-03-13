"""Orchestration logic for Garmin → Supabase sync.

All public functions accept a Garmin client and Supabase client and
coordinate fetching, upserting, and logging.  Individual data-type
failures are logged but never stop the overall sync.
"""

import logging
import time
from datetime import date, timedelta

from garminconnect import Garmin
from supabase import Client

import config
import data_fetchers
import supabase_client
from garmin_client import with_retry

log = logging.getLogger(__name__)

ALL_DATA_TYPES = [
    "daily_summaries",
    "heart_rate",
    "hrv",
    "sleep",
    "activities",
    "activity_metrics",
    "body_composition",
    "spo2",
    "respiration",
    "stress",
]

# Map data type name → (fetcher, upserter) pairs.
# Fetchers all accept (garmin_client, date_str).
# "single" upserters accept (sb_client, data_dict) and return int.
# "multi"  upserters accept (sb_client, date_str, rows_list) and return int.
# "list"   upserters accept (sb_client, rows_list) and return int.

_DISPATCH: dict[str, dict] = {
    "daily_summaries": {
        "fetch": lambda g, d: data_fetchers.fetch_daily_summary(g, d),
        "upsert": lambda sb, d, data, uid: supabase_client.upsert_daily_summary(sb, data, uid),
        "kind": "single",
    },
    "heart_rate": {
        "fetch": lambda g, d: data_fetchers.fetch_heart_rates(g, d),
        "upsert": lambda sb, d, rows, uid: supabase_client.upsert_heart_rate_intraday(sb, d, rows, uid),
        "kind": "multi",
    },
    "hrv": {
        "fetch": lambda g, d: data_fetchers.fetch_hrv(g, d),
        "upsert": lambda sb, d, data, uid: supabase_client.upsert_hrv(sb, data, uid),
        "kind": "single",
    },
    "sleep": {
        "fetch": lambda g, d: data_fetchers.fetch_sleep(g, d),
        "upsert": lambda sb, d, data, uid: supabase_client.upsert_sleep(sb, data, uid),
        "kind": "single",
    },
    "activities": {
        "fetch": lambda g, d: data_fetchers.fetch_activities(g, d),
        "upsert": lambda sb, d, rows, uid: supabase_client.upsert_activities(sb, rows, uid),
        "kind": "list",
    },
    "activity_metrics": {
        "kind": "custom",
    },
    "body_composition": {
        "fetch": lambda g, d: data_fetchers.fetch_body_composition(g, d),
        "upsert": lambda sb, d, data, uid: supabase_client.upsert_body_composition(sb, data, uid),
        "kind": "single",
    },
    "spo2": {
        "fetch": lambda g, d: data_fetchers.fetch_spo2(g, d),
        "upsert": lambda sb, d, data, uid: supabase_client.upsert_spo2(sb, data, uid),
        "kind": "single",
    },
    "respiration": {
        "fetch": lambda g, d: data_fetchers.fetch_respiration(g, d),
        "upsert": lambda sb, d, data, uid: supabase_client.upsert_respiration(sb, data, uid),
        "kind": "single",
    },
    "stress": {
        "fetch": lambda g, d: data_fetchers.fetch_stress_details(g, d),
        "upsert": lambda sb, d, rows, uid: supabase_client.upsert_stress_details(sb, d, rows, uid),
        "kind": "multi",
    },
}


def _sync_activity_metrics(
    garmin: Garmin,
    sb: Client,
    date_str: str,
    user_id: str,
) -> tuple[str, int]:
    """Fetch activity details and metrics for all aerobic activities on a date.

    First fetches the activity list for the date, then gets detailed metrics
    for each aerobic activity.
    """
    activities = with_retry(data_fetchers.fetch_activities, garmin, date_str)
    if not activities:
        return "success", 0

    count = 0
    for act in activities:
        activity_id = act.get("activity_id")
        if not activity_id:
            continue

        detail = with_retry(
            data_fetchers.fetch_activity_details,
            garmin,
            activity_id,
            activity_type=act.get("activity_type"),
            avg_hr=act.get("avg_heart_rate"),
            max_hr=act.get("max_heart_rate"),
            duration_seconds=act.get("duration_seconds"),
        )

        if detail:
            detail["distance_meters"] = act.get("distance_meters")
            count += supabase_client.upsert_activity_metrics(sb, detail, user_id)

        # Rate limit between detail fetches
        time.sleep(config.FETCH_DELAY)

    return "success", count


def _sync_one_type(
    garmin: Garmin,
    sb: Client,
    date_str: str,
    dtype: str,
    user_id: str,
) -> tuple[str, int]:
    """Fetch + upsert a single data type for one date.

    Returns (status, record_count).
    """
    spec = _DISPATCH[dtype]

    # Custom handler for activity_metrics
    if spec.get("kind") == "custom" and dtype == "activity_metrics":
        return _sync_activity_metrics(garmin, sb, date_str, user_id)

    data = with_retry(spec["fetch"], garmin, date_str)

    # No data is not an error — just nothing to write
    if data is None or data == [] or data == {}:
        return "success", 0

    kind = spec["kind"]
    if kind == "single":
        count = spec["upsert"](sb, date_str, data, user_id)
    elif kind == "multi":
        count = spec["upsert"](sb, date_str, data, user_id)
    elif kind == "list":
        count = spec["upsert"](sb, date_str, data, user_id)
    else:
        raise ValueError(f"Unknown dispatch kind: {kind}")

    return "success", count


# ── Public API ─────────────────────────────────────────────────


def sync_date(
    garmin: Garmin,
    sb: Client,
    date_str: str,
    user_id: str,
    data_types: list[str] | None = None,
) -> dict[str, dict]:
    """Sync all data types for a single date.

    Returns {dtype: {"status": "success"|"error", "records": N, "error": msg|None}}
    """
    types = data_types or ALL_DATA_TYPES
    results: dict[str, dict] = {}

    for dtype in types:
        if dtype not in _DISPATCH:
            log.warning("Unknown data type: %s — skipping", dtype)
            results[dtype] = {"status": "error", "records": 0, "error": f"unknown type: {dtype}"}
            continue

        started_at = supabase_client._now_iso()
        try:
            status, count = _sync_one_type(garmin, sb, date_str, dtype, user_id)
            results[dtype] = {"status": status, "records": count, "error": None}
            supabase_client.log_sync(sb, dtype, date_str, "success", user_id,
                                     records_synced=count, started_at=started_at)
            log.info("  %s: %d records", dtype, count)
        except Exception as exc:
            msg = str(exc)
            results[dtype] = {"status": "error", "records": 0, "error": msg}
            supabase_client.log_sync(sb, dtype, date_str, "error", user_id,
                                     error_message=msg, started_at=started_at)
            log.error("  %s: error — %s", dtype, msg)

        # Rate-limit delay between API calls
        time.sleep(config.FETCH_DELAY)

    return results


def sync_date_range(
    garmin: Garmin,
    sb: Client,
    start_date: str,
    end_date: str,
    user_id: str,
    data_types: list[str] | None = None,
) -> dict[str, dict]:
    """Sync a range of dates sequentially.

    Returns aggregate summary: {dtype: {"success": N, "error": N, "records": N}}
    """
    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)
    total_days = (end - start).days + 1

    agg: dict[str, dict] = {}
    current = start
    day_num = 0

    while current <= end:
        day_num += 1
        date_str = current.isoformat()
        log.info("Syncing %s  (%d/%d days)", date_str, day_num, total_days)

        day_results = sync_date(garmin, sb, date_str, user_id, data_types)

        for dtype, result in day_results.items():
            if dtype not in agg:
                agg[dtype] = {"success": 0, "error": 0, "records": 0}
            if result["status"] == "success":
                agg[dtype]["success"] += 1
            else:
                agg[dtype]["error"] += 1
            agg[dtype]["records"] += result["records"]

        current += timedelta(days=1)

        # Extra delay between dates to respect Garmin rate limits
        if current <= end:
            time.sleep(config.FETCH_DELAY)

    return agg


def sync_today(
    garmin: Garmin,
    sb: Client,
    user_id: str,
    data_types: list[str] | None = None,
) -> dict[str, dict]:
    """Sync today's date."""
    today = date.today().isoformat()
    log.info("Syncing today: %s", today)
    return sync_date(garmin, sb, today, user_id, data_types)


def _already_synced_today(sb: Client, date_str: str, dtype: str, user_id: str) -> bool:
    """Check if a data type was already successfully synced for a given user+date."""
    try:
        result = (
            sb.table("sync_log")
            .select("id")
            .eq("user_id", user_id)
            .eq("data_type", dtype)
            .eq("sync_date", date_str)
            .eq("status", "success")
            .limit(1)
            .execute()
        )
        return bool(result.data)
    except Exception:
        return False


def backfill(
    garmin: Garmin,
    sb: Client,
    user_id: str,
    days: int = 30,
    data_types: list[str] | None = None,
) -> dict[str, dict]:
    """Backfill the last N days, skipping dates already synced successfully.

    Returns aggregate summary.
    """
    types = data_types or ALL_DATA_TYPES
    end = date.today()
    start = end - timedelta(days=days - 1)
    total_days = days

    agg: dict[str, dict] = {}
    current = start
    day_num = 0

    while current <= end:
        day_num += 1
        date_str = current.isoformat()

        # Filter to only types not yet synced for this date
        needed = [t for t in types if not _already_synced_today(sb, date_str, t, user_id)]

        if not needed:
            log.info("Skipping %s — all types already synced  (%d/%d)", date_str, day_num, total_days)
            for t in types:
                if t not in agg:
                    agg[t] = {"success": 0, "error": 0, "records": 0, "skipped": 0}
                agg[t]["skipped"] += 1
            current += timedelta(days=1)
            continue

        log.info("Backfilling %s  (%d/%d days, %d types)", date_str, day_num, total_days, len(needed))
        day_results = sync_date(garmin, sb, date_str, user_id, needed)

        for dtype, result in day_results.items():
            if dtype not in agg:
                agg[dtype] = {"success": 0, "error": 0, "records": 0, "skipped": 0}
            if result["status"] == "success":
                agg[dtype]["success"] += 1
            else:
                agg[dtype]["error"] += 1
            agg[dtype]["records"] += result["records"]

        # Count skipped types
        for t in types:
            if t not in needed:
                if t not in agg:
                    agg[t] = {"success": 0, "error": 0, "records": 0, "skipped": 0}
                agg[t]["skipped"] += 1

        current += timedelta(days=1)

        if current <= end:
            time.sleep(config.FETCH_DELAY)

    return agg
