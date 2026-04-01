"""Tests for the activity-to-plan matching engine."""

from unittest.mock import MagicMock, patch

import pytest

from matcher import (
    classify_activity,
    score_match,
    find_candidates,
    select_best_matches,
    reconcile_user,
)


# ── Fixtures ──────────────────────────────────────────────────


def _activity(
    activity_id=1, date="2026-03-30", activity_type="running",
    name="Morning Run", duration_seconds=2400, distance_meters=8000,
    avg_heart_rate=155, max_heart_rate=175, calories=400,
):
    return {
        "activity_id": activity_id,
        "date": date,
        "activity_type": activity_type,
        "name": name,
        "duration_seconds": duration_seconds,
        "distance_meters": distance_meters,
        "avg_heart_rate": avg_heart_rate,
        "max_heart_rate": max_heart_rate,
        "calories": calories,
    }


def _workout(
    id="w1", date="2026-03-30", workout_type="cardio",
    title="Base Run", intensity="moderate", duration_minutes=40,
    season_id="s1",
):
    return {
        "id": id,
        "date": date,
        "workout_type": workout_type,
        "title": title,
        "intensity": intensity,
        "duration_minutes": duration_minutes,
        "season_id": season_id,
    }


def _metrics(
    workout_classification="tempo",
    classification_details=None,
):
    return {
        "workout_classification": workout_classification,
        "classification_details": classification_details or {
            "zones": {"z1": 5, "z2": 15, "z3": 50, "z4": 25, "z5": 5},
            "reason": "50% tempo zone",
        },
    }


# ── classify_activity ─────────────────────────────────────────


class TestClassifyActivity:
    def test_running_classified_as_cardio(self):
        result = classify_activity(_activity(activity_type="running"))
        assert result["plan_type"] == "cardio"

    def test_strength_training(self):
        result = classify_activity(_activity(activity_type="strength_training", avg_heart_rate=90))
        assert result["plan_type"] == "strength"

    def test_yoga_classified_as_recovery(self):
        result = classify_activity(_activity(activity_type="yoga", avg_heart_rate=80))
        assert result["plan_type"] == "recovery"

    def test_low_hr_short_run_is_recovery(self):
        result = classify_activity(_activity(
            activity_type="running", avg_heart_rate=110,
            duration_seconds=1200,  # 20 min
        ))
        assert result["plan_type"] == "recovery"

    def test_uses_metrics_classification(self):
        result = classify_activity(
            _activity(),
            _metrics(workout_classification="intervals"),
        )
        assert result["classification"] == "intervals"
        assert result["intensity"] == "high"

    def test_uses_metrics_zones(self):
        result = classify_activity(
            _activity(),
            _metrics(classification_details={"zones": {"z1": 80, "z2": 20}}),
        )
        assert result["zones"]["z1"] == 80

    def test_high_hr_inferred_intensity(self):
        result = classify_activity(_activity(avg_heart_rate=170))
        assert result["intensity"] == "high"

    def test_no_hr_defaults_moderate(self):
        result = classify_activity(_activity(avg_heart_rate=0))
        assert result["intensity"] == "moderate"


# ── score_match ──────────────────────────────────────────────


