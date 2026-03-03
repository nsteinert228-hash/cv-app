import { describe, it, expect, beforeEach } from 'vitest';
import { SessionLog, STORAGE_KEY } from '../src/sessionLog.js';

// In-memory mock for localStorage
function createMockStorage() {
  const store = {};
  return {
    getItem(key) { return store[key] ?? null; },
    setItem(key, value) { store[key] = String(value); },
    removeItem(key) { delete store[key]; },
    _store: store,
  };
}

describe('SessionLog', () => {
  it('starts empty', () => {
    const log = new SessionLog();
    expect(log.entries).toHaveLength(0);
    expect(log.totalReps).toBe(0);
  });

  it('adds entries with timestamp', async () => {
    const log = new SessionLog();
    await log.addEntry('Squats', 5);
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0].exercise).toBe('Squats');
    expect(log.entries[0].reps).toBe(5);
    expect(log.entries[0].timestamp).toBeInstanceOf(Date);
  });

  it('does not log zero reps', async () => {
    const log = new SessionLog();
    await log.addEntry('Squats', 0);
    expect(log.entries).toHaveLength(0);
  });

  it('does not log negative reps', async () => {
    const log = new SessionLog();
    await log.addEntry('Squats', -1);
    expect(log.entries).toHaveLength(0);
  });

  it('computes summary across multiple entries', async () => {
    const log = new SessionLog();
    await log.addEntry('Squats', 5);
    await log.addEntry('Pushups', 10);
    await log.addEntry('Squats', 3);
    expect(log.getSummary()).toEqual({ Squats: 8, Pushups: 10 });
    expect(log.totalReps).toBe(18);
  });

  it('returns empty summary when no entries', () => {
    const log = new SessionLog();
    expect(log.getSummary()).toEqual({});
  });

  it('reset clears all entries', async () => {
    const log = new SessionLog();
    await log.addEntry('Squats', 5);
    await log.addEntry('Pushups', 3);
    await log.reset();
    expect(log.entries).toHaveLength(0);
    expect(log.totalReps).toBe(0);
  });
});

describe('SessionLog — persistence', () => {
  let storage;

  beforeEach(() => {
    storage = createMockStorage();
  });

  it('persists entries to storage on addEntry', async () => {
    const log = new SessionLog(storage);
    await log.addEntry('Squats', 5);
    const raw = JSON.parse(storage.getItem(STORAGE_KEY));
    expect(raw).toHaveLength(1);
    expect(raw[0].exercise).toBe('Squats');
    expect(raw[0].reps).toBe(5);
    expect(raw[0].timestamp).toBeDefined();
  });

  it('restores entries from storage on construction', async () => {
    const log1 = new SessionLog(storage);
    await log1.addEntry('Squats', 5);
    await log1.addEntry('Pushups', 8);

    const log2 = new SessionLog(storage);
    expect(log2.entries).toHaveLength(2);
    expect(log2.entries[0].exercise).toBe('Squats');
    expect(log2.entries[0].reps).toBe(5);
    expect(log2.entries[0].timestamp).toBeInstanceOf(Date);
    expect(log2.entries[1].exercise).toBe('Pushups');
    expect(log2.totalReps).toBe(13);
  });

  it('clears storage on reset', async () => {
    const log = new SessionLog(storage);
    await log.addEntry('Squats', 5);
    await log.reset();
    const raw = JSON.parse(storage.getItem(STORAGE_KEY));
    expect(raw).toEqual([]);
  });

  it('handles corrupt storage data gracefully', () => {
    storage.setItem(STORAGE_KEY, 'not-valid-json{{{');
    const log = new SessionLog(storage);
    expect(log.entries).toHaveLength(0);
  });

  it('handles non-array storage data gracefully', () => {
    storage.setItem(STORAGE_KEY, JSON.stringify({ not: 'an array' }));
    const log = new SessionLog(storage);
    expect(log.entries).toHaveLength(0);
  });

  it('filters out invalid entries from storage', () => {
    storage.setItem(STORAGE_KEY, JSON.stringify([
      { exercise: 'Squats', reps: 5, timestamp: new Date().toISOString() },
      { exercise: '', reps: 3, timestamp: new Date().toISOString() },
      { exercise: 'Pushups', reps: 0, timestamp: new Date().toISOString() },
      { exercise: 'Lunges', reps: 7, timestamp: new Date().toISOString() },
    ]));
    const log = new SessionLog(storage);
    expect(log.entries).toHaveLength(2);
    expect(log.entries[0].exercise).toBe('Squats');
    expect(log.entries[1].exercise).toBe('Lunges');
  });

  it('works without storage (null)', async () => {
    const log = new SessionLog(null);
    await log.addEntry('Squats', 5);
    expect(log.entries).toHaveLength(1);
    await log.reset();
    expect(log.entries).toHaveLength(0);
  });
});

