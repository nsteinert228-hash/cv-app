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
            "calories": int(act["calories"]) if act.get("calories") is not None else None,
            "avg_heart_rate": int(act["averageHR"]) if act.get("averageHR") is not None else None,
            "max_heart_rate": int(act["maxHR"]) if act.get("maxHR") is not None else None,
            "avg_pace": avg_pace,
            "elevation_gain_meters": act.get("elevationGain"),
            "raw_json": json.dumps(act),
        })

    log.info("Parsed %d activities for %s", len(rows), date_str)
    return rows


# ── 5b. activity_metrics (per-activity time-series) ───────────


# Aerobic activity types that warrant detailed metrics fetching
AEROBIC_TYPES = {
    "running", "cycling", "swimming", "hiking", "walking",
    "trail_running", "open_water_swimming", "elliptical",
    "stair_climbing", "rowing", "indoor_cycling", "treadmill_running",
    "indoor_rowing", "lap_swimming",
}


def _extract_time_series(metrics_list: list | None, metric_key: str) -> list[dict]:
    """Extract a time-series from the Garmin activity details metrics array.

    Garmin returns metrics as:
      [{"metricsIndex": 0, "metrics": [{"key": "...", "value": ...}, ...]}, ...]
    where metricsIndex is the sample index.

    Returns [{t: seconds_offset, v: value}, ...].
    """
    if not metrics_list:
        return []

    points = []
    for sample in metrics_list:
        idx = sample.get("metricsIndex", 0)
        metrics = sample.get("metrics") or []
        for m in metrics:
            if m.get("key") == metric_key and m.get("value") is not None:
                points.append({"t": idx, "v": round(m["value"], 2)})
                break
    return points


def _extract_splits(splits_data: list | None) -> list[dict]:
    """Parse Garmin split data into a clean list of split summaries."""
    if not splits_data:
        return []

    splits = []
    for s in splits_data:
        split = {
            "distance_m": s.get("distance"),
            "duration_s": s.get("duration"),
            "avg_hr": s.get("averageHR"),
            "max_hr": s.get("maxHR"),
            "elevation_gain": s.get("elevationGain"),
            "elevation_loss": s.get("elevationLoss"),
        }
        # Compute avg pace (min/km) from average speed
        avg_speed = s.get("averageSpeed")
        if avg_speed and avg_speed > 0:
            split["avg_pace"] = round(1000 / (avg_speed * 60), 2)
        else:
            split["avg_pace"] = None
        splits.append(split)
    return splits


