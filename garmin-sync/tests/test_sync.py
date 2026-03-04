from datetime import date
from unittest.mock import MagicMock, patch

import pytest

import sync


DATE = "2026-03-01"
USER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


@pytest.fixture(autouse=True)
def _no_sleep():
    """Eliminate all time.sleep calls so tests run instantly."""
    with patch("sync.time.sleep"):
        yield


def _mock_garmin():
    return MagicMock()


def _mock_supabase():
    """Supabase client mock; sync_log queries return empty by default."""
    sb = MagicMock()
    builder = MagicMock()
    builder.select.return_value = builder
    builder.eq.return_value = builder
    builder.limit.return_value = builder
    builder.execute.return_value = MagicMock(data=[])
    sb.table.return_value = builder
    return sb


# ── sync_date ──────────────────────────────────────────────────


class TestSyncDate:
    @patch("sync.supabase_client")
    @patch("sync.data_fetchers")
    @patch("sync.with_retry", side_effect=lambda fn, *a, **kw: fn(*a, **kw))
    def test_syncs_all_types_and_returns_summary(self, _retry, mock_fetchers, mock_sb):
        mock_fetchers.fetch_daily_summary.return_value = {"date": DATE, "steps": 100}
        mock_fetchers.fetch_heart_rates.return_value = [{"hr": 65}]
        mock_fetchers.fetch_hrv.return_value = {"date": DATE}
        mock_fetchers.fetch_sleep.return_value = {"date": DATE}
        mock_fetchers.fetch_activities.return_value = [{"id": 1}]
        mock_fetchers.fetch_body_composition.return_value = {"date": DATE}
        mock_fetchers.fetch_spo2.return_value = {"date": DATE}
        mock_fetchers.fetch_respiration.return_value = {"date": DATE}
        mock_fetchers.fetch_stress_details.return_value = [{"stress": 25}]

        mock_sb.upsert_daily_summary.return_value = 1
        mock_sb.upsert_heart_rate_intraday.return_value = 1
        mock_sb.upsert_hrv.return_value = 1
        mock_sb.upsert_sleep.return_value = 1
        mock_sb.upsert_activities.return_value = 1
        mock_sb.upsert_body_composition.return_value = 1
        mock_sb.upsert_spo2.return_value = 1
        mock_sb.upsert_respiration.return_value = 1
        mock_sb.upsert_stress_details.return_value = 1

        results = sync.sync_date(_mock_garmin(), _mock_supabase(), DATE, USER_ID)

        assert len(results) == len(sync.ALL_DATA_TYPES)
        for dtype, result in results.items():
            assert result["status"] == "success", f"{dtype} failed: {result}"
        # log_sync called for each type with user_id
        assert mock_sb.log_sync.call_count == len(sync.ALL_DATA_TYPES)
        for log_call in mock_sb.log_sync.call_args_list:
            assert log_call[0][4] == USER_ID  # user_id is 5th positional arg

    @patch("sync.supabase_client")
    @patch("sync.data_fetchers")
    @patch("sync.with_retry", side_effect=lambda fn, *a, **kw: fn(*a, **kw))
    def test_continues_on_individual_type_failure(self, _retry, mock_fetchers, mock_sb):
        """A failure in one type should not block others."""
        mock_fetchers.fetch_daily_summary.side_effect = Exception("API down")
        mock_fetchers.fetch_heart_rates.return_value = [{"hr": 65}]
        mock_fetchers.fetch_hrv.return_value = None  # no data
        mock_fetchers.fetch_sleep.return_value = {"date": DATE}
        mock_fetchers.fetch_activities.return_value = []
        mock_fetchers.fetch_body_composition.return_value = None
        mock_fetchers.fetch_spo2.return_value = None
        mock_fetchers.fetch_respiration.return_value = None
        mock_fetchers.fetch_stress_details.return_value = []

        mock_sb.upsert_heart_rate_intraday.return_value = 1
        mock_sb.upsert_sleep.return_value = 1

        results = sync.sync_date(_mock_garmin(), _mock_supabase(), DATE, USER_ID)

        # daily_summaries should be error
        assert results["daily_summaries"]["status"] == "error"
        assert "API down" in results["daily_summaries"]["error"]
        # heart_rate should succeed
        assert results["heart_rate"]["status"] == "success"
        # hrv returned None → success with 0 records
        assert results["hrv"]["status"] == "success"
        assert results["hrv"]["records"] == 0

    @patch("sync.supabase_client")
    @patch("sync.data_fetchers")
    @patch("sync.with_retry", side_effect=lambda fn, *a, **kw: fn(*a, **kw))
    def test_syncs_subset_of_types(self, _retry, mock_fetchers, mock_sb):
        mock_fetchers.fetch_sleep.return_value = {"date": DATE}
        mock_sb.upsert_sleep.return_value = 1

        results = sync.sync_date(_mock_garmin(), _mock_supabase(), DATE, USER_ID,
                                 data_types=["sleep"])

        assert len(results) == 1
        assert "sleep" in results
        assert results["sleep"]["status"] == "success"

    @patch("sync.supabase_client")
    @patch("sync.data_fetchers")
    @patch("sync.with_retry", side_effect=lambda fn, *a, **kw: fn(*a, **kw))
    def test_handles_unknown_data_type(self, _retry, mock_fetchers, mock_sb):
        results = sync.sync_date(_mock_garmin(), _mock_supabase(), DATE, USER_ID,
                                 data_types=["nonexistent"])
        assert results["nonexistent"]["status"] == "error"

    @patch("sync.supabase_client")
    @patch("sync.data_fetchers")
    @patch("sync.with_retry", side_effect=lambda fn, *a, **kw: fn(*a, **kw))
    def test_logs_success_and_error_to_sync_log(self, _retry, mock_fetchers, mock_sb):
        mock_fetchers.fetch_sleep.return_value = {"date": DATE}
        mock_fetchers.fetch_hrv.side_effect = Exception("timeout")
        mock_sb.upsert_sleep.return_value = 1

        sync.sync_date(_mock_garmin(), _mock_supabase(), DATE, USER_ID,
                       data_types=["sleep", "hrv"])

        log_calls = mock_sb.log_sync.call_args_list
        assert len(log_calls) == 2

        # log_sync(sb, dtype, date_str, status, user_id, ...) — status is 4th positional arg
        call_statuses = [c[0][3] for c in log_calls]
        assert "success" in call_statuses
        assert "error" in call_statuses
        # user_id is 5th positional arg
        for c in log_calls:
            assert c[0][4] == USER_ID

    @patch("sync.supabase_client")
    @patch("sync.data_fetchers")
    @patch("sync.with_retry", side_effect=lambda fn, *a, **kw: fn(*a, **kw))
    def test_upsert_receives_user_id(self, _retry, mock_fetchers, mock_sb):
        """Verify user_id flows through to upsert calls."""
        mock_fetchers.fetch_sleep.return_value = {"date": DATE}
        mock_sb.upsert_sleep.return_value = 1

        sync.sync_date(_mock_garmin(), _mock_supabase(), DATE, USER_ID,
                       data_types=["sleep"])

        # upsert_sleep called with (sb, data, user_id) via dispatch lambda
        mock_sb.upsert_sleep.assert_called_once()
        assert mock_sb.upsert_sleep.call_args[0][2] == USER_ID