describe('SessionLog — Supabase sync', () => {
  let storage;

  beforeEach(() => {
    storage = createMockStorage();
  });

  function createMockDb() {
    const inserted = [];
    let deleted = false;
    return {
      insertWorkoutEntry: async (exercise, reps, timestamp) => {
        inserted.push({ exercise, reps, timestamp });
      },
      fetchWorkoutEntries: async () => [
        { exercise: 'Squats', reps: 10, timestamp: new Date('2025-01-01T10:00:00Z') },
      ],
      deleteAllWorkoutEntries: async () => { deleted = true; },
      _inserted: inserted,
      get _deleted() { return deleted; },
    };
  }

  it('syncs addEntry to db when db is set', async () => {
    const mockDb = createMockDb();
    const log = new SessionLog(storage, mockDb);
    await log.addEntry('Squats', 5);
    expect(mockDb._inserted).toHaveLength(1);
    expect(mockDb._inserted[0].exercise).toBe('Squats');
    expect(mockDb._inserted[0].reps).toBe(5);
  });

  it('does not fail when db.insertWorkoutEntry throws', async () => {
    const mockDb = createMockDb();
    mockDb.insertWorkoutEntry = async () => { throw new Error('network error'); };
    const log = new SessionLog(storage, mockDb);
    await log.addEntry('Squats', 5);
    expect(log.entries).toHaveLength(1); // still added locally
  });

  it('reset calls deleteAllWorkoutEntries on db', async () => {
    const mockDb = createMockDb();
    const log = new SessionLog(storage, mockDb);
    await log.addEntry('Squats', 5);
    await log.reset();
    expect(mockDb._deleted).toBe(true);
    expect(log.entries).toHaveLength(0);
  });

  it('syncFromRemote replaces local entries with remote data', async () => {
    const mockDb = createMockDb();
    const log = new SessionLog(storage, mockDb);
    await log.addEntry('Pushups', 3);
    await log.syncFromRemote();
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0].exercise).toBe('Squats');
    expect(log.entries[0].reps).toBe(10);
  });

  it('pushLocalToRemote sends all local entries to db', async () => {
    const mockDb = createMockDb();
    const log = new SessionLog(storage);
    await log.addEntry('Squats', 5);
    await log.addEntry('Pushups', 3);
    log.setDb(mockDb);
    await log.pushLocalToRemote();
    expect(mockDb._inserted).toHaveLength(2);
  });

  it('setDb updates the db reference', () => {
    const log = new SessionLog(storage);
    expect(log._db).toBeNull();
    const mockDb = createMockDb();
    log.setDb(mockDb);
    expect(log._db).toBe(mockDb);
  });

  it('syncFromRemote is no-op when db is null', async () => {
    const log = new SessionLog(storage);
    await log.addEntry('Squats', 5);
    await log.syncFromRemote();
    expect(log.entries).toHaveLength(1); // unchanged
  });
});
