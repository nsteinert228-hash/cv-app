const STORAGE_KEY = 'cv-app-session-log';

export class SessionLog {
  constructor(storage = null) {
    this._storage = storage;
    this.entries = [];
    this._load();
  }

  addEntry(exerciseName, repCount) {
    if (repCount <= 0) return;
    this.entries.push({
      exercise: exerciseName,
      reps: repCount,
      timestamp: new Date(),
    });
    this._save();
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

  reset() {
    this.entries = [];
    this._save();
  }

  _save() {
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
