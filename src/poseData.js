// Synthetic pose keypoint data for KNN classifier training (profile view)
// All positions are normalized: hip-centered, torso-length scaled, right-facing

// 17 COCO keypoints order:
// 0:nose 1:left_eye 2:right_eye 3:left_ear 4:right_ear
// 5:left_shoulder 6:right_shoulder 7:left_elbow 8:right_elbow
// 9:left_wrist 10:right_wrist 11:left_hip 12:right_hip
// 13:left_knee 14:right_knee 15:left_ankle 16:right_ankle

// Seeded PRNG for reproducible data
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianNoise(rng) {
  const u1 = rng() || 1e-10;
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// Template poses: flat arrays of [x0,y0, x1,y1, ..., x16,y16]
// Profile view facing right, hip at origin, torso length = 1.0
// y increases downward (canvas convention)
const TEMPLATES = {
  // Standing upright — shared starting position for squats and lunges
  standing_up: [
    // nose        left_eye     right_eye    left_ear     right_ear
    0.1, -1.35,    0.15, -1.4,  0.15, -1.4,  -0.05, -1.35, -0.05, -1.35,
    // left_shldr  right_shldr  left_elbow   right_elbow  left_wrist   right_wrist
    0.0, -1.0,     0.0, -1.0,   -0.05, -0.5, -0.05, -0.5, -0.05, -0.05, -0.05, -0.05,
    // left_hip    right_hip    left_knee    right_knee   left_ankle   right_ankle
    0.0, 0.0,      0.0, 0.0,    0.0, 0.8,    0.0, 0.8,    0.0, 1.55,   0.0, 1.55,
  ],

  // Bottom of squat: torso leaned forward ~35°, knees bent ~100°
  squat_down: [
    // nose        left_eye     right_eye    left_ear     right_ear
    0.82, -1.12,   0.87, -1.17, 0.87, -1.17, 0.72, -1.07, 0.72, -1.07,
    // left_shldr  right_shldr  left_elbow   right_elbow  left_wrist   right_wrist
    0.57, -0.82,   0.57, -0.82, 0.75, -0.55, 0.75, -0.55, 0.9, -0.3,   0.9, -0.3,
    // left_hip    right_hip    left_knee    right_knee   left_ankle   right_ankle
    0.0, 0.0,      0.0, 0.0,    0.75, 0.27,  0.75, 0.27,  0.68, 1.02,  0.68, 1.02,
  ],

  // Top of pushup / plank: body horizontal, arms extended (from real capture)
  pushup_up: [
    // nose        left_eye     right_eye    left_ear     right_ear
    1.39, -0.14,   1.48, -0.14, 1.42, -0.24, 1.42, -0.23, 1.29, -0.41,
    // left_shldr  right_shldr  left_elbow   right_elbow  left_wrist   right_wrist
    0.97, -0.29,   0.95, -0.27, 0.89, 0.35,  0.89, 0.42,  1.01, 0.79,  1.05, 0.93,
    // left_hip    right_hip    left_knee    right_knee   left_ankle   right_ankle
    0.03, 0.00,    -0.03, -0.00, -0.66, 0.32, -0.76, 0.33, -1.10, 0.50, -1.50, 0.53,
  ],

  // Bottom of pushup: body lowered, elbows bent back (from real capture)
  pushup_down: [
    // nose        left_eye     right_eye    left_ear     right_ear
    1.34, 0.22,    1.38, 0.20,  1.37, 0.18,  1.31, 0.04,  1.28, -0.00,
    // left_shldr  right_shldr  left_elbow   right_elbow  left_wrist   right_wrist
    1.00, -0.06,   1.00, -0.01, 0.50, -0.07, 0.44, -0.01, 0.62, 0.30,  0.59, 0.43,
    // left_hip    right_hip    left_knee    right_knee   left_ankle   right_ankle
    0.02, -0.03,   -0.02, 0.03, -0.65, 0.11, -0.70, 0.16, -1.21, 0.07, -1.32, 0.11,
  ],

  // Top of pull-up: chin above bar, elbows bent, front-on view
  pullup_up: [
    // nose        left_eye     right_eye    left_ear     right_ear
    0.0, -1.35,    -0.08, -1.4, 0.08, -1.4,  -0.2, -1.3,  0.2, -1.3,
    // left_shldr  right_shldr  left_elbow   right_elbow  left_wrist   right_wrist
    -0.45, -0.95,  0.45, -0.95, -0.7, -1.25, 0.7, -1.25,  -0.5, -1.55, 0.5, -1.55,
    // left_hip    right_hip    left_knee    right_knee   left_ankle   right_ankle
    -0.15, 0.0,    0.15, 0.0,   -0.15, 0.75, 0.15, 0.75,  -0.15, 1.45, 0.15, 1.45,
  ],

  // Bottom of pull-up / dead hang: arms extended overhead, front-on view
  pullup_down: [
    // nose        left_eye     right_eye    left_ear     right_ear
    0.0, -1.25,    -0.08, -1.3, 0.08, -1.3,  -0.2, -1.2,  0.2, -1.2,
    // left_shldr  right_shldr  left_elbow   right_elbow  left_wrist   right_wrist
    -0.4, -0.9,    0.4, -0.9,   -0.55, -1.35, 0.55, -1.35, -0.45, -1.75, 0.45, -1.75,
    // left_hip    right_hip    left_knee    right_knee   left_ankle   right_ankle
    -0.12, 0.0,    0.12, 0.0,   -0.12, 0.8,  0.12, 0.8,   -0.12, 1.55, 0.12, 1.55,
  ],

  // Bottom of lunge: front knee bent ~90°, rear knee near ground, torso upright
  lunge_down: [
    // nose        left_eye     right_eye    left_ear     right_ear
    0.10, -1.32,   0.15, -1.37, 0.15, -1.37, 0.00, -1.32, 0.00, -1.32,
    // left_shldr  right_shldr  left_elbow   right_elbow  left_wrist   right_wrist
    0.05, -1.0,    0.05, -1.0,  0.00, -0.50, 0.00, -0.50, -0.05, -0.05, -0.05, -0.05,
    // left_hip    right_hip    left_knee    right_knee   left_ankle   right_ankle
    0.0, 0.0,      0.0, 0.0,   -0.55, 0.55,  0.65, 0.0,   -1.10, 0.75,  0.65, 0.75,
  ],
};

// Mirror a template by swapping left/right COCO keypoint pairs.
// Handles asymmetric poses like lunges done with either leg forward.
function mirrorTemplate(template) {
  const mirrored = [...template];
  // COCO left/right pairs: (1,2) eyes, (3,4) ears, (5,6) shoulders,
  // (7,8) elbows, (9,10) wrists, (11,12) hips, (13,14) knees, (15,16) ankles
  const pairs = [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16]];
  for (const [l, r] of pairs) {
    mirrored[l * 2] = template[r * 2];
    mirrored[l * 2 + 1] = template[r * 2 + 1];
    mirrored[r * 2] = template[l * 2];
    mirrored[r * 2 + 1] = template[l * 2 + 1];
  }
  return mirrored;
}

