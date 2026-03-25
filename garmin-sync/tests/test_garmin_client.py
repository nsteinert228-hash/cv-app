from unittest.mock import MagicMock, patch

import pytest

from garminconnect import (
    GarminConnectAuthenticationError,
    GarminConnectTooManyRequestsError,
)
from garth.exc import GarthHTTPError

import garmin_client


@pytest.fixture(autouse=True)
def _reset_singleton():
    """Ensure each test starts with fresh singleton and cooldown state."""
    garmin_client._client = None
    garmin_client.reset_login_cooldown()
    yield
    garmin_client._client = None
    garmin_client.reset_login_cooldown()


# ── Token persistence ──────────────────────────────────────────


class TestTokenPersistence:
    @patch("garmin_client.config")
    @patch("garmin_client.Garmin")
    def test_saves_tokens_on_credential_login(self, MockGarmin, mock_config, tmp_path):
        """After credential login, tokens are dumped to the token dir."""
        mock_config.GARMIN_EMAIL = "a@b.com"
        mock_config.GARMIN_PASSWORD = "pw"
        mock_config.GARMIN_TOKEN_DIR = str(tmp_path / "tokens")

        client_instance = MagicMock()
        garth_mock = MagicMock()
        client_instance.garth = garth_mock
        # First call (token load) raises FileNotFoundError
        # Second call (credential login) returns our instance
        MockGarmin.side_effect = [FileNotFoundError, client_instance]
        MockGarmin.return_value = client_instance

        # Make the token-load path fail
        first_instance = MagicMock()
        first_instance.login.side_effect = FileNotFoundError
        second_instance = client_instance
        second_instance.login.return_value = None
        MockGarmin.side_effect = [first_instance, second_instance]

        result = garmin_client.get_client()

        assert result is second_instance
        garth_mock.dump.assert_called_once()
        dump_path = garth_mock.dump.call_args[0][0]
        assert "tokens" in dump_path

    @patch("garmin_client.config")
    @patch("garmin_client.Garmin")
    def test_loads_tokens_when_available(self, MockGarmin, mock_config, tmp_path):
        """When token dir exists and tokens are valid, no credential login needed."""
        token_dir = tmp_path / "tokens"
        token_dir.mkdir()
        mock_config.GARMIN_TOKEN_DIR = str(token_dir)

        client_instance = MagicMock()
        MockGarmin.return_value = client_instance
        client_instance.login.return_value = None

        result = garmin_client.get_client()

        assert result is client_instance
        # login called with token path (not bare credentials)
        client_instance.login.assert_called_once_with(str(token_dir))


# ── Auth retry on stale tokens ─────────────────────────────────


class TestAuthRetry:
    @patch("garmin_client.config")
    @patch("garmin_client.Garmin")
    def test_retries_with_credentials_on_stale_tokens(self, MockGarmin, mock_config, tmp_path):
        """If token login raises GarthHTTPError, falls back to credentials."""
        token_dir = tmp_path / "tokens"
        token_dir.mkdir()
        mock_config.GARMIN_TOKEN_DIR = str(token_dir)
        mock_config.GARMIN_EMAIL = "a@b.com"
        mock_config.GARMIN_PASSWORD = "pw"

        stale_client = MagicMock()
        stale_client.login.side_effect = GarthHTTPError("stale", error=Exception("expired"))
        fresh_client = MagicMock()
        fresh_client.login.return_value = None
        fresh_client.garth = MagicMock()
        MockGarmin.side_effect = [stale_client, fresh_client]

        result = garmin_client.get_client()

        assert result is fresh_client
        # Should have attempted token login then credential login
        assert stale_client.login.call_count == 1
        assert fresh_client.login.call_count == 1
        fresh_client.garth.dump.assert_called_once()

    @patch("garmin_client.config")
    @patch("garmin_client.Garmin")
    def test_retries_with_credentials_on_auth_error(self, MockGarmin, mock_config, tmp_path):
        """If token login raises GarminConnectAuthenticationError, falls back."""
        token_dir = tmp_path / "tokens"
        token_dir.mkdir()
        mock_config.GARMIN_TOKEN_DIR = str(token_dir)
        mock_config.GARMIN_EMAIL = "a@b.com"
        mock_config.GARMIN_PASSWORD = "pw"

        stale_client = MagicMock()
        stale_client.login.side_effect = GarminConnectAuthenticationError
        fresh_client = MagicMock()
        fresh_client.login.return_value = None
        fresh_client.garth = MagicMock()
        MockGarmin.side_effect = [stale_client, fresh_client]

        result = garmin_client.get_client()

        assert result is fresh_client


