-- ============================================================
-- Training Recommendations Cache + Preferences
-- ============================================================
-- Caches Claude API responses to avoid redundant calls.
-- Adds training_preferences JSONB to user_preferences.
-- ============================================================

-- ============================================================
-- 1. training_recommendations_cache
-- ============================================================
create table training_recommendations_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  view text not null check (view in ('today', 'week', 'plan')),
  data_hash text not null,
  response_json jsonb not null,
  created_at timestamptz not null default now()
);

create index idx_training_cache_lookup
  on training_recommendations_cache (user_id, view, data_hash, created_at desc);

alter table training_recommendations_cache enable row level security;

create policy "Users read own cache"
  on training_recommendations_cache for select
  using (auth.uid() = user_id);

create policy "Service role manages cache"
  on training_recommendations_cache for all
  using (true) with check (true);

-- ============================================================
-- 2. Add training_preferences to user_preferences
-- ============================================================
alter table user_preferences
  add column if not exists training_preferences jsonb default '{}';
