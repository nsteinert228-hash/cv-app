-- Garmin Health → Supabase Schema
-- All daily tables use (user_id, date) as composite PK.
-- All include raw_json JSONB, created_at, updated_at.
-- RLS enabled on all tables with auth.uid() = user_id select policies.
-- Python service uses service_role key to bypass RLS for writes.

-- ============================================================
-- garmin_daily_summary
-- ============================================================
create table garmin_daily_summary (
  user_id uuid not null references auth.users(id),
  date date not null,
  primary key (user_id, date),
  total_steps integer,
  daily_step_goal integer,
  total_distance_meters real,
  total_kilocalories integer,
  active_kilocalories integer,
  bmr_kilocalories integer,
  floors_ascended integer,
  floors_descended integer,
  moderate_intensity_minutes integer,
  vigorous_intensity_minutes integer,
  average_stress_level integer,
  max_stress_level integer,
  rest_stress_duration integer,
  low_stress_duration integer,
  medium_stress_duration integer,
  high_stress_duration integer,
  sedentary_seconds integer,
  active_seconds integer,
  raw_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table garmin_daily_summary enable row level security;
create policy "Users read own data" on garmin_daily_summary
  for select using (auth.uid() = user_id);

-- ============================================================
-- garmin_heart_rate
-- ============================================================
create table garmin_heart_rate (
  user_id uuid not null references auth.users(id),
  date date not null,
  primary key (user_id, date),
  resting_heart_rate integer,
  min_heart_rate integer,
  max_heart_rate integer,
  seven_day_avg_resting_hr integer,
  raw_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table garmin_heart_rate enable row level security;
create policy "Users read own data" on garmin_heart_rate
  for select using (auth.uid() = user_id);

-- ============================================================
-- garmin_heart_rate_intraday
-- ============================================================
create table garmin_heart_rate_intraday (
  user_id uuid not null references auth.users(id),
  timestamp_ms bigint not null,
  date date not null,
  heart_rate integer,
  primary key (user_id, date, timestamp_ms),
  created_at timestamptz not null default now()
);

create index idx_hr_intraday_date on garmin_heart_rate_intraday (user_id, date);

alter table garmin_heart_rate_intraday enable row level security;
create policy "Users read own data" on garmin_heart_rate_intraday
  for select using (auth.uid() = user_id);

-- ============================================================
-- garmin_hrv
-- ============================================================
create table garmin_hrv (
  user_id uuid not null references auth.users(id),
  date date not null,
  primary key (user_id, date),
  weekly_avg real,
  last_night_avg real,
  last_night_5min_high real,
  baseline_low real,
  baseline_balanced real,
  baseline_high real,
  status text,
  raw_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table garmin_hrv enable row level security;
create policy "Users read own data" on garmin_hrv
  for select using (auth.uid() = user_id);

-- ============================================================
-- garmin_sleep
-- ============================================================
create table garmin_sleep (
  user_id uuid not null references auth.users(id),
  date date not null,
  primary key (user_id, date),
  sleep_start_timestamp_gmt bigint,
  sleep_end_timestamp_gmt bigint,
  deep_sleep_seconds integer,
  light_sleep_seconds integer,
  rem_sleep_seconds integer,
  awake_sleep_seconds integer,
  total_sleep_seconds integer,
  score_overall integer,
  score_quality integer,
  score_duration integer,
  score_recovery integer,
  score_deep integer,
  score_rem integer,
  score_restlessness integer,
  raw_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table garmin_sleep enable row level security;
create policy "Users read own data" on garmin_sleep
  for select using (auth.uid() = user_id);

-- ============================================================
-- garmin_activities
-- ============================================================
create table garmin_activities (
  user_id uuid not null references auth.users(id),
  activity_id bigint not null,
  primary key (user_id, activity_id),
  activity_name text,
  activity_type text,
  start_time_gmt timestamptz,
  start_time_local timestamptz,
  duration_seconds real,
  distance_meters real,
  calories integer,
  average_hr integer,
  max_hr integer,
  average_speed real,
  max_speed real,
  elevation_gain real,
  elevation_loss real,
  start_latitude real,
  start_longitude real,
  steps integer,
  vo2_max real,
  raw_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_activities_start on garmin_activities (user_id, start_time_local);

alter table garmin_activities enable row level security;
create policy "Users read own data" on garmin_activities
  for select using (auth.uid() = user_id);

-- ============================================================
-- garmin_body_composition
-- ============================================================
create table garmin_body_composition (
  user_id uuid not null references auth.users(id),
  date date not null,
  primary key (user_id, date),
  weight_grams real,
  weight_kg real,
  bmi real,
  body_fat_percent real,
  body_water_percent real,
  muscle_mass_grams integer,
  bone_mass_grams integer,
  raw_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table garmin_body_composition enable row level security;
create policy "Users read own data" on garmin_body_composition
  for select using (auth.uid() = user_id);

-- ============================================================
-- garmin_spo2
-- ============================================================
create table garmin_spo2 (
  user_id uuid not null references auth.users(id),
  date date not null,
  primary key (user_id, date),
  average_spo2 real,
  lowest_spo2 integer,
  seven_day_avg_spo2 real,
  raw_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table garmin_spo2 enable row level security;
create policy "Users read own data" on garmin_spo2
  for select using (auth.uid() = user_id);

-- ============================================================
-- garmin_respiration
-- ============================================================
create table garmin_respiration (
  user_id uuid not null references auth.users(id),
  date date not null,
  primary key (user_id, date),
  avg_waking_respiration real,
  avg_sleep_respiration real,
  highest_respiration real,
  lowest_respiration real,
  raw_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table garmin_respiration enable row level security;
create policy "Users read own data" on garmin_respiration
  for select using (auth.uid() = user_id);

-- ============================================================
-- garmin_body_battery
-- ============================================================
create table garmin_body_battery (
  user_id uuid not null references auth.users(id),
  date date not null,
  primary key (user_id, date),
  charged integer,
  drained integer,
  start_level integer,
  end_level integer,
  raw_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table garmin_body_battery enable row level security;
create policy "Users read own data" on garmin_body_battery
  for select using (auth.uid() = user_id);

-- ============================================================
-- garmin_training_readiness
-- ============================================================
create table garmin_training_readiness (
  user_id uuid not null references auth.users(id),
  date date not null,
  primary key (user_id, date),
  score integer,
  level text,
  raw_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table garmin_training_readiness enable row level security;
create policy "Users read own data" on garmin_training_readiness
  for select using (auth.uid() = user_id);

-- ============================================================
-- garmin_sync_log
-- ============================================================
create table garmin_sync_log (
  user_id uuid not null references auth.users(id),
  data_type text not null,
  primary key (user_id, data_type),
  last_synced_date date not null,
  last_synced_at timestamptz not null default now(),
  rows_synced integer default 0
);

alter table garmin_sync_log enable row level security;
create policy "Users read own data" on garmin_sync_log
  for select using (auth.uid() = user_id);
