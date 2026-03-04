from unittest.mock import MagicMock, patch, call

import pytest

import supabase_client


DATE = "2026-03-01"
USER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


def _mock_supabase():
    """Build a mock Supabase client with chained table().method().execute() API."""
    client = MagicMock()
    # Make table() return a builder that supports chaining
    builder = MagicMock()
    builder.upsert.return_value = builder
    builder.insert.return_value = builder
    builder.delete.return_value = builder
    builder.eq.return_value = builder
    builder.execute.return_value = MagicMock(data=[])
    client.table.return_value = builder
    return client, builder


# ── Daily upserts ──────────────────────────────────────────────


class TestDailyUpserts:
    def test_upsert_daily_summary(self):
        client, builder = _mock_supabase()
        data = {"date": DATE, "steps": 8500, "raw_json": "{}"}

        count = supabase_client.upsert_daily_summary(client, data, USER_ID)

        assert count == 1
        client.table.assert_called_with("daily_summaries")
        builder.upsert.assert_called_once()
        upsert_arg = builder.upsert.call_args
        assert upsert_arg[0][0]["date"] == DATE
        assert upsert_arg[0][0]["steps"] == 8500
        assert upsert_arg[0][0]["user_id"] == USER_ID
        assert "synced_at" in upsert_arg[0][0]
        assert upsert_arg[1]["on_conflict"] == "user_id,date"

    def test_upsert_hrv(self):
        client, builder = _mock_supabase()
        data = {"date": DATE, "weekly_avg": 45}
        count = supabase_client.upsert_hrv(client, data, USER_ID)
        assert count == 1
        client.table.assert_called_with("hrv_summaries")
        assert builder.upsert.call_args[0][0]["user_id"] == USER_ID
        assert builder.upsert.call_args[1]["on_conflict"] == "user_id,date"

    def test_upsert_sleep(self):
        client, builder = _mock_supabase()
        data = {"date": DATE, "deep_seconds": 3600}
        count = supabase_client.upsert_sleep(client, data, USER_ID)
        assert count == 1
        client.table.assert_called_with("sleep_summaries")
        assert builder.upsert.call_args[0][0]["user_id"] == USER_ID

    def test_upsert_body_composition(self):
        client, builder = _mock_supabase()
        data = {"date": DATE, "weight_kg": 75.0}
        count = supabase_client.upsert_body_composition(client, data, USER_ID)
        assert count == 1
        client.table.assert_called_with("body_composition")
        assert builder.upsert.call_args[0][0]["user_id"] == USER_ID

    def test_upsert_spo2(self):
        client, builder = _mock_supabase()
        data = {"date": DATE, "avg_spo2": 96.5}
        count = supabase_client.upsert_spo2(client, data, USER_ID)
        assert count == 1
        client.table.assert_called_with("spo2_daily")
        assert builder.upsert.call_args[0][0]["user_id"] == USER_ID

    def test_upsert_respiration(self):
        client, builder = _mock_supabase()
        data = {"date": DATE, "avg_waking": 16.5}
        count = supabase_client.upsert_respiration(client, data, USER_ID)
        assert count == 1
        client.table.assert_called_with("respiration_daily")
        assert builder.upsert.call_args[0][0]["user_id"] == USER_ID

    def test_returns_zero_for_empty_data(self):
        client, _ = _mock_supabase()
        assert supabase_client.upsert_daily_summary(client, {}, USER_ID) == 0
        assert supabase_client.upsert_daily_summary(client, None, USER_ID) == 0

    def test_sets_synced_at(self):
        client, builder = _mock_supabase()
        data = {"date": DATE}
        supabase_client.upsert_daily_summary(client, data, USER_ID)
        upsert_arg = builder.upsert.call_args[0][0]
        assert "synced_at" in upsert_arg


# ── Activities upsert ──────────────────────────────────────────


class TestUpsertActivities:
    def test_upserts_with_composite_conflict(self):
        client, builder = _mock_supabase()
        rows = [
            {"activity_id": 111, "date": DATE, "name": "Run"},
            {"activity_id": 222, "date": DATE, "name": "Walk"},
        ]

        count = supabase_client.upsert_activities(client, rows, USER_ID)

        assert count == 2
        client.table.assert_called_with("activities")
        upsert_kwargs = builder.upsert.call_args[1]
        assert upsert_kwargs["on_conflict"] == "user_id,activity_id"
        # Verify user_id added to each row
        upserted_rows = builder.upsert.call_args[0][0]
        assert all(r["user_id"] == USER_ID for r in upserted_rows)

    def test_returns_zero_for_empty_list(self):
        client, _ = _mock_supabase()
        assert supabase_client.upsert_activities(client, [], USER_ID) == 0

    def test_sets_synced_at_on_all_rows(self):
        client, builder = _mock_supabase()
        rows = [{"activity_id": 1}, {"activity_id": 2}]
        supabase_client.upsert_activities(client, rows, USER_ID)
        upserted_rows = builder.upsert.call_args[0][0]
        assert all("synced_at" in r for r in upserted_rows)


# ── Intraday (delete + chunked insert) ────────────────────────


