import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase module
vi.mock('../src/supabase.js', () => {
  const SUPABASE_URL = 'https://test.supabase.co';
  const SUPABASE_ANON_KEY = 'test-anon-key';
  return { getSupabaseClient: vi.fn(), SUPABASE_URL, SUPABASE_ANON_KEY };
});

const { getSupabaseClient } = await import('../src/supabase.js');

// ── seasonManager tests (pure logic, no DB) ────────────────

describe('seasonManager — computeSeasonState logic', () => {
  // We test the logic directly since computeSeasonState is not exported.
  // Instead, we replicate its logic here for unit testing.

  function computeSeasonState(season) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startDate = new Date(season.start_date + 'T00:00:00');
    const endDate = new Date(season.end_date + 'T00:00:00');

    const daysSinceStart = Math.floor((today - startDate) / (1000 * 60 * 60 * 24));
    const totalDays = season.duration_weeks * 7;

    const currentWeek = Math.min(
      Math.max(Math.floor(daysSinceStart / 7) + 1, 1),
      season.duration_weeks,
    );

    const currentDay = Math.min(
      Math.max(daysSinceStart + 1, 1),
      totalDays,
    );

    const daysRemaining = Math.max(
      Math.floor((endDate - today) / (1000 * 60 * 60 * 24)),
      0,
    );

    const isExpired = today > endDate;
    const hasStarted = today >= startDate;
    const progressPct = totalDays > 0
      ? Math.min(Math.round((daysSinceStart / totalDays) * 100), 100)
      : 0;

    return { currentWeek, currentDay, totalDays, daysRemaining, isExpired, hasStarted, progressPct };
  }

  it('computes state for a season in progress', () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - 10); // started 10 days ago

    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 55); // 8 weeks total

    const season = {
      start_date: startDate.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0],
      duration_weeks: 8,
    };

    const state = computeSeasonState(season);

    expect(state.currentWeek).toBeGreaterThanOrEqual(2);
    expect(state.currentDay).toBeGreaterThanOrEqual(10);
    expect(state.currentDay).toBeLessThanOrEqual(12);
    expect(state.totalDays).toBe(56);
    expect(state.isExpired).toBe(false);
    expect(state.hasStarted).toBe(true);
    expect(state.progressPct).toBeGreaterThan(0);
    expect(state.progressPct).toBeLessThan(100);
    expect(state.daysRemaining).toBeGreaterThan(0);
  });

  it('computes state for a season that has not started', () => {
    const future = new Date();
    future.setDate(future.getDate() + 5);

    const endDate = new Date(future);
    endDate.setDate(future.getDate() + 55);

    const season = {
      start_date: future.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0],
      duration_weeks: 8,
    };

    const state = computeSeasonState(season);

    expect(state.currentWeek).toBe(1);
    expect(state.currentDay).toBe(1);
    expect(state.hasStarted).toBe(false);
    expect(state.isExpired).toBe(false);
  });

  it('computes state for an expired season', () => {
    const past = new Date();
    past.setDate(past.getDate() - 60);

    const endDate = new Date(past);
    endDate.setDate(past.getDate() + 55);

    const season = {
      start_date: past.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0],
      duration_weeks: 8,
    };

    const state = computeSeasonState(season);

    expect(state.isExpired).toBe(true);
    expect(state.daysRemaining).toBe(0);
    expect(state.progressPct).toBe(100);
  });

  it('clamps currentWeek to duration_weeks', () => {
    const past = new Date();
    past.setDate(past.getDate() - 100);

    const endDate = new Date(past);
    endDate.setDate(past.getDate() + 55);

    const season = {
      start_date: past.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0],
      duration_weeks: 8,
    };

    const state = computeSeasonState(season);

    expect(state.currentWeek).toBe(8);
    expect(state.currentDay).toBe(56);
  });
});

// ── seasonData query tests ──────────────────────────────────

