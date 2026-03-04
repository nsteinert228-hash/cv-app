# Garmin Health → Supabase Sync

## Stack
- Python 3.11+
- garminconnect (Garmin Connect API wrapper)
- supabase-py (Supabase Python client)
- python-dotenv for env management

## Commands
- `pip install -r requirements.txt` — install deps
- `pytest -v` — run tests
- `ruff check .` — lint
- `python main.py sync --today` — daily sync
- `python main.py backfill --days 30` — backfill

## Conventions
- Date format: 'YYYY-MM-DD' strings throughout
- All DB tables use date (DATE) as primary key for daily data
- Raw API responses stored in JSONB raw_json columns
- Upserts for idempotent syncs (safe to re-run)
- Structured logging with Python logging module
- Type hints on all functions

## Key Files
- garmin_client.py — auth + session management
- data_fetchers.py — one function per health data type
- supabase_client.py — upsert logic per table
- sync.py — orchestration + date range iteration
- main.py — CLI entrypoint
- config.py — env var loading

## Important Notes
- Never commit .env or token files
- Garmin rate limits aggressively — use 1s delay between date fetches
- Token persistence in ~/.garmin_tokens avoids repeated logins
- Supabase uses service_role key (bypasses RLS)
- Intraday data (HR, stress) is batched in 500-row chunks