# ── Singleton ──────────────────────────────────────────────────


class TestSingleton:
    @patch("garmin_client.config")
    @patch("garmin_client.Garmin")
    def test_returns_same_instance(self, MockGarmin, mock_config, tmp_path):
        mock_config.GARMIN_TOKEN_DIR = str(tmp_path)
        client_instance = MagicMock()
        MockGarmin.return_value = client_instance
        client_instance.login.return_value = None

        first = garmin_client.get_client()
        second = garmin_client.get_client()
        assert first is second
        # Garmin() only constructed once
        assert MockGarmin.call_count == 1

    @patch("garmin_client.config")
    @patch("garmin_client.Garmin")
    def test_reset_clears_singleton(self, MockGarmin, mock_config, tmp_path):
        mock_config.GARMIN_TOKEN_DIR = str(tmp_path)
        mock_config.GARMIN_EMAIL = "a@b.com"
        mock_config.GARMIN_PASSWORD = "pw"

        first_client = MagicMock()
        first_client.login.return_value = None
        second_client = MagicMock()
        second_client.login.return_value = None
        second_client.garth = MagicMock()

        # First get_client loads from tokens, second after reset does credential login
        stale = MagicMock()
        stale.login.side_effect = FileNotFoundError
        MockGarmin.side_effect = [first_client, stale, second_client]

        c1 = garmin_client.get_client()
        assert c1 is first_client

        garmin_client.reset_client()
        c2 = garmin_client.get_client()
        assert c2 is second_client
        assert c1 is not c2


# ── Rate limit backoff ─────────────────────────────────────────


class TestWithRetry:
    @patch("garmin_client.time.sleep")
    def test_succeeds_without_retry(self, mock_sleep):
        fn = MagicMock(return_value="ok")
        result = garmin_client.with_retry(fn, "arg1", key="val")
        assert result == "ok"
        fn.assert_called_once_with("arg1", key="val")
        mock_sleep.assert_not_called()

    @patch("garmin_client.time.sleep")
    def test_retries_on_rate_limit_with_backoff(self, mock_sleep):
        fn = MagicMock(
            side_effect=[
                GarminConnectTooManyRequestsError,
                GarminConnectTooManyRequestsError,
                "success",
            ]
        )
        result = garmin_client.with_retry(fn)
        assert result == "success"
        assert fn.call_count == 3
        # First backoff: 60s, second: 120s
        assert mock_sleep.call_args_list[0][0][0] == 60
        assert mock_sleep.call_args_list[1][0][0] == 120

    @patch("garmin_client.time.sleep")
    def test_backoff_caps_at_max(self, mock_sleep):
        fn = MagicMock(
            side_effect=[
                GarminConnectTooManyRequestsError,
                GarminConnectTooManyRequestsError,
                GarminConnectTooManyRequestsError,
                GarminConnectTooManyRequestsError,
                "success",
            ]
        )
        result = garmin_client.with_retry(fn)
        assert result == "success"
        delays = [call[0][0] for call in mock_sleep.call_args_list]
        # 60, 120, 240, 480 — but 480 > 900? No: 60, 120, 240, 480
        # Actually: 60*2=120, 120*2=240, 240*2=480; all < 900
        assert delays == [60, 120, 240, 480]

    @patch("garmin_client.time.sleep")
    def test_gives_up_after_max_retries(self, mock_sleep):
        fn = MagicMock(side_effect=GarminConnectTooManyRequestsError)
        with pytest.raises(GarminConnectTooManyRequestsError):
            garmin_client.with_retry(fn)
        assert fn.call_count == garmin_client.RATE_LIMIT_MAX_RETRIES

    @patch("garmin_client.get_client")
    @patch("garmin_client.reset_client")
    def test_reauths_on_auth_error(self, mock_reset, mock_get_client):
        call_count = 0

        def flaky(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise GarminConnectAuthenticationError
            return "reauthenticated"

        fn = MagicMock(side_effect=flaky)
        result = garmin_client.with_retry(fn)
        assert result == "reauthenticated"
        mock_reset.assert_called_once()
        mock_get_client.assert_called_once()
