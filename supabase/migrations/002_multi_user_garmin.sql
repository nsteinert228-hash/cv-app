-- ============================================================
-- Multi-User Garmin Migration
-- ============================================================
-- Adds user_id scoping to all Garmin tables, creates
-- garmin_connections for per-user credentials/tokens,
-- and encrypted credential helper functions.
-- ============================================================

-- Enable pgcrypto for credential encryption
create extension if not exists pgcrypto;

-- ============================================================
-- garmin_connections — per-user Garmin account link
-- ============================================================
create table garmin_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  garmin_email text not null,
  encrypted_tokens jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'sync_requested', 'error')),
  last_sync_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table garmin_connections enable row level security;

create policy "Users read own connection"
  on garmin_connections for select
  using (auth.uid() = user_id);

create policy "Users insert own connection"
  on garmin_connections for insert
  with check (auth.uid() = user_id);

create policy "Users update own connection"
  on garmin_connections for update
  using (auth.uid() = user_id);

create policy "Users delete own connection"
  on garmin_connections for delete
  using (auth.uid() = user_id);

create policy "Service role full access"
  on garmin_connections for all
  using (auth.role() = 'service_role');

create trigger trg_garmin_connections_updated_at
  before update on garmin_connections
  for each row execute function update_updated_at();

-- ============================================================
-- 1. daily_summaries — add user_id, composite PK
-- ============================================================
alter table daily_summaries add column user_id uuid references auth.users(id);
-- Backfill if needed: UPDATE daily_summaries SET user_id = '<your-user-uuid>' WHERE user_id IS NULL;
alter table daily_summaries alter column user_id set not null;

alter table daily_summaries drop constraint daily_summaries_pkey;
alter table daily_summaries add primary key (user_id, date);

drop policy if exists "Service role bypass" on daily_summaries;
create policy "Users read own data" on daily_summaries for select using (auth.uid() = user_id);
create policy "Service role full access" on daily_summaries for all using (auth.role() = 'service_role');

drop index if exists idx_daily_summaries_date;
create index idx_daily_summaries_user_date on daily_summaries (user_id, date);

-- ============================================================
-- 2. heart_rate_intraday — add user_id (keep UUID PK)
-- ============================================================
alter table heart_rate_intraday add column user_id uuid references auth.users(id);
-- Backfill if needed: UPDATE heart_rate_intraday SET user_id = '<your-user-uuid>' WHERE user_id IS NULL;
alter table heart_rate_intraday alter column user_id set not null;

drop policy if exists "Service role bypass" on heart_rate_intraday;
create policy "Users read own data" on heart_rate_intraday for select using (auth.uid() = user_id);
create policy "Service role full access" on heart_rate_intraday for all using (auth.role() = 'service_role');

drop index if exists idx_hr_intraday_date_ts;
create index idx_hr_intraday_user_date_ts on heart_rate_intraday (user_id, date, timestamp);

-- ============================================================
-- 3. hrv_summaries — add user_id, composite PK
-- ============================================================
alter table hrv_summaries add column user_id uuid references auth.users(id);
-- Backfill if needed: UPDATE hrv_summaries SET user_id = '<your-user-uuid>' WHERE user_id IS NULL;
alter table hrv_summaries alter column user_id set not null;

alter table hrv_summaries drop constraint hrv_summaries_pkey;
alter table hrv_summaries add primary key (user_id, date);

drop policy if exists "Service role bypass" on hrv_summaries;
create policy "Users read own data" on hrv_summaries for select using (auth.uid() = user_id);
create policy "Service role full access" on hrv_summaries for all using (auth.role() = 'service_role');

drop index if exists idx_hrv_summaries_date;
create index idx_hrv_summaries_user_date on hrv_summaries (user_id, date);

-- ============================================================
-- 4. sleep_summaries — add user_id, composite PK
-- ============================================================
alter table sleep_summaries add column user_id uuid references auth.users(id);
-- Backfill if needed: UPDATE sleep_summaries SET user_id = '<your-user-uuid>' WHERE user_id IS NULL;
alter table sleep_summaries alter column user_id set not null;

alter table sleep_summaries drop constraint sleep_summaries_pkey;
alter table sleep_summaries add primary key (user_id, date);

drop policy if exists "Service role bypass" on sleep_summaries;
create policy "Users read own data" on sleep_summaries for select using (auth.uid() = user_id);
create policy "Service role full access" on sleep_summaries for all using (auth.role() = 'service_role');

drop index if exists idx_sleep_summaries_date;
create index idx_sleep_summaries_user_date on sleep_summaries (user_id, date);

-- ============================================================
-- 5. activities — add user_id, composite PK
-- ============================================================
alter table activities add column user_id uuid references auth.users(id);
-- Backfill if needed: UPDATE activities SET user_id = '<your-user-uuid>' WHERE user_id IS NULL;
alter table activities alter column user_id set not null;

alter table activities drop constraint activities_pkey;
alter table activities add primary key (user_id, activity_id);

drop policy if exists "Service role bypass" on activities;
create policy "Users read own data" on activities for select using (auth.uid() = user_id);
create policy "Service role full access" on activities for all using (auth.role() = 'service_role');

drop index if exists idx_activities_date;
drop index if exists idx_activities_start_time;
create index idx_activities_user_date on activities (user_id, date);
create index idx_activities_user_start_time on activities (user_id, start_time);