# ── sync_date_range ────────────────────────────────────────────


class TestSyncDateRange:
    @patch("sync.sync_date")
    def test_iterates_all_dates_in_range(self, mock_sync_date):
        mock_sync_date.return_value = {
            "sleep": {"status": "success", "records": 1, "error": None},
        }

        agg = sync.sync_date_range(
            _mock_garmin(), _mock_supabase(),
            "2026-03-01", "2026-03-03", USER_ID,
            data_types=["sleep"],
        )

        assert mock_sync_date.call_count == 3
        dates_called = [c[0][2] for c in mock_sync_date.call_args_list]
        assert dates_called == ["2026-03-01", "2026-03-02", "2026-03-03"]
        # user_id is 4th positional arg
        for c in mock_sync_date.call_args_list:
            assert c[0][3] == USER_ID
        assert agg["sleep"]["success"] == 3
        assert agg["sleep"]["records"] == 3

    @patch("sync.sync_date")
    def test_aggregates_errors(self, mock_sync_date):
        mock_sync_date.side_effect = [
            {"sleep": {"status": "success", "records": 1, "error": None}},
            {"sleep": {"status": "error", "records": 0, "error": "fail"}},
        ]

        agg = sync.sync_date_range(
            _mock_garmin(), _mock_supabase(),
            "2026-03-01", "2026-03-02", USER_ID,
            data_types=["sleep"],
        )

        assert agg["sleep"]["success"] == 1
        assert agg["sleep"]["error"] == 1

    @patch("sync.sync_date")
    def test_single_day_range(self, mock_sync_date):
        mock_sync_date.return_value = {
            "hrv": {"status": "success", "records": 1, "error": None},
        }

        agg = sync.sync_date_range(
            _mock_garmin(), _mock_supabase(),
            "2026-03-01", "2026-03-01", USER_ID,
            data_types=["hrv"],
        )

        assert mock_sync_date.call_count == 1
        assert agg["hrv"]["success"] == 1


# ── sync_today ─────────────────────────────────────────────────


