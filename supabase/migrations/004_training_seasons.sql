-- ============================================================
-- Training Seasons — persistent multi-week training plans
-- ============================================================
-- Converts stateless AI recommendations into season-based
-- training with workout tracking and adaptive planning.
-- ============================================================

-- ============================================================
-- 1. training_seasons — the season container
-- ============================================================
create table training_seasons (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete cascade not null,
  season_number   integer not null,
  name            text not null,
  status          text not null check (status in ('active', 'completed', 'abandoned')),
  duration_weeks  integer not null default 8,
  start_date      date not null,
  end_date        date not null,
  plan_json       jsonb not null,
  preferences_snapshot    jsonb default '{}',
  previous_season_id      uuid references training_seasons(id),
  previous_season_summary jsonb,
  completion_summary      jsonb,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

-- Only one active season per user
create unique index idx_one_active_season
  on training_seasons (user_id) where status = 'active';

create index idx_seasons_user_status
  on training_seasons (user_id, status);

alter table training_seasons enable row level security;

create policy "Users read own seasons"
  on training_seasons for select
  using (auth.uid() = user_id);

create policy "Service role manages seasons"
  on training_seasons for all
  using (true) with check (true);

-- ============================================================
-- 2. season_workouts — daily workout prescriptions
-- ============================================================
create table season_workouts (
  id                uuid primary key default gen_random_uuid(),
  season_id         uuid references training_seasons(id) on delete cascade not null,
  user_id           uuid references auth.users(id) on delete cascade not null,
  date              date not null,
  week_number       integer not null,
  day_of_week       integer not null check (day_of_week between 1 and 7),
  workout_type      text not null check (workout_type in ('strength', 'cardio', 'recovery', 'mixed', 'rest')),
  title             text not null,
  intensity         text not null check (intensity in ('high', 'moderate', 'low', 'rest')),
  duration_minutes  integer,
  prescription_json jsonb not null,
  version           integer not null default 1,
  is_adapted        boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index idx_season_workout_date
  on season_workouts (season_id, date);

create index idx_season_workouts_user_date
  on season_workouts (user_id, date);

alter table season_workouts enable row level security;

create policy "Users read own workouts"
  on season_workouts for select
  using (auth.uid() = user_id);

create policy "Service role manages workouts"
  on season_workouts for all
  using (true) with check (true);

-- ============================================================
-- 3. workout_logs — what the user actually performed
-- ============================================================
create table workout_logs (
  id                uuid primary key default gen_random_uuid(),
  workout_id        uuid references season_workouts(id) on delete cascade not null unique,
  user_id           uuid references auth.users(id) on delete cascade not null,
  date              date not null,
  status            text not null check (status in ('completed', 'partial', 'skipped', 'substituted')),
  source            text not null check (source in ('manual', 'garmin_auto', 'garmin_confirmed')),
  actual_json       jsonb not null,
  garmin_activity_id text,
  adherence_score   numeric(5,2) check (adherence_score between 0 and 100),
  notes             text,
  created_at        timestamptz not null default now()
);

create index idx_workout_logs_user_date
  on workout_logs (user_id, date);

alter table workout_logs enable row level security;

create policy "Users read own logs"
  on workout_logs for select
  using (auth.uid() = user_id);

create policy "Users insert own logs"
  on workout_logs for insert
  with check (auth.uid() = user_id);

create policy "Users update own logs"
  on workout_logs for update
  using (auth.uid() = user_id);

create policy "Service role manages logs"
  on workout_logs for all
  using (true) with check (true);

-- ============================================================
-- 4. season_adaptations — change log with feedback queue
-- ============================================================
create table season_adaptations (
  id              uuid primary key default gen_random_uuid(),
  season_id       uuid references training_seasons(id) on delete cascade not null,
  user_id         uuid references auth.users(id) on delete cascade not null,
  affected_date   date not null,
  trigger         text not null,
  summary         text not null,
  changes_json    jsonb not null,
  proximity       text not null check (proximity in ('near_term', 'future')),
  acknowledged    boolean not null default false,
  created_at      timestamptz not null default now()
);

create index idx_adaptations_user_unacked
  on season_adaptations (user_id, season_id, acknowledged)
  where acknowledged = false;

alter table season_adaptations enable row level security;

create policy "Users read own adaptations"
  on season_adaptations for select
  using (auth.uid() = user_id);

create policy "Users ack own adaptations"
  on season_adaptations for update
  using (auth.uid() = user_id);

create policy "Service role manages adaptations"
  on season_adaptations for all
  using (true) with check (true);
