# Garmin Health → Supabase Sync

Python service that pulls personal health data from Garmin Connect and writes it to Supabase. Idempotent (safe to re-run), handles rate limiting with exponential backoff, and persists auth tokens to avoid repeated logins.

## Setup

```bash
cd garmin-sync
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `GARMIN_EMAIL` | Your Garmin Connect email |
| `GARMIN_PASSWORD` | Your Garmin Connect password |
| `SUPABASE_URL` | Supabase project URL (`https://xxx.supabase.co`) |
| `SUPABASE_SERVICE_KEY` | Supabase service_role key (not anon) |

Run the migration in the Supabase SQL Editor:

```sql
-- Paste contents of supabase/migrations/001_garmin_health_tables.sql
```

## Usage

```bash
# Sync today's data (all types)
python main.py sync --today

# Sync a specific date
python main.py sync --date 2025-03-01

# Sync a date range
python main.py sync --range 2025-01-01 2025-03-01

# Sync only specific data types
python main.py sync --today --types sleep,hrv,heart_rate

# Backfill last 90 days (skips already-synced dates)
python main.py backfill --days 90

# Check sync status
python main.py status
```

### Data Types

`daily_summaries`, `heart_rate`, `hrv`, `sleep`, `activities`, `body_composition`, `spo2`, `respiration`, `stress`

## Tables

| Table | PK | Description |
|---|---|---|
| `daily_summaries` | `date` | Steps, calories, distance, stress, heart rate |
| `heart_rate_intraday` | `id` (UUID) | Per-minute HR readings with timestamp |
| `hrv_summaries` | `date` | HRV weekly avg, last night, baseline, status |
| `sleep_summaries` | `date` | Sleep stages, score, SpO2, respiration |
| `activities` | `activity_id` | Garmin activities with pace, HR, elevation |
| `body_composition` | `date` | Weight, BMI, body fat, muscle mass |
| `spo2_daily` | `date` | Average, lowest, latest SpO2 |
| `respiration_daily` | `date` | Waking/sleeping respiration rates |
| `stress_details` | `id` (UUID) | Per-minute stress readings |
| `sync_log` | `id` (UUID) | Tracks sync history per data type and date |

All tables include `raw_json` (full API response), `created_at`, `updated_at`, and `synced_at`. RLS is enabled with a service_role bypass policy.

## Development

```bash
# Run tests
pytest -v

# Lint
ruff check .
```

## Architecture

```
main.py              CLI (argparse)
  └─ sync.py         Orchestration: date iteration, error isolation, sync_log
      ├─ data_fetchers.py   One function per data type (Garmin API → parsed dict)
      ├─ supabase_client.py Upsert functions per table (chunked for intraday)
      └─ garmin_client.py   Auth, token persistence, rate limit retry
config.py            Env var loading from .env
```