// Generate N variations of a template pose by adding Gaussian noise
function generateVariations(template, count, sigma, seed) {
  const rng = mulberry32(seed);
  const variations = [];

  for (let i = 0; i < count; i++) {
    const variant = new Float32Array(template.length);
    for (let j = 0; j < template.length; j++) {
      variant[j] = template[j] + gaussianNoise(rng) * sigma;
    }
    variations.push(variant);
  }

  return variations;
}

const EXAMPLES_PER_CLASS = 30;
const NOISE_SIGMA = 0.06;

const HALF_EXAMPLES = EXAMPLES_PER_CLASS / 2;

export const POSE_DATA = {
  standing_up: generateVariations(TEMPLATES.standing_up, EXAMPLES_PER_CLASS, NOISE_SIGMA, 42),
  squat_down: generateVariations(TEMPLATES.squat_down, EXAMPLES_PER_CLASS, NOISE_SIGMA, 137),
  pushup_up: generateVariations(TEMPLATES.pushup_up, EXAMPLES_PER_CLASS, NOISE_SIGMA, 256),
  pushup_down: generateVariations(TEMPLATES.pushup_down, EXAMPLES_PER_CLASS, NOISE_SIGMA, 389),
  pullup_up: generateVariations(TEMPLATES.pullup_up, EXAMPLES_PER_CLASS, NOISE_SIGMA, 501),
  pullup_down: generateVariations(TEMPLATES.pullup_down, EXAMPLES_PER_CLASS, NOISE_SIGMA, 518),
  lunge_down: [
    ...generateVariations(TEMPLATES.lunge_down, HALF_EXAMPLES, NOISE_SIGMA, 631),
    ...generateVariations(mirrorTemplate(TEMPLATES.lunge_down), HALF_EXAMPLES, NOISE_SIGMA, 732),
  ],
};

export { TEMPLATES, generateVariations, mirrorTemplate };
