"""Orchestration logic for Garmin → Supabase sync.

All public functions accept a garmy APIClient and Supabase client and
coordinate fetching, upserting, and logging.  Individual data-type
failures are logged but never stop the overall sync.
"""

import logging
import time
from datetime import date, timedelta
from typing import Any

from supabase import Client

import config
import data_fetchers
import supabase_client
from garmin_service import with_retry
from matcher import reconcile_user

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
# Fetchers all accept (api_client, date_str).
# "single" upserters accept (sb_client, data_dict) and return int.
# "multi"  upserters accept (sb_client, date_str, rows_list) and return int.
# "list"   upserters accept (sb_client, rows_list) and return int.

_DISPATCH: dict[str, dict] = {
    "daily_summaries": {
        "fetch": lambda g, d: data_fetchers.fetch_daily_summary(g, d),
        "upsert": lambda sb, d, data, uid: supabase_client.upsert_daily_summary(sb, data, uid),
        "kind": "single",
        "table": "daily_summaries",
    },
    "heart_rate": {
        "fetch": lambda g, d: data_fetchers.fetch_heart_rates(g, d),
        "upsert": lambda sb, d, rows, uid: supabase_client.upsert_heart_rate_intraday(sb, d, rows, uid),
        "kind": "multi",
        "table": "heart_rate_intraday",
    },
    "hrv": {
        "fetch": lambda g, d: data_fetchers.fetch_hrv(g, d),
        "upsert": lambda sb, d, data, uid: supabase_client.upsert_hrv(sb, data, uid),
        "kind": "single",
        "table": "hrv_summaries",
    },
    "sleep": {
        "fetch": lambda g, d: data_fetchers.fetch_sleep(g, d),
        "upsert": lambda sb, d, data, uid: supabase_client.upsert_sleep(sb, data, uid),
        "kind": "single",
        "table": "sleep_summaries",
    },
    "activities": {
        "fetch": lambda g, d: data_fetchers.fetch_activities(g, d),
        "upsert": lambda sb, d, rows, uid: supabase_client.upsert_activities(sb, rows, uid),
        "kind": "list",
        "table": "activities",
    },
    "activity_metrics": {
        "kind": "custom",
        "table": "activity_metrics",
    },
    "body_composition": {
        "fetch": lambda g, d: data_fetchers.fetch_body_composition(g, d),
        "upsert": lambda sb, d, data, uid: supabase_client.upsert_body_composition(sb, data, uid),
        "kind": "single",
        "table": "body_composition",
    },
    "spo2": {
        "fetch": lambda g, d: data_fetchers.fetch_spo2(g, d),
        "upsert": lambda sb, d, data, uid: supabase_client.upsert_spo2(sb, data, uid),
        "kind": "single",
        "table": "spo2_daily",
    },
    "respiration": {
        "fetch": lambda g, d: data_fetchers.fetch_respiration(g, d),
        "upsert": lambda sb, d, data, uid: supabase_client.upsert_respiration(sb, data, uid),
        "kind": "single",
        "table": "respiration_daily",
    },
    "stress": {
        "fetch": lambda g, d: data_fetchers.fetch_stress_details(g, d),
        "upsert": lambda sb, d, rows, uid: supabase_client.upsert_stress_details(sb, d, rows, uid),
        "kind": "multi",
        "table": "stress_details",
    },
}


# ── Supabase cache check ─────────────────────────────────────


def _has_cached_data(sb: Client, table: str, date_str: str, user_id: str) -> bool:
    """Check if data already exists in a Supabase table for a user+date.

    Returns True if at least one row exists, meaning we can skip the
    Garmin API call for this data type and date.
    """
    try:
        result = (
            sb.table(table)
            .select("user_id", count="exact")
            .eq("user_id", user_id)
            .eq("date", date_str)
            .limit(1)
            .execute()
        )
        return bool(result.count and result.count > 0)
    except Exception:
        # On error, fall through to fetch — better to re-fetch than miss data
        return False


def _is_today(date_str: str) -> bool:
    """Check if a date string is today's date."""
    return date_str == date.today().isoformat()


