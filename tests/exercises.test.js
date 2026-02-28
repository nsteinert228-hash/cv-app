import { describe, it, expect } from 'vitest';
import {
  EXERCISES, angleBetween, pickBestSide, getExerciseAngle, RepCounter,
} from '../src/exercises.js';

// Helper: create a point
const pt = (x, y, score = 0.9) => ({ x, y, score });

describe('angleBetween', () => {
  it('returns 90 for a right angle', () => {
    const a = pt(0, 1);
    const b = pt(0, 0);
    const c = pt(1, 0);
    expect(angleBetween(a, b, c)).toBeCloseTo(90, 1);
  });

  it('returns 180 for a straight line', () => {
    const a = pt(-1, 0);
    const b = pt(0, 0);
    const c = pt(1, 0);
    expect(angleBetween(a, b, c)).toBeCloseTo(180, 1);
  });

  it('returns 0 for coincident points A and C on same side', () => {
    const a = pt(1, 0);
    const b = pt(0, 0);
    const c = pt(1, 0);
    expect(angleBetween(a, b, c)).toBeCloseTo(0, 1);
  });

  it('returns ~45 for a 45-degree angle', () => {
    const a = pt(0, 1);
    const b = pt(0, 0);
    const c = pt(1, 1);
    expect(angleBetween(a, b, c)).toBeCloseTo(45, 1);
  });

  it('returns 0 when points overlap (zero-length vectors)', () => {
    const a = pt(0, 0);
    const b = pt(0, 0);
    const c = pt(1, 0);
    expect(angleBetween(a, b, c)).toBe(0);
  });
});

describe('pickBestSide', () => {
  it('picks left when left side has higher confidence', () => {
    const keypoints = Array(17).fill(null).map(() => pt(0, 0, 0.5));
    // Boost left squat joints (11, 13, 15)
    keypoints[11] = pt(0, 0, 0.9);
    keypoints[13] = pt(0, 0, 0.9);
    keypoints[15] = pt(0, 0, 0.9);
    expect(pickBestSide(keypoints, EXERCISES.squat)).toBe('left');
  });

  it('picks right when right side has higher confidence', () => {
    const keypoints = Array(17).fill(null).map(() => pt(0, 0, 0.5));
    // Boost right squat joints (12, 14, 16)
    keypoints[12] = pt(0, 0, 0.95);
    keypoints[14] = pt(0, 0, 0.95);
    keypoints[16] = pt(0, 0, 0.95);
    expect(pickBestSide(keypoints, EXERCISES.squat)).toBe('right');
  });

  it('picks left when equal (left >= right)', () => {
    const keypoints = Array(17).fill(null).map(() => pt(0, 0, 0.8));
    expect(pickBestSide(keypoints, EXERCISES.squat)).toBe('left');
  });
});

describe('RepCounter', () => {
  // Helper: create keypoints where the squat knee angle is a specific value
  // Angle is at knee (B), formed by hip (A) → knee (B) → ankle (C)
  function squatKeypoints(kneeAngleDeg, score = 0.9) {
    const keypoints = Array(17).fill(null).map(() => pt(0, 0, score));

    const rad = kneeAngleDeg * (Math.PI / 180);

    // Hip above knee, ankle positioned to produce desired angle at knee
    // BA = (0, -100) points upward; BC direction rotated by angle from BA
    keypoints[11] = pt(100, 0, score);                            // hip (A)
    keypoints[13] = pt(100, 100, score);                          // knee (B)
    keypoints[15] = pt(
      100 + 100 * Math.sin(rad),
      100 - 100 * Math.cos(rad),
      score,
    );                                                            // ankle (C)

    return keypoints;
  }

  it('starts in idle state with 0 count', () => {
    const counter = new RepCounter(EXERCISES.squat);
    expect(counter.count).toBe(0);
    expect(counter.state).toBe('idle');
  });

  it('transitions from idle to up when angle is high', () => {
    const counter = new RepCounter(EXERCISES.squat);
    counter.update(squatKeypoints(170));
    expect(counter.state).toBe('up');
    expect(counter.count).toBe(0);
  });

  it('does not count a rep on first down', () => {
    const counter = new RepCounter(EXERCISES.squat);
    counter.update(squatKeypoints(170)); // → up
    counter.update(squatKeypoints(80));  // → down
    expect(counter.state).toBe('down');
    expect(counter.count).toBe(0);
  });

  it('counts a rep on down → up transition', () => {
    const counter = new RepCounter(EXERCISES.squat);
    counter.update(squatKeypoints(170)); // idle → up
    counter.update(squatKeypoints(80));  // up → down
    counter.update(squatKeypoints(170)); // down → up, count++
    expect(counter.count).toBe(1);
    expect(counter.state).toBe('up');
  });

  it('counts multiple reps', () => {
    const counter = new RepCounter(EXERCISES.squat);
    counter.update(squatKeypoints(170)); // idle → up

    for (let i = 0; i < 5; i++) {
      counter.update(squatKeypoints(80));  // → down
      counter.update(squatKeypoints(170)); // → up, count++
    }

    expect(counter.count).toBe(5);
  });

  it('skips low-confidence frames without changing state', () => {
    const counter = new RepCounter(EXERCISES.squat);
    counter.update(squatKeypoints(170));       // idle → up
    counter.update(squatKeypoints(80, 0.1));   // low confidence, skip
    expect(counter.state).toBe('up');          // state unchanged
    expect(counter.count).toBe(0);
  });

  it('does not transition on angles in the dead zone (hysteresis)', () => {
    const counter = new RepCounter(EXERCISES.squat);
    counter.update(squatKeypoints(170));  // idle → up

    // Angle at exactly downThreshold (100) — should NOT trigger due to hysteresis (needs < 95)
    counter.update(squatKeypoints(98));
    expect(counter.state).toBe('up');

    // Below hysteresis threshold (< 95)
    counter.update(squatKeypoints(90));
    expect(counter.state).toBe('down');
  });

  it('reset clears count and returns to idle', () => {
    const counter = new RepCounter(EXERCISES.squat);
    counter.update(squatKeypoints(170));
    counter.update(squatKeypoints(80));
    counter.update(squatKeypoints(170));
    expect(counter.count).toBe(1);

    counter.reset();
    expect(counter.count).toBe(0);
    expect(counter.state).toBe('idle');
  });
});

describe('EXERCISES config', () => {
  it('squat uses knee angle joints', () => {
    expect(EXERCISES.squat.joints.left).toEqual([11, 13, 15]);
    expect(EXERCISES.squat.joints.right).toEqual([12, 14, 16]);
  });

  it('pushup uses elbow angle joints', () => {
    expect(EXERCISES.pushup.joints.left).toEqual([5, 7, 9]);
    expect(EXERCISES.pushup.joints.right).toEqual([6, 8, 10]);
  });
});
