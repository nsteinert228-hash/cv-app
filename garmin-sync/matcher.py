"""Activity-to-plan matching engine.

Matches Garmin activities against season_workouts to produce
plan_completions with 0-100 scoring. Runs post-sync as a
reconciliation step. No Garmin API dependency — reads only
from Supabase tables.
"""

import json
import logging
from datetime import date, timedelta
from typing import Any

from supabase import Client

import supabase_client

log = logging.getLogger(__name__)

# ── Type mapping ──────────────────────────────────────────────

# Plan workout_type → compatible Garmin activity_type values
PLAN_TO_GARMIN = {
    "cardio": {
        "running", "trail_running", "treadmill_running",
        "cycling", "indoor_cycling", "mountain_biking",
        "lap_swimming", "open_water_swimming",
        "elliptical", "stair_climbing", "hiking", "rowing",
        "indoor_rowing",
    },
    "strength": {
        "strength_training", "indoor_cardio",
    },
    "recovery": {
        "yoga", "pilates", "breathwork", "walking", "stretching",
    },
    "mixed": {
        "running", "cycling", "strength_training", "indoor_cardio",
        "elliptical", "hiking", "rowing",
    },
    "rest": set(),
}

# Workout classification → plan intensity level
CLASSIFICATION_INTENSITY = {
    "intervals": "high",
    "tempo": "moderate",
    "threshold": "high",
    "progression": "moderate",
    "recovery": "low",
    "easy": "low",
    "long run": "moderate",
    "race effort": "high",
    "mixed": "moderate",
    "pyramid": "high",
    "unclassified": "moderate",
}

# Plan intensity ordering for comparison
INTENSITY_RANK = {"low": 1, "moderate": 2, "high": 3, "rest": 0}


# ── Activity classifier ──────────────────────────────────────


def classify_activity(
    activity: dict,
    metrics: dict | None = None,
) -> dict:
    """Classify a Garmin activity into plan-compatible terms.

    Returns {
        plan_type: str,        # cardio/strength/recovery/mixed
        intensity: str,        # low/moderate/high
        classification: str,   # from activity_metrics or inferred
        zones: dict,           # HR zone percentages if available
    }
    """
    atype = (activity.get("activity_type") or "").lower()
    avg_hr = activity.get("avg_heart_rate") or 0
    duration_s = activity.get("duration_seconds") or 0
    duration_min = duration_s / 60

    # Use activity_metrics classification if available
    classification = None
    zones = {}
    if metrics:
        classification = metrics.get("workout_classification")
        details = metrics.get("classification_details")
        if isinstance(details, str):
            try:
                details = json.loads(details)
            except (json.JSONDecodeError, TypeError):
                details = {}
        if isinstance(details, dict):
            zones = details.get("zones", {})

    # Determine plan_type from Garmin activity_type
    plan_type = "cardio"  # default
    if atype in PLAN_TO_GARMIN.get("strength", set()):
        plan_type = "strength"
    elif atype in PLAN_TO_GARMIN.get("recovery", set()):
        plan_type = "recovery"
    elif atype in PLAN_TO_GARMIN.get("cardio", set()):
        # Check if it's actually a recovery effort based on HR/classification
        if classification in ("recovery", "easy") or (avg_hr > 0 and avg_hr < 120 and duration_min < 30):
            plan_type = "recovery"
        else:
            plan_type = "cardio"

    # Determine intensity
    if classification:
        intensity = CLASSIFICATION_INTENSITY.get(classification, "moderate")
    elif avg_hr > 0:
        # Rough HR-based intensity (assumes typical zones)
        if avg_hr < 120:
            intensity = "low"
        elif avg_hr < 150:
            intensity = "moderate"
        else:
            intensity = "high"
    else:
        intensity = "moderate"

    return {
        "plan_type": plan_type,
        "intensity": intensity,
        "classification": classification or "unknown",
        "zones": zones,
    }


# ── Scoring ───────────────────────────────────────────────────


