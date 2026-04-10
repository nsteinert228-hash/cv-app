"""Activity-to-plan matching engine.

Matches Garmin activities against season_workouts to produce
plan_completions with 0-100 scoring. Runs post-sync as a
reconciliation step. No Garmin API dependency — reads only
from Supabase tables.
"""

import json
import logging
import math
import re
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

# Structure adjacency — which workout types are "close enough"
STRUCTURE_ADJACENCY: dict[str, set[str]] = {
    "intervals": {"threshold", "pyramid", "race effort"},
    "tempo": {"threshold", "progression"},
    "threshold": {"tempo", "intervals", "race effort"},
    "easy": {"recovery", "long run"},
    "recovery": {"easy"},
    "long run": {"easy", "progression"},
    "progression": {"tempo", "long run"},
    "pyramid": {"intervals"},
    "race effort": {"threshold", "intervals"},
}

# Keywords in prescription text / title → expected classification
STRUCTURE_KEYWORDS: dict[str, str] = {
    "interval": "intervals",
    "tempo": "tempo",
    "threshold": "threshold",
    "easy": "easy",
    "recovery": "recovery",
    "long run": "long run",
    "progression": "progression",
    "fartlek": "intervals",
    "speed": "intervals",
    "hill repeat": "intervals",
    "steady state": "tempo",
    "race pace": "race effort",
}

# Expected HR zone profiles per workout classification (z1-z5 as percentages)
EXPECTED_ZONE_PROFILES: dict[str, dict[str, float]] = {
    "recovery": {"z1": 50, "z2": 30, "z3": 15, "z4": 5, "z5": 0},
    "easy": {"z1": 30, "z2": 45, "z3": 20, "z4": 5, "z5": 0},
    "long run": {"z1": 20, "z2": 40, "z3": 30, "z4": 10, "z5": 0},
    "tempo": {"z1": 10, "z2": 15, "z3": 45, "z4": 25, "z5": 5},
    "threshold": {"z1": 5, "z2": 10, "z3": 20, "z4": 45, "z5": 20},
    "intervals": {"z1": 15, "z2": 15, "z3": 15, "z4": 30, "z5": 25},
    "race effort": {"z1": 5, "z2": 5, "z3": 15, "z4": 35, "z5": 40},
    "progression": {"z1": 15, "z2": 25, "z3": 35, "z4": 20, "z5": 5},
    "pyramid": {"z1": 10, "z2": 15, "z3": 20, "z4": 30, "z5": 25},
}

# Intensity → fallback zone profile when no structural keyword found
INTENSITY_ZONE_PROFILE: dict[str, str] = {
    "low": "easy",
    "moderate": "tempo",
    "high": "intervals",
}