class TestIntradayReplace:
    def test_deletes_then_inserts_heart_rate(self):
        client, builder = _mock_supabase()
        rows = [
            {"date": DATE, "timestamp": "2026-03-01T08:00:00+00:00", "heart_rate": 65},
            {"date": DATE, "timestamp": "2026-03-01T08:01:00+00:00", "heart_rate": 72},
        ]

        count = supabase_client.upsert_heart_rate_intraday(client, DATE, rows, USER_ID)

        assert count == 2
        # Should call table twice: once for delete, once for insert
        table_calls = client.table.call_args_list
        assert any(c == call("heart_rate_intraday") for c in table_calls)
        # Verify delete was called with eq("user_id", ...) and eq("date", ...)
        builder.delete.assert_called_once()
        builder.eq.assert_any_call("user_id", USER_ID)
        builder.eq.assert_any_call("date", DATE)
        # Verify insert was called with user_id in rows
        builder.insert.assert_called_once()
        inserted_rows = builder.insert.call_args[0][0]
        assert all(r["user_id"] == USER_ID for r in inserted_rows)

    def test_deletes_then_inserts_stress_details(self):
        client, builder = _mock_supabase()
        rows = [{"date": DATE, "timestamp": "T", "stress_level": 42}]
        count = supabase_client.upsert_stress_details(client, DATE, rows, USER_ID)
        assert count == 1

    def test_chunks_large_batches(self):
        client = MagicMock()

        # Track insert calls separately from delete calls
        call_log = []

        def make_builder(table_name):
            b = MagicMock()
            b.delete.return_value = b
            b.eq.return_value = b
            b.execute.return_value = MagicMock(data=[])

            def track_insert(data):
                call_log.append(("insert", len(data)))
                return b

            b.insert.side_effect = track_insert
            return b

        client.table.side_effect = lambda name: make_builder(name)

        rows = [{"date": DATE, "timestamp": f"T{i}", "heart_rate": 60 + i}
                for i in range(1250)]

        count = supabase_client.upsert_heart_rate_intraday(client, DATE, rows, USER_ID)

        assert count == 1250
        # Should be 3 insert calls: 500 + 500 + 250
        insert_calls = [c for c in call_log if c[0] == "insert"]
        assert len(insert_calls) == 3
        assert insert_calls[0][1] == 500
        assert insert_calls[1][1] == 500
        assert insert_calls[2][1] == 250

    def test_returns_zero_for_empty_rows(self):
        client, _ = _mock_supabase()
        assert supabase_client.upsert_heart_rate_intraday(client, DATE, [], USER_ID) == 0
        assert supabase_client.upsert_stress_details(client, DATE, [], USER_ID) == 0


# ── Sync log ───────────────────────────────────────────────────


class TestLogSync:
    def test_inserts_sync_log_entry(self):
        client, builder = _mock_supabase()
        supabase_client.log_sync(
            client,
            data_type="daily_summaries",
            sync_date=DATE,
            status="success",
            user_id=USER_ID,
            records_synced=1,
        )
        client.table.assert_called_with("sync_log")
        builder.insert.assert_called_once()
        row = builder.insert.call_args[0][0]
        assert row["data_type"] == "daily_summaries"
        assert row["sync_date"] == DATE
        assert row["status"] == "success"
        assert row["records_synced"] == 1
        assert row["user_id"] == USER_ID
        assert row["error_message"] is None
        assert "started_at" in row
        assert "completed_at" in row

    def test_logs_error_message(self):
        client, builder = _mock_supabase()
        supabase_client.log_sync(
            client,
            data_type="sleep",
            sync_date=DATE,
            status="error",
            user_id=USER_ID,
            error_message="Connection timeout",
        )
        row = builder.insert.call_args[0][0]
        assert row["status"] == "error"
        assert row["error_message"] == "Connection timeout"
        assert row["user_id"] == USER_ID

    def test_does_not_raise_on_insert_failure(self):
        client, builder = _mock_supabase()
        builder.execute.side_effect = Exception("DB down")
        # Should not raise — log_sync swallows exceptions
        supabase_client.log_sync(client, "test", DATE, "error", USER_ID)


# ── Retry logic ────────────────────────────────────────────────


class TestRetry:
    @patch("supabase_client.time.sleep")
    def test_retries_on_transient_error(self, mock_sleep):
        client, builder = _mock_supabase()
        builder.execute.side_effect = [
            Exception("connection reset"),
            MagicMock(data=[]),
        ]

        count = supabase_client.upsert_daily_summary(client, {"date": DATE}, USER_ID)

        assert count == 1
        assert mock_sleep.call_count == 1
        assert mock_sleep.call_args[0][0] == supabase_client.RETRY_BASE_DELAY

    @patch("supabase_client.time.sleep")
    def test_raises_after_max_retries(self, mock_sleep):
        client, builder = _mock_supabase()
        builder.execute.side_effect = Exception("persistent failure")

        with pytest.raises(Exception, match="persistent failure"):
            supabase_client.upsert_daily_summary(client, {"date": DATE}, USER_ID)

        assert mock_sleep.call_count == supabase_client.MAX_RETRIES - 1

    @patch("supabase_client.time.sleep")
    def test_exponential_backoff(self, mock_sleep):
        client, builder = _mock_supabase()
        builder.execute.side_effect = [
            Exception("fail 1"),
            Exception("fail 2"),
            MagicMock(data=[]),
        ]

        supabase_client.upsert_daily_summary(client, {"date": DATE}, USER_ID)

        delays = [c[0][0] for c in mock_sleep.call_args_list]
        assert delays == [2, 4]  # RETRY_BASE_DELAY=2, then 2*2=4