def score_match(
    workout: dict,
    activity: dict,
    metrics: dict | None,
    classified: dict,
) -> tuple[float, float, dict, str]:
    """Score how well an activity matches a planned workout.

    Returns (completion_score, match_confidence, breakdown, match_reason).
    """
    w_type = workout.get("workout_type", "")
    w_intensity = workout.get("intensity", "moderate")
    w_duration = workout.get("duration_minutes") or 0
    w_date = workout.get("date", "")
    w_title = workout.get("title", "")

    a_date = activity.get("date", "")
    a_type = (activity.get("activity_type") or "").lower()
    a_name = activity.get("name") or a_type
    a_duration_min = (activity.get("duration_seconds") or 0) / 60
    a_distance_m = activity.get("distance_meters") or 0

    # ── Type score (25%) ──
    compatible_types = PLAN_TO_GARMIN.get(w_type, set())
    if a_type in compatible_types:
        type_score = 100
    elif classified["plan_type"] == w_type:
        type_score = 90  # semantic match (e.g., hiking classified as cardio)
    elif w_type == "mixed":
        type_score = 70  # mixed accepts almost anything
    elif w_type in ("cardio", "mixed") and classified["plan_type"] in ("cardio", "mixed"):
        type_score = 60  # adjacent type
    else:
        type_score = 20  # wrong type entirely

    # ── Duration score (30%) ──
    if w_duration > 0 and a_duration_min > 0:
        ratio = a_duration_min / w_duration
        if 0.8 <= ratio <= 1.2:
            duration_score = 100  # within 20%
        elif ratio > 1.2:
            duration_score = max(60, 100 - (ratio - 1.2) * 100)  # over-performed
        else:
            duration_score = max(0, ratio / 0.8 * 100)  # under-performed
        duration_score = min(100, max(0, duration_score))
    elif w_duration == 0:
        duration_score = 80  # no duration prescribed → assume good
    else:
        duration_score = 50  # activity has no duration data

    # ── Intensity score (30%) ──
    w_rank = INTENSITY_RANK.get(w_intensity, 2)
    a_rank = INTENSITY_RANK.get(classified["intensity"], 2)
    intensity_diff = abs(w_rank - a_rank)
    if intensity_diff == 0:
        intensity_score = 100
    elif intensity_diff == 1:
        intensity_score = 70
    else:
        intensity_score = 30

    # ── Date score (15%) ──
    if a_date == w_date:
        date_score = 100
    else:
        date_score = 70  # ±1 day

    # ── Weighted total ──
    completion_score = round(
        type_score * 0.25
        + duration_score * 0.30
        + intensity_score * 0.30
        + date_score * 0.15,
        1,
    )

    # ── Confidence ──
    confidence = min(99, round(
        (type_score * 0.4 + date_score * 0.4 + duration_score * 0.2) / 100 * 95
    ))

    # ── Match reason ──
    reason = _build_reason(
        a_name, a_duration_min, a_distance_m, w_type, w_title,
        w_duration, completion_score, classified, a_date, w_date,
    )

    breakdown = {
        "type_score": round(type_score),
        "duration_score": round(duration_score),
        "intensity_score": round(intensity_score),
        "date_score": round(date_score),
    }

    return completion_score, confidence, breakdown, reason


def _build_reason(
    a_name, a_dur_min, a_dist_m, w_type, w_title,
    w_dur, score, classified, a_date, w_date,
) -> str:
    """Build a plain English match explanation."""
    dist_str = f"{a_dist_m / 1609:.1f} mi" if a_dist_m else ""
    dur_str = f"{a_dur_min:.0f} min" if a_dur_min else ""
    detail = ", ".join(filter(None, [dur_str, dist_str]))

    cls = classified.get("classification", "")
    cls_str = f" at {cls} pace" if cls and cls not in ("unknown", "unclassified") else ""

    if score >= 85:
        verb = "Great match"
    elif score >= 60:
        verb = "Good match"
    elif score >= 40:
        verb = "Partial match"
    else:
        verb = "Weak match"

    day_note = ""
    if a_date != w_date:
        day_note = f" (done {'day before' if a_date < w_date else 'day after'})"

    return f"{verb} — {a_name} ({detail}){cls_str} matched your {w_type} day \"{w_title}\"{day_note}."


# ── Candidate finder ──────────────────────────────────────────


