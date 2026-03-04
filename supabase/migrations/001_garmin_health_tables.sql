-- ============================================================
-- Garmin Health Tables Migration
-- ============================================================
-- Single-user schema: date is the PK for daily tables.
-- All tables include raw_json, created_at, updated_at.
-- RLS enabled with service_role bypass for Python sync writes.
-- ============================================================

-- ============================================================
-- Helper: auto-update updated_at trigger function
-- ============================================================
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================
-- 1. daily_summaries
-- ============================================================
create table daily_summaries (
  date date primary key,
  steps integer,
  floors_climbed integer,
  calories_total integer,
  calories_active integer,
  calories_bmr integer,
  distance_meters real,
  intensity_minutes integer,
  stress_avg integer,
  stress_max integer,
  stress_qualifier text,
  avg_heart_rate integer,
  max_heart_rate integer,
  resting_heart_rate integer,
  min_heart_rate integer,
  raw_json jsonb,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_daily_summaries_date on daily_summaries (date);

alter table daily_summaries enable row level security;
create policy "Service role bypass" on daily_summaries
  using (true) with check (true);

create trigger trg_daily_summaries_updated_at
  before update on daily_summaries
  for each row execute function update_updated_at();

-- ============================================================
-- 2. heart_rate_intraday
-- ============================================================
create table heart_rate_intraday (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  timestamp timestamptz not null,
  heart_rate integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_hr_intraday_date_ts on heart_rate_intraday (date, timestamp);

alter table heart_rate_intraday enable row level security;
create policy "Service role bypass" on heart_rate_intraday
  using (true) with check (true);

create trigger trg_hr_intraday_updated_at
  before update on heart_rate_intraday
  for each row execute function update_updated_at();

-- ============================================================
-- 3. hrv_summaries
-- ============================================================
create table hrv_summaries (
  date date primary key,
  weekly_avg real,
  last_night real,
  last_night_avg real,
  last_night_5_min_high real,
  baseline_low real,
  baseline_balanced real,
  baseline_upper real,
  status text,
  raw_json jsonb,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_hrv_summaries_date on hrv_summaries (date);

alter table hrv_summaries enable row level security;
create policy "Service role bypass" on hrv_summaries
  using (true) with check (true);

create trigger trg_hrv_summaries_updated_at
  before update on hrv_summaries
  for each row execute function update_updated_at();

-- ============================================================
-- 4. sleep_summaries
-- ============================================================
create table sleep_summaries (
  date date primary key,
  sleep_start timestamptz,
  sleep_end timestamptz,
  total_sleep_seconds integer,
  deep_seconds integer,
  light_seconds integer,
  rem_seconds integer,
  awake_seconds integer,
  sleep_score integer,
  avg_spo2 real,
  avg_respiration real,
  raw_json jsonb,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_sleep_summaries_date on sleep_summaries (date);

alter table sleep_summaries enable row level security;
create policy "Service role bypass" on sleep_summaries
  using (true) with check (true);

create trigger trg_sleep_summaries_updated_at
  before update on sleep_summaries
  for each row execute function update_updated_at();

-- ============================================================
-- 5. activities
-- ============================================================
create table activities (
  activity_id bigint primary key,
  date date not null,
  activity_type text,
  name text,
  start_time timestamptz,
  duration_seconds real,
  distance_meters real,
  calories integer,
  avg_heart_rate integer,
  max_heart_rate integer,
  avg_pace real,
  elevation_gain_meters real,
  raw_json jsonb,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_activities_date on activities (date);
create index idx_activities_start_time on activities (start_time);

alter table activities enable row level security;
create policy "Service role bypass" on activities
  using (true) with check (true);

create trigger trg_activities_updated_at
  before update on activities
  for each row execute function update_updated_at();

-- ============================================================
-- 6. body_composition
-- ============================================================
create table body_composition (
  date date primary key,
  weight_kg real,
  bmi real,
  body_fat_pct real,
  muscle_mass_kg real,
  bone_mass_kg real,
  body_water_pct real,
  raw_json jsonb,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_body_composition_date on body_composition (date);

alter table body_composition enable row level security;
create policy "Service role bypass" on body_composition
  using (true) with check (true);

create trigger trg_body_composition_updated_at
  before update on body_composition
  for each row execute function update_updated_at();

-- ============================================================
-- 7. spo2_daily
-- ============================================================
create table spo2_daily (
  date date primary key,
  avg_spo2 real,
  lowest_spo2 integer,
  latest_spo2 real,
  raw_json jsonb,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_spo2_daily_date on spo2_daily (date);

alter table spo2_daily enable row level security;
create policy "Service role bypass" on spo2_daily
  using (true) with check (true);

create trigger trg_spo2_daily_updated_at
  before update on spo2_daily
  for each row execute function update_updated_at();

-- ============================================================
-- 8. respiration_daily
-- ============================================================
create table respiration_daily (
  date date primary key,
  avg_waking real,
  avg_sleeping real,
  highest real,
  lowest real,
  raw_json jsonb,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_respiration_daily_date on respiration_daily (date);

alter table respiration_daily enable row level security;
create policy "Service role bypass" on respiration_daily
  using (true) with check (true);

create trigger trg_respiration_daily_updated_at
  before update on respiration_daily
  for each row execute function update_updated_at();

-- ============================================================
-- 9. stress_details
-- ============================================================
create table stress_details (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  timestamp timestamptz not null,
  stress_level integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_stress_details_date_ts on stress_details (date, timestamp);

alter table stress_details enable row level security;
create policy "Service role bypass" on stress_details
  using (true) with check (true);

create trigger trg_stress_details_updated_at
  before update on stress_details
  for each row execute function update_updated_at();

-- ============================================================
-- 10. sync_log
-- ============================================================
create table sync_log (
  id uuid primary key default gen_random_uuid(),
  data_type text not null,
  sync_date date not null,
  status text not null,
  error_message text,
  records_synced integer,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_sync_log_data_type on sync_log (data_type, sync_date);

alter table sync_log enable row level security;
create policy "Service role bypass" on sync_log
  using (true) with check (true);

create trigger trg_sync_log_updated_at
  before update on sync_log
  for each row execute function update_updated_at();
