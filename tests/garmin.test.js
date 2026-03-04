import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase module
const mockMaybeSingle = vi.fn();
const mockLimit = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockOrder = vi.fn(() => ({ limit: mockLimit }));
const mockSelect = vi.fn(() => ({ order: mockOrder, maybeSingle: mockMaybeSingle }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));

const mockGetSession = vi.fn();
const mockClient = {
  from: mockFrom,
  auth: {
    getSession: mockGetSession,
  },
};

vi.mock('../src/supabase.js', () => ({
  getSupabaseClient: () => mockClient,
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import after mocking
const {
  connectGarmin,
  getGarminStatus,
  disconnectGarmin,
  requestSync,
  getLatestDailySummary,
  getLatestSleep,
} = await import('../src/garmin.js');

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: 'test-jwt-token' } },
  });
});

describe('connectGarmin', () => {
  it('calls connect-garmin edge function with credentials', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'pending' }),
    });

    const result = await connectGarmin('user@example.com', 'pass123');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/connect-garmin');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Authorization']).toBe('Bearer test-jwt-token');
    const body = JSON.parse(opts.body);
    expect(body.garmin_email).toBe('user@example.com');
    expect(body.garmin_password).toBe('pass123');
    expect(result.status).toBe('pending');
  });

  it('throws on error response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'bad request' }),
    });

    await expect(connectGarmin('a', 'b')).rejects.toThrow('bad request');
  });
});

describe('getGarminStatus', () => {
  it('returns null when no connection exists', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await getGarminStatus();
    expect(result).toBeNull();
    expect(mockFrom).toHaveBeenCalledWith('garmin_connections');
  });

  it('returns status when connected', async () => {
    const status = { status: 'active', last_sync_at: '2026-03-01T00:00:00Z', error_message: null };
    mockMaybeSingle.mockResolvedValue({ data: status, error: null });

    const result = await getGarminStatus();
    expect(result.status).toBe('active');
  });
});

describe('disconnectGarmin', () => {
  it('calls disconnect-garmin edge function', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'disconnected' }),
    });

    const result = await disconnectGarmin();

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/disconnect-garmin');
    expect(result.status).toBe('disconnected');
  });
});

describe('requestSync', () => {
  it('calls sync-garmin edge function', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'sync_requested' }),
    });

    const result = await requestSync();

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/sync-garmin');
    expect(result.status).toBe('sync_requested');
  });
});

describe('getLatestDailySummary', () => {
  it('queries daily_summaries ordered by date desc', async () => {
    const summary = { date: '2026-03-01', steps: 8500, resting_heart_rate: 62, calories_total: 2100 };
    mockMaybeSingle.mockResolvedValue({ data: summary, error: null });

    const result = await getLatestDailySummary();

    expect(mockFrom).toHaveBeenCalledWith('daily_summaries');
    expect(mockOrder).toHaveBeenCalledWith('date', { ascending: false });
    expect(mockLimit).toHaveBeenCalledWith(1);
    expect(result.steps).toBe(8500);
  });
});

describe('getLatestSleep', () => {
  it('queries sleep_summaries ordered by date desc', async () => {
    const sleep = { date: '2026-03-01', sleep_score: 82, total_sleep_seconds: 28000 };
    mockMaybeSingle.mockResolvedValue({ data: sleep, error: null });

    const result = await getLatestSleep();

    expect(mockFrom).toHaveBeenCalledWith('sleep_summaries');
    expect(result.sleep_score).toBe(82);
  });
});
