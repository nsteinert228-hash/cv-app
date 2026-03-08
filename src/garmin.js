// Garmin Connect integration — edge function calls and data queries
import { getSupabaseClient, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase.js';

const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;

async function _callEdgeFunction(name, body = {}) {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase not configured');

  const { data: { session } } = await client.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(`${FUNCTIONS_BASE}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Edge function error: ${res.status}`);
  return data;
}

export async function connectGarmin(email, password) {
  return _callEdgeFunction('connect-garmin', {
    garmin_email: email,
    garmin_password: password,
  });
}

export async function getGarminStatus() {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from('garmin_connections')
    .select('status, last_sync_at, error_message')
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function disconnectGarmin() {
  return _callEdgeFunction('disconnect-garmin');
}

export async function requestSync() {
  return _callEdgeFunction('sync-garmin');
}

export async function getLatestDailySummary() {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from('daily_summaries')
    .select('date, steps, resting_heart_rate, calories_total')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getLatestSleep() {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from('sleep_summaries')
    .select('date, sleep_score, total_sleep_seconds')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// ── Dashboard data fetchers ──────────────────────────────────

export async function getSleepDetailed() {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from('sleep_summaries')
    .select('date, deep_seconds, light_seconds, rem_seconds, awake_seconds, total_sleep_seconds, sleep_score')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getHrvTrend(days = 14) {
  const client = getSupabaseClient();
  if (!client) return [];

  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split('T')[0];

  const { data, error } = await client
    .from('hrv_summaries')
    .select('date, last_night_avg, baseline_low, baseline_balanced, baseline_upper, status')
    .gte('date', sinceStr)
    .order('date', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function getDailySummaryDetailed() {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from('daily_summary_extended')
    .select('date, steps, calories_total, calories_active, calories_bmr, stress_avg, stress_max, stress_qualifier, intensity_minutes, floors_climbed, resting_heart_rate, min_heart_rate, max_heart_rate, distance_meters, bb_high, bb_low, bb_current, bb_charged, bb_drained, step_goal, intensity_goal, floors_goal, rhr_7d_avg, rest_stress_duration, low_stress_duration, medium_stress_duration, high_stress_duration, highly_active_seconds, sedentary_seconds, moderate_intensity_min, vigorous_intensity_min')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getSpo2() {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from('spo2_daily')
    .select('date, avg_spo2, lowest_spo2')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getLastSyncTime() {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from('sync_log')
    .select('completed_at')
    .eq('status', 'success')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.completed_at ?? null;
}

export async function getRespiration() {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from('respiration_daily')
    .select('date, avg_waking, avg_sleeping')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getRecentActivities(limit = 5) {
  const client = getSupabaseClient();
  if (!client) return [];

  const { data, error } = await client
    .from('activities')
    .select('activity_id, date, activity_type, name, start_time, duration_seconds, distance_meters, calories, avg_heart_rate, max_heart_rate, elevation_gain_meters')
    .order('date', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

export async function getBodyCompositionTrend(days = 14) {
  const client = getSupabaseClient();
  if (!client) return [];

  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split('T')[0];

  const { data, error } = await client
    .from('body_composition')
    .select('date, weight_kg, body_fat_pct, muscle_mass_kg')
    .gte('date', sinceStr)
    .order('date', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function getDailyTrend(days = 14) {
  const client = getSupabaseClient();
  if (!client) return [];

  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split('T')[0];

  const { data, error } = await client
    .from('daily_summaries')
    .select('date, resting_heart_rate, steps')
    .gte('date', sinceStr)
    .order('date', { ascending: true });

  if (error) throw error;
  return data || [];
}
