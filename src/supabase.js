// Supabase client initialization
// Replace these with your Supabase project credentials
export const SUPABASE_URL = 'https://zzmfhumffrvlfinpyrzc.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp6bWZodW1mZnJ2bGZpbnB5cnpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1NzcxNTIsImV4cCI6MjA4ODE1MzE1Mn0.TYWnudUD9-IkvulBTFKN3OInm9e74XEDVceChKPU95s';

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

  _client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storageKey: 'cv-app-auth',
      lock: async (_name, _acquireTimeout, fn) => await fn(),
    },
  });
  return _client;
}

export function isSupabaseConfigured() {
  return SUPABASE_URL !== 'YOUR_SUPABASE_URL' && SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY';
}

const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;

export async function callEdgeFunction(name, body = {}) {
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
  } catch {
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
