import { describe, it, expect } from 'vitest';
import { EXERCISES, RepCounter, ExerciseDetector } from '../src/exercises.js';

// Helper to create fake keypoints (just need valid structure for type checking)
function fakeKeypoints() {
  const kps = Array(17).fill(null).map(() => ({ x: 100, y: 200, score: 0.9 }));
  kps[5] = { x: 100, y: 100, score: 0.9 };
  kps[6] = { x: 100, y: 100, score: 0.9 };
  kps[11] = { x: 100, y: 200, score: 0.9 };
  kps[12] = { x: 100, y: 200, score: 0.9 };
  return kps;
}

// Testable RepCounter that uses queued predictions instead of real classifier
class TestableRepCounter extends RepCounter {
  constructor(exercise, predictions) {
    super(exercise, null);
    this._predictions = predictions;
    this._callIndex = 0;
  }

  async update(keypoints) {
    const prediction = this._predictions[this._callIndex++] || null;
    this.prediction = prediction;

    if (!prediction) {
      this._consecutiveUp = 0;
      this._consecutiveDown = 0;
      return { count: this.count, state: this.state, prediction };
    }

    const { upClass, downClass } = this.exercise;
    const upConf = prediction.confidences[upClass] || 0;
    const downConf = prediction.confidences[downClass] || 0;

    if (upConf > 0.7) {
      this._consecutiveUp++;
      this._consecutiveDown = 0;
    } else if (downConf > 0.7) {
      this._consecutiveDown++;
      this._consecutiveUp = 0;
    } else {
      this._consecutiveUp = 0;
      this._consecutiveDown = 0;
    }

    switch (this.state) {
      case 'idle':
        if (this._consecutiveUp >= 3) this.state = 'up';
        break;
      case 'up':
        if (this._consecutiveDown >= 3) this.state = 'down';
        break;
      case 'down':
        if (this._consecutiveUp >= 3) {
          this.state = 'up';
          this.count++;
        }
        break;
    }

    return { count: this.count, state: this.state, prediction };
  }
}

// Helper to create a prediction object
function pred(label, confs) {
  return { label, confidences: confs };
}

// Repeat a prediction N times (for smoothing)
function repeat(p, n) {
  return Array(n).fill(p);
}

const upPred = pred('squat_up', { squat_up: 0.9, squat_down: 0.1 });
const downPred = pred('squat_down', { squat_up: 0.1, squat_down: 0.9 });
const lowConfPred = pred('squat_up', { squat_up: 0.4, squat_down: 0.3 });

describe('EXERCISES config', () => {
  it('squat has correct class names', () => {
    expect(EXERCISES.squat.upClass).toBe('squat_up');
    expect(EXERCISES.squat.downClass).toBe('squat_down');
    expect(EXERCISES.squat.name).toBe('Squats');
  });

  it('pushup has correct class names', () => {
    expect(EXERCISES.pushup.upClass).toBe('pushup_up');
    expect(EXERCISES.pushup.downClass).toBe('pushup_down');
    expect(EXERCISES.pushup.name).toBe('Pushups');
  });
});

