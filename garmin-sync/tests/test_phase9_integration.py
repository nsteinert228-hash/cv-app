"""Phase 9 integration tests: smoke, cache, retry, and token persistence.

These tests verify the full garmy migration works end-to-end using mocks
at the garmy/Supabase boundary — no real API calls needed.
"""

import logging
from unittest.mock import MagicMock, patch, call

import pytest
from requests import HTTPError

from garmy.core.exceptions import APIError

import garmin_service
import data_fetchers
import sync

DATE = "2026-03-15"
TODAY = "2026-03-29"
USER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


@pytest.fixture(autouse=True)
def _reset_state():
    """Fresh garmin_service state for each test."""
    garmin_service._api_client = None
    garmin_service.reset_login_cooldown()
    yield
    garmin_service._api_client = None
    garmin_service.reset_login_cooldown()


@pytest.fixture(autouse=True)
def _no_sleep():
    """Eliminate all time.sleep calls."""
    with patch("garmin_service.time.sleep"), \
         patch("sync.time.sleep"):
        yield


def _mock_supabase(cached_tables=None):
    """Build a Supabase mock. cached_tables is a set of table names with data."""
    cached_tables = cached_tables or set()
    sb = MagicMock()

    def _table(name):
        builder = MagicMock()
        builder.select.return_value = builder
        builder.eq.return_value = builder
        builder.limit.return_value = builder
        if name in cached_tables:
            builder.execute.return_value = MagicMock(data=[{"id": 1}], count=1)
        else:
            builder.execute.return_value = MagicMock(data=[], count=0)
        builder.upsert.return_value = builder
        builder.insert.return_value = builder
        builder.delete.return_value = builder
        return builder

    sb.table.side_effect = _table
    return sb


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 1. SMOKE TESTS — every garmin_service fetch function returns data
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class TestSmokeGarminService:
    """Verify each fetch wrapper calls the right garmy API and returns data."""

    def _mock_client(self):
        client = MagicMock()
        # Set up metrics.get() chain
        accessor = MagicMock()
        client.metrics.get.return_value = accessor
        return client, accessor

    def test_fetch_stats_raw(self):
        client, accessor = self._mock_client()
        accessor.raw.return_value = {"totalSteps": 8000}

        result = garmin_service.fetch_stats_raw(client, DATE)

        client.metrics.get.assert_called_with("daily_summary")
        accessor.raw.assert_called_once_with(date_input=DATE)
        assert result == {"totalSteps": 8000}

    def test_fetch_heart_rate_raw(self):
        client, accessor = self._mock_client()
        accessor.raw.return_value = {"heartRateValues": [[1, 65]]}

        result = garmin_service.fetch_heart_rate_raw(client, DATE)

        client.metrics.get.assert_called_with("heart_rate")
        accessor.raw.assert_called_once_with(date_input=DATE)
        assert result["heartRateValues"] == [[1, 65]]

    def test_fetch_hrv_raw(self):
        client, accessor = self._mock_client()
        accessor.raw.return_value = {"hrvSummary": {"weeklyAvg": 42}}

        result = garmin_service.fetch_hrv_raw(client, DATE)

        client.metrics.get.assert_called_with("hrv")
        assert result["hrvSummary"]["weeklyAvg"] == 42

    def test_fetch_sleep_raw(self):
        client, accessor = self._mock_client()
        accessor.raw.return_value = {"dailySleepDTO": {"deepSleepSeconds": 3600}}

        result = garmin_service.fetch_sleep_raw(client, DATE)

        client.metrics.get.assert_called_with("sleep")
        assert result["dailySleepDTO"]["deepSleepSeconds"] == 3600

    def test_fetch_stress_raw(self):
        client, accessor = self._mock_client()
        accessor.raw.return_value = {"stressValuesArray": [[1, 25]]}

        result = garmin_service.fetch_stress_raw(client, DATE)

        client.metrics.get.assert_called_with("stress")
        assert result["stressValuesArray"] == [[1, 25]]

    def test_fetch_respiration_raw(self):
        client, accessor = self._mock_client()
        accessor.raw.return_value = {"avgWakingRespirationValue": 16.5}

        result = garmin_service.fetch_respiration_raw(client, DATE)

        client.metrics.get.assert_called_with("respiration")
        assert result["avgWakingRespirationValue"] == 16.5

    def test_fetch_activities_raw_filters_by_date(self):
        client, accessor = self._mock_client()
        accessor.raw.return_value = [
            {"activityId": 1, "startTimeLocal": f"{DATE} 08:00:00"},
            {"activityId": 2, "startTimeLocal": "2026-03-14 18:00:00"},
        ]

        result = garmin_service.fetch_activities_raw(client, DATE)

        assert len(result) == 1
        assert result[0]["activityId"] == 1

    def test_fetch_activities_raw_returns_empty_on_none(self):
        client, accessor = self._mock_client()
        accessor.raw.return_value = None

        result = garmin_service.fetch_activities_raw(client, DATE)
        assert result == []

    def test_fetch_body_composition_raw(self):
        client = MagicMock()
        client.connectapi.return_value = {"dateWeightList": [{"weight": 75000}]}

        result = garmin_service.fetch_body_composition_raw(client, DATE)

        assert "dateWeightList" in result
        assert client.connectapi.call_args[0][0].startswith("/weight-service/")

    def test_fetch_spo2_raw(self):
        client, accessor = self._mock_client()
        accessor.raw.return_value = {
            "averageSpo2": 96.5,
            "lowestSpo2": 91,
            "latestSpo2": 97.0,
        }

        result = garmin_service.fetch_spo2_raw(client, DATE)

        assert result["averageSpO2"] == 96.5
        assert result["lowestSpO2"] == 91
        assert result["latestSpO2"] == 97.0

    def test_fetch_activity_details_raw(self):
        client = MagicMock()
        client.connectapi.return_value = {"metricDescriptors": []}

        result = garmin_service.fetch_activity_details_raw(client, 12345)

        assert client.connectapi.call_args[0][0] == "/activity-service/activity/12345/details"
        assert result == {"metricDescriptors": []}

    def test_fetch_activity_splits_raw(self):
        client = MagicMock()
        client.connectapi.return_value = {"lapDTOs": []}

        result = garmin_service.fetch_activity_splits_raw(client, 12345)

        assert client.connectapi.call_args[0][0] == "/activity-service/activity/12345/splits"

    def test_fetch_returns_none_for_non_dict(self):
        """connectapi endpoints return None when result isn't a dict."""
        client = MagicMock()
        client.connectapi.return_value = "not a dict"

        assert garmin_service.fetch_body_composition_raw(client, DATE) is None
        assert garmin_service.fetch_activity_details_raw(client, 1) is None


