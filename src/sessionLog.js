const STORAGE_KEY = 'utrain-session-log';

export class SessionLog {
  constructor(storage = null, db = null) {
    this._storage = storage;
    this._db = db; // { fetchWorkoutEntries, insertWorkoutEntry, deleteAllWorkoutEntries }
    this.entries = [];
    this._load();
  }

  async addEntry(exerciseName, repCount) {
    if (repCount <= 0) return;
    const entry = {
      exercise: exerciseName,
      reps: repCount,
      timestamp: new Date(),
    };
    this.entries.push(entry);
    this._saveLocal();

    // Sync to Supabase in background
    if (this._db) {
      try {
        await this._db.insertWorkoutEntry(entry.exercise, entry.reps, entry.timestamp);
      } catch (err) {
        console.warn('Failed to sync entry to Supabase:', err.message);
      }
    }
  }

  getSummary() {
    const summary = {};
    for (const entry of this.entries) {
      summary[entry.exercise] = (summary[entry.exercise] || 0) + entry.reps;
    }
    return summary;
  }

  get totalReps() {
    return this.entries.reduce((sum, e) => sum + e.reps, 0);
  }

  async reset() {
    this.entries = [];
    this._saveLocal();

    if (this._db) {
      try {
        await this._db.deleteAllWorkoutEntries();
      } catch (err) {
        console.warn('Failed to clear Supabase entries:', err.message);
      }
    }
  }

  // Load entries from Supabase (source of truth when authenticated)
  async syncFromRemote() {
    if (!this._db) return;
    try {
      const remoteEntries = await this._db.fetchWorkoutEntries();
      this.entries = remoteEntries;
      this._saveLocal(); // update local cache
    } catch (err) {
      console.warn('Failed to fetch from Supabase, using local data:', err.message);
    }
  }

  // Push any local-only entries to Supabase (e.g. after login)
  async pushLocalToRemote() {
    if (!this._db || this.entries.length === 0) return;
    try {
      for (const entry of this.entries) {
        await this._db.insertWorkoutEntry(entry.exercise, entry.reps, entry.timestamp);
      }
      // Clear localStorage after successful push — Supabase is now source of truth
      this._saveLocal();
    } catch (err) {
      console.warn('Failed to push local entries to Supabase:', err.message);
    }
  }

  setDb(db) {
    this._db = db;
  }

  _saveLocal() {
    const storage = this._storage ?? _getLocalStorage();
    if (!storage) return;
    try {
      const data = this.entries.map(e => ({
        exercise: e.exercise,
        reps: e.reps,
        timestamp: e.timestamp.toISOString(),
      }));
      storage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch { /* quota exceeded or unavailable — silently ignore */ }
  }

  _load() {
    const storage = this._storage ?? _getLocalStorage();
    if (!storage) return;
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return;
      this.entries = data
        .filter(e => e.exercise && typeof e.reps === 'number' && e.reps > 0 && e.timestamp)
        .map(e => ({
          exercise: e.exercise,
          reps: e.reps,
          timestamp: new Date(e.timestamp),
        }));
    } catch { /* corrupt data — start fresh */ }
  }
}

function _getLocalStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export { STORAGE_KEY };
