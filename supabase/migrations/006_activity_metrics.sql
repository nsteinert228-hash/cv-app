-- ============================================================
-- Activity Metrics (time-series data for individual activities)
-- ============================================================
-- Stores per-second or per-interval HR, pace, elevation, and
-- other metrics from Garmin activity details. Keyed on
-- (user_id, activity_id) with data points in a JSONB array.
-- ============================================================

create table activity_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  activity_id bigint not null,
  -- Summary fields extracted from detail response
  activity_type text,
  duration_seconds real,
  distance_meters real,
  -- Time-series arrays stored as JSONB for flexibility
  -- Each is an array of objects: [{t: seconds_offset, v: value}, ...]
  heart_rate_samples jsonb,       -- [{t, v}] where v = bpm
  pace_samples jsonb,             -- [{t, v}] where v = min/km
  elevation_samples jsonb,        -- [{t, v}] where v = meters
  cadence_samples jsonb,          -- [{t, v}] where v = spm
  -- Split summaries (per-km or per-mile)
  splits jsonb,                   -- [{distance_m, duration_s, avg_hr, avg_pace, elevation_gain, elevation_loss}]
  -- Computed classification
  workout_classification text,    -- e.g. "intervals", "tempo", "recovery", "base", "progression", "pyramid"
  classification_details jsonb,   -- {reason, zones: {...}, segments: [...]}
  -- Raw API response for future use
  raw_json jsonb,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint uq_activity_metrics_user_activity unique (user_id, activity_id)
);

create index idx_activity_metrics_user_activity on activity_metrics (user_id, activity_id);
create index idx_activity_metrics_activity_id on activity_metrics (activity_id);

alter table activity_metrics enable row level security;
create policy "Service role bypass" on activity_metrics
  using (true) with check (true);

create policy "Users can read own activity metrics" on activity_metrics
  for select using (auth.uid() = user_id);

create trigger trg_activity_metrics_updated_at
  before update on activity_metrics
  for each row execute function update_updated_at();
