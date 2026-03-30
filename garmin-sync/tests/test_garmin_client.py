from unittest.mock import MagicMock, patch

import pytest

from garmy.core.exceptions import APIError

import garmin_service


@pytest.fixture(autouse=True)
def _reset_singleton():
    """Ensure each test starts with fresh singleton and cooldown state."""
    garmin_service._api_client = None
    garmin_service.reset_login_cooldown()
    yield
    garmin_service._api_client = None
    garmin_service.reset_login_cooldown()


# ── Singleton ────────────���─────────────────────────────────────


class TestSingleton:
    @patch("garmin_service.config")
    @patch("garmin_service.AuthClient")
    @patch("garmin_service.APIClient")
    def test_returns_same_instance(self, MockAPIClient, MockAuthClient, mock_config):
        mock_config.GARMIN_EMAIL = "a@b.com"
        mock_config.GARMIN_PASSWORD = "pw"
        api_instance = MagicMock()
        MockAPIClient.return_value = api_instance

        first = garmin_service.get_client()
        second = garmin_service.get_client()
        assert first is second
        assert MockAPIClient.call_count == 1

    @patch("garmin_service.config")
    @patch("garmin_service.AuthClient")
    @patch("garmin_service.APIClient")
    def test_reset_clears_singleton(self, MockAPIClient, MockAuthClient, mock_config):
        mock_config.GARMIN_EMAIL = "a@b.com"
        mock_config.GARMIN_PASSWORD = "pw"

        first_api = MagicMock()
        second_api = MagicMock()
        MockAPIClient.side_effect = [first_api, second_api]

        c1 = garmin_service.get_client()
        assert c1 is first_api

        garmin_service.reset_client()
        garmin_service.reset_login_cooldown()
        c2 = garmin_service.get_client()
        assert c2 is second_api
        assert c1 is not c2


# ── Rate limit backoff ──────────────────���──────────────────────


class TestWithRetry:
    @patch("garmin_service.time.sleep")
    def test_succeeds_without_retry(self, mock_sleep):
        fn = MagicMock(return_value="ok")
        result = garmin_service.with_retry(fn, "arg1", key="val")
        assert result == "ok"
        fn.assert_called_once_with("arg1", key="val")
        mock_sleep.assert_not_called()

    @patch("garmin_service.time.sleep")
    def test_retries_on_rate_limit_with_backoff(self, mock_sleep):
        from requests import HTTPError

        err = HTTPError("429 Too Many Requests")
        fn = MagicMock(
            side_effect=[
                APIError(msg="rate limited", error=err),
                APIError(msg="429 Too Many Requests", error=err),
                "success",
            ]
        )
        result = garmin_service.with_retry(fn)
        assert result == "success"
        assert fn.call_count == 3
        # First backoff: 60s, second: 120s
        assert mock_sleep.call_args_list[0][0][0] == 60
        assert mock_sleep.call_args_list[1][0][0] == 120

    @patch("garmin_service.time.sleep")
    def test_gives_up_after_max_retries(self, mock_sleep):
        from requests import HTTPError

        err = HTTPError("429 Too Many Requests")
        fn = MagicMock(side_effect=APIError(msg="429 Too Many Requests", error=err))
        with pytest.raises(APIError):
            garmin_service.with_retry(fn)
        assert fn.call_count == garmin_service.RATE_LIMIT_MAX_RETRIES

    @patch("garmin_service.get_client")
    @patch("garmin_service.reset_client")
    def test_reauths_on_auth_error(self, mock_reset, mock_get_client):
        from requests import HTTPError

        call_count = 0

        def flaky(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise APIError(msg="401 Unauthorized", error=HTTPError("401"))
            return "reauthenticated"

        fn = MagicMock(side_effect=flaky)
        result = garmin_service.with_retry(fn)
        assert result == "reauthenticated"
        mock_reset.assert_called_once()
        mock_get_client.assert_called_once()


# ── Login cooldown ──��────────────────��─────────────────────────


class TestLoginCooldown:
    @patch("garmin_service.config")
    @patch("garmin_service.AuthClient")
    @patch("garmin_service.APIClient")
    def test_cooldown_after_failed_login(self, MockAPIClient, MockAuthClient, mock_config):
        mock_config.GARMIN_EMAIL = "a@b.com"
        mock_config.GARMIN_PASSWORD = "pw"

        auth = MagicMock()
        auth.is_authenticated = False
        MockAuthClient.return_value = auth

        api_instance = MagicMock()
        api_instance.login.side_effect = Exception("auth failed")
        MockAPIClient.return_value = api_instance

        with pytest.raises(Exception, match="auth failed"):
            garmin_service.get_client()

        assert garmin_service._consecutive_login_failures == 1

    def test_reset_cooldown(self):
        garmin_service._last_login_attempt = 999.0
        garmin_service._consecutive_login_failures = 5
        garmin_service.reset_login_cooldown()
        assert garmin_service._last_login_attempt == 0.0
        assert garmin_service._consecutive_login_failures == 0