class TestScoreMatch:
    def test_exact_match_high_score(self):
        """Running on planned cardio day with matching duration → high score."""
        w = _workout(duration_minutes=40)
        a = _activity(duration_seconds=2400)  # 40 min
        classified = classify_activity(a, _metrics(workout_classification="tempo"))

        score, confidence, breakdown, reason = score_match(w, a, _metrics(), classified)

        assert score >= 85
        assert confidence >= 80
        assert "Great match" in reason or "Good match" in reason
        assert breakdown["type_score"] == 100

    def test_short_duration_penalized(self):
        """15 min actual vs 40 min planned → lower duration score."""
        w = _workout(duration_minutes=40)
        a = _activity(duration_seconds=900)  # 15 min
        classified = classify_activity(a)

        score, _, breakdown, _ = score_match(w, a, None, classified)

        assert breakdown["duration_score"] < 60
        assert score < 85  # penalized but type+intensity still contribute

    def test_wrong_type_low_score(self):
        """Strength activity on cardio day → low type score."""
        w = _workout(workout_type="cardio")
        a = _activity(activity_type="strength_training", avg_heart_rate=90)
        classified = classify_activity(a)

        score, _, breakdown, _ = score_match(w, a, None, classified)

        assert breakdown["type_score"] < 50
        assert score < 80  # type penalty but duration/date still score

    def test_intensity_mismatch(self):
        """High-intensity plan + recovery effort → intensity penalty."""
        w = _workout(intensity="high")
        a = _activity(avg_heart_rate=110)
        classified = classify_activity(a, _metrics(workout_classification="recovery"))

        score, _, breakdown, _ = score_match(w, a, None, classified)

        assert breakdown["intensity_score"] < 50

    def test_fuzzy_date_penalty(self):
        """Activity on adjacent day → lower date score."""
        w = _workout(date="2026-03-30")
        a = _activity(date="2026-03-31")
        classified = classify_activity(a)

        _, _, breakdown, reason = score_match(w, a, None, classified)

        assert breakdown["date_score"] == 70
        assert "day after" in reason

    def test_no_prescribed_duration(self):
        """No duration in plan → assume decent match."""
        w = _workout(duration_minutes=0)
        a = _activity(duration_seconds=1800)
        classified = classify_activity(a)

        _, _, breakdown, _ = score_match(w, a, None, classified)

        assert breakdown["duration_score"] == 80

    def test_reason_plain_english(self):
        w = _workout(title="Tempo Run")
        a = _activity(name="Cambridge Running", distance_meters=9656)
        classified = classify_activity(a, _metrics(workout_classification="tempo"))

        _, _, _, reason = score_match(w, a, _metrics(), classified)

        assert "Cambridge Running" in reason
        assert "Tempo Run" in reason
        assert "mi" in reason


# ── find_candidates ──────────────────────────────────────────


class TestFindCandidates:
    def test_same_day_first(self):
        acts = [
            _activity(activity_id=1, date="2026-03-29"),
            _activity(activity_id=2, date="2026-03-30"),
        ]
        w = _workout(date="2026-03-30")

        candidates = find_candidates(acts, {}, w)

        assert candidates[0][0]["activity_id"] == 2  # same day first

    def test_excludes_outside_window(self):
        acts = [
            _activity(activity_id=1, date="2026-03-27"),  # 3 days before
            _activity(activity_id=2, date="2026-03-30"),
        ]
        w = _workout(date="2026-03-30")

        candidates = find_candidates(acts, {}, w)

        assert len(candidates) == 1
        assert candidates[0][0]["activity_id"] == 2

    def test_includes_adjacent_days(self):
        acts = [
            _activity(activity_id=1, date="2026-03-29"),
            _activity(activity_id=2, date="2026-03-30"),
            _activity(activity_id=3, date="2026-03-31"),
        ]
        w = _workout(date="2026-03-30")

        candidates = find_candidates(acts, {}, w)

        assert len(candidates) == 3


# ── select_best_matches ──────────────────────────────────────