# Intensity → expected aerobic training effect range
INTENSITY_TE_RANGE: dict[str, tuple[float, float]] = {
    "low": (1.0, 2.5),
    "moderate": (2.0, 3.5),
    "high": (3.0, 5.0),
}


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

    Uses four core dimensions (type, duration, intensity, date) plus
    three time-series dimensions (structure, zones, effort) when
    activity_metrics data is available.

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

    # ── Type score ──
    compatible_types = PLAN_TO_GARMIN.get(w_type, set())
    if a_type in compatible_types:
        type_score = 100
    elif classified["plan_type"] == w_type:
        type_score = 90
    elif w_type == "mixed":
        type_score = 70
    elif w_type in ("cardio", "mixed") and classified["plan_type"] in ("cardio", "mixed"):
        type_score = 60
    else:
        type_score = 20

    # ── Duration score ──
    if w_duration > 0 and a_duration_min > 0:
        ratio = a_duration_min / w_duration
        if 0.8 <= ratio <= 1.2:
            duration_score = 100
        elif ratio > 1.2:
            duration_score = max(60, 100 - (ratio - 1.2) * 100)
        else:
            duration_score = max(0, ratio / 0.8 * 100)
        duration_score = min(100, max(0, duration_score))
    elif w_duration == 0:
        duration_score = 80
    else:
        duration_score = 50

    # ── Intensity score ──
    w_rank = INTENSITY_RANK.get(w_intensity, 2)
    a_rank = INTENSITY_RANK.get(classified["intensity"], 2)
    intensity_diff = abs(w_rank - a_rank)
    if intensity_diff == 0:
        intensity_score = 100
    elif intensity_diff == 1:
        intensity_score = 70
    else:
        intensity_score = 30

    # ── Date score ──
    date_score = 100 if a_date == w_date else 70

    # ── Time-series dimensions (when data available) ──
    has_timeseries = bool(metrics and metrics.get("heart_rate_samples"))
    structure_score = None
    zone_score = None
    effort_score = None
    zone_pcts = classified.get("zones") or None
    pace_cv = None
    aero_te = activity.get("aerobic_training_effect")

    if has_timeseries:
        structure_score = _score_structure(workout, metrics, classified)
        zone_score = _score_zones(workout, classified)
        effort_score, pace_cv = _score_effort(workout, activity, metrics, classified)

    # ── Weighted total (adaptive) ──
    if has_timeseries and structure_score is not None:
        completion_score = round(
            type_score * 0.15
            + duration_score * 0.20
            + intensity_score * 0.10
            + date_score * 0.10
            + structure_score * 0.15
            + (zone_score or intensity_score) * 0.15
            + (effort_score or 50) * 0.15,
            1,
        )
    else:
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

    # ── Breakdown ──
    breakdown: dict[str, Any] = {
        "type_score": round(type_score),
        "duration_score": round(duration_score),
        "intensity_score": round(intensity_score),
        "date_score": round(date_score),
    }
    if has_timeseries:
        if structure_score is not None:
            breakdown["structure_score"] = round(structure_score)
        if zone_score is not None:
            breakdown["zone_score"] = round(zone_score)
        if effort_score is not None:
            breakdown["effort_score"] = round(effort_score)
        if zone_pcts:
            breakdown["zones"] = zone_pcts
        breakdown["classification"] = classified.get("classification")
        if pace_cv is not None:
            breakdown["pace_cv"] = round(pace_cv, 1)
        if aero_te is not None:
            breakdown["aerobic_te"] = round(aero_te, 1)

    # ── Match reason ──
    reason = _build_reason(
        a_name, a_duration_min, a_distance_m, w_type, w_title,
        w_duration, completion_score, classified, a_date, w_date,
        zone_pcts=zone_pcts, pace_cv=pace_cv, training_effect=aero_te,
    )

    return completion_score, confidence, breakdown, reason


# ── Time-series scoring helpers ──────────────────────────────


def _extract_expected_structure(workout: dict) -> str | None:
    """Extract expected workout structure from prescription text and title."""
    text = ""
    rx = workout.get("prescription_json")
    if isinstance(rx, dict):
        text = (rx.get("description") or "") + " " + (rx.get("notes") or "")
    elif isinstance(rx, str):
        text = rx
    text = (text + " " + (workout.get("title") or "")).lower()

    for keyword, classification in STRUCTURE_KEYWORDS.items():
        if keyword in text:
            return classification
    return None


def _score_structure(workout: dict, metrics: dict | None, classified: dict) -> int:
    """Score: does the workout's HR/pace pattern match the prescribed structure?"""
    actual = classified.get("classification", "unknown")
    if actual in ("unknown", "unclassified"):
        return 50

    expected = _extract_expected_structure(workout)
    if not expected:
        # No structural keywords — fall back to intensity-compatible check
        w_intensity = workout.get("intensity", "moderate")
        expected_from_intensity = CLASSIFICATION_INTENSITY.get(actual)
        if expected_from_intensity == w_intensity:
            return 80
        return 50

    if actual == expected:
        return 100
    if expected in STRUCTURE_ADJACENCY and actual in STRUCTURE_ADJACENCY[expected]:
        return 75
    if CLASSIFICATION_INTENSITY.get(actual) == CLASSIFICATION_INTENSITY.get(expected):
        return 60
    return 20


def _zone_cosine_similarity(expected: dict, actual: dict) -> float:
    """Cosine similarity between two zone profile vectors, scaled 0-100."""
    keys = ["z1", "z2", "z3", "z4", "z5"]
    e = [expected.get(k, 0) for k in keys]
    a = [actual.get(k, 0) for k in keys]
    dot = sum(x * y for x, y in zip(e, a))
    mag_e = math.sqrt(sum(x * x for x in e))
    mag_a = math.sqrt(sum(x * x for x in a))
    if mag_e == 0 or mag_a == 0:
        return 50
    return round(dot / (mag_e * mag_a) * 100)


def _score_zones(workout: dict, classified: dict) -> int:
    """Score: does time-in-zones match the intended workout type?"""
    actual_zones = classified.get("zones")
    if not actual_zones:
        return 50

    expected_structure = _extract_expected_structure(workout)

    if expected_structure and expected_structure in EXPECTED_ZONE_PROFILES:
        expected = EXPECTED_ZONE_PROFILES[expected_structure]
    else:
        w_intensity = workout.get("intensity", "moderate")
        profile_key = INTENSITY_ZONE_PROFILE.get(w_intensity, "tempo")
        expected = EXPECTED_ZONE_PROFILES.get(profile_key, EXPECTED_ZONE_PROFILES["tempo"])

    return _zone_cosine_similarity(expected, actual_zones)


