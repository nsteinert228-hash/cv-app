#!/bin/bash
# Garmin → Supabase sync cron wrapper
# Used by macOS launchd (com.nsteinert.garmin-sync)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== garmin-sync starting at $(date) ==="

# Load .env so Python has SUPABASE_URL, SUPABASE_SERVICE_KEY, etc.
if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a
    source "$SCRIPT_DIR/.env"
    set +a
else
    echo "ERROR: $SCRIPT_DIR/.env not found. Copy .env.example to .env and fill in values." >&2
    exit 1
fi

YESTERDAY=$(date -v-1d +%Y-%m-%d)
TODAY=$(date +%Y-%m-%d)

# USER_ID: your Supabase Auth user UUID
# Find it in Supabase Dashboard → Authentication → Users
USER_ID="${GARMIN_SYNC_USER_ID:?Set GARMIN_SYNC_USER_ID in .env}"

echo "Syncing $YESTERDAY to $TODAY for user $USER_ID"
exec "$SCRIPT_DIR/.venv/bin/python" main.py sync --range "$YESTERDAY" "$TODAY" --user-id "$USER_ID"