class TestSelectBestMatches:
    def test_one_to_one_match(self):
        workouts = [_workout(id="w1", workout_type="cardio")]
        activities = [_activity(activity_id=1)]

        completions = select_best_matches(workouts, activities, {})

        assert len(completions) == 1
        assert completions[0]["workout_id"] == "w1"
        assert completions[0]["activity_id"] == 1
        assert completions[0]["match_type"] == "exact"
        assert completions[0]["completion_score"] > 0

    def test_rest_day_auto_complete(self):
        workouts = [_workout(id="w1", workout_type="rest", title="Rest Day")]

        completions = select_best_matches(workouts, [], {})

        assert len(completions) == 1
        assert completions[0]["match_type"] == "rest_day"
        assert completions[0]["completion_score"] == 100

    def test_unmatched_past_workout(self):
        workouts = [_workout(id="w1", date="2026-03-25")]  # past, no activity

        completions = select_best_matches(workouts, [], {})

        assert len(completions) == 1
        assert completions[0]["match_type"] == "unmatched"
        assert completions[0]["completion_score"] == 0

    def test_no_double_counting(self):
        """One activity should only match one workout."""
        workouts = [
            _workout(id="w1", date="2026-03-30", workout_type="cardio"),
            _workout(id="w2", date="2026-03-30", workout_type="strength"),
        ]
        activities = [_activity(activity_id=1, date="2026-03-30")]

        completions = select_best_matches(workouts, activities, {})

        matched = [c for c in completions if c["activity_id"] is not None]
        assert len(matched) == 1  # only one gets the activity

    def test_greedy_assigns_best_first(self):
        """Higher-confidence match should win."""
        workouts = [
            _workout(id="w1", workout_type="cardio", duration_minutes=40),
            _workout(id="w2", workout_type="strength", duration_minutes=30),
        ]
        activities = [
            _activity(activity_id=1, activity_type="running", duration_seconds=2400),
        ]

        completions = select_best_matches(workouts, activities, {})

        # Running should match cardio, not strength
        cardio_completion = next(c for c in completions if c["workout_id"] == "w1")
        assert cardio_completion["activity_id"] == 1

    def test_fuzzy_date_match(self):
        """Activity on adjacent day matches when same day has nothing."""
        workouts = [_workout(id="w1", date="2026-03-30")]
        activities = [_activity(activity_id=1, date="2026-03-31")]

        completions = select_best_matches(workouts, activities, {})

        assert completions[0]["match_type"] == "fuzzy_date"
        assert completions[0]["activity_date"] == "2026-03-31"


# ── reconcile_user ───────────────────────────────────────────


class TestReconcileUser:
    @patch("matcher.supabase_client")
    def test_no_active_season(self, mock_sb):
        mock_sb.fetch_active_season.return_value = None

        result = reconcile_user(MagicMock(), "user1")

        assert result["matched"] == 0

    @patch("matcher.supabase_client")
    def test_full_reconciliation(self, mock_sb):
        mock_sb.fetch_active_season.return_value = {
            "id": "s1", "start_date": "2026-03-28", "end_date": "2026-04-04",
        }
        mock_sb.fetch_season_workouts.return_value = [
            _workout(id="w1", date="2026-03-30", workout_type="cardio", season_id="s1"),
            _workout(id="w2", date="2026-03-28", workout_type="rest", title="Rest", season_id="s1"),
        ]
        mock_sb.fetch_activities_in_range.return_value = [
            _activity(activity_id=99, date="2026-03-30"),
        ]
        mock_sb.fetch_activity_metrics_map.return_value = {}
        mock_sb.fetch_plan_completions.return_value = []
        mock_sb.upsert_plan_completion.return_value = 1
        mock_sb.update_workout_log_adherence.return_value = 0

        result = reconcile_user(MagicMock(), "user1", date_range=("2026-03-28", "2026-03-30"))

        assert result["matched"] == 1  # cardio matched
        assert result["rest"] == 1     # rest auto-completed
        assert mock_sb.upsert_plan_completion.call_count == 2

    @patch("matcher.supabase_client")
    def test_respects_overrides(self, mock_sb):
        mock_sb.fetch_active_season.return_value = {
            "id": "s1", "start_date": "2026-03-28",
        }
        mock_sb.fetch_season_workouts.return_value = [
            _workout(id="w1", date="2026-03-30", season_id="s1"),
        ]
        mock_sb.fetch_activities_in_range.return_value = [
            _activity(activity_id=99, date="2026-03-30"),
        ]
        mock_sb.fetch_activity_metrics_map.return_value = {}
        mock_sb.fetch_plan_completions.return_value = [
            {"workout_id": "w1", "overridden": True},
        ]

        result = reconcile_user(MagicMock(), "user1", date_range=("2026-03-28", "2026-03-30"))

        assert result["matched"] == 0
        assert result["skipped_override"] == 0  # filtered before matching
        mock_sb.upsert_plan_completion.assert_not_called()