class TestSmokeDataFetchers:
    """Verify data_fetchers produce Supabase-ready dicts from raw API data."""

    @patch("data_fetchers.garmin_service")
    def test_daily_summary_end_to_end(self, mock_gs):
        mock_gs.fetch_stats_raw.return_value = {
            "totalSteps": 10000,
            "totalKilocalories": 2200,
            "restingHeartRate": 58,
            "moderateIntensityMinutes": 20,
            "vigorousIntensityMinutes": 10,
        }
        result = data_fetchers.fetch_daily_summary(MagicMock(), DATE)

        assert result["date"] == DATE
        assert result["steps"] == 10000
        assert result["intensity_minutes"] == 30
        assert result["resting_heart_rate"] == 58
        assert "raw_json" in result

    @patch("data_fetchers.garmin_service")
    def test_sleep_end_to_end(self, mock_gs):
        mock_gs.fetch_sleep_raw.return_value = {
            "dailySleepDTO": {
                "sleepStartTimestampGMT": 1710540000000,
                "sleepEndTimestampGMT": 1710568800000,
                "deepSleepSeconds": 4000,
                "lightSleepSeconds": 12000,
                "remSleepSeconds": 5000,
                "awakeSleepSeconds": 1000,
                "sleepScores": {"overall": {"value": 82}},
            }
        }
        result = data_fetchers.fetch_sleep(MagicMock(), DATE)

        assert result["total_sleep_seconds"] == 4000 + 12000 + 5000
        assert result["sleep_score"] == 82
        assert result["sleep_start"] is not None

    @patch("data_fetchers.garmin_service")
    def test_activities_end_to_end(self, mock_gs):
        mock_gs.fetch_activities_raw.return_value = [
            {
                "activityId": 99,
                "activityType": {"typeKey": "running"},
                "activityName": "Morning Run",
                "startTimeGMT": f"{DATE} 07:00:00",
                "duration": 2400.0,
                "distance": 8000.0,
                "calories": 500,
                "averageHR": 155,
                "maxHR": 178,
                "averageSpeed": 3.33,
                "elevationGain": 120.0,
            },
        ]
        rows = data_fetchers.fetch_activities(MagicMock(), DATE)

        assert len(rows) == 1
        assert rows[0]["activity_id"] == 99
        assert rows[0]["activity_type"] == "running"
        assert rows[0]["avg_pace"] is not None


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 2. CACHE TESTS — second sync hits Supabase only, no Garmin call
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class TestCacheSkipsGarmin:
    """Confirm that historical dates with cached data skip Garmin entirely."""

    @patch("sync._is_today", return_value=False)
    @patch("sync.supabase_client")
    @patch("sync.data_fetchers")
    @patch("sync.with_retry", side_effect=lambda fn, *a, **kw: fn(*a, **kw))
    def test_second_sync_skips_garmin(self, _retry, mock_fetchers, mock_sb, _today):
        """Simulate: first call fetches, second call is cached."""
        # First call: no cache, fetcher returns data
        mock_fetchers.fetch_sleep.return_value = {"date": DATE}
        mock_sb.upsert_sleep.return_value = 1

        with patch("sync._has_cached_data", return_value=False):
            r1 = sync.sync_date(MagicMock(), _mock_supabase(), DATE, USER_ID,
                                data_types=["sleep"])

        assert r1["sleep"]["status"] == "success"
        assert mock_fetchers.fetch_sleep.call_count == 1

        # Second call: data now cached
        mock_fetchers.fetch_sleep.reset_mock()

        with patch("sync._has_cached_data", return_value=True):
            r2 = sync.sync_date(MagicMock(), _mock_supabase(), DATE, USER_ID,
                                data_types=["sleep"])

        assert r2["sleep"]["status"] == "cached"
        mock_fetchers.fetch_sleep.assert_not_called()

    @patch("sync._is_today", return_value=False)
    @patch("sync.supabase_client")
    @patch("sync.data_fetchers")
    @patch("sync.with_retry", side_effect=lambda fn, *a, **kw: fn(*a, **kw))
    def test_cache_is_per_type(self, _retry, mock_fetchers, mock_sb, _today):
        """If sleep is cached but hrv isn't, only hrv should hit Garmin."""
        mock_fetchers.fetch_hrv.return_value = {"date": DATE}
        mock_sb.upsert_hrv.return_value = 1

        def selective_cache(sb, table, d, uid):
            return table == "sleep_summaries"  # sleep cached, hrv not

        with patch("sync._has_cached_data", side_effect=selective_cache):
            results = sync.sync_date(MagicMock(), _mock_supabase(), DATE, USER_ID,
                                     data_types=["sleep", "hrv"])

        assert results["sleep"]["status"] == "cached"
        assert results["hrv"]["status"] == "success"
        mock_fetchers.fetch_sleep.assert_not_called()
        mock_fetchers.fetch_hrv.assert_called_once()

    @patch("sync._is_today", return_value=False)
    @patch("sync.supabase_client")
    @patch("sync.data_fetchers")
    @patch("sync.with_retry", side_effect=lambda fn, *a, **kw: fn(*a, **kw))
    def test_no_sync_log_for_cache_hits(self, _retry, mock_fetchers, mock_sb, _today):
        """Cache hits should not write to sync_log."""
        with patch("sync._has_cached_data", return_value=True):
            sync.sync_date(MagicMock(), _mock_supabase(), DATE, USER_ID,
                           data_types=["sleep"])

        mock_sb.log_sync.assert_not_called()

    @patch("sync._is_today", return_value=False)
    @patch("sync.supabase_client")
    @patch("sync.data_fetchers")
    @patch("sync.with_retry", side_effect=lambda fn, *a, **kw: fn(*a, **kw))
    def test_cache_skips_rate_limit_delay(self, _retry, mock_fetchers, mock_sb, _today):
        """Cache hits should not incur rate-limit sleep delays."""
        with patch("sync._has_cached_data", return_value=True), \
             patch("sync.time.sleep") as mock_sleep:
            sync.sync_date(MagicMock(), _mock_supabase(), DATE, USER_ID,
                           data_types=["sleep", "hrv"])

        mock_sleep.assert_not_called()

    @patch("sync.supabase_client")
    @patch("sync.data_fetchers")
    @patch("sync.with_retry", side_effect=lambda fn, *a, **kw: fn(*a, **kw))
    def test_today_always_fetches_even_if_cached(self, _retry, mock_fetchers, mock_sb):
        """Today's date should always fetch from Garmin (data accumulates)."""
        mock_fetchers.fetch_sleep.return_value = {"date": TODAY}
        mock_sb.upsert_sleep.return_value = 1

        with patch("sync._is_today", return_value=True), \
             patch("sync._has_cached_data", return_value=True):
            results = sync.sync_date(MagicMock(), _mock_supabase(), TODAY, USER_ID,
                                     data_types=["sleep"])

        assert results["sleep"]["status"] == "success"
        mock_fetchers.fetch_sleep.assert_called_once()

    @patch("sync._is_today", return_value=False)
    @patch("sync._has_cached_data", return_value=True)
    @patch("sync.supabase_client")
    @patch("sync.data_fetchers")
    @patch("sync.with_retry", side_effect=lambda fn, *a, **kw: fn(*a, **kw))
    def test_force_overrides_cache(self, _retry, mock_fetchers, mock_sb, _cache, _today):
        """force=True should fetch from Garmin regardless of cache."""
        mock_fetchers.fetch_sleep.return_value = {"date": DATE}
        mock_sb.upsert_sleep.return_value = 1

        results = sync.sync_date(MagicMock(), _mock_supabase(), DATE, USER_ID,
                                 data_types=["sleep"], force=True)

        assert results["sleep"]["status"] == "success"
        mock_fetchers.fetch_sleep.assert_called_once()


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 3. RETRY TESTS — transient failures, rate limits, auth errors
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class TestRetryTransient:
    """Test the @retry_transient decorator on garmin_service fetch functions.

    Uses fetch_body_composition_raw (connectapi-based) since it's the simplest
    function that exercises the retry decorator with a mockable client.
    """

    def test_retries_on_connection_error(self):
        """Transient errors (connection reset, timeout) should be retried."""
        client = MagicMock()
        client.connectapi.side_effect = [
            ConnectionError("Connection reset"),
            ConnectionError("Timeout"),
            {"dateWeightList": [{"weight": 75000}]},
        ]

        result = garmin_service.fetch_body_composition_raw(client, DATE)

        assert result == {"dateWeightList": [{"weight": 75000}]}
        assert client.connectapi.call_count == 3

    def test_gives_up_after_max_transient_retries(self):
        """After max_attempts, the exception propagates."""
        client = MagicMock()
        client.connectapi.side_effect = ConnectionError("persistent failure")

        with pytest.raises(ConnectionError, match="persistent failure"):
            garmin_service.fetch_body_composition_raw(client, DATE)

        assert client.connectapi.call_count == 3  # default max_attempts

    def test_does_not_retry_rate_limit(self):
        """429 errors should NOT be retried by @retry_transient (with_retry handles them)."""
        client = MagicMock()
        err = HTTPError("429 Too Many Requests")
        client.connectapi.side_effect = APIError(msg="429 Too Many Requests", error=err)

        with pytest.raises(APIError):
            garmin_service.fetch_body_composition_raw(client, DATE)

        assert client.connectapi.call_count == 1  # no retry

    def test_does_not_retry_auth_error(self):
        """401/403 errors should NOT be retried by @retry_transient."""
        client = MagicMock()
        err = HTTPError("401 Unauthorized")
        client.connectapi.side_effect = APIError(msg="401 Unauthorized", error=err)

        with pytest.raises(APIError):
            garmin_service.fetch_body_composition_raw(client, DATE)

        assert client.connectapi.call_count == 1

    def test_transient_retry_logs_warnings(self, caplog):
        """Retries should produce warning log messages."""
        client = MagicMock()
        client.connectapi.side_effect = [
            ConnectionError("reset"),
            {"dateWeightList": []},
        ]

        with caplog.at_level(logging.WARNING):
            garmin_service.fetch_body_composition_raw(client, DATE)

        assert any("attempt 1/3 failed" in r.message for r in caplog.records)


