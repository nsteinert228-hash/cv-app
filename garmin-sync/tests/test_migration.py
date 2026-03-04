"""Basic validation that the multi-user migration SQL file parses correctly."""

from pathlib import Path


MIGRATION_PATH = Path(__file__).parent.parent.parent / "supabase" / "migrations" / "002_multi_user_garmin.sql"


class TestMigrationFile:
    def test_migration_file_exists(self):
        assert MIGRATION_PATH.exists(), f"Migration file not found at {MIGRATION_PATH}"

    def test_migration_not_empty(self):
        content = MIGRATION_PATH.read_text()
        assert len(content) > 100, "Migration file is suspiciously small"

    def test_creates_garmin_connections_table(self):
        content = MIGRATION_PATH.read_text()
        assert "create table garmin_connections" in content

    def test_adds_user_id_to_all_garmin_tables(self):
        content = MIGRATION_PATH.read_text()
        tables = [
            "daily_summaries",
            "heart_rate_intraday",
            "hrv_summaries",
            "sleep_summaries",
            "activities",
            "body_composition",
            "spo2_daily",
            "respiration_daily",
            "stress_details",
            "sync_log",
        ]
        for table in tables:
            assert f"alter table {table} add column user_id" in content, \
                f"Missing user_id column addition for {table}"

    def test_creates_rls_policies(self):
        content = MIGRATION_PATH.read_text()
        assert content.count('"Users read own data"') == 10  # one per garmin table
        assert content.count('"Service role full access"') >= 10

    def test_creates_credential_functions(self):
        content = MIGRATION_PATH.read_text()
        assert "store_garmin_credentials" in content
        assert "get_garmin_credentials" in content
        assert "pgp_sym_encrypt" in content
        assert "pgp_sym_decrypt" in content

    def test_enables_pgcrypto(self):
        content = MIGRATION_PATH.read_text()
        assert "pgcrypto" in content
