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
    upClass: 'squat_up',
    downClass: 'squat_down',
  },
  pushup: {
    name: 'Pushups',
    upClass: 'pushup_up',
    downClass: 'pushup_down',
  },
  lunge: {
    name: 'Lunges',
    upClass: 'lunge_up',
    downClass: 'lunge_down',
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

export class ExerciseDetector {
  constructor() {
    this._window = [];
    this.detectedKey = null;
  }

  update(prediction) {
    if (!prediction) return null;

    const prefix = prediction.label.split('_')[0];
    this._window.push(prefix);
    if (this._window.length > DETECT_WINDOW) {
      this._window.shift();
    }

    const counts = {};
    for (const p of this._window) {
      counts[p] = (counts[p] || 0) + 1;
    }

    let bestPrefix = null;
    let bestCount = 0;
    for (const [p, c] of Object.entries(counts)) {
      if (c > bestCount) { bestPrefix = p; bestCount = c; }
    }

    const threshold = (this.detectedKey && this.detectedKey !== bestPrefix)
      ? SWITCH_THRESHOLD
      : DETECT_THRESHOLD;

    if (bestCount >= threshold && EXERCISES[bestPrefix]) {
      if (this.detectedKey !== bestPrefix) {
        this.detectedKey = bestPrefix;
        return bestPrefix;
      }
    }

    return null;
  }

  reset() {
    this._window = [];
    this.detectedKey = null;
  }
}
