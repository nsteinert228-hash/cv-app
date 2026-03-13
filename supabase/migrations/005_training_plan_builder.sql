-- ============================================================
-- Training Plan Builder — enhanced season creation & workout mods
-- ============================================================
-- Adds richer plan configuration to training_seasons and a
-- workout_modifications log for tracking user-initiated changes.
-- ============================================================

-- ── 1. Extend training_seasons with plan builder fields ──────
alter table training_seasons
  add column if not exists training_type text,
  add column if not exists skill_level text,
  add column if not exists avoided_exercises jsonb default '[]',
  add column if not exists preferred_activities jsonb default '[]',
  add column if not exists plan_duration_weeks integer,
  add column if not exists plan_config jsonb default '{}';

-- ── 2. workout_modifications — user-initiated workout changes ──
create table if not exists workout_modifications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete cascade not null,
  season_id       uuid references training_seasons(id) on delete cascade not null,
  workout_date    date not null,
  user_prompt     text not null,
  original_workout jsonb not null,
  modified_workout jsonb not null,
  affected_dates  jsonb default '[]',
  created_at      timestamptz not null default now()
);

create index idx_workout_mods_user_date
  on workout_modifications (user_id, workout_date);

alter table workout_modifications enable row level security;

create policy "Users read own modifications"
  on workout_modifications for select
  using (auth.uid() = user_id);

create policy "Service role manages modifications"
  on workout_modifications for all
  using (true) with check (true);
