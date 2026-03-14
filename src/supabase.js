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
      storageKey: 'train-me-auth',
      lock: async (_name, _acquireTimeout, fn) => await fn(),
    },
  });
  return _client;
}

export function isSupabaseConfigured() {
  return SUPABASE_URL !== 'YOUR_SUPABASE_URL' && SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY';
}
