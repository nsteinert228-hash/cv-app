import json
from unittest.mock import MagicMock, patch

import data_fetchers

DATE = "2026-03-01"


# ── fetch_daily_summary ────────────────────────────────────────


class TestFetchDailySummary:
    @patch("data_fetchers.garmin_service")
    def test_maps_fields_to_schema(self, mock_gs):
        raw = {
            "totalSteps": 8500,
            "floorsAscended": 12,
            "totalKilocalories": 2100,
            "activeKilocalories": 500,
            "bmrKilocalories": 1600,
            "totalDistanceMeters": 6200.5,
            "moderateIntensityMinutes": 30,
            "vigorousIntensityMinutes": 15,
            "averageStressLevel": 35,
            "maxStressLevel": 80,
            "stressQualifier": "low",
            "restingHeartRate": 62,
            "maxHeartRate": 165,
            "minHeartRate": 48,
        }
        mock_gs.fetch_stats_raw.return_value = raw
        result = data_fetchers.fetch_daily_summary(MagicMock(), DATE)

        assert result["date"] == DATE
        assert result["steps"] == 8500
        assert result["floors_climbed"] == 12
        assert result["calories_total"] == 2100
        assert result["calories_active"] == 500
        assert result["calories_bmr"] == 1600
        assert result["distance_meters"] == 6200  # _int() truncates to int
        assert result["intensity_minutes"] == 45  # 30 + 15
        assert result["stress_avg"] == 35
        assert result["stress_max"] == 80
        assert result["stress_qualifier"] == "low"
        assert result["resting_heart_rate"] == 62
        assert result["max_heart_rate"] == 165
        assert result["min_heart_rate"] == 48
        assert json.loads(result["raw_json"]) == raw

    @patch("data_fetchers.garmin_service")
    def test_returns_none_when_no_data(self, mock_gs):
        mock_gs.fetch_stats_raw.return_value = None
        assert data_fetchers.fetch_daily_summary(MagicMock(), DATE) is None

    @patch("data_fetchers.garmin_service")
    def test_returns_none_when_empty_dict(self, mock_gs):
        mock_gs.fetch_stats_raw.return_value = {}
        assert data_fetchers.fetch_daily_summary(MagicMock(), DATE) is None

    @patch("data_fetchers.garmin_service")
    def test_handles_missing_intensity_fields(self, mock_gs):
        raw = {"totalSteps": 100}
        mock_gs.fetch_stats_raw.return_value = raw
        result = data_fetchers.fetch_daily_summary(MagicMock(), DATE)
        assert result["intensity_minutes"] == 0
        assert result["steps"] == 100


# ── fetch_heart_rates ──────────────────────────────────────────


class TestFetchHeartRates:
    @patch("data_fetchers.garmin_service")
    def test_parses_intraday_values(self, mock_gs):
        raw = {
            "heartRateValues": [
                [1709280000000, 65],
                [1709280060000, 72],
            ],
        }
        mock_gs.fetch_heart_rate_raw.return_value = raw
        rows = data_fetchers.fetch_heart_rates(MagicMock(), DATE)

        assert len(rows) == 2
        assert rows[0]["date"] == DATE
        assert rows[0]["heart_rate"] == 65
        assert rows[0]["timestamp"] == "2024-03-01T08:00:00+00:00"
        assert rows[1]["heart_rate"] == 72

    @patch("data_fetchers.garmin_service")
    def test_skips_none_heart_rate(self, mock_gs):
        raw = {
            "heartRateValues": [
                [1709280000000, 65],
                [1709280060000, None],
                None,
            ],
        }
        mock_gs.fetch_heart_rate_raw.return_value = raw
        rows = data_fetchers.fetch_heart_rates(MagicMock(), DATE)
        assert len(rows) == 1

    @patch("data_fetchers.garmin_service")
    def test_returns_empty_when_no_data(self, mock_gs):
        mock_gs.fetch_heart_rate_raw.return_value = None
        assert data_fetchers.fetch_heart_rates(MagicMock(), DATE) == []

    @patch("data_fetchers.garmin_service")
    def test_returns_empty_when_no_values_key(self, mock_gs):
        mock_gs.fetch_heart_rate_raw.return_value = {}
        rows = data_fetchers.fetch_heart_rates(MagicMock(), DATE)
        assert rows == []


# ── fetch_hrv ──────────────────────────────────────────────────


