-- ============================================================
-- Plan Completions — activity-to-plan matching engine results
-- ============================================================
-- Stores the result of matching Garmin activities to planned
-- season workouts. Populated by the Python matching engine
-- post-sync. Separate from workout_logs (user-facing) so the
-- engine can freely re-run without corrupting manual entries.
-- ============================================================

create table if not exists plan_completions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references auth.users(id) on delete cascade not null,
  season_id           uuid references training_seasons(id) on delete cascade not null,
  workout_id          uuid references season_workouts(id) on delete cascade not null,
  activity_id         bigint,                -- NULL for rest days or unmatched
  match_date          date not null,         -- planned workout date
  activity_date       date,                  -- actual activity date (may differ by +-1)
  match_type          text not null check (match_type in (
    'exact', 'fuzzy_date', 'type_only', 'substitute', 'rest_day', 'unmatched'
  )),
  match_confidence    numeric(5,2) check (match_confidence between 0 and 100),
  completion_score    numeric(5,2) check (completion_score between 0 and 100),
  match_reason        text,                  -- plain English explanation
  scoring_breakdown   jsonb default '{}',    -- {type_score, duration_score, intensity_score, date_score}
  matched_at          timestamptz not null default now(),
  overridden          boolean not null default false,
  override_reason     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (workout_id)                        -- one completion per planned workout
);

create index if not exists idx_plan_completions_user_season
  on plan_completions (user_id, season_id, match_date);

create index if not exists idx_plan_completions_activity
  on plan_completions (user_id, activity_id)
  where activity_id is not null;

alter table plan_completions enable row level security;

create policy "Users read own completions"
  on plan_completions for select
  using (auth.uid() = user_id);

create policy "Service role manages completions"
  on plan_completions for all
  to service_role
  using (true) with check (true);
