// Season data layer — CRUD for training seasons, workouts, logs, adaptations
import { getSupabaseClient, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase.js';

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

// ── Season CRUD ──────────────────────────────────────────────

export async function getActiveSeason() {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;

  const { data, error } = await client
    .from('training_seasons')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getSeasonById(seasonId) {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from('training_seasons')
    .select('*')
    .eq('id', seasonId)
    .single();

  if (error) throw error;
  return data;
}

export async function getSeasonHistory() {
  const client = getSupabaseClient();
  if (!client) return [];

  const { data, error } = await client
    .from('training_seasons')
    .select('id, season_number, name, status, duration_weeks, start_date, end_date, completion_summary, created_at, completed_at')
    .order('season_number', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function createSeason(preferences = {}, previousSeasonId = null, durationWeeks = 8, extraConfig = {}) {
  return _callEdgeFunction('season-create', {
    preferences,
    previous_season_id: previousSeasonId,
    duration_weeks: durationWeeks,
    start_date: extraConfig.start_date || null,
    plan_config: extraConfig.plan_config || null,
  });
}

export async function completeSeason(seasonId) {
  return _callEdgeFunction('season-complete', { season_id: seasonId });
}

export async function abandonSeason(seasonId) {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase not configured');

  const { error } = await client
    .from('training_seasons')
    .update({
      status: 'abandoned',
      completed_at: new Date().toISOString(),
    })
    .eq('id', seasonId)
    .eq('status', 'active');

  if (error) throw error;
}

// ── Season Workouts ──────────────────────────────────────────

export async function getSeasonWorkouts(seasonId, weekNumber = null) {
  const client = getSupabaseClient();
  if (!client) return [];

  let query = client
    .from('season_workouts')
    .select('*')
    .eq('season_id', seasonId)
    .order('date', { ascending: true });

  if (weekNumber != null) {
    query = query.eq('week_number', weekNumber);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getTodayWorkout(seasonId) {
  const client = getSupabaseClient();
  if (!client) return null;

  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await client
    .from('season_workouts')
    .select('*')
    .eq('season_id', seasonId)
    .eq('date', today)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getThisWeekWorkouts(seasonId) {
  const client = getSupabaseClient();
  if (!client) return [];

  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const { data, error } = await client
    .from('season_workouts')
    .select('*')
    .eq('season_id', seasonId)
    .gte('date', monday.toISOString().split('T')[0])
    .lte('date', sunday.toISOString().split('T')[0])
    .order('date', { ascending: true });

  if (error) throw error;
  return data || [];
}

// ── Workout Logs ─────────────────────────────────────────────

export async function getWorkoutLog(workoutId) {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from('workout_logs')
    .select('*')
    .eq('workout_id', workoutId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getWorkoutLogsForSeason(seasonId) {
  const client = getSupabaseClient();
  if (!client) return [];

  // Get all workout IDs for this season, then their logs
  const { data: workouts } = await client
    .from('season_workouts')
    .select('id')
    .eq('season_id', seasonId);

  if (!workouts || workouts.length === 0) return [];

  const ids = workouts.map(w => w.id);
  const { data, error } = await client
    .from('workout_logs')
    .select('*')
    .in('workout_id', ids)
    .order('date', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function submitWorkoutLog(workoutId, status, actualJson = {}, garminActivityId = null, notes = null, source = null) {
  const payload = {
    workout_id: workoutId,
    status,
    actual_json: actualJson,
    garmin_activity_id: garminActivityId,
    notes,
  };
  if (source) payload.source = source;
  return _callEdgeFunction('workout-log', payload);
}

// ── Adaptations ──────────────────────────────────────────────

export async function getUnacknowledgedAdaptations(seasonId) {
  const client = getSupabaseClient();
  if (!client) return [];

  const { data, error } = await client
    .from('season_adaptations')
    .select('*')
    .eq('season_id', seasonId)
    .eq('acknowledged', false)
    .eq('proximity', 'near_term')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function acknowledgeAdaptation(adaptationId) {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase not configured');

  const { error } = await client
    .from('season_adaptations')
    .update({ acknowledged: true })
    .eq('id', adaptationId);

  if (error) throw error;
}

export async function getAdaptationForDate(seasonId, date) {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from('season_adaptations')
    .select('*')
    .eq('season_id', seasonId)
    .eq('affected_date', date)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function triggerAdaptation(force = false) {
  return _callEdgeFunction('season-adapt', { force });
}

// ── Workout Swap ─────────────────────────────────────────────

export async function swapWorkout(workoutId, newType, newTitle, newPrescription) {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase not configured');

  const { data: original, error: fetchErr } = await client
    .from('season_workouts')
    .select('*')
    .eq('id', workoutId)
    .single();

  if (fetchErr) throw fetchErr;

  // Update the workout
  const { error: updateErr } = await client
    .from('season_workouts')
    .update({
      workout_type: newType,
      title: newTitle,
      prescription_json: newPrescription,
      is_adapted: true,
    })
    .eq('id', workoutId);

  if (updateErr) throw updateErr;

  // Record the swap as an adaptation for transparency
  const { error: adaptErr } = await client
    .from('season_adaptations')
    .insert({
      season_id: original.season_id,
      trigger: 'schedule',
      summary: `Swapped "${original.title}" (${original.workout_type}) → "${newTitle}" (${newType})`,
      affected_date: original.date,
      proximity: 'near_term',
      acknowledged: true,
    });

  if (adaptErr) console.warn('Failed to log swap adaptation:', adaptErr);

  return { ...original, workout_type: newType, title: newTitle, prescription_json: newPrescription, is_adapted: true };
}

export async function getWeekWorkoutsByWeekNumber(seasonId, weekNumber) {
  const client = getSupabaseClient();
  if (!client) return [];

  const { data, error } = await client
    .from('season_workouts')
    .select('*')
    .eq('season_id', seasonId)
    .eq('week_number', weekNumber)
    .order('date', { ascending: true });

  if (error) throw error;
  return data || [];
}

// ── Workout Modification ────────────────────────────────────

export async function modifyWorkout(workoutId, userPrompt, seasonId) {
  return _callEdgeFunction('modify-workout', {
    workout_id: workoutId,
    user_prompt: userPrompt,
    season_id: seasonId,
  });
}

// ── Garmin Activities by Date Range ─────────────────────────

export async function getGarminActivitiesByDateRange(startDate, endDate) {
  const client = getSupabaseClient();
  if (!client) return [];

  const { data, error } = await client
    .from('activities')
    .select('activity_id, activity_type, name, date, duration_seconds, distance_meters, calories, avg_heart_rate, max_heart_rate')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true });

  if (error) throw error;
  return data || [];
}

// ── Garmin Activity Matching ─────────────────────────────────

const GARMIN_TYPE_MAP = {
  running: ['RUNNING', 'TRAIL_RUNNING', 'TREADMILL_RUNNING'],
  cycling: ['CYCLING', 'INDOOR_CYCLING', 'MOUNTAIN_BIKING'],
  swimming: ['LAP_SWIMMING', 'OPEN_WATER_SWIMMING'],
  cardio: ['RUNNING', 'CYCLING', 'LAP_SWIMMING', 'ELLIPTICAL', 'STAIR_CLIMBING'],
};

export async function findMatchingGarminActivity(workoutType, date) {
  const client = getSupabaseClient();
  if (!client) return null;

  const matchTypes = GARMIN_TYPE_MAP[workoutType] || GARMIN_TYPE_MAP.cardio;

  const { data, error } = await client
    .from('activities')
    .select('activity_id, activity_type, name, duration_seconds, distance_meters, calories, avg_heart_rate, max_heart_rate')
    .eq('date', date)
    .in('activity_type', matchTypes)
    .limit(1);

  if (error || !data || data.length === 0) return null;
  return data[0];
}
