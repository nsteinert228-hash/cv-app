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

## Automated Sync (macOS)

The sync can run automatically in the background using macOS `launchd`. This syncs yesterday + today every 4 hours and on login/boot.

### 1. Create the wrapper script

Create `sync-cron.sh` in the `garmin-sync/` directory:

```bash
#!/bin/bash
# Garmin → Supabase sync cron wrapper
set -euo pipefail

YESTERDAY=$(date -v-1d +%Y-%m-%d)
TODAY=$(date +%Y-%m-%d)
USER_ID="<your-supabase-user-uuid>"

cd ~/cv-app/garmin-sync
exec .venv/bin/python main.py sync --range "$YESTERDAY" "$TODAY" --user-id "$USER_ID"
```

Replace `<your-supabase-user-uuid>` with your user ID from Supabase Auth.

Make it executable:

```bash
chmod +x ~/cv-app/garmin-sync/sync-cron.sh
```

### 2. Create the log directory

```bash
mkdir -p ~/cv-app/garmin-sync/logs
```

### 3. Create the launchd plist

Save the following to `~/Library/LaunchAgents/com.nsteinert.garmin-sync.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.nsteinert.garmin-sync</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>/Users/YOUR_USERNAME/cv-app/garmin-sync/sync-cron.sh</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>StartInterval</key>
    <integer>14400</integer>

    <key>StandardOutPath</key>
    <string>/Users/YOUR_USERNAME/cv-app/garmin-sync/logs/sync.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/YOUR_USERNAME/cv-app/garmin-sync/logs/sync-error.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
```

Replace `YOUR_USERNAME` with your macOS username (run `whoami` to check).

### 4. Bootstrap your Garmin tokens

Before the automated sync can work, you need to authenticate once manually so that garmy caches your OAuth tokens to `~/.garmy/`:

```bash
cd ~/cv-app/garmin-sync
source .venv/bin/activate
python main.py sync --today --user-id <your-uuid>
```

This performs an SSO login and saves tokens to disk. All future runs (including the cron) will use cached/refreshed tokens without needing interactive login.

### 5. Load the scheduled job

```bash
launchctl load ~/Library/LaunchAgents/com.nsteinert.garmin-sync.plist
```

Verify it's registered:

```bash
launchctl list | grep garmin
```

### Managing the sync job

| Action | Command |
|---|---|
| Trigger manually | `launchctl start com.nsteinert.garmin-sync` |
| Stop a running sync | `launchctl stop com.nsteinert.garmin-sync` |
| Disable | `launchctl unload ~/Library/LaunchAgents/com.nsteinert.garmin-sync.plist` |
| Re-enable | `launchctl load ~/Library/LaunchAgents/com.nsteinert.garmin-sync.plist` |
| Watch logs | `tail -f ~/cv-app/garmin-sync/logs/sync-error.log` |

### How it works

- Runs on login/boot, then every 4 hours while your Mac is awake
- Skipped runs (e.g., Mac asleep) are not retried — the next run catches up by syncing yesterday + today
- Uses garmy's OAuth2 refresh tokens (valid ~30 days). As long as the sync runs at least once a month, no manual re-auth is needed
- If the refresh token expires (e.g., Mac unused for 30+ days), run the manual sync from step 4 once to re-authenticate

## Development

```bash
# Run tests
pytest -v

# Lint
ruff check .
```

## Architecture

```
main.py                CLI (argparse)
  └─ sync.py           Orchestration: date iteration, cache layer, sync_log
      ├─ data_fetchers.py     One function per data type (raw API → parsed dict)
      ├─ supabase_client.py   Upsert functions per table (chunked for intraday)
      └─ garmin_service.py    Auth, token caching, retry, all Garmin API calls (garmy)
config.py              Env var loading from .env
```

> **Note:** The old `garmin_client.py` (python-garminconnect) was removed in the garmy migration.
> If you have stale token files in `~/.garmin_tokens/` from the old library, they can be safely deleted.
> garmy stores its tokens in `~/.garmy/` (or `GARMIN_TOKEN_DIR`).
