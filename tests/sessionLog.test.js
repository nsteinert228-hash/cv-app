import { describe, it, expect } from 'vitest';
import { SessionLog } from '../src/sessionLog.js';

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