class TestRetryWithRetry:
    """Test the with_retry() orchestration-level retry (rate limits + reauth)."""

    def test_rate_limit_backoff_sequence(self):
        """429s should trigger exponential backoff: 60s, 120s, 240s, ..."""
        err = HTTPError("429")
        fn = MagicMock(side_effect=[
            APIError(msg="429", error=err),
            APIError(msg="429", error=err),
            "ok",
        ])

        result = garmin_service.with_retry(fn)

        assert result == "ok"
        assert fn.call_count == 3

    def test_auth_error_triggers_reauth_then_retry(self):
        """401 should reset client, re-authenticate, then retry the call once."""
        call_count = 0

        def flaky(*a, **kw):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise APIError(msg="401 Unauthorized", error=HTTPError("401"))
            return "success_after_reauth"

        with patch("garmin_service.reset_client") as mock_reset, \
             patch("garmin_service.get_client"):
            result = garmin_service.with_retry(MagicMock(side_effect=flaky))

        assert result == "success_after_reauth"
        mock_reset.assert_called_once()

    def test_non_retryable_api_error_propagates_immediately(self):
        """Non-429/401/403 API errors should raise without retry."""
        err = HTTPError("500 Internal Server Error")
        fn = MagicMock(side_effect=APIError(msg="500 Server Error", error=err))

        with pytest.raises(APIError):
            garmin_service.with_retry(fn)

        assert fn.call_count == 1