def find_candidates(
    activities: list[dict],
    metrics_map: dict[int, dict],
    workout: dict,
) -> list[tuple[dict, dict | None, dict]]:
    """Find activity candidates for a workout within ±1 day.

    Returns [(activity, metrics_or_none, classified), ...] sorted
    by date proximity (same day first).
    """
    w_date = date.fromisoformat(workout["date"])
    candidates = []

    for act in activities:
        a_date = date.fromisoformat(act["date"])
        if abs((a_date - w_date).days) > 1:
            continue

        metrics = metrics_map.get(act.get("activity_id"))
        classified = classify_activity(act, metrics)
        candidates.append((act, metrics, classified))

    # Sort: same day first, then by date proximity
    candidates.sort(key=lambda c: abs((date.fromisoformat(c[0]["date"]) - w_date).days))
    return candidates


# ── Best match selector (greedy) ──────────────────────────────


def select_best_matches(
    workouts: list[dict],
    activities: list[dict],
    metrics_map: dict[int, dict],
) -> list[dict]:
    """Assign activities to workouts using greedy best-match.

    Returns a list of completion dicts ready for upsert.
    """
    # Score all (workout, activity) pairs
    pairs: list[tuple[float, float, dict, dict, dict, str]] = []

    for w in workouts:
        if w.get("workout_type") == "rest":
            continue  # handled separately below

        candidates = find_candidates(activities, metrics_map, w)
        for act, metrics, classified in candidates:
            score, confidence, breakdown, reason = score_match(w, act, metrics, classified)
            pairs.append((confidence, score, w, act, breakdown, reason))

    # Sort by confidence descending
    pairs.sort(key=lambda p: p[0], reverse=True)

    # Greedy assignment: highest confidence first
    used_workouts: set[str] = set()
    used_activities: set[int] = set()
    completions: list[dict] = []

    for confidence, score, w, act, breakdown, reason in pairs:
        w_id = w["id"]
        a_id = act.get("activity_id")

        if w_id in used_workouts or a_id in used_activities:
            continue

        used_workouts.add(w_id)
        used_activities.add(a_id)

        # Determine match type
        if act["date"] == w["date"]:
            a_type = (act.get("activity_type") or "").lower()
            if a_type in PLAN_TO_GARMIN.get(w.get("workout_type", ""), set()):
                match_type = "exact"
            else:
                match_type = "substitute"
        else:
            match_type = "fuzzy_date"

        completions.append({
            "workout_id": w_id,
            "season_id": w.get("season_id") or w.get("_season_id"),
            "activity_id": a_id,
            "match_date": w["date"],
            "activity_date": act["date"],
            "match_type": match_type,
            "match_confidence": confidence,
            "completion_score": score,
            "match_reason": reason,
            "scoring_breakdown": json.dumps(breakdown),
        })

    # Handle unmatched workouts (non-rest)
    today_str = date.today().isoformat()
    for w in workouts:
        w_id = w["id"]
        if w_id in used_workouts:
            continue
        if w.get("workout_type") == "rest":
            # Rest days auto-complete
            completions.append({
                "workout_id": w_id,
                "season_id": w.get("season_id") or w.get("_season_id"),
                "activity_id": None,
                "match_date": w["date"],
                "activity_date": None,
                "match_type": "rest_day",
                "match_confidence": 100,
                "completion_score": 100,
                "match_reason": "Rest day — recovery is part of the plan.",
                "scoring_breakdown": json.dumps({}),
            })
        elif w["date"] <= today_str:
            # Past workout with no match = truly missed
            completions.append({
                "workout_id": w_id,
                "season_id": w.get("season_id") or w.get("_season_id"),
                "activity_id": None,
                "match_date": w["date"],
                "activity_date": None,
                "match_type": "unmatched",
                "match_confidence": 0,
                "completion_score": 0,
                "match_reason": "No matching activity found for this workout.",
                "scoring_breakdown": json.dumps({}),
            })
        # Future workouts: skip, no completion yet

    return completions


# ── Reconciliation orchestrator ───────────────────────────────


