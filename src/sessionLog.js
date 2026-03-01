export class SessionLog {
  constructor() {
    this.entries = [];
  }

  addEntry(exerciseName, repCount) {
    if (repCount <= 0) return;
    this.entries.push({
      exercise: exerciseName,
      reps: repCount,
      timestamp: new Date(),
    });
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
  }
}