class TestFetchHrv:
    @patch("data_fetchers.garmin_service")
    def test_maps_fields_to_schema(self, mock_gs):
        raw = {
            "hrvSummary": {
                "weeklyAvg": 45,
                "lastNight": 42,
                "lastNightAvg": 50,
                "lastNight5MinHigh": 68,
                "baseline": {
                    "lowUpper": 30,
                    "balancedLow": 35,
                    "balancedUpper": 55,
                },
                "status": "BALANCED",
            }
        }
        mock_gs.fetch_hrv_raw.return_value = raw
        result = data_fetchers.fetch_hrv(MagicMock(), DATE)

        assert result["date"] == DATE
        assert result["weekly_avg"] == 45
        assert result["last_night"] == 42
        assert result["last_night_avg"] == 50
        assert result["last_night_5_min_high"] == 68
        assert result["baseline_low"] == 30
        assert result["baseline_balanced"] == 35
        assert result["baseline_upper"] == 55
        assert result["status"] == "BALANCED"

    @patch("data_fetchers.garmin_service")
    def test_returns_none_when_no_data(self, mock_gs):
        mock_gs.fetch_hrv_raw.return_value = None
        assert data_fetchers.fetch_hrv(MagicMock(), DATE) is None

    @patch("data_fetchers.garmin_service")
    def test_handles_missing_baseline(self, mock_gs):
        raw = {"hrvSummary": {"weeklyAvg": 45, "status": "LOW"}}
        mock_gs.fetch_hrv_raw.return_value = raw
        result = data_fetchers.fetch_hrv(MagicMock(), DATE)
        assert result["baseline_low"] is None
        assert result["status"] == "LOW"


# ── fetch_sleep ────────────────────────────────────────────────


class TestFetchSleep:
    @patch("data_fetchers.garmin_service")
    def test_maps_fields_to_schema(self, mock_gs):
        raw = {
            "dailySleepDTO": {
                "sleepStartTimestampGMT": 1709247600000,  # 2024-02-29 23:00 UTC
                "sleepEndTimestampGMT": 1709276400000,    # 2024-03-01 07:00 UTC
                "deepSleepSeconds": 3600,
                "lightSleepSeconds": 10800,
                "remSleepSeconds": 5400,
                "awakeSleepSeconds": 1200,
                "averageSpO2Value": 96.5,
                "averageRespirationValue": 15.2,
                "sleepScores": {
                    "overall": {"value": 78},
                },
            }
        }
        mock_gs.fetch_sleep_raw.return_value = raw
        result = data_fetchers.fetch_sleep(MagicMock(), DATE)

        assert result["date"] == DATE
        assert result["sleep_start"] == "2024-02-29T23:00:00+00:00"
        assert result["sleep_end"] == "2024-03-01T07:00:00+00:00"
        assert result["total_sleep_seconds"] == 3600 + 10800 + 5400
        assert result["deep_seconds"] == 3600
        assert result["light_seconds"] == 10800
        assert result["rem_seconds"] == 5400
        assert result["awake_seconds"] == 1200
        assert result["sleep_score"] == 78
        assert result["avg_spo2"] == 96.5
        assert result["avg_respiration"] == 15.2

    @patch("data_fetchers.garmin_service")
    def test_sleep_score_as_plain_int(self, mock_gs):
        raw = {
            "dailySleepDTO": {
                "sleepStartTimestampGMT": 1709247600000,
                "sleepEndTimestampGMT": 1709276400000,
                "deepSleepSeconds": 0,
                "lightSleepSeconds": 0,
                "remSleepSeconds": 0,
                "awakeSleepSeconds": 0,
                "sleepScores": {"overall": 82},
            }
        }
        mock_gs.fetch_sleep_raw.return_value = raw
        result = data_fetchers.fetch_sleep(MagicMock(), DATE)
        assert result["sleep_score"] == 82

    @patch("data_fetchers.garmin_service")
    def test_returns_none_when_no_data(self, mock_gs):
        mock_gs.fetch_sleep_raw.return_value = None
        assert data_fetchers.fetch_sleep(MagicMock(), DATE) is None

    @patch("data_fetchers.garmin_service")
    def test_returns_none_when_no_sleep_start(self, mock_gs):
        raw = {"dailySleepDTO": {"sleepStartTimestampGMT": None}}
        mock_gs.fetch_sleep_raw.return_value = raw
        assert data_fetchers.fetch_sleep(MagicMock(), DATE) is None