def _score_effort(
    workout: dict, activity: dict, metrics: dict | None, classified: dict,
) -> tuple[int, float | None]:
    """Score: training effect alignment + pace consistency.

    Returns (effort_score, pace_cv_or_none).
    """
    sub_scores: list[float] = []
    pace_cv = None

    # 1. Training effect alignment
    aero_te = activity.get("aerobic_training_effect")
    w_intensity = workout.get("intensity", "moderate")
    if aero_te is not None:
        te_min, te_max = INTENSITY_TE_RANGE.get(w_intensity, (2.0, 3.5))
        if te_min <= aero_te <= te_max:
            sub_scores.append(100)
        else:
            dist = te_min - aero_te if aero_te < te_min else aero_te - te_max
            sub_scores.append(max(20, 100 - dist * 40))

    # 2. Pace consistency from splits
    if metrics:
        splits = metrics.get("splits")
        if isinstance(splits, str):
            try:
                splits = json.loads(splits)
            except (json.JSONDecodeError, TypeError):
                splits = None
        if splits and len(splits) >= 3:
            paces = [
                s.get("avg_pace") or s.get("duration_s", 0) / max(s.get("distance_m", 1), 1) * 1000
                for s in splits if s.get("distance_m", 0) > 100
            ]
            if len(paces) >= 3:
                mean_pace = sum(paces) / len(paces)
                if mean_pace > 0:
                    std_pace = math.sqrt(sum((p - mean_pace) ** 2 for p in paces) / len(paces))
                    pace_cv = (std_pace / mean_pace) * 100

                    actual_cls = classified.get("classification", "")
                    expected_struct = _extract_expected_structure(workout)
                    is_interval_type = (expected_struct or actual_cls) in (
                        "intervals", "pyramid", "fartlek",
                    )
                    if is_interval_type:
                        sub_scores.append(min(100, pace_cv * 4))
                    else:
                        sub_scores.append(max(20, 100 - max(0, (pace_cv - 5)) * 5))

    if not sub_scores:
        return 50, pace_cv

    return round(sum(sub_scores) / len(sub_scores)), pace_cv


def _build_reason(
    a_name, a_dur_min, a_dist_m, w_type, w_title,
    w_dur, score, classified, a_date, w_date,
    zone_pcts=None, pace_cv=None, training_effect=None,
) -> str:
    """Build a plain English match explanation with physiological detail."""
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

    base = f"{verb} — {a_name} ({detail}){cls_str}{day_note}."

    # Append physiological insights when available
    insights: list[str] = []
    if zone_pcts:
        top_zone = max(zone_pcts, key=lambda z: zone_pcts.get(z, 0))
        top_pct = zone_pcts.get(top_zone, 0)
        if top_pct > 0:
            zone_label = {
                "z1": "recovery", "z2": "easy", "z3": "tempo",
                "z4": "threshold", "z5": "VO2max",
            }.get(top_zone, top_zone)
            insights.append(f"{top_pct}% in {zone_label} zone")
    if pace_cv is not None:
        if pace_cv < 10:
            insights.append(f"steady pace (CV {pace_cv:.0f}%)")
        elif pace_cv > 20:
            insights.append(f"varied pace (CV {pace_cv:.0f}%)")
    if training_effect is not None:
        insights.append(f"{training_effect:.1f} TE")

    if insights:
        base = base.rstrip(".") + " — " + ", ".join(insights) + "."

    return base


# ── Candidate finder ──────────────────────────────────────────


