// Garmin Connect integration — edge function calls and data queries
import { getSupabaseClient } from './supabase.js';

const FUNCTIONS_BASE = 'https://zzmfhumffrvlfinpyrzc.supabase.co/functions/v1';

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
      'apikey': session.access_token,
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
