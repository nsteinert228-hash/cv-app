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

  it('adds entries with timestamp', () => {
    const log = new SessionLog();
    log.addEntry('Squats', 5);
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0].exercise).toBe('Squats');
    expect(log.entries[0].reps).toBe(5);
    expect(log.entries[0].timestamp).toBeInstanceOf(Date);
  });

  it('does not log zero reps', () => {
    const log = new SessionLog();
    log.addEntry('Squats', 0);
    expect(log.entries).toHaveLength(0);
  });

  it('does not log negative reps', () => {
    const log = new SessionLog();
    log.addEntry('Squats', -1);
    expect(log.entries).toHaveLength(0);
  });

  it('computes summary across multiple entries', () => {
    const log = new SessionLog();
    log.addEntry('Squats', 5);
    log.addEntry('Pushups', 10);
    log.addEntry('Squats', 3);
    expect(log.getSummary()).toEqual({ Squats: 8, Pushups: 10 });
    expect(log.totalReps).toBe(18);
  });

  it('returns empty summary when no entries', () => {
    const log = new SessionLog();
    expect(log.getSummary()).toEqual({});
  });

  it('reset clears all entries', () => {
    const log = new SessionLog();
    log.addEntry('Squats', 5);
    log.addEntry('Pushups', 3);
    log.reset();
    expect(log.entries).toHaveLength(0);
    expect(log.totalReps).toBe(0);
  });
});

describe('SessionLog — persistence', () => {
  let storage;

  beforeEach(() => {
    storage = createMockStorage();
  });

  it('persists entries to storage on addEntry', () => {
    const log = new SessionLog(storage);
    log.addEntry('Squats', 5);
    const raw = JSON.parse(storage.getItem(STORAGE_KEY));
    expect(raw).toHaveLength(1);
    expect(raw[0].exercise).toBe('Squats');
    expect(raw[0].reps).toBe(5);
    expect(raw[0].timestamp).toBeDefined();
  });

  it('restores entries from storage on construction', () => {
    const log1 = new SessionLog(storage);
    log1.addEntry('Squats', 5);
    log1.addEntry('Pushups', 8);

    const log2 = new SessionLog(storage);
    expect(log2.entries).toHaveLength(2);
    expect(log2.entries[0].exercise).toBe('Squats');
    expect(log2.entries[0].reps).toBe(5);
    expect(log2.entries[0].timestamp).toBeInstanceOf(Date);
    expect(log2.entries[1].exercise).toBe('Pushups');
    expect(log2.totalReps).toBe(13);
  });

  it('clears storage on reset', () => {
    const log = new SessionLog(storage);
    log.addEntry('Squats', 5);
    log.reset();
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

  it('works without storage (null)', () => {
    const log = new SessionLog(null);
    log.addEntry('Squats', 5);
    expect(log.entries).toHaveLength(1);
    log.reset();
    expect(log.entries).toHaveLength(0);
  });
});