class TestRetryLoginCooldown:
    """Test the login cooldown prevents rapid re-auth attempts."""

    @patch("garmin_service.config")
    @patch("garmin_service.AuthClient")
    @patch("garmin_service.APIClient")
    def test_failed_login_increments_cooldown(self, MockAPI, MockAuth, mock_config):
        mock_config.GARMIN_EMAIL = "a@b.com"
        mock_config.GARMIN_PASSWORD = "wrong"

        # AuthClient with no valid cached tokens
        auth = MagicMock()
        auth.is_authenticated = False
        MockAuth.return_value = auth

        api = MagicMock()
        api.login.side_effect = Exception("bad password")
        MockAPI.return_value = api

        with pytest.raises(Exception, match="bad password"):
            garmin_service.get_client()

        assert garmin_service._consecutive_login_failures == 1

        # Second attempt should hit cooldown
        garmin_service._api_client = None
        with pytest.raises(RuntimeError, match="Login cooldown active"):
            garmin_service.get_client()

    @patch("garmin_service.config")
    @patch("garmin_service.AuthClient")
    @patch("garmin_service.APIClient")
    def test_successful_login_resets_failure_count(self, MockAPI, MockAuth, mock_config):
        mock_config.GARMIN_EMAIL = "a@b.com"
        mock_config.GARMIN_PASSWORD = "pw"

        auth = MagicMock()
        auth.is_authenticated = False
        MockAuth.return_value = auth

        api = MagicMock()
        api.login.return_value = None
        MockAPI.return_value = api

        garmin_service.get_client()

        assert garmin_service._consecutive_login_failures == 0


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 4. TOKEN PERSISTENCE — re-auth from cached tokens without login
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class TestTokenPersistence:
    """Verify that garmy's AuthClient handles token caching correctly."""

    @patch("garmin_service.config")
    @patch("garmin_service.AuthClient")
    @patch("garmin_service.APIClient")
    def test_auth_client_receives_token_dir(self, MockAPI, MockAuth, mock_config):
        """AuthClient should be initialized with the configured token_dir."""
        mock_config.GARMIN_EMAIL = "a@b.com"
        mock_config.GARMIN_PASSWORD = "pw"

        api = MagicMock()
        MockAPI.return_value = api

        with patch.dict("os.environ", {"GARMIN_TOKEN_DIR": "/tmp/test_tokens"}):
            garmin_service.get_client()

        MockAuth.assert_called_once_with(token_dir="/tmp/test_tokens")

    @patch("garmin_service.config")
    @patch("garmin_service.AuthClient")
    @patch("garmin_service.APIClient")
    def test_token_dir_defaults_to_garmy(self, MockAPI, MockAuth, mock_config):
        """Without GARMIN_TOKEN_DIR env var, should default to ~/.garmy."""
        mock_config.GARMIN_EMAIL = "a@b.com"
        mock_config.GARMIN_PASSWORD = "pw"

        api = MagicMock()
        MockAPI.return_value = api

        with patch.dict("os.environ", {}, clear=False):
            # Remove GARMIN_TOKEN_DIR if present
            import os
            env_backup = os.environ.pop("GARMIN_TOKEN_DIR", None)
            try:
                garmin_service.get_client()
            finally:
                if env_backup is not None:
                    os.environ["GARMIN_TOKEN_DIR"] = env_backup

        token_dir = MockAuth.call_args[1]["token_dir"]
        assert token_dir.endswith(".garmy")

    @patch("garmin_service.config")
    @patch("garmin_service.AuthClient")
    @patch("garmin_service.APIClient")
    def test_login_called_when_no_cached_tokens(self, MockAPI, MockAuth, mock_config):
        """When no cached tokens exist, login() should be called with credentials."""
        mock_config.GARMIN_EMAIL = "user@example.com"
        mock_config.GARMIN_PASSWORD = "s3cret"

        auth = MagicMock()
        auth.is_authenticated = False
        MockAuth.return_value = auth

        api = MagicMock()
        MockAPI.return_value = api

        garmin_service.get_client()

        api.login.assert_called_once_with("user@example.com", "s3cret")

    @patch("garmin_service.config")
    @patch("garmin_service.AuthClient")
    @patch("garmin_service.APIClient")
    def test_login_skipped_when_tokens_cached(self, MockAPI, MockAuth, mock_config):
        """When valid cached tokens exist, login() should NOT be called."""
        mock_config.GARMIN_EMAIL = "user@example.com"
        mock_config.GARMIN_PASSWORD = "s3cret"

        auth = MagicMock()
        auth.is_authenticated = True
        MockAuth.return_value = auth

        api = MagicMock()
        MockAPI.return_value = api

        garmin_service.get_client()

        api.login.assert_not_called()

    @patch("garmin_service.config")
    @patch("garmin_service.AuthClient")
    @patch("garmin_service.APIClient")
    def test_simulated_restart_uses_same_token_dir(self, MockAPI, MockAuth, mock_config):
        """After reset (simulating restart), a new client uses the same token_dir.

        garmy's AuthClient loads cached tokens from token_dir on init, so
        the second instantiation should resume from cached tokens without
        needing a fresh SSO login.
        """
        mock_config.GARMIN_EMAIL = "a@b.com"
        mock_config.GARMIN_PASSWORD = "pw"

        api1 = MagicMock()
        api2 = MagicMock()
        MockAPI.side_effect = [api1, api2]

        with patch.dict("os.environ", {"GARMIN_TOKEN_DIR": "/tmp/garmy_test"}):
            # First init
            c1 = garmin_service.get_client()
            assert c1 is api1

            # Simulate restart
            garmin_service.reset_client()
            garmin_service.reset_login_cooldown()

            # Second init — AuthClient should use same token_dir
            c2 = garmin_service.get_client()
            assert c2 is api2

        # Both AuthClient inits used the same token_dir
        assert MockAuth.call_count == 2
        for auth_call in MockAuth.call_args_list:
            assert auth_call[1]["token_dir"] == "/tmp/garmy_test"

    @patch("garmin_service.config")
    @patch("garmin_service.AuthClient")
    @patch("garmin_service.APIClient")
    def test_per_user_token_dir(self, MockAPI, MockAuth, mock_config):
        """Multi-user mode: each user gets their own token directory."""
        api = MagicMock()
        MockAPI.return_value = api

        garmin_service.get_client_for_user(
            "user1@example.com", "pw1", token_dir="/tmp/tokens/user-aaa"
        )
        garmin_service.reset_login_cooldown()
        garmin_service.get_client_for_user(
            "user2@example.com", "pw2", token_dir="/tmp/tokens/user-bbb"
        )

        dirs = [c[1]["token_dir"] for c in MockAuth.call_args_list]
        assert dirs == ["/tmp/tokens/user-aaa", "/tmp/tokens/user-bbb"]
