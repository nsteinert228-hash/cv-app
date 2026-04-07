// Murph attempt state machine & timer
// Phases: setup → mile1 → exercises → mile2 → summary
import * as data from './murphData.js';

export const PHASES = {
  SETUP: 'setup',
  MILE1: 'mile1',
  EXERCISES: 'exercises',
  MILE2: 'mile2',
  SUMMARY: 'summary',
};

export const MURPH_TARGETS = {
  pullups: 100,
  pushups: 200,
  squats: 300,
};

export class MurphAttempt {
  constructor() {
    this.phase = PHASES.SETUP;
    this.attemptId = null;
    this.startedAt = null;
    this.finishedAt = null;

    // Phase timestamps
    this.mile1CompletedAt = null;
    this.exercisesCompletedAt = null;
    this.mile2StartedAt = null;

    // Rep counts (accumulated from CV tracker)
    this.reps = { pullups: 0, pushups: 0, squats: 0 };

    // CV session segments
    this._segments = { pullups: [], pushups: [], squats: [] };
    this._currentSegment = null;

    // Listeners
    this._listeners = new Set();

    // Timer
    this._timerInterval = null;

    // Persistence key for recovery
    this._storageKey = 'utrain-murph-active';
  }

  // ── Event system ──

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    const state = this.getState();
    for (const fn of this._listeners) fn(state);
  }

  getState() {
    return {
      phase: this.phase,
      attemptId: this.attemptId,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      elapsed: this.getElapsed(),
      reps: { ...this.reps },
      mile1CompletedAt: this.mile1CompletedAt,
      exercisesCompletedAt: this.exercisesCompletedAt,
      mile2StartedAt: this.mile2StartedAt,
    };
  }

  getElapsed() {
    if (!this.startedAt) return 0;
    const end = this.finishedAt ? new Date(this.finishedAt).getTime() : Date.now();
    return Math.floor((end - new Date(this.startedAt).getTime()) / 1000);
  }

  // ── Phase transitions ──

  async start() {
    const now = new Date().toISOString();
    this.startedAt = now;
    this.phase = PHASES.MILE1;

    try {
      const attempt = await data.createAttempt(now);
      this.attemptId = attempt.id;
    } catch (err) {
      console.error('Failed to create Murph attempt in DB:', err);
      // Continue anyway — we'll persist later
      this.attemptId = 'local-' + Date.now();
    }

    this._persist();
    this._startTimer();
    this._emit();
  }

  async completeMile1() {
    if (this.phase !== PHASES.MILE1) return;
    this.mile1CompletedAt = new Date().toISOString();
    this.phase = PHASES.EXERCISES;
    this._persist();
    this._emit();

    this._saveToDb({ mile1_completed_at: this.mile1CompletedAt });
  }

  async completeExercises() {
    if (this.phase !== PHASES.EXERCISES) return;
    this._endCurrentSegment();
    this.exercisesCompletedAt = new Date().toISOString();
    this.phase = PHASES.MILE2;
    this.mile2StartedAt = new Date().toISOString();
    this._persist();
    this._emit();

    this._saveToDb({
      exercises_completed_at: this.exercisesCompletedAt,
      mile2_started_at: this.mile2StartedAt,
      pullups_completed: this.reps.pullups,
      pushups_completed: this.reps.pushups,
      squats_completed: this.reps.squats,
      cv_session_data: this._buildSessionData(),
    });
  }

  async finish() {
    if (this.phase !== PHASES.MILE2) return;
    this.finishedAt = new Date().toISOString();
    const totalSeconds = (new Date(this.finishedAt) - new Date(this.startedAt)) / 1000;
    this.phase = PHASES.SUMMARY;
    this._stopTimer();
    this._clearPersisted();
    this._emit();

    await this._saveToDb({
      finished_at: this.finishedAt,
      total_time_seconds: totalSeconds,
      status: 'completed',
      pullups_completed: this.reps.pullups,
      pushups_completed: this.reps.pushups,
      squats_completed: this.reps.squats,
      cv_session_data: this._buildSessionData(),
    });

    // Attempt mile matching (may fail if Garmin hasn't synced yet)
    try {
      await data.matchMiles(this.attemptId);
    } catch (err) {
      console.warn('Mile matching deferred — Garmin data may not be synced yet:', err);
    }
  }

  abandon() {
    this._stopTimer();
    this._endCurrentSegment();
    this._clearPersisted();
    this.phase = PHASES.SETUP;

    if (this.attemptId && !this.attemptId.startsWith('local-')) {
      data.abandonAttempt(this.attemptId).catch(() => {});
    }

    this._emit();
  }

  // ── Rep tracking (called from CV tracker integration) ──

  addRep(exercise) {
    const key = exercise === 'Pull-ups' ? 'pullups'
      : exercise === 'Pushups' ? 'pushups'
      : exercise === 'Squats' ? 'squats'
      : null;
    if (!key) return;

    this.reps[key]++;
    this._emit();

    // Track segments
    if (!this._currentSegment || this._currentSegment.exercise !== key) {
      this._endCurrentSegment();
      this._currentSegment = {
        exercise: key,
        count: 0,
        started_at: new Date().toISOString(),
      };
    }
    this._currentSegment.count++;

    return this.reps[key];
  }

  isTargetMet(exercise) {
    return this.reps[exercise] >= MURPH_TARGETS[exercise];
  }

  allTargetsMet() {
    return Object.keys(MURPH_TARGETS).every(k => this.isTargetMet(k));
  }

  // ── Timer ──

  _startTimer() {
    this._stopTimer();
    this._timerInterval = setInterval(() => this._emit(), 1000);
  }

  _stopTimer() {
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
  }

  // ── Segments ──

  _endCurrentSegment() {
    if (this._currentSegment && this._currentSegment.count > 0) {
      this._currentSegment.ended_at = new Date().toISOString();
      this._segments[this._currentSegment.exercise].push({
        count: this._currentSegment.count,
        started_at: this._currentSegment.started_at,
        ended_at: this._currentSegment.ended_at,
      });
      this._currentSegment = null;
    }
  }

  _buildSessionData() {
    this._endCurrentSegment();
    return {
      session_start: this.mile1CompletedAt,
      session_end: this.exercisesCompletedAt || new Date().toISOString(),
      exercises: {
        pullups: { total: this.reps.pullups, segments: this._segments.pullups },
        pushups: { total: this.reps.pushups, segments: this._segments.pushups },
        squats: { total: this.reps.squats, segments: this._segments.squats },
      },
      auto_mode: true,
    };
  }

  // ── Persistence (crash recovery) ──

  _persist() {
    try {
      localStorage.setItem(this._storageKey, JSON.stringify({
        phase: this.phase,
        attemptId: this.attemptId,
        startedAt: this.startedAt,
        mile1CompletedAt: this.mile1CompletedAt,
        exercisesCompletedAt: this.exercisesCompletedAt,
        mile2StartedAt: this.mile2StartedAt,
        reps: this.reps,
        segments: this._segments,
      }));
    } catch {}
  }

  _clearPersisted() {
    try { localStorage.removeItem(this._storageKey); } catch {}
  }

  restore() {
    try {
      const raw = localStorage.getItem(this._storageKey);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      this.phase = saved.phase;
      this.attemptId = saved.attemptId;
      this.startedAt = saved.startedAt;
      this.mile1CompletedAt = saved.mile1CompletedAt;
      this.exercisesCompletedAt = saved.exercisesCompletedAt;
      this.mile2StartedAt = saved.mile2StartedAt;
      this.reps = saved.reps || { pullups: 0, pushups: 0, squats: 0 };
      this._segments = saved.segments || { pullups: [], pushups: [], squats: [] };
      if (this.phase !== PHASES.SUMMARY && this.phase !== PHASES.SETUP) {
        this._startTimer();
      }
      this._emit();
      return true;
    } catch {
      return false;
    }
  }

  // ── DB save helper ──

  async _saveToDb(updates) {
    if (!this.attemptId || this.attemptId.startsWith('local-')) return;
    try {
      await data.updateAttempt(this.attemptId, updates);
    } catch (err) {
      console.error('Failed to save Murph attempt:', err);
    }
  }

  // ── Submit to leaderboard ──

  async submitToLeaderboard() {
    if (!this.attemptId || this.attemptId.startsWith('local-')) {
      throw new Error('Cannot submit local attempt to leaderboard');
    }
    return data.updateAttempt(this.attemptId, { submitted_to_leaderboard: true });
  }

  // ── Retry mile matching ──

  async retryMileMatch() {
    if (!this.attemptId || this.attemptId.startsWith('local-')) return null;
    try {
      await data.triggerGarminSync();
    } catch {}
    return data.matchMiles(this.attemptId);
  }
}

// Singleton
let _instance = null;
export function getMurphAttempt() {
  if (!_instance) _instance = new MurphAttempt();
  return _instance;
}