def _sync_activity_metrics(
    garmin: Any,
    sb: Client,
    date_str: str,
    user_id: str,
    force: bool = False,
) -> tuple[str, int]:
    """Fetch activity details and metrics for all aerobic activities on a date.

    First fetches the activity list for the date, then gets detailed metrics
    for each aerobic activity. Skips activities that already have metrics
    in the DB unless force=True.
    """
    activities = with_retry(data_fetchers.fetch_activities, garmin, date_str)
    if not activities:
        return "success", 0

    count = 0
    for act in activities:
        activity_id = act.get("activity_id")
        if not activity_id:
            continue

        # Check if we already have metrics for this activity
        if not force:
            try:
                existing = (
                    sb.table("activity_metrics")
                    .select("activity_id", count="exact")
                    .eq("user_id", user_id)
                    .eq("activity_id", activity_id)
                    .limit(1)
                    .execute()
                )
                if existing.count and existing.count > 0:
                    log.debug("Activity metrics for %d already cached, skipping", activity_id)
                    continue
            except Exception:
                pass  # On error, fall through to fetch

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
    garmin: Any,
    sb: Client,
    date_str: str,
    dtype: str,
    user_id: str,
    force: bool = False,
) -> tuple[str, int]:
    """Fetch + upsert a single data type for one date.

    Checks Supabase first — if data already exists for a historical date,
    skips the Garmin API call entirely. Today's data is always re-fetched
    since it accumulates throughout the day.

    Pass force=True to bypass the cache and always fetch from Garmin.

    Returns (status, record_count).
    """
    spec = _DISPATCH[dtype]

    # Custom handler for activity_metrics
    if spec.get("kind") == "custom" and dtype == "activity_metrics":
        return _sync_activity_metrics(garmin, sb, date_str, user_id, force=force)

    # Cache check: skip Garmin fetch if data exists and date is not today
    if not force and not _is_today(date_str):
        table = spec.get("table")
        if table and _has_cached_data(sb, table, date_str, user_id):
            log.debug("  %s for %s already in DB, skipping Garmin fetch", dtype, date_str)
            return "cached", 0

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
    garmin: Any,
    sb: Client,
    date_str: str,
    user_id: str,
    data_types: list[str] | None = None,
    force: bool = False,
) -> dict[str, dict]:
    """Sync all data types for a single date.

    Historical dates are checked against Supabase first — if data already
    exists, the Garmin API call is skipped. Today's data is always
    re-fetched. Pass force=True to bypass caching entirely.

    Returns {dtype: {"status": "success"|"cached"|"error", "records": N, "error": msg|None}}
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
            status, count = _sync_one_type(garmin, sb, date_str, dtype, user_id, force=force)
            results[dtype] = {"status": status, "records": count, "error": None}
            # Only write sync_log for actual fetches, not cache hits
            if status != "cached":
                supabase_client.log_sync(sb, dtype, date_str, "success", user_id,
                                         records_synced=count, started_at=started_at)
            if status == "cached":
                log.debug("  %s: cached", dtype)
            else:
                log.info("  %s: %d records", dtype, count)
        except Exception as exc:
            msg = str(exc)
            results[dtype] = {"status": "error", "records": 0, "error": msg}
            supabase_client.log_sync(sb, dtype, date_str, "error", user_id,
                                     error_message=msg, started_at=started_at)
            log.error("  %s: error — %s", dtype, msg)

        # Rate-limit delay between API calls — skip for cache hits
        if results[dtype]["status"] != "cached":
            time.sleep(config.FETCH_DELAY)

    # Post-sync: match activities to plan
    try:
        match_stats = reconcile_user(sb, user_id, date_range=(date_str, date_str))
        if match_stats.get("matched") or match_stats.get("unmatched"):
            log.info("  matching: %d matched, %d unmatched", match_stats["matched"], match_stats["unmatched"])
    except Exception as exc:
        log.warning("Post-sync matching failed: %s", exc)

    return results


def sync_date_range(
    garmin: Any,
    sb: Client,
    start_date: str,
    end_date: str,
    user_id: str,
    data_types: list[str] | None = None,
    force: bool = False,
) -> dict[str, dict]:
    """Sync a range of dates sequentially.

    Historical dates with existing data are automatically skipped
    (via the cache check in _sync_one_type). Pass force=True to
    bypass caching and re-fetch everything.

    Returns aggregate summary: {dtype: {"success": N, "error": N, "cached": N, "records": N}}
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

        day_results = sync_date(garmin, sb, date_str, user_id, data_types, force=force)

        for dtype, result in day_results.items():
            if dtype not in agg:
                agg[dtype] = {"success": 0, "error": 0, "cached": 0, "records": 0}
            if result["status"] == "success":
                agg[dtype]["success"] += 1
            elif result["status"] == "cached":
                agg[dtype]["cached"] += 1
            else:
                agg[dtype]["error"] += 1
            agg[dtype]["records"] += result["records"]

        current += timedelta(days=1)

        # Extra delay between dates — skip if everything was cached
        all_cached = all(r["status"] == "cached" for r in day_results.values())
        if current <= end and not all_cached:
            time.sleep(config.FETCH_DELAY)

    return agg


def sync_today(
    garmin: Any,
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
    garmin: Any,
    sb: Client,
    user_id: str,
    days: int = 30,
    data_types: list[str] | None = None,
    force: bool = False,
) -> dict[str, dict]:
    """Backfill the last N days, skipping dates already in Supabase.

    The cache layer in _sync_one_type automatically skips data types
    that already exist for historical dates, so this just iterates
    the date range and lets sync_date handle the rest.

    Returns aggregate summary.
    """
    end = date.today()
    start = end - timedelta(days=days - 1)
    start_str = start.isoformat()
    end_str = end.isoformat()

    log.info("Backfilling %d days: %s → %s", days, start_str, end_str)
    return sync_date_range(garmin, sb, start_str, end_str, user_id,
                           data_types=data_types, force=force)
