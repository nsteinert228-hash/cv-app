"""Fetch functions for each Garmin health data type.

Each function accepts a garminconnect.Garmin client and a date string
(YYYY-MM-DD), calls the appropriate API method, and returns a parsed dict
matching the Supabase table schema — or None if no data is available.
"""

import json
import logging
from datetime import datetime, timezone

from garminconnect import Garmin

log = logging.getLogger(__name__)


def _ms_to_iso(ms: int | None) -> str | None:
    """Convert epoch milliseconds to an ISO 8601 UTC timestamp string."""
    if ms is None:
        return None
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()


# ── 1. daily_summaries ─────────────────────────────────────────


def fetch_daily_summary(client: Garmin, date_str: str) -> dict | None:
    """Fetch daily summary stats for a single date."""
    log.info("Fetching daily summary for %s", date_str)
    raw = client.get_stats(date_str)
    if not raw:
        log.debug("No daily summary data for %s", date_str)
        return None

    moderate = raw.get("moderateIntensityMinutes") or 0
    vigorous = raw.get("vigorousIntensityMinutes") or 0

    def _int(v):
        return int(v) if v is not None else None

    return {
        "date": date_str,
        "steps": _int(raw.get("totalSteps")),
        "floors_climbed": _int(raw.get("floorsAscended")),
        "calories_total": _int(raw.get("totalKilocalories")),
        "calories_active": _int(raw.get("activeKilocalories")),
        "calories_bmr": _int(raw.get("bmrKilocalories")),
        "distance_meters": _int(raw.get("totalDistanceMeters")),
        "intensity_minutes": int(moderate + vigorous),
        "stress_avg": _int(raw.get("averageStressLevel")),
        "stress_max": _int(raw.get("maxStressLevel")),
        "stress_qualifier": raw.get("stressQualifier"),
        "avg_heart_rate": _int(raw.get("restingHeartRate")),
        "max_heart_rate": _int(raw.get("maxHeartRate")),
        "resting_heart_rate": _int(raw.get("restingHeartRate")),
        "min_heart_rate": _int(raw.get("minHeartRate")),
        "raw_json": json.dumps(raw),
    }


# ── 2. heart_rate_intraday ─────────────────────────────────────


def fetch_heart_rates(client: Garmin, date_str: str) -> list[dict]:
    """Fetch intraday heart rate values as a list of (date, timestamp, hr) rows."""
    log.info("Fetching heart rates for %s", date_str)
    raw = client.get_heart_rates(date_str)
    if not raw:
        log.debug("No heart rate data for %s", date_str)
        return []

    rows: list[dict] = []
    for entry in raw.get("heartRateValues") or []:
        if entry is None or len(entry) < 2 or entry[1] is None:
            continue
        rows.append({
            "date": date_str,
            "timestamp": _ms_to_iso(entry[0]),
            "heart_rate": entry[1],
        })

    log.info("Parsed %d heart rate readings for %s", len(rows), date_str)
    return rows


# ── 3. hrv_summaries ───────────────────────────────────────────


def fetch_hrv(client: Garmin, date_str: str) -> dict | None:
    """Fetch HRV summary data for a single date."""
    log.info("Fetching HRV for %s", date_str)
    raw = client.get_hrv_data(date_str)
    if not raw:
        log.debug("No HRV data for %s", date_str)
        return None

    summary = raw.get("hrvSummary") or {}
    baseline = summary.get("baseline") or {}

    return {
        "date": date_str,
        "weekly_avg": summary.get("weeklyAvg"),
        "last_night": summary.get("lastNight"),
        "last_night_avg": summary.get("lastNightAvg"),
        "last_night_5_min_high": summary.get("lastNight5MinHigh"),
        "baseline_low": baseline.get("lowUpper"),
        "baseline_balanced": baseline.get("balancedLow"),
        "baseline_upper": baseline.get("balancedUpper"),
        "status": summary.get("status"),
        "raw_json": json.dumps(raw),
    }


# ── 4. sleep_summaries ─────────────────────────────────────────


def fetch_sleep(client: Garmin, date_str: str) -> dict | None:
    """Fetch sleep data for a single date."""
    log.info("Fetching sleep for %s", date_str)
    raw = client.get_sleep_data(date_str)
    if not raw:
        log.debug("No sleep data for %s", date_str)
        return None

    dto = raw.get("dailySleepDTO") or {}
    if not dto.get("sleepStartTimestampGMT"):
        log.debug("No sleep start timestamp for %s", date_str)
        return None

    deep = dto.get("deepSleepSeconds") or 0
    light = dto.get("lightSleepSeconds") or 0
    rem = dto.get("remSleepSeconds") or 0
    awake = dto.get("awakeSleepSeconds") or 0

    # Sleep score may be a top-level int or nested dict
    scores = dto.get("sleepScores") or {}
    overall = scores.get("overall")
    if isinstance(overall, dict):
        overall = overall.get("value")

    return {
        "date": date_str,
        "sleep_start": _ms_to_iso(dto.get("sleepStartTimestampGMT")),
        "sleep_end": _ms_to_iso(dto.get("sleepEndTimestampGMT")),
        "total_sleep_seconds": deep + light + rem,
        "deep_seconds": deep,
        "light_seconds": light,
        "rem_seconds": rem,
        "awake_seconds": awake,
        "sleep_score": overall,
        "avg_spo2": dto.get("averageSpO2Value"),
        "avg_respiration": dto.get("averageRespirationValue"),
        "raw_json": json.dumps(raw),
    }


