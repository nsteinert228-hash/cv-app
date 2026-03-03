// Authentication module using Supabase Auth
import { getSupabaseClient } from './supabase.js';

export async function signUp(email, password) {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase not configured');

  const { data, error } = await client.auth.signUp({ email, password });
  if (error) throw error;
  return data.user;
}

export async function signIn(email, password) {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase not configured');

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

export async function signOut() {
  const client = getSupabaseClient();
  if (!client) return;

  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export async function getUser() {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data: { user } } = await client.auth.getUser();
  return user;
}

export function onAuthStateChange(callback) {
  const client = getSupabaseClient();
  if (!client) return { data: { subscription: { unsubscribe() {} } } };

  return client.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
}