# ── fetch_activities ───────────────────────────────────────────


class TestFetchActivities:
    @patch("data_fetchers.garmin_service")
    def test_maps_fields_to_schema(self, mock_gs):
        raw_list = [
            {
                "activityId": 12345,
                "activityName": "Morning Run",
                "activityType": {"typeKey": "running"},
                "startTimeGMT": "2026-03-01 12:00:00",
                "duration": 1800.0,
                "distance": 5000.0,
                "calories": 350,
                "averageHR": 145,
                "maxHR": 172,
                "averageSpeed": 2.78,  # m/s → pace ~6.0 min/km
                "elevationGain": 50.0,
            }
        ]
        mock_gs.fetch_activities_raw.return_value = raw_list
        rows = data_fetchers.fetch_activities(MagicMock(), DATE)

        assert len(rows) == 1
        row = rows[0]
        assert row["activity_id"] == 12345
        assert row["date"] == DATE
        assert row["activity_type"] == "running"
        assert row["name"] == "Morning Run"
        assert row["start_time"] == "2026-03-01 12:00:00"
        assert row["duration_seconds"] == 1800.0
        assert row["distance_meters"] == 5000.0
        assert row["calories"] == 350
        assert row["avg_heart_rate"] == 145
        assert row["max_heart_rate"] == 172
        assert row["avg_pace"] == round(1000 / (2.78 * 60), 2)
        assert row["elevation_gain_meters"] == 50.0
        assert "raw_json" in row

    @patch("data_fetchers.garmin_service")
    def test_avg_pace_none_when_speed_zero(self, mock_gs):
        raw_list = [{"activityId": 1, "activityType": {}, "averageSpeed": 0}]
        mock_gs.fetch_activities_raw.return_value = raw_list
        rows = data_fetchers.fetch_activities(MagicMock(), DATE)
        assert rows[0]["avg_pace"] is None

    @patch("data_fetchers.garmin_service")
    def test_returns_empty_when_no_activities(self, mock_gs):
        mock_gs.fetch_activities_raw.return_value = []
        assert data_fetchers.fetch_activities(MagicMock(), DATE) == []

    @patch("data_fetchers.garmin_service")
    def test_returns_empty_when_none(self, mock_gs):
        mock_gs.fetch_activities_raw.return_value = None
        assert data_fetchers.fetch_activities(MagicMock(), DATE) == []


# ── fetch_body_composition ─────────────────────────────────────


class TestFetchBodyComposition:
    @patch("data_fetchers.garmin_service")
    def test_maps_fields_to_schema(self, mock_gs):
        raw = {
            "dateWeightList": [
                {
                    "calendarDate": DATE,
                    "weight": 75000,    # grams
                    "bmi": 24.5,
                    "bodyFat": 18.0,
                    "muscleMass": 32000,  # grams
                    "boneMass": 3200,     # grams
                    "bodyWater": 55.0,
                }
            ]
        }
        mock_gs.fetch_body_composition_raw.return_value = raw
        result = data_fetchers.fetch_body_composition(MagicMock(), DATE)

        assert result["date"] == DATE
        assert result["weight_kg"] == 75.0
        assert result["bmi"] == 24.5
        assert result["body_fat_pct"] == 18.0
        assert result["muscle_mass_kg"] == 32.0
        assert result["bone_mass_kg"] == 3.2
        assert result["body_water_pct"] == 55.0

    @patch("data_fetchers.garmin_service")
    def test_returns_none_when_empty_list(self, mock_gs):
        raw = {"dateWeightList": []}
        mock_gs.fetch_body_composition_raw.return_value = raw
        assert data_fetchers.fetch_body_composition(MagicMock(), DATE) is None

    @patch("data_fetchers.garmin_service")
    def test_returns_none_when_no_data(self, mock_gs):
        mock_gs.fetch_body_composition_raw.return_value = None
        assert data_fetchers.fetch_body_composition(MagicMock(), DATE) is None

    @patch("data_fetchers.garmin_service")
    def test_handles_none_weights(self, mock_gs):
        raw = {
            "dateWeightList": [
                {"calendarDate": DATE, "weight": None, "muscleMass": None, "boneMass": None}
            ]
        }
        mock_gs.fetch_body_composition_raw.return_value = raw
        result = data_fetchers.fetch_body_composition(MagicMock(), DATE)
        assert result["weight_kg"] is None
        assert result["muscle_mass_kg"] is None
        assert result["bone_mass_kg"] is None


