import { describe, it, expect } from 'vitest';
import { normalizeKeypoints } from '../src/classifier.js';
import { POSE_DATA, TEMPLATES, generateVariations, mirrorTemplate } from '../src/poseData.js';

// Helper: create keypoints array from flat [x,y,...] with score
function keypointsFromFlat(flat, score = 0.9) {
  const kps = [];
  for (let i = 0; i < 17; i++) {
    kps.push({ x: flat[i * 2], y: flat[i * 2 + 1], score });
  }
  return kps;
}

describe('normalizeKeypoints', () => {
  it('centers on hip midpoint', () => {
    // Create keypoints with hips at (100, 200) and shoulders at (100, 100)
    const kps = Array(17).fill(null).map(() => ({ x: 100, y: 200, score: 0.9 }));
    kps[11] = { x: 95, y: 200, score: 0.9 };  // left hip
    kps[12] = { x: 105, y: 200, score: 0.9 }; // right hip
    kps[5] = { x: 95, y: 100, score: 0.9 };   // left shoulder
    kps[6] = { x: 105, y: 100, score: 0.9 };  // right shoulder

    const result = normalizeKeypoints(kps);
    // Hip midpoint should map to (0, 0)
    // left_hip index 11: result[22] and result[23]
    expect(result[22]).toBeCloseTo((-5) / 100, 2); // (95 - 100) / torso_len
    expect(result[23]).toBeCloseTo(0, 2);           // (200 - 200) / torso_len
  });

  it('scales by torso length', () => {
    const kps = Array(17).fill(null).map(() => ({ x: 0, y: 0, score: 0.9 }));
    kps[11] = { x: 0, y: 200, score: 0.9 };   // left hip
    kps[12] = { x: 0, y: 200, score: 0.9 };   // right hip
    kps[5] = { x: 0, y: 0, score: 0.9 };      // left shoulder
    kps[6] = { x: 0, y: 0, score: 0.9 };      // right shoulder
    // Torso length = 200. Place nose at (0, -200) which is 200px above hip
    kps[0] = { x: 0, y: -200, score: 0.9 };

    const result = normalizeKeypoints(kps);
    // Nose normalized: (0 - 0)/200 = 0, (-200 - 200)/200 = -2
    expect(result[0]).toBeCloseTo(0, 2);
    expect(result[1]).toBeCloseTo(-2, 2);
  });

  it('mirrors x when person faces left', () => {
    const kps = Array(17).fill(null).map(() => ({ x: 0, y: 0, score: 0.9 }));
    // Shoulders LEFT of hips (facing left)
    kps[11] = { x: 100, y: 100, score: 0.9 }; // left hip
    kps[12] = { x: 100, y: 100, score: 0.9 }; // right hip
    kps[5] = { x: 0, y: 0, score: 0.9 };      // left shoulder (to the LEFT)
    kps[6] = { x: 0, y: 0, score: 0.9 };      // right shoulder
    // Place nose at (-50, -50) - to the left of hip
    kps[0] = { x: -50, y: -50, score: 0.9 };

    const result = normalizeKeypoints(kps);
    // Nose raw normalized x: (-50 - 100) / torsoLen = -150/torsoLen (negative)
    // After mirroring: positive
    expect(result[0]).toBeGreaterThan(0);
  });

  it('does not mirror x when person faces right', () => {
    const kps = Array(17).fill(null).map(() => ({ x: 0, y: 0, score: 0.9 }));
    // Shoulders RIGHT of hips (facing right)
    kps[11] = { x: 0, y: 100, score: 0.9 };   // left hip
    kps[12] = { x: 0, y: 100, score: 0.9 };   // right hip
    kps[5] = { x: 100, y: 0, score: 0.9 };    // left shoulder (to the RIGHT)
    kps[6] = { x: 100, y: 0, score: 0.9 };    // right shoulder
    // Place nose at (150, -50) - to the right
    kps[0] = { x: 150, y: -50, score: 0.9 };

    const result = normalizeKeypoints(kps);
    // Nose raw normalized x: (150 - 0) / torsoLen = positive
    // No mirroring: stays positive
    expect(result[0]).toBeGreaterThan(0);
  });

  it('returns null for degenerate pose (zero torso length)', () => {
    const kps = Array(17).fill(null).map(() => ({ x: 100, y: 100, score: 0.9 }));
    // Shoulders at same position as hips → zero torso length
    const result = normalizeKeypoints(kps);
    expect(result).toBeNull();
  });

  it('returns array of 34 values', () => {
    const kps = Array(17).fill(null).map(() => ({ x: 0, y: 0, score: 0.9 }));
    kps[11] = { x: 0, y: 100, score: 0.9 };
    kps[12] = { x: 0, y: 100, score: 0.9 };
    kps[5] = { x: 0, y: 0, score: 0.9 };
    kps[6] = { x: 0, y: 0, score: 0.9 };

    const result = normalizeKeypoints(kps);
    expect(result).toHaveLength(34);
  });
});