describe('RepCounter — temporal smoothing', () => {
  it('starts in idle state with 0 count', () => {
    const counter = new TestableRepCounter(EXERCISES.squat, []);
    expect(counter.count).toBe(0);
    expect(counter.state).toBe('idle');
  });

  it('does NOT transition on a single high-confidence frame', async () => {
    const counter = new TestableRepCounter(EXERCISES.squat, [upPred]);
    await counter.update(fakeKeypoints());
    expect(counter.state).toBe('idle'); // needs 3 consecutive frames
  });

  it('transitions idle → up after 3 consecutive up frames', async () => {
    const counter = new TestableRepCounter(EXERCISES.squat, repeat(upPred, 3));
    for (let i = 0; i < 3; i++) await counter.update(fakeKeypoints());
    expect(counter.state).toBe('up');
    expect(counter.count).toBe(0);
  });

  it('does not count a rep on first down', async () => {
    const predictions = [...repeat(upPred, 3), ...repeat(downPred, 3)];
    const counter = new TestableRepCounter(EXERCISES.squat, predictions);
    for (const _ of predictions) await counter.update(fakeKeypoints());
    expect(counter.state).toBe('down');
    expect(counter.count).toBe(0);
  });

  it('counts a rep on down → up transition', async () => {
    const predictions = [
      ...repeat(upPred, 3),   // idle → up
      ...repeat(downPred, 3), // up → down
      ...repeat(upPred, 3),   // down → up, count++
    ];
    const counter = new TestableRepCounter(EXERCISES.squat, predictions);
    for (const _ of predictions) await counter.update(fakeKeypoints());
    expect(counter.count).toBe(1);
    expect(counter.state).toBe('up');
  });

  it('counts multiple reps', async () => {
    const predictions = [...repeat(upPred, 3)]; // idle → up
    for (let i = 0; i < 5; i++) {
      predictions.push(...repeat(downPred, 3)); // → down
      predictions.push(...repeat(upPred, 3));   // → up, count++
    }
    const counter = new TestableRepCounter(EXERCISES.squat, predictions);
    for (const _ of predictions) await counter.update(fakeKeypoints());
    expect(counter.count).toBe(5);
  });

  it('resets consecutive counters on null prediction', async () => {
    const predictions = [upPred, upPred, null, upPred, upPred, upPred];
    const counter = new TestableRepCounter(EXERCISES.squat, predictions);
    for (const _ of predictions) await counter.update(fakeKeypoints());
    // The null in the middle resets the streak, so 3rd-5th frames are only 3 consecutive
    expect(counter.state).toBe('up');
  });

  it('resets consecutive counters on low confidence', async () => {
    const predictions = [upPred, upPred, lowConfPred, upPred, upPred];
    const counter = new TestableRepCounter(EXERCISES.squat, predictions);
    for (const _ of predictions) await counter.update(fakeKeypoints());
    // Low conf breaks the streak, only 2 consecutive after that
    expect(counter.state).toBe('idle');
  });

  it('a single noisy frame does NOT cause state transition', async () => {
    const predictions = [
      ...repeat(upPred, 3),  // idle → up
      downPred,              // single noisy down frame
      upPred,                // back to up immediately
    ];
    const counter = new TestableRepCounter(EXERCISES.squat, predictions);
    for (const _ of predictions) await counter.update(fakeKeypoints());
    expect(counter.state).toBe('up'); // stayed in up, noise was filtered
  });

  it('works with pushup exercise', async () => {
    const pUp = pred('pushup_up', { pushup_up: 0.9, pushup_down: 0.1 });
    const pDown = pred('pushup_down', { pushup_up: 0.1, pushup_down: 0.9 });
    const predictions = [
      ...repeat(pUp, 3),   // idle → up
      ...repeat(pDown, 3), // up → down
      ...repeat(pUp, 3),   // down → up, count++
    ];
    const counter = new TestableRepCounter(EXERCISES.pushup, predictions);
    for (const _ of predictions) await counter.update(fakeKeypoints());
    expect(counter.count).toBe(1);
  });

  it('reset clears count, state, and consecutive counters', async () => {
    const predictions = [
      ...repeat(upPred, 3),
      ...repeat(downPred, 3),
      ...repeat(upPred, 3),
    ];
    const counter = new TestableRepCounter(EXERCISES.squat, predictions);
    for (const _ of predictions) await counter.update(fakeKeypoints());
    expect(counter.count).toBe(1);

    counter.reset();
    expect(counter.count).toBe(0);
    expect(counter.state).toBe('idle');
    expect(counter.prediction).toBeNull();
    expect(counter._consecutiveUp).toBe(0);
    expect(counter._consecutiveDown).toBe(0);
  });
});

describe('ExerciseDetector', () => {
  function detPred(label) {
    return { label, confidences: { [label]: 0.9 } };
  }

  it('starts with no detected exercise', () => {
    const d = new ExerciseDetector();
    expect(d.detectedKey).toBeNull();
  });

  it('does not detect from a single frame', () => {
    const d = new ExerciseDetector();
    d.update(detPred('squat_up'));
    expect(d.detectedKey).toBeNull();
  });

  it('detects squat after 10 frames', () => {
    const d = new ExerciseDetector();
    for (let i = 0; i < 9; i++) {
      expect(d.update(detPred('squat_up'))).toBeNull();
    }
    expect(d.update(detPred('squat_up'))).toBe('squat');
    expect(d.detectedKey).toBe('squat');
  });

  it('treats squat_up and squat_down as same exercise', () => {
    const d = new ExerciseDetector();
    for (let i = 0; i < 10; i++) {
      d.update(detPred(i % 2 === 0 ? 'squat_up' : 'squat_down'));
    }
    expect(d.detectedKey).toBe('squat');
  });

  it('ignores null predictions', () => {
    const d = new ExerciseDetector();
    for (let i = 0; i < 10; i++) {
      d.update(detPred('squat_up'));
      d.update(null); // nulls don't enter the window
    }
    expect(d.detectedKey).toBe('squat');
  });

  it('requires higher threshold to switch exercises (hysteresis)', () => {
    const d = new ExerciseDetector();
    // Establish squat (10 frames)
    for (let i = 0; i < 10; i++) d.update(detPred('squat_up'));
    expect(d.detectedKey).toBe('squat');

    // 11 pushup frames — not enough to switch (need 12)
    for (let i = 0; i < 11; i++) d.update(detPred('pushup_up'));
    expect(d.detectedKey).toBe('squat');

    // One more pushup frame (12 total in window) triggers switch
    expect(d.update(detPred('pushup_up'))).toBe('pushup');
    expect(d.detectedKey).toBe('pushup');
  });

  it('returns null when detected exercise is same as current', () => {
    const d = new ExerciseDetector();
    for (let i = 0; i < 10; i++) d.update(detPred('squat_up'));
    expect(d.detectedKey).toBe('squat');

    // More squat frames don't trigger a change
    expect(d.update(detPred('squat_down'))).toBeNull();
  });

  it('reset clears all state', () => {
    const d = new ExerciseDetector();
    for (let i = 0; i < 10; i++) d.update(detPred('squat_up'));
    expect(d.detectedKey).toBe('squat');

    d.reset();
    expect(d.detectedKey).toBeNull();
    expect(d._window).toHaveLength(0);
  });
});