-- ============================================================
-- 6. body_composition — add user_id, composite PK
-- ============================================================
alter table body_composition add column user_id uuid references auth.users(id);
-- Backfill if needed: UPDATE body_composition SET user_id = '<your-user-uuid>' WHERE user_id IS NULL;
alter table body_composition alter column user_id set not null;

alter table body_composition drop constraint body_composition_pkey;
alter table body_composition add primary key (user_id, date);

drop policy if exists "Service role bypass" on body_composition;
create policy "Users read own data" on body_composition for select using (auth.uid() = user_id);
create policy "Service role full access" on body_composition for all using (auth.role() = 'service_role');

drop index if exists idx_body_composition_date;
create index idx_body_composition_user_date on body_composition (user_id, date);

-- ============================================================
-- 7. spo2_daily — add user_id, composite PK
-- ============================================================
alter table spo2_daily add column user_id uuid references auth.users(id);
-- Backfill if needed: UPDATE spo2_daily SET user_id = '<your-user-uuid>' WHERE user_id IS NULL;
alter table spo2_daily alter column user_id set not null;

alter table spo2_daily drop constraint spo2_daily_pkey;
alter table spo2_daily add primary key (user_id, date);

drop policy if exists "Service role bypass" on spo2_daily;
create policy "Users read own data" on spo2_daily for select using (auth.uid() = user_id);
create policy "Service role full access" on spo2_daily for all using (auth.role() = 'service_role');

drop index if exists idx_spo2_daily_date;
create index idx_spo2_daily_user_date on spo2_daily (user_id, date);

-- ============================================================
-- 8. respiration_daily — add user_id, composite PK
-- ============================================================
alter table respiration_daily add column user_id uuid references auth.users(id);
-- Backfill if needed: UPDATE respiration_daily SET user_id = '<your-user-uuid>' WHERE user_id IS NULL;
alter table respiration_daily alter column user_id set not null;

alter table respiration_daily drop constraint respiration_daily_pkey;
alter table respiration_daily add primary key (user_id, date);

drop policy if exists "Service role bypass" on respiration_daily;
create policy "Users read own data" on respiration_daily for select using (auth.uid() = user_id);
create policy "Service role full access" on respiration_daily for all using (auth.role() = 'service_role');

drop index if exists idx_respiration_daily_date;
create index idx_respiration_daily_user_date on respiration_daily (user_id, date);

-- ============================================================
-- 9. stress_details — add user_id (keep UUID PK)
-- ============================================================
alter table stress_details add column user_id uuid references auth.users(id);
-- Backfill if needed: UPDATE stress_details SET user_id = '<your-user-uuid>' WHERE user_id IS NULL;
alter table stress_details alter column user_id set not null;

drop policy if exists "Service role bypass" on stress_details;
create policy "Users read own data" on stress_details for select using (auth.uid() = user_id);
create policy "Service role full access" on stress_details for all using (auth.role() = 'service_role');

drop index if exists idx_stress_details_date_ts;
create index idx_stress_details_user_date_ts on stress_details (user_id, date, timestamp);

-- ============================================================
-- 10. sync_log — add user_id (keep UUID PK)
-- ============================================================
alter table sync_log add column user_id uuid references auth.users(id);
-- Backfill if needed: UPDATE sync_log SET user_id = '<your-user-uuid>' WHERE user_id IS NULL;
alter table sync_log alter column user_id set not null;

drop policy if exists "Service role bypass" on sync_log;
create policy "Users read own data" on sync_log for select using (auth.uid() = user_id);
create policy "Service role full access" on sync_log for all using (auth.role() = 'service_role');

drop index if exists idx_sync_log_data_type;
create index idx_sync_log_user_data_type on sync_log (user_id, data_type, sync_date);

-- ============================================================
-- Encrypted credential storage helpers
-- ============================================================

create or replace function store_garmin_credentials(
  p_user_id uuid,
  p_email text,
  p_password text,
  p_key text
)
returns void
language plpgsql
security definer
as $$
begin
  insert into garmin_connections (user_id, garmin_email, encrypted_tokens, status)
  values (
    p_user_id,
    p_email,
    jsonb_build_object(
      'password', pgp_sym_encrypt(p_password, p_key),
      'garth_tokens', null
    ),
    'pending'
  )
  on conflict (user_id) do update set
    garmin_email = excluded.garmin_email,
    encrypted_tokens = excluded.encrypted_tokens,
    status = 'pending',
    error_message = null,
    updated_at = now();
end;
$$;

create or replace function get_garmin_credentials(
  p_user_id uuid,
  p_key text
)
returns table (
  garmin_email text,
  garmin_password text,
  garth_tokens jsonb,
  status text
)
language plpgsql
security definer
as $$
begin
  return query
  select
    gc.garmin_email,
    pgp_sym_decrypt(
      (gc.encrypted_tokens->>'password')::bytea,
      p_key
    ) as garmin_password,
    case
      when gc.encrypted_tokens->>'garth_tokens' is not null
      then gc.encrypted_tokens->'garth_tokens'
      else null
    end as garth_tokens,
    gc.status
  from garmin_connections gc
  where gc.user_id = p_user_id;
end;
$$;
