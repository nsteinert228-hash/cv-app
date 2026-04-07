// Exercise configurations — classifier-based approach
// Each exercise maps to KNN pose classes for its up/down phases

import { classifyPose } from './classifier.js';
import {
  MIN_CONFIDENCE, SMOOTHING_FRAMES,
  DETECT_WINDOW, DETECT_THRESHOLD, SWITCH_THRESHOLD,
} from './config.js';

export const EXERCISES = {
  squat: {
    name: 'Squats',
    upClass: 'standing_up',
    downClass: 'squat_down',
  },
  pushup: {
    name: 'Pushups',
    upClass: 'pushup_up',
    downClass: 'pushup_down',
  },
  lunge: {
    name: 'Lunges',
    upClass: 'standing_up',
    downClass: 'lunge_down',
  },
  pullup: {
    name: 'Pull-ups',
    upClass: 'pullup_up',
    downClass: 'pullup_down',
  },
};

// States
const IDLE = 'idle';
const UP = 'up';
const DOWN = 'down';

export class RepCounter {
  constructor(exercise, classifier) {
    this.exercise = exercise;
    this.classifier = classifier;
    this.state = IDLE;
    this.count = 0;
    this.prediction = null;
    this._consecutiveUp = 0;
    this._consecutiveDown = 0;
  }

  async update(keypoints, precomputedPrediction = null) {
    const prediction = precomputedPrediction || await classifyPose(this.classifier, keypoints);
    this.prediction = prediction;

    // Skip frame if classification failed (low keypoint confidence or degenerate pose)
    if (!prediction) {
      this._consecutiveUp = 0;
      this._consecutiveDown = 0;
      return { count: this.count, state: this.state, prediction };
    }

    const { upClass, downClass } = this.exercise;
    const upConf = prediction.confidences[upClass] || 0;
    const downConf = prediction.confidences[downClass] || 0;

    // Track consecutive high-confidence frames for each class
    if (upConf > MIN_CONFIDENCE) {
      this._consecutiveUp++;
      this._consecutiveDown = 0;
    } else if (downConf > MIN_CONFIDENCE) {
      this._consecutiveDown++;
      this._consecutiveUp = 0;
    } else {
      // Neither class is confident enough — reset streaks
      this._consecutiveUp = 0;
      this._consecutiveDown = 0;
    }

    // Only transition state after enough consecutive frames agree
    switch (this.state) {
      case IDLE:
        if (this._consecutiveUp >= SMOOTHING_FRAMES) {
          this.state = UP;
        }
        break;

      case UP:
        if (this._consecutiveDown >= SMOOTHING_FRAMES) {
          this.state = DOWN;
        }
        break;

      case DOWN:
        if (this._consecutiveUp >= SMOOTHING_FRAMES) {
          this.state = UP;
          this.count++;
        }
        break;
    }

    return { count: this.count, state: this.state, prediction };
  }

  reset() {
    this.state = IDLE;
    this.count = 0;
    this.prediction = null;
    this._consecutiveUp = 0;
    this._consecutiveDown = 0;
  }
}

// Build reverse mapping from classifier labels → exercise keys.
// Labels shared across exercises (e.g. standing_up) map to null (ambiguous).
function buildLabelMap() {
  const map = {};
  for (const [key, ex] of Object.entries(EXERCISES)) {
    for (const label of [ex.upClass, ex.downClass]) {
      if (!(label in map)) {
        map[label] = key;
      } else if (map[label] !== key) {
        map[label] = null; // shared across exercises — ambiguous
      }
    }
  }
  return map;
}

const LABEL_MAP = buildLabelMap();

export class ExerciseDetector {
  constructor() {
    this._window = [];
    this.detectedKey = null;
  }

  update(prediction) {
    if (!prediction) return null;

    const exerciseKey = LABEL_MAP[prediction.label];
    // Skip labels that don't map to a specific exercise (shared up classes)
    if (!exerciseKey) return null;

    this._window.push(exerciseKey);
    if (this._window.length > DETECT_WINDOW) {
      this._window.shift();
    }

    const counts = {};
    for (const k of this._window) {
      counts[k] = (counts[k] || 0) + 1;
    }

    let bestKey = null;
    let bestCount = 0;
    for (const [k, c] of Object.entries(counts)) {
      if (c > bestCount) { bestKey = k; bestCount = c; }
    }

    const threshold = (this.detectedKey && this.detectedKey !== bestKey)
      ? SWITCH_THRESHOLD
      : DETECT_THRESHOLD;

    if (bestCount >= threshold && EXERCISES[bestKey]) {
      if (this.detectedKey !== bestKey) {
        this.detectedKey = bestKey;
        return bestKey;
      }
    }

    return null;
  }

  reset() {
    this._window = [];
    this.detectedKey = null;
  }
}
