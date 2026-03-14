// Training data layer — edge function calls and readiness queries
import { getSupabaseClient, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase.js';
import { getDailySummaryDetailed, getSleepDetailed, getHrvTrend } from './garmin.js';

const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;

// ── Edge function caller ─────────────────────────────────────

async function _callEdgeFunction(name, body = {}) {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase not configured');

  const { data: { session } } = await client.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  let res;
  try {
    res = await fetch(`${FUNCTIONS_BASE}/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    throw new Error('Unable to reach the server. Check your connection and try again.');
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Server returned an invalid response (${res.status})`);
  }
  if (!res.ok) throw new Error(data.error || `Edge function error: ${res.status}`);
  return data;
}

// ── Training recommendation ──────────────────────────────────

export async function getTrainingRecommendation(view, preferences = {}, force = false) {
  return _callEdgeFunction('training-recommendations', { view, preferences, force });
}

// ── Today's readiness snapshot for hero bar ──────────────────

export async function getTodayReadiness() {
  const [daily, sleep, hrvArr] = await Promise.all([
    getDailySummaryDetailed(),
    getSleepDetailed(),
    getHrvTrend(7),
  ]);

  const latestHrv = hrvArr.length ? hrvArr[hrvArr.length - 1] : null;

  return {
    sleep_score: sleep?.sleep_score ?? null,
    body_battery: daily?.bb_current ?? null,
    bb_high: daily?.bb_high ?? null,
    bb_low: daily?.bb_low ?? null,
    hrv_status: latestHrv?.status ?? null,
    hrv_value: latestHrv?.last_night_avg ?? null,
    stress_avg: daily?.stress_avg ?? null,
    resting_hr: daily?.resting_heart_rate ?? null,
    steps: daily?.steps ?? null,
  };
}

// ── Recent uTrain workout entries ──────────────────────────

export async function getRecentWorkouts(days = 7) {
  const client = getSupabaseClient();
  if (!client) return [];

  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString();

  const { data, error } = await client
    .from('workout_entries')
    .select('exercise, reps, performed_at')
    .gte('performed_at', sinceStr)
    .order('performed_at', { ascending: false });

  if (error) throw error;

  // Aggregate by date + exercise
  const agg = {};
  for (const e of (data || [])) {
    const d = new Date(e.performed_at).toISOString().split('T')[0];
    const key = `${d}|${e.exercise}`;
    if (!agg[key]) agg[key] = { date: d, exercise: e.exercise, total_reps: 0 };
    agg[key].total_reps += e.reps || 0;
  }

  return Object.values(agg);
}

// ── Training preferences ─────────────────────────────────────

export async function getTrainingPreferences() {
  const client = getSupabaseClient();
  if (!client) return {};

  const { data, error } = await client
    .from('user_preferences')
    .select('training_preferences')
    .maybeSingle();

  if (error) throw error;
  return data?.training_preferences || {};
}

export async function saveTrainingPreferences(prefs) {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase not configured');

  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await client
    .from('user_preferences')
    .upsert({ user_id: user.id, training_preferences: prefs }, { onConflict: 'user_id' });

  if (error) throw error;
}