# ── fetch_spo2 ─────────────────────────────────────────────────


class TestFetchSpo2:
    @patch("data_fetchers.garmin_service")
    def test_maps_fields_to_schema(self, mock_gs):
        raw = {
            "averageSpO2": 96.5,
            "lowestSpO2": 91,
            "latestSpO2": 97.0,
        }
        mock_gs.fetch_spo2_raw.return_value = raw
        result = data_fetchers.fetch_spo2(MagicMock(), DATE)

        assert result["date"] == DATE
        assert result["avg_spo2"] == 96.5
        assert result["lowest_spo2"] == 91
        assert result["latest_spo2"] == 97.0

    @patch("data_fetchers.garmin_service")
    def test_returns_none_when_no_data(self, mock_gs):
        mock_gs.fetch_spo2_raw.return_value = None
        assert data_fetchers.fetch_spo2(MagicMock(), DATE) is None


# ── fetch_respiration ──────────────────────────────────────────


class TestFetchRespiration:
    @patch("data_fetchers.garmin_service")
    def test_maps_fields_to_schema(self, mock_gs):
        raw = {
            "avgWakingRespirationValue": 16.5,
            "avgSleepRespirationValue": 14.2,
            "highestRespirationValue": 22.0,
            "lowestRespirationValue": 12.0,
        }
        mock_gs.fetch_respiration_raw.return_value = raw
        result = data_fetchers.fetch_respiration(MagicMock(), DATE)

        assert result["date"] == DATE
        assert result["avg_waking"] == 16.5
        assert result["avg_sleeping"] == 14.2
        assert result["highest"] == 22.0
        assert result["lowest"] == 12.0

    @patch("data_fetchers.garmin_service")
    def test_returns_none_when_no_data(self, mock_gs):
        mock_gs.fetch_respiration_raw.return_value = None
        assert data_fetchers.fetch_respiration(MagicMock(), DATE) is None


# ── fetch_stress_details ───────────────────────────────────────


class TestFetchStressDetails:
    @patch("data_fetchers.garmin_service")
    def test_parses_stress_values(self, mock_gs):
        raw = {
            "stressValuesArray": [
                [1709280000000, 25],
                [1709280060000, 42],
            ]
        }
        mock_gs.fetch_stress_raw.return_value = raw
        rows = data_fetchers.fetch_stress_details(MagicMock(), DATE)

        assert len(rows) == 2
        assert rows[0]["date"] == DATE
        assert rows[0]["stress_level"] == 25
        assert rows[0]["timestamp"] == "2024-03-01T08:00:00+00:00"
        assert rows[1]["stress_level"] == 42

    @patch("data_fetchers.garmin_service")
    def test_skips_negative_values(self, mock_gs):
        """Garmin uses -1/-2 for unmeasured or activity periods."""
        raw = {
            "stressValuesArray": [
                [1709280000000, 25],
                [1709280060000, -1],
                [1709280120000, -2],
                [1709280180000, 50],
            ]
        }
        mock_gs.fetch_stress_raw.return_value = raw
        rows = data_fetchers.fetch_stress_details(MagicMock(), DATE)
        assert len(rows) == 2
        assert rows[0]["stress_level"] == 25
        assert rows[1]["stress_level"] == 50

    @patch("data_fetchers.garmin_service")
    def test_skips_none_entries(self, mock_gs):
        raw = {
            "stressValuesArray": [
                [1709280000000, 25],
                [1709280060000, None],
                None,
            ]
        }
        mock_gs.fetch_stress_raw.return_value = raw
        rows = data_fetchers.fetch_stress_details(MagicMock(), DATE)
        assert len(rows) == 1

    @patch("data_fetchers.garmin_service")
    def test_returns_empty_when_no_data(self, mock_gs):
        mock_gs.fetch_stress_raw.return_value = None
        assert data_fetchers.fetch_stress_details(MagicMock(), DATE) == []

    @patch("data_fetchers.garmin_service")
    def test_returns_empty_when_no_values_key(self, mock_gs):
        mock_gs.fetch_stress_raw.return_value = {}
        assert data_fetchers.fetch_stress_details(MagicMock(), DATE) == []
