// Supabase client initialization
// Replace these with your Supabase project credentials
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

let _client = null;

export function getSupabaseClient() {
  if (_client) return _client;

  if (SUPABASE_URL === 'YOUR_SUPABASE_URL' || SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY') {
    return null; // Not configured — app will use localStorage fallback
  }

  if (typeof supabase === 'undefined' || !supabase.createClient) {
    console.warn('Supabase JS library not loaded');
    return null;
  }

  _client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _client;
}

export function isSupabaseConfigured() {
  return SUPABASE_URL !== 'YOUR_SUPABASE_URL' && SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY';
}