def find_candidates(
    activities: list[dict],
    metrics_map: dict[int, dict],
    workout: dict,
) -> list[tuple[dict, dict | None, dict]]:
    """Find activity candidates for a workout within ±1 day.

    For today/future workouts, only same-day activities are candidates
    (no fuzzy matching with yesterday's activity for today's plan).

    Returns [(activity, metrics_or_none, classified), ...] sorted
    by date proximity (same day first).
    """
    w_date = date.fromisoformat(workout["date"])
    today = date.today()
    candidates = []

    for act in activities:
        a_date = date.fromisoformat(act["date"])
        day_diff = abs((a_date - w_date).days)

        if day_diff > 1:
            continue

        # For today/future workouts: only allow same-day matches
        # (don't match yesterday's activity to today's plan)
        if w_date >= today and day_diff > 0:
            continue

        # Don't match future activities to past workouts either
        if a_date > today:
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
    # ── Phase 1: Handle mixed workouts with multi-activity matching ──
    # Mixed workouts can be fulfilled by multiple activities on the same day
    # (e.g., a RUN + LIFT both count toward a MIX day)
    used_workouts: set[str] = set()
    used_activities: set[int] = set()
    completions: list[dict] = []

    for w in workouts:
        if w.get("workout_type") != "mixed" or w.get("workout_type") == "rest":
            continue

        same_day_acts = [a for a in activities if a["date"] == w["date"]]
        if not same_day_acts:
            continue

        # Combine all same-day activities into a composite match
        total_duration = sum(a.get("duration_seconds") or 0 for a in same_day_acts) / 60
        types_found = set()
        names = []
        activity_ids = []
        for a in same_day_acts:
            atype = (a.get("activity_type") or "").lower()
            metrics = metrics_map.get(a.get("activity_id"))
            cls = classify_activity(a, metrics)
            types_found.add(cls["plan_type"])
            names.append(a.get("name") or atype)
            activity_ids.append(a.get("activity_id"))

        # Score: mixed workouts get a bonus for having multiple activity types
        w_duration = w.get("duration_minutes") or 0
        dur_score = 100 if w_duration == 0 else min(100, max(0, (total_duration / w_duration) * 100)) if w_duration > 0 else 80
        type_diversity = len(types_found)
        type_score = min(100, 60 + type_diversity * 20)  # 80 for 1 type, 100 for 2+
        score = round(type_score * 0.35 + dur_score * 0.35 + 100 * 0.15 + 100 * 0.15, 1)  # date=100 (same day), intensity bonus
        confidence = min(95, round(type_score * 0.5 + 100 * 0.3 + dur_score * 0.2))

        names_str = " + ".join(names[:3])
        dur_str = f"{total_duration:.0f} min total"
        types_str = " + ".join(sorted(t.upper()[:3] for t in types_found))
        reason = f"Great match — {names_str} ({dur_str}, {types_str}) covered your mixed training day \"{w.get('title', '')}\"."

        used_workouts.add(w["id"])
        for aid in activity_ids:
            used_activities.add(aid)

        completions.append({
            "workout_id": w["id"],
            "season_id": w.get("season_id") or w.get("_season_id"),
            "activity_id": activity_ids[0] if activity_ids else None,  # primary activity
            "match_date": w["date"],
            "activity_date": w["date"],
            "match_type": "exact",
            "match_confidence": confidence,
            "completion_score": score,
            "match_reason": reason,
            "scoring_breakdown": json.dumps({
                "type_score": round(type_score),
                "duration_score": round(dur_score),
                "intensity_score": 100,
                "date_score": 100,
                "activities_matched": len(same_day_acts),
            }),
        })

    # ── Phase 2: Standard 1:1 matching for non-mixed workouts ──
    pairs: list[tuple[float, float, dict, dict, dict, str]] = []

    for w in workouts:
        if w.get("workout_type") == "rest" or w["id"] in used_workouts:
            continue

        candidates = find_candidates(activities, metrics_map, w)
        for act, metrics, classified in candidates:
            if act.get("activity_id") in used_activities:
                continue
            score, confidence, breakdown, reason = score_match(w, act, metrics, classified)
            pairs.append((confidence, score, w, act, breakdown, reason))

    # Sort by confidence descending
    pairs.sort(key=lambda p: p[0], reverse=True)

    # Greedy assignment: highest confidence first
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

        # Sync workout_logs with completion status
        # The frontend timeline reads workout_logs to show completion
        if c["match_type"] == "unmatched":
            # Remove any stale log for unmatched workouts
            try:
                sb.table("workout_logs").delete().eq("workout_id", c["workout_id"]).execute()
            except Exception:
                pass
        elif c.get("completion_score", 0) > 0:
            status = "completed" if c["completion_score"] >= 40 else "partial"
            log_row = {
                "workout_id": c["workout_id"],
                "user_id": user_id,
                "date": c["match_date"],
                "status": status,
                "source": "garmin_auto",
                "adherence_score": c["completion_score"],
                "actual_json": {},
            }
            if c.get("activity_id"):
                log_row["garmin_activity_id"] = str(c["activity_id"])
            try:
                supabase_client.upsert_workout_log(sb, log_row)
                stats["updated"] += 1
            except Exception as exc:
                log.warning("Failed to upsert workout_log for %s: %s", c["workout_id"], exc)

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