def _classify_workout(
    hr_samples: list[dict],
    pace_samples: list[dict],
    splits: list[dict],
    avg_hr: int | None,
    max_hr: int | None,
    activity_type: str | None,
    duration_seconds: float | None,
) -> tuple[str, dict]:
    """Classify an aerobic workout based on HR and pace patterns.

    Returns (classification_label, details_dict).
    """
    details: dict = {"reason": "", "zones": {}, "segments": []}

    if not hr_samples or len(hr_samples) < 5:
        return "unclassified", {"reason": "Insufficient HR data"}

    hr_values = [p["v"] for p in hr_samples if p.get("v") and p["v"] > 0]
    if not hr_values:
        return "unclassified", {"reason": "No valid HR data"}

    avg_hr_actual = sum(hr_values) / len(hr_values)
    max_hr_actual = max(hr_values)

    # Estimate max HR if not provided (220 - age approximation)
    # Use the actual max HR from the activity as a proxy
    est_max_hr = max_hr if max_hr and max_hr > 150 else max(max_hr_actual + 10, 190)

    # HR zone boundaries (percentage of estimated max HR)
    z1_ceil = est_max_hr * 0.60  # Recovery: <60%
    z2_ceil = est_max_hr * 0.70  # Base/Easy: 60-70%
    z3_ceil = est_max_hr * 0.80  # Tempo: 70-80%
    z4_ceil = est_max_hr * 0.90  # Threshold: 80-90%
    # z5: >90% — VO2max/Intervals

    # Compute time in each zone
    zone_counts = {"z1": 0, "z2": 0, "z3": 0, "z4": 0, "z5": 0}
    for hr in hr_values:
        if hr < z1_ceil:
            zone_counts["z1"] += 1
        elif hr < z2_ceil:
            zone_counts["z2"] += 1
        elif hr < z3_ceil:
            zone_counts["z3"] += 1
        elif hr < z4_ceil:
            zone_counts["z4"] += 1
        else:
            zone_counts["z5"] += 1

    total = len(hr_values)
    zone_pcts = {k: round(v / total * 100, 1) for k, v in zone_counts.items()}
    details["zones"] = zone_pcts
    details["avg_hr"] = round(avg_hr_actual)
    details["max_hr"] = max_hr_actual
    details["est_max_hr"] = est_max_hr

    # Detect HR variability pattern (for interval detection)
    # Look at rolling HR segments to find alternating high/low patterns
    segment_size = max(len(hr_values) // 10, 5)
    segments = []
    for i in range(0, len(hr_values) - segment_size + 1, segment_size):
        seg = hr_values[i:i + segment_size]
        seg_avg = sum(seg) / len(seg)
        segments.append(round(seg_avg))
    details["segments"] = segments

    # Count significant HR transitions (>10 bpm swings between segments)
    transitions = 0
    if len(segments) >= 3:
        for i in range(1, len(segments)):
            if abs(segments[i] - segments[i - 1]) > 10:
                transitions += 1

    # Also analyze pace variability from splits
    pace_cv = 0
    if splits and len(splits) >= 2:
        split_paces = [s["avg_pace"] for s in splits if s.get("avg_pace")]
        if len(split_paces) >= 2:
            pace_mean = sum(split_paces) / len(split_paces)
            pace_variance = sum((p - pace_mean) ** 2 for p in split_paces) / len(split_paces)
            pace_cv = (pace_variance ** 0.5) / pace_mean * 100 if pace_mean > 0 else 0

    # Classification logic
    high_zone_pct = zone_pcts["z4"] + zone_pcts["z5"]
    tempo_zone_pct = zone_pcts["z3"]
    easy_zone_pct = zone_pcts["z1"] + zone_pcts["z2"]

    # Intervals: high HR variability with significant time in z4/z5
    if transitions >= 3 and high_zone_pct > 20:
        # Check for pyramid pattern: ascending then descending segment averages
        if len(segments) >= 5:
            mid = len(segments) // 2
            ascending = all(segments[i] <= segments[i + 1] for i in range(mid - 1))
            descending = all(segments[i] >= segments[i + 1] for i in range(mid, len(segments) - 1))
            if ascending and descending:
                details["reason"] = f"Pyramid HR pattern detected: {transitions} transitions, peak in middle segments"
                return "pyramid", details

        details["reason"] = f"High HR variability with {transitions} transitions, {high_zone_pct:.0f}% in z4/z5"
        return "intervals", details

    # Tempo: sustained time in z3 (70-80% max HR)
    if tempo_zone_pct >= 40 and pace_cv < 15:
        details["reason"] = f"{tempo_zone_pct:.0f}% of time in tempo zone (z3), steady pace (CV={pace_cv:.1f}%)"
        return "tempo", details

    # Threshold: sustained z4 effort
    if zone_pcts["z4"] >= 30 and transitions < 3:
        details["reason"] = f"{zone_pcts['z4']:.0f}% in threshold zone (z4), steady effort"
        return "threshold", details

    # Progression: steadily increasing HR / decreasing pace over the activity
    if len(segments) >= 4:
        increasing = sum(1 for i in range(1, len(segments)) if segments[i] > segments[i - 1])
        if increasing >= len(segments) * 0.7:
            details["reason"] = f"Progressively increasing HR across {len(segments)} segments ({increasing} ascending)"
            return "progression", details

    # Long run: duration > 75min, mostly easy zones
    if duration_seconds and duration_seconds > 4500 and easy_zone_pct >= 50:
        details["reason"] = f"Long duration ({duration_seconds / 60:.0f}min), {easy_zone_pct:.0f}% in easy zones"
        return "long run", details

    # Recovery: predominantly z1, very easy
    if zone_pcts["z1"] >= 50 and high_zone_pct < 10:
        details["reason"] = f"{zone_pcts['z1']:.0f}% in recovery zone (z1), low intensity"
        return "recovery", details

    # Base/Easy: predominantly z2
    if easy_zone_pct >= 60 and high_zone_pct < 15:
        details["reason"] = f"{easy_zone_pct:.0f}% in easy zones (z1+z2)"
        return "easy", details

    # Race effort: high sustained HR with low variability
    if high_zone_pct >= 50 and transitions < 3:
        details["reason"] = f"{high_zone_pct:.0f}% in high zones (z4+z5), sustained effort"
        return "race effort", details

    # Default
    details["reason"] = f"Mixed effort: z1+z2={easy_zone_pct:.0f}%, z3={tempo_zone_pct:.0f}%, z4+z5={high_zone_pct:.0f}%"
    return "mixed", details


def fetch_activity_details(client: Garmin, activity_id: int, activity_type: str | None = None,
                           avg_hr: int | None = None, max_hr: int | None = None,
                           duration_seconds: float | None = None) -> dict | None:
    """Fetch detailed metrics for a single activity.

    Returns a parsed dict with time-series data and workout classification,
    or None if the activity type is not aerobic or no data is available.
    """
    # Only fetch details for aerobic activities
    if activity_type and activity_type not in AEROBIC_TYPES:
        log.debug("Skipping non-aerobic activity %d (type: %s)", activity_id, activity_type)
        return None

    log.info("Fetching activity details for %d (type: %s)", activity_id, activity_type)

    try:
        raw = client.get_activity_details(activity_id)
    except Exception as exc:
        log.warning("Failed to fetch details for activity %d: %s", activity_id, exc)
        return None

    if not raw:
        log.debug("No detail data for activity %d", activity_id)
        return None

    # Extract the metrics detail array
    metric_descriptors = raw.get("metricDescriptors") or []
    activity_detail_metrics = raw.get("activityDetailMetrics") or []

    # Build key mapping from descriptors
    # Garmin returns descriptors like [{"metricsIndex": 0, "key": "directTimestamp"}, ...]
    key_map = {}
    for desc in metric_descriptors:
        key_map[desc.get("metricsIndex")] = desc.get("key")

    # Parse the flat metrics array into structured samples
    # Each entry in activityDetailMetrics has a "metrics" array that maps by index to descriptors
    hr_samples = []
    pace_samples = []
    elevation_samples = []
    cadence_samples = []

    for sample in activity_detail_metrics:
        metrics = sample.get("metrics") or []
        timestamp = None
        hr = None
        speed = None
        elev = None
        cadence = None

        for idx, value in enumerate(metrics):
            if value is None:
                continue
            key = key_map.get(idx, "")
            if key == "directTimestamp":
                timestamp = value
            elif key == "directHeartRate":
                hr = value
            elif key == "directSpeed":
                speed = value
            elif key == "directElevation":
                elev = value
            elif key in ("directRunCadence", "directBikeCadence"):
                cadence = value

        # Use metricsIndex as time offset if no timestamp
        t = sample.get("metricsIndex", 0)

        if hr is not None and hr > 0:
            hr_samples.append({"t": t, "v": int(hr)})
        if speed is not None and speed > 0:
            # Convert m/s to min/km for pace
            pace_min_per_km = round(1000 / (speed * 60), 2)
            pace_samples.append({"t": t, "v": pace_min_per_km})
        if elev is not None:
            elevation_samples.append({"t": t, "v": round(elev, 1)})
        if cadence is not None and cadence > 0:
            cadence_samples.append({"t": t, "v": int(cadence)})

    # Also try to get splits
    splits = []
    try:
        splits_raw = client.get_activity_splits(activity_id)
        if splits_raw:
            lap_list = splits_raw.get("lapDTOs") or splits_raw.get("splitDTOs") or []
            splits = _extract_splits(lap_list)
    except Exception as exc:
        log.warning("Failed to fetch splits for activity %d: %s", activity_id, exc)

    # Classify the workout
    classification, classification_details = _classify_workout(
        hr_samples, pace_samples, splits,
        avg_hr, max_hr, activity_type, duration_seconds,
    )

    # Downsample time-series if too many points (keep ~200 points max)
    def _downsample(samples: list[dict], max_points: int = 200) -> list[dict]:
        if len(samples) <= max_points:
            return samples
        step = len(samples) / max_points
        return [samples[int(i * step)] for i in range(max_points)]

    return {
        "activity_id": activity_id,
        "activity_type": activity_type,
        "duration_seconds": duration_seconds,
        "distance_meters": None,  # filled by caller from activity summary
        "heart_rate_samples": json.dumps(_downsample(hr_samples)),
        "pace_samples": json.dumps(_downsample(pace_samples)),
        "elevation_samples": json.dumps(_downsample(elevation_samples)),
        "cadence_samples": json.dumps(_downsample(cadence_samples)),
        "splits": json.dumps(splits),
        "workout_classification": classification,
        "classification_details": json.dumps(classification_details),
        "raw_json": json.dumps(raw),
    }


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