def reconcile_user(
    sb: Client,
    user_id: str,
    date_range: tuple[str, str] | None = None,
    force: bool = False,
) -> dict:
    """Match activities to planned workouts for a user.

    If date_range is None, processes the full active season.
    force=True re-matches even overridden completions.

    Returns {matched, unmatched, rest, skipped_override, updated}.
    """
    season = supabase_client.fetch_active_season(sb, user_id)
    if not season:
        log.info("No active season for user %s, skipping match", user_id)
        return {"matched": 0, "unmatched": 0, "rest": 0, "skipped_override": 0, "updated": 0}

    season_id = season["id"]
    start = date_range[0] if date_range else season.get("start_date", date.today().isoformat())
    end = date_range[1] if date_range else (date.today() + timedelta(days=1)).isoformat()

    # Fetch data
    workouts = supabase_client.fetch_season_workouts(sb, user_id, season_id, start, end)
    if not workouts:
        log.info("No workouts in range %s to %s", start, end)
        return {"matched": 0, "unmatched": 0, "rest": 0, "skipped_override": 0, "updated": 0}

    # Inject season_id into workouts (some queries don't include it)
    for w in workouts:
        w["_season_id"] = season_id

    # Buffer ±1 day for fuzzy matching
    buf_start = (date.fromisoformat(start) - timedelta(days=1)).isoformat()
    buf_end = (date.fromisoformat(end) + timedelta(days=1)).isoformat()

    activities = supabase_client.fetch_activities_in_range(sb, user_id, buf_start, buf_end)
    activity_ids = [a["activity_id"] for a in activities if a.get("activity_id")]
    metrics_map = supabase_client.fetch_activity_metrics_map(sb, user_id, activity_ids)

    # Fetch existing completions to check overrides
    existing = supabase_client.fetch_plan_completions(sb, user_id, season_id)
    override_set = {c["workout_id"] for c in existing if c.get("overridden")}

    # Filter out overridden workouts unless force=True
    if not force:
        workouts = [w for w in workouts if w["id"] not in override_set]

    # Run matching
    completions = select_best_matches(workouts, activities, metrics_map)

    # Upsert results
    stats = {"matched": 0, "unmatched": 0, "rest": 0, "skipped_override": 0, "updated": 0}

    for c in completions:
        if c["workout_id"] in override_set and not force:
            stats["skipped_override"] += 1
            continue

        c["season_id"] = season_id
        supabase_client.upsert_plan_completion(sb, c, user_id)

        if c["match_type"] == "rest_day":
            stats["rest"] += 1
        elif c["match_type"] == "unmatched":
            stats["unmatched"] += 1
        else:
            stats["matched"] += 1

        # Also update workout_logs adherence if a log exists
        if c.get("completion_score") is not None:
            updated = supabase_client.update_workout_log_adherence(
                sb, c["workout_id"], c["completion_score"]
            )
            stats["updated"] += updated

    log.info(
        "Matching complete for user %s: %d matched, %d unmatched, %d rest, %d overrides skipped",
        user_id, stats["matched"], stats["unmatched"], stats["rest"], stats["skipped_override"],
    )
    return stats


def recalculate_adherence(
    sb: Client,
    user_id: str,
    week_number: int | None = None,
) -> dict:
    """Recalculate adherence stats from plan_completions.

    Returns {total, completed, adherence_pct, by_week: {week: pct}}.
    """
    season = supabase_client.fetch_active_season(sb, user_id)
    if not season:
        return {"total": 0, "completed": 0, "adherence_pct": 0, "by_week": {}}

    completions = supabase_client.fetch_plan_completions(sb, user_id, season["id"])

    # Fetch workouts to get week numbers
    workouts = supabase_client.fetch_season_workouts(
        sb, user_id, season["id"],
        season.get("start_date", "2000-01-01"),
        date.today().isoformat(),
    )
    w_map = {w["id"]: w for w in workouts}

    by_week: dict[int, list[float]] = {}
    total = 0
    completed = 0

    for c in completions:
        w = w_map.get(c["workout_id"])
        if not w:
            continue
        wk = w.get("week_number", 0)
        if week_number is not None and wk != week_number:
            continue

        score = c.get("completion_score") or 0
        if wk not in by_week:
            by_week[wk] = []
        by_week[wk].append(score)
        total += 1
        if score >= 40:
            completed += 1

    week_pcts = {}
    for wk, scores in sorted(by_week.items()):
        count_done = sum(1 for s in scores if s >= 40)
        week_pcts[wk] = round(count_done / len(scores) * 100) if scores else 0

    overall_pct = round(completed / total * 100) if total > 0 else 0

    return {
        "total": total,
        "completed": completed,
        "adherence_pct": overall_pct,
        "by_week": week_pcts,
    }