# ── 5. activities ───────────────────────────────────────────────


def fetch_activities(client: Garmin, date_str: str) -> list[dict]:
    """Fetch activities for a single date."""
    log.info("Fetching activities for %s", date_str)
    raw_list = client.get_activities_by_date(date_str, date_str)
    if not raw_list:
        log.debug("No activities for %s", date_str)
        return []

    rows: list[dict] = []
    for act in raw_list:
        activity_type = act.get("activityType") or {}
        type_key = activity_type.get("typeKey") if isinstance(activity_type, dict) else str(activity_type)

        # Compute avg pace (min/km) from average speed (m/s)
        avg_speed = act.get("averageSpeed")
        avg_pace = None
        if avg_speed and avg_speed > 0:
            avg_pace = round(1000 / (avg_speed * 60), 2)

        rows.append({
            "activity_id": act.get("activityId"),
            "date": date_str,
            "activity_type": type_key,
            "name": act.get("activityName"),
            "start_time": act.get("startTimeGMT"),
            "duration_seconds": act.get("duration"),
            "distance_meters": act.get("distance"),
            "calories": act.get("calories"),
            "avg_heart_rate": act.get("averageHR"),
            "max_heart_rate": act.get("maxHR"),
            "avg_pace": avg_pace,
            "elevation_gain_meters": act.get("elevationGain"),
            "raw_json": json.dumps(act),
        })

    log.info("Parsed %d activities for %s", len(rows), date_str)
    return rows


# ── 6. body_composition ────────────────────────────────────────


def fetch_body_composition(client: Garmin, date_str: str) -> dict | None:
    """Fetch body composition data for a single date."""
    log.info("Fetching body composition for %s", date_str)
    raw = client.get_body_composition(date_str, date_str)
    if not raw:
        log.debug("No body composition data for %s", date_str)
        return None

    entries = raw.get("dateWeightList") or []
    if not entries:
        log.debug("No weight entries for %s", date_str)
        return None

    entry = entries[0]
    weight_grams = entry.get("weight")
    muscle_grams = entry.get("muscleMass")
    bone_grams = entry.get("boneMass")

    return {
        "date": date_str,
        "weight_kg": round(weight_grams / 1000, 2) if weight_grams else None,
        "bmi": entry.get("bmi"),
        "body_fat_pct": entry.get("bodyFat"),
        "muscle_mass_kg": round(muscle_grams / 1000, 2) if muscle_grams else None,
        "bone_mass_kg": round(bone_grams / 1000, 2) if bone_grams else None,
        "body_water_pct": entry.get("bodyWater"),
        "raw_json": json.dumps(entry),
    }


# ── 7. spo2_daily ──────────────────────────────────────────────


def fetch_spo2(client: Garmin, date_str: str) -> dict | None:
    """Fetch SpO2 data for a single date."""
    log.info("Fetching SpO2 for %s", date_str)
    raw = client.get_spo2_data(date_str)
    if not raw:
        log.debug("No SpO2 data for %s", date_str)
        return None

    return {
        "date": date_str,
        "avg_spo2": raw.get("averageSpO2"),
        "lowest_spo2": raw.get("lowestSpO2"),
        "latest_spo2": raw.get("latestSpO2"),
        "raw_json": json.dumps(raw),
    }


# ── 8. respiration_daily ───────────────────────────────────────


def fetch_respiration(client: Garmin, date_str: str) -> dict | None:
    """Fetch respiration data for a single date."""
    log.info("Fetching respiration for %s", date_str)
    raw = client.get_respiration_data(date_str)
    if not raw:
        log.debug("No respiration data for %s", date_str)
        return None

    return {
        "date": date_str,
        "avg_waking": raw.get("avgWakingRespirationValue"),
        "avg_sleeping": raw.get("avgSleepRespirationValue"),
        "highest": raw.get("highestRespirationValue"),
        "lowest": raw.get("lowestRespirationValue"),
        "raw_json": json.dumps(raw),
    }


# ── 9. stress_details ──────────────────────────────────────────


def fetch_stress_details(client: Garmin, date_str: str) -> list[dict]:
    """Fetch intraday stress values as a list of (date, timestamp, level) rows."""
    log.info("Fetching stress details for %s", date_str)
    raw = client.get_stress_data(date_str)
    if not raw:
        log.debug("No stress data for %s", date_str)
        return []

    rows: list[dict] = []
    for entry in raw.get("stressValuesArray") or []:
        if entry is None or len(entry) < 2 or entry[1] is None:
            continue
        # Garmin uses -1 / -2 for unmeasured or activity periods — skip those
        if entry[1] < 0:
            continue
        rows.append({
            "date": date_str,
            "timestamp": _ms_to_iso(entry[0]),
            "stress_level": entry[1],
        })

    log.info("Parsed %d stress readings for %s", len(rows), date_str)
    return rows
