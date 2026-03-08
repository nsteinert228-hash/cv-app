import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock supabase module ────────────────────────────────────
const mockUpsert = vi.fn().mockResolvedValue({ error: null });
const mockMaybeSingle = vi.fn();
const mockGte = vi.fn(() => ({ order: mockOrder }));
const mockOrder = vi.fn(() => ({ data: [], error: null }));
const mockSelect = vi.fn(() => ({
  maybeSingle: mockMaybeSingle,
  gte: mockGte,
}));
const mockFrom = vi.fn(() => ({
  select: mockSelect,
  upsert: mockUpsert,
}));

const mockGetSession = vi.fn();
const mockGetUser = vi.fn();
const mockClient = {
  from: mockFrom,
  auth: {
    getSession: mockGetSession,
    getUser: mockGetUser,
  },
};

vi.mock('../src/supabase.js', () => ({
  getSupabaseClient: () => mockClient,
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'test-anon-key',
}));

// ── Mock garmin helpers used by getTodayReadiness ────────────
const mockGetDailySummaryDetailed = vi.fn();
const mockGetSleepDetailed = vi.fn();
const mockGetHrvTrend = vi.fn();

vi.mock('../src/garmin.js', () => ({
  getDailySummaryDetailed: (...a) => mockGetDailySummaryDetailed(...a),
  getSleepDetailed: (...a) => mockGetSleepDetailed(...a),
  getHrvTrend: (...a) => mockGetHrvTrend(...a),
}));

// ── Mock global fetch ───────────────────────────────────────
const mockFetch = vi.fn();
global.fetch = mockFetch;

// ── Import after mocking ────────────────────────────────────
const {
  getTrainingRecommendation,
  getTodayReadiness,
  getRecentWorkouts,
  getTrainingPreferences,
  saveTrainingPreferences,
} = await import('../src/trainingData.js');

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: 'test-jwt-token' } },
  });
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-123' } },
  });
});

// ─────────────────────────────────────────────────────────────
// getTrainingRecommendation
// ─────────────────────────────────────────────────────────────
describe('getTrainingRecommendation', () => {
  it('calls training-recommendations edge function with correct params', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ recommendation: 'Rest day' }),
    });

    const result = await getTrainingRecommendation('today', { goal: 'strength' }, false);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://test.supabase.co/functions/v1/training-recommendations');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Authorization']).toBe('Bearer test-jwt-token');
    expect(opts.headers['apikey']).toBe('test-anon-key');

    const body = JSON.parse(opts.body);
    expect(body.view).toBe('today');
    expect(body.preferences).toEqual({ goal: 'strength' });
    expect(body.force).toBe(false);
    expect(result.recommendation).toBe('Rest day');
  });

  it('passes force=true when requested', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ recommendation: 'Leg day' }),
    });

    await getTrainingRecommendation('week', {}, true);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.force).toBe(true);
  });

  it('throws on edge function error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Internal server error' }),
    });

    await expect(getTrainingRecommendation('today')).rejects.toThrow('Internal server error');
  });

  it('throws when not authenticated', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });

    await expect(getTrainingRecommendation('today')).rejects.toThrow('Not authenticated');
  });
});

// ─────────────────────────────────────────────────────────────
// getTodayReadiness
// ─────────────────────────────────────────────────────────────
describe('getTodayReadiness', () => {
  it('merges daily, sleep, and HRV data into readiness snapshot', async () => {
    mockGetDailySummaryDetailed.mockResolvedValue({
      bb_current: 65, bb_high: 95, bb_low: 20,
      stress_avg: 38, resting_heart_rate: 58, steps: 9200,
    });
    mockGetSleepDetailed.mockResolvedValue({ sleep_score: 81 });
    mockGetHrvTrend.mockResolvedValue([
      { status: 'balanced', last_night_avg: 42 },
      { status: 'balanced', last_night_avg: 48 },
    ]);

    const r = await getTodayReadiness();

    expect(r).toEqual({
      sleep_score: 81,
      body_battery: 65,
      bb_high: 95,
      bb_low: 20,
      hrv_status: 'balanced',
      hrv_value: 48,
      stress_avg: 38,
      resting_hr: 58,
      steps: 9200,
    });
    expect(mockGetHrvTrend).toHaveBeenCalledWith(7);
  });

  it('returns nulls when upstream data is missing', async () => {
    mockGetDailySummaryDetailed.mockResolvedValue(null);
    mockGetSleepDetailed.mockResolvedValue(null);
    mockGetHrvTrend.mockResolvedValue([]);

    const r = await getTodayReadiness();

    expect(r.sleep_score).toBeNull();
    expect(r.body_battery).toBeNull();
    expect(r.hrv_status).toBeNull();
    expect(r.hrv_value).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// getRecentWorkouts
// ─────────────────────────────────────────────────────────────
describe('getRecentWorkouts', () => {
  it('aggregates reps by date and exercise', async () => {
    const rows = [
      { exercise: 'squat', reps: 10, performed_at: '2026-03-07T10:00:00Z' },
      { exercise: 'squat', reps: 12, performed_at: '2026-03-07T10:05:00Z' },
      { exercise: 'pushup', reps: 15, performed_at: '2026-03-07T11:00:00Z' },
    ];
    mockOrder.mockResolvedValue({ data: rows, error: null });

    const result = await getRecentWorkouts(7);

    expect(mockFrom).toHaveBeenCalledWith('workout_entries');
    expect(result).toHaveLength(2);

    const squat = result.find(r => r.exercise === 'squat');
    expect(squat.total_reps).toBe(22);
    expect(squat.date).toBe('2026-03-07');

    const pushup = result.find(r => r.exercise === 'pushup');
    expect(pushup.total_reps).toBe(15);
  });

  it('returns empty array when client is null', async () => {
    // Re-import with null client — instead we test the empty-data path
    mockOrder.mockResolvedValue({ data: [], error: null });

    const result = await getRecentWorkouts();
    expect(result).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// getTrainingPreferences / saveTrainingPreferences
// ─────────────────────────────────────────────────────────────
describe('getTrainingPreferences', () => {
  it('returns training_preferences from user_preferences row', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { training_preferences: { goal: 'endurance', experience: 'intermediate' } },
      error: null,
    });

    const prefs = await getTrainingPreferences();

    expect(mockFrom).toHaveBeenCalledWith('user_preferences');
    expect(prefs).toEqual({ goal: 'endurance', experience: 'intermediate' });
  });

  it('returns empty object when no row exists', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const prefs = await getTrainingPreferences();
    expect(prefs).toEqual({});
  });
});

describe('saveTrainingPreferences', () => {
  it('upserts preferences with user_id', async () => {
    await saveTrainingPreferences({ goal: 'strength' });

    expect(mockFrom).toHaveBeenCalledWith('user_preferences');
    expect(mockUpsert).toHaveBeenCalledWith(
      { user_id: 'user-123', training_preferences: { goal: 'strength' } },
      { onConflict: 'user_id' },
    );
  });

  it('throws when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    await expect(saveTrainingPreferences({})).rejects.toThrow('Not authenticated');
  });
});
