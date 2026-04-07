// Murph data layer — Supabase CRUD for murph_attempts + user_profiles
import { getSupabaseClient, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase.js';

const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;

async function _getSession() {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data: { session } } = await client.auth.getSession();
  return session;
}

async function _callEdgeFunction(name, body = {}) {
  const session = await _getSession();
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
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Edge function ${name} failed: ${text}`);
  }
  return res.json();
}

// ── User Profiles ──

export async function getProfile() {
  const client = getSupabaseClient();
  if (!client) return null;
  const session = await _getSession();
  if (!session) return null;
  const { data } = await client
    .from('user_profiles')
    .select('*')
    .eq('user_id', session.user.id)
    .maybeSingle();
  return data;
}

export async function upsertProfile(displayName) {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase not configured');
  const session = await _getSession();
  if (!session) throw new Error('Not authenticated');
  const { data, error } = await client
    .from('user_profiles')
    .upsert({
      user_id: session.user.id,
      display_name: displayName,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Murph Attempts ──

export async function createAttempt(startedAt) {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase not configured');
  const session = await _getSession();
  if (!session) throw new Error('Not authenticated');
  const { data, error } = await client
    .from('murph_attempts')
    .insert({
      user_id: session.user.id,
      started_at: startedAt,
      status: 'in_progress',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateAttempt(id, updates) {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase not configured');
  const { data, error } = await client
    .from('murph_attempts')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getAttempt(id) {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data } = await client
    .from('murph_attempts')
    .select('*')
    .eq('id', id)
    .single();
  return data;
}

export async function getMyAttempts() {
  const client = getSupabaseClient();
  if (!client) return [];
  const session = await _getSession();
  if (!session) return [];
  const { data } = await client
    .from('murph_attempts')
    .select('*')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false });
  return data || [];
}

export async function abandonAttempt(id) {
  return updateAttempt(id, { status: 'abandoned' });
}

// ── Mile Matching ──

export async function matchMiles(attemptId) {
  return _callEdgeFunction('murph-match-miles', { attempt_id: attemptId });
}

// ── Leaderboard ──

export async function getLeaderboard(period = 'all') {
  return _callEdgeFunction('murph-leaderboard', { period });
}

// ── Garmin Sync Trigger ──

export async function triggerGarminSync() {
  return _callEdgeFunction('sync-garmin', {});
}
