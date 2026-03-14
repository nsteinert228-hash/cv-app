-- Supabase SQL schema for uTrain Exercise Tracker
-- Run this in the Supabase SQL Editor to set up the required tables.

-- 1. Workout entries table
create table if not exists workout_entries (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null default auth.uid(),
  exercise text not null,
  reps integer not null check (reps > 0),
  performed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Index for fast queries per user
create index if not exists idx_workout_entries_user
  on workout_entries(user_id, performed_at);

-- RLS: users can only access their own rows
alter table workout_entries enable row level security;

create policy "Users manage own workout entries"
  on workout_entries for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 2. User preferences table
create table if not exists user_preferences (
  user_id uuid references auth.users(id) on delete cascade primary key,
  exercise_mode text not null default 'auto',
  updated_at timestamptz not null default now()
);

-- RLS: users can only access their own preferences
alter table user_preferences enable row level security;

create policy "Users manage own preferences"
  on user_preferences for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