class TestSyncToday:
    @patch("sync.sync_date")
    @patch("sync.date")
    def test_syncs_todays_date(self, mock_date_cls, mock_sync_date):
        mock_date_cls.today.return_value = date(2026, 3, 1)
        mock_date_cls.side_effect = lambda *a, **kw: date(*a, **kw)
        mock_sync_date.return_value = {}

        sync.sync_today(_mock_garmin(), _mock_supabase(), USER_ID)

        mock_sync_date.assert_called_once()
        assert mock_sync_date.call_args[0][2] == "2026-03-01"
        assert mock_sync_date.call_args[0][3] == USER_ID

    @patch("sync.sync_date")
    @patch("sync.date")
    def test_passes_data_types(self, mock_date_cls, mock_sync_date):
        mock_date_cls.today.return_value = date(2026, 3, 1)
        mock_date_cls.side_effect = lambda *a, **kw: date(*a, **kw)
        mock_sync_date.return_value = {}

        sync.sync_today(_mock_garmin(), _mock_supabase(), USER_ID, data_types=["sleep"])

        assert mock_sync_date.call_args[0][4] == ["sleep"]


# ── backfill ───────────────────────────────────────────────────


class TestBackfill:
    @patch("sync.sync_date")
    @patch("sync._already_synced_today", return_value=False)
    @patch("sync.date")
    def test_backfills_n_days(self, mock_date_cls, mock_synced, mock_sync_date):
        mock_date_cls.today.return_value = date(2026, 3, 3)
        mock_date_cls.fromisoformat = date.fromisoformat
        mock_date_cls.side_effect = lambda *a, **kw: date(*a, **kw)
        mock_sync_date.return_value = {
            "sleep": {"status": "success", "records": 1, "error": None},
        }

        sync.backfill(_mock_garmin(), _mock_supabase(), USER_ID, days=3,
                     data_types=["sleep"])

        assert mock_sync_date.call_count == 3
        dates = [c[0][2] for c in mock_sync_date.call_args_list]
        assert dates == ["2026-03-01", "2026-03-02", "2026-03-03"]
        # user_id passed through
        for c in mock_sync_date.call_args_list:
            assert c[0][3] == USER_ID

    @patch("sync.sync_date")
    @patch("sync._already_synced_today")
    @patch("sync.date")
    def test_skips_already_synced_dates(self, mock_date_cls, mock_synced, mock_sync_date):
        mock_date_cls.today.return_value = date(2026, 3, 3)
        mock_date_cls.fromisoformat = date.fromisoformat
        mock_date_cls.side_effect = lambda *a, **kw: date(*a, **kw)

        # Day 1: already synced; Day 2 & 3: not synced
        def is_synced(sb, date_str, dtype, uid):
            return date_str == "2026-03-01"

        mock_synced.side_effect = is_synced
        mock_sync_date.return_value = {
            "sleep": {"status": "success", "records": 1, "error": None},
        }

        agg = sync.backfill(_mock_garmin(), _mock_supabase(), USER_ID, days=3,
                            data_types=["sleep"])

        # Only day 2 and 3 should be synced
        assert mock_sync_date.call_count == 2
        dates = [c[0][2] for c in mock_sync_date.call_args_list]
        assert "2026-03-01" not in dates
        assert "2026-03-02" in dates
        assert "2026-03-03" in dates
        # Skipped count for sleep
        assert agg["sleep"]["skipped"] == 1

    @patch("sync.sync_date")
    @patch("sync._already_synced_today")
    @patch("sync.date")
    def test_skips_per_type_not_per_date(self, mock_date_cls, mock_synced, mock_sync_date):
        """If only sleep is synced for a date, hrv should still be fetched."""
        mock_date_cls.today.return_value = date(2026, 3, 1)
        mock_date_cls.fromisoformat = date.fromisoformat
        mock_date_cls.side_effect = lambda *a, **kw: date(*a, **kw)

        def is_synced(sb, date_str, dtype, uid):
            return dtype == "sleep"  # sleep already done, hrv not

        mock_synced.side_effect = is_synced
        mock_sync_date.return_value = {
            "hrv": {"status": "success", "records": 1, "error": None},
        }

        sync.backfill(_mock_garmin(), _mock_supabase(), USER_ID, days=1,
                     data_types=["sleep", "hrv"])

        # sync_date should be called with only ["hrv"]
        assert mock_sync_date.call_count == 1
        types_arg = mock_sync_date.call_args[0][4]
        assert types_arg == ["hrv"]


# ── _already_synced_today ──────────────────────────────────────


class TestAlreadySynced:
    def test_returns_true_when_success_exists(self):
        sb = _mock_supabase()
        builder = sb.table.return_value
        builder.execute.return_value = MagicMock(data=[{"id": "abc"}])

        assert sync._already_synced_today(sb, DATE, "sleep", USER_ID) is True

    def test_returns_false_when_no_records(self):
        sb = _mock_supabase()
        assert sync._already_synced_today(sb, DATE, "sleep", USER_ID) is False

    def test_returns_false_on_error(self):
        sb = _mock_supabase()
        sb.table.side_effect = Exception("DB error")
        assert sync._already_synced_today(sb, DATE, "sleep", USER_ID) is False

    def test_filters_by_user_id(self):
        sb = _mock_supabase()
        builder = sb.table.return_value

        sync._already_synced_today(sb, DATE, "sleep", USER_ID)

        builder.eq.assert_any_call("user_id", USER_ID)
