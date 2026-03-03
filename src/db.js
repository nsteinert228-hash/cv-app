// Database operations for Supabase
import { getSupabaseClient } from './supabase.js';

// --- Workout Entries ---

export async function fetchWorkoutEntries() {
  const client = getSupabaseClient();
  if (!client) return [];

  const { data, error } = await client
    .from('workout_entries')
    .select('id, exercise, reps, performed_at')
    .order('performed_at', { ascending: true });

  if (error) throw error;

  return (data || []).map(row => ({
    id: row.id,
    exercise: row.exercise,
    reps: row.reps,
    timestamp: new Date(row.performed_at),
  }));
}

export async function insertWorkoutEntry(exercise, reps, timestamp) {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from('workout_entries')
    .insert({
      exercise,
      reps,
      performed_at: timestamp.toISOString(),
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

export async function deleteAllWorkoutEntries() {
  const client = getSupabaseClient();
  if (!client) return;

  const { error } = await client
    .from('workout_entries')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000'); // delete all rows

  if (error) throw error;
}

// --- User Preferences ---

export async function fetchPreferences() {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from('user_preferences')
    .select('exercise_mode')
    .single();

  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
  return data;
}

export async function upsertPreferences(exerciseMode) {
  const client = getSupabaseClient();
  if (!client) return;

  const { data: { user } } = await client.auth.getUser();
  if (!user) return;

  const { error } = await client
    .from('user_preferences')
    .upsert({
      user_id: user.id,
      exercise_mode: exerciseMode,
      updated_at: new Date().toISOString(),
    });

  if (error) throw error;
}