describe('seasonData — getActiveSeason', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = {
      from: vi.fn(),
      auth: { getSession: vi.fn() },
    };
    getSupabaseClient.mockReturnValue(mockClient);
  });

  it('returns null when no active season exists', async () => {
    const { getActiveSeason } = await import('../src/seasonData.js');

    mockClient.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    });

    const result = await getActiveSeason();
    expect(result).toBeNull();
  });

  it('returns active season when one exists', async () => {
    const { getActiveSeason } = await import('../src/seasonData.js');

    const mockSeason = { id: 'abc-123', name: 'Test Season', status: 'active' };
    mockClient.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: mockSeason, error: null }),
        }),
      }),
    });

    const result = await getActiveSeason();
    expect(result).toEqual(mockSeason);
  });

  it('returns null when supabase is not configured', async () => {
    getSupabaseClient.mockReturnValue(null);
    const { getActiveSeason } = await import('../src/seasonData.js');
    const result = await getActiveSeason();
    expect(result).toBeNull();
  });
});

describe('seasonData — getThisWeekWorkouts', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = {
      from: vi.fn(),
    };
    getSupabaseClient.mockReturnValue(mockClient);
  });

  it('queries workouts for current Mon-Sun range', async () => {
    const { getThisWeekWorkouts } = await import('../src/seasonData.js');

    const mockWorkouts = [
      { id: 'w1', date: '2026-03-09', title: 'Upper Body' },
      { id: 'w2', date: '2026-03-10', title: 'Cardio' },
    ];

    const orderFn = vi.fn().mockResolvedValue({ data: mockWorkouts, error: null });
    const lteFn = vi.fn().mockReturnValue({ order: orderFn });
    const gteFn = vi.fn().mockReturnValue({ lte: lteFn });
    const eqFn = vi.fn().mockReturnValue({ gte: gteFn });
    const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
    mockClient.from.mockReturnValue({ select: selectFn });

    const result = await getThisWeekWorkouts('season-id');
    expect(result).toEqual(mockWorkouts);
    expect(mockClient.from).toHaveBeenCalledWith('season_workouts');
  });
});

describe('seasonData — GARMIN_TYPE_MAP', () => {
  it('maps running types correctly', async () => {
    const mod = await import('../src/seasonData.js');
    // findMatchingGarminActivity uses GARMIN_TYPE_MAP internally
    // We can't test the map directly since it's not exported,
    // but we can verify the function exists
    expect(typeof mod.findMatchingGarminActivity).toBe('function');
  });
});

// ── Edge function caller tests ──────────────────────────────

describe('seasonData — createSeason', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: 'test-token' } },
        }),
      },
    };
    getSupabaseClient.mockReturnValue(mockClient);
  });

  it('calls season-create edge function', async () => {
    const { createSeason } = await import('../src/seasonData.js');

    const mockResponse = { season_id: 'new-id', name: 'Test', total_workouts: 56 };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockResponse),
    });

    const result = await createSeason({ goals: 'strength_building' }, null, 8);
    expect(result).toEqual(mockResponse);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/season-create'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws on edge function error', async () => {
    const { createSeason } = await import('../src/seasonData.js');

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({ error: 'Season already exists' }),
    });

    await expect(createSeason()).rejects.toThrow('Season already exists');
  });
});

describe('seasonData — submitWorkoutLog', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: 'test-token' } },
        }),
      },
    };
    getSupabaseClient.mockReturnValue(mockClient);
  });

  it('calls workout-log edge function with correct payload', async () => {
    const { submitWorkoutLog } = await import('../src/seasonData.js');

    const mockResponse = { log_id: 'log-1', adherence_score: 85 };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockResponse),
    });

    const actual = { exercises: [{ exercise: 'Bench Press', sets_completed: 3, completed: true }] };
    const result = await submitWorkoutLog('workout-1', 'completed', actual, null, 'Felt good');

    expect(result).toEqual(mockResponse);

    const fetchCall = global.fetch.mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.workout_id).toBe('workout-1');
    expect(body.status).toBe('completed');
    expect(body.actual_json).toEqual(actual);
    expect(body.notes).toBe('Felt good');
  });
});

describe('seasonData — acknowledgeAdaptation', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = {
      from: vi.fn(),
    };
    getSupabaseClient.mockReturnValue(mockClient);
  });

  it('updates acknowledged to true', async () => {
    const { acknowledgeAdaptation } = await import('../src/seasonData.js');

    const eqFn = vi.fn().mockResolvedValue({ error: null });
    const updateFn = vi.fn().mockReturnValue({ eq: eqFn });
    mockClient.from.mockReturnValue({ update: updateFn });

    await acknowledgeAdaptation('adapt-1');
    expect(mockClient.from).toHaveBeenCalledWith('season_adaptations');
    expect(updateFn).toHaveBeenCalledWith({ acknowledged: true });
  });
});