describe('POSE_DATA', () => {
  it('has 5 pose classes (standing_up shared by squat and lunge)', () => {
    expect(Object.keys(POSE_DATA)).toEqual(
      expect.arrayContaining([
        'standing_up',
        'squat_down',
        'pushup_up', 'pushup_down',
        'lunge_down',
      ]),
    );
    expect(Object.keys(POSE_DATA)).toHaveLength(5);
  });

  it('has 30 examples per class', () => {
    for (const examples of Object.values(POSE_DATA)) {
      expect(examples).toHaveLength(30);
    }
  });

  it('each example has 34 values', () => {
    for (const examples of Object.values(POSE_DATA)) {
      for (const example of examples) {
        expect(example).toHaveLength(34);
      }
    }
  });

  it('variations differ from the template', () => {
    const template = TEMPLATES.standing_up;
    const examples = POSE_DATA.standing_up;
    // At least some values should differ (noise was added)
    const firstExample = examples[0];
    let hasDiff = false;
    for (let i = 0; i < 34; i++) {
      if (Math.abs(firstExample[i] - template[i]) > 1e-6) {
        hasDiff = true;
        break;
      }
    }
    expect(hasDiff).toBe(true);
  });

  it('mirrorTemplate swaps left/right COCO keypoint pairs', () => {
    const original = TEMPLATES.lunge_down;
    const mirrored = mirrorTemplate(original);
    // Knees swapped: left_knee (13) ↔ right_knee (14)
    expect(mirrored[13 * 2]).toBeCloseTo(original[14 * 2], 6);
    expect(mirrored[13 * 2 + 1]).toBeCloseTo(original[14 * 2 + 1], 6);
    expect(mirrored[14 * 2]).toBeCloseTo(original[13 * 2], 6);
    expect(mirrored[14 * 2 + 1]).toBeCloseTo(original[13 * 2 + 1], 6);
    // Ankles swapped: left_ankle (15) ↔ right_ankle (16)
    expect(mirrored[15 * 2]).toBeCloseTo(original[16 * 2], 6);
    expect(mirrored[15 * 2 + 1]).toBeCloseTo(original[16 * 2 + 1], 6);
    expect(mirrored[16 * 2]).toBeCloseTo(original[15 * 2], 6);
    expect(mirrored[16 * 2 + 1]).toBeCloseTo(original[15 * 2 + 1], 6);
    // Nose (0) stays unchanged
    expect(mirrored[0]).toBeCloseTo(original[0], 6);
    expect(mirrored[1]).toBeCloseTo(original[1], 6);
  });

  it('lunge_down includes both leg-forward variations', () => {
    // lunge_down should have 30 examples covering both left and right leg forward
    expect(POSE_DATA.lunge_down).toHaveLength(30);
    // First 15 from original template: right_knee (14) is forward (x > 0)
    const firstRightKneeX = POSE_DATA.lunge_down[0][14 * 2]; // right_knee x
    expect(firstRightKneeX).toBeGreaterThan(0);
    // Last 15 from mirrored template: left_knee (13) is forward (x > 0), right_knee behind
    const lastRightKneeX = POSE_DATA.lunge_down[15][14 * 2]; // right_knee x
    expect(lastRightKneeX).toBeLessThan(0);
  });

  it('generates reproducible data with same seed', () => {
    const a = generateVariations(TEMPLATES.standing_up, 5, 0.06, 42);
    const b = generateVariations(TEMPLATES.standing_up, 5, 0.06, 42);
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 34; j++) {
        expect(a[i][j]).toBe(b[i][j]);
      }
    }
  });
});
