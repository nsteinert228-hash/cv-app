# Garmin Sync Service Deployment

The Python sync service (`garmin-sync/`) pulls data from Garmin Connect and writes it to Supabase. It needs to run on a schedule outside of GitHub Pages.

## Recommended: Railway.app Cron Job

Railway supports Python natively with built-in cron scheduling. The free tier is sufficient for this workload.

### Setup

1. Add a `Dockerfile` to `garmin-sync/`:

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["python", "sync_all.py"]
```

2. Create a Railway project and link the `garmin-sync/` directory.

3. Set environment variables in Railway:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `GARMIN_ENCRYPTION_KEY`

4. Configure the cron schedule: `0 6,18 * * *` (twice daily at 6 AM and 6 PM UTC).

### Why twice daily?

Garmin data updates once per day after the watch syncs (typically overnight for sleep, throughout the day for activity). Running at 6 AM catches overnight sleep data; 6 PM catches daily activity data.

### Alternative: Hourly polling

For more frequent updates, use the watch mode:

```
sync-all --watch --interval 3600
```

This polls every hour. Useful during development or if users want near-real-time step counts.

## Other Options

| Platform | Pros | Cons |
|----------|------|------|
| **Railway** | Python-native, built-in cron, simple | Free tier limits |
| **Render** | Free cron jobs, Docker support | Cold starts on free tier |
| **Fly.io** | Global edge, machines API | More complex setup |
| **GitHub Actions** | Free for public repos, no infra | 6-hour max runtime, no persistent state |
| **Supabase Edge Function** | Same platform | Deno runtime, needs Python rewrite |

## Monitoring

- Railway provides built-in logs for each cron run
- Optionally create a `sync_health` table in Supabase to track sync run outcomes
- The `sync_log` table already records per-user sync results with timestamps
