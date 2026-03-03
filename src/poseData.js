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
  // Standing upright
  squat_up: [
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

  // Pre-lunge split stance: torso upright, feet staggered front/back, arms at sides
  // Key difference from squat_up: legs are split (front knee slightly ahead, rear behind)
  lunge_up: [
    // nose        left_eye     right_eye    left_ear     right_ear
    0.12, -1.33,   0.17, -1.38, 0.17, -1.38, -0.03, -1.33, -0.03, -1.33,
    // left_shldr  right_shldr  left_elbow   right_elbow  left_wrist   right_wrist
    0.02, -1.0,    0.02, -1.0,  -0.03, -0.5, -0.03, -0.5, -0.03, -0.05, -0.03, -0.05,
    // left_hip    right_hip    left_knee    right_knee   left_ankle   right_ankle
    0.0, 0.0,      0.0, 0.0,    0.40, 0.75,  -0.35, 0.80, 0.42, 1.50,  -0.40, 1.55,
  ],

  // Bottom of lunge: front knee bent ~90°, rear knee near ground, torso upright
  lunge_down: [
    // nose        left_eye     right_eye    left_ear     right_ear
    0.20, -1.10,   0.25, -1.15, 0.25, -1.15, 0.10, -1.10, 0.10, -1.10,
    // left_shldr  right_shldr  left_elbow   right_elbow  left_wrist   right_wrist
    0.10, -0.80,   0.10, -0.80, 0.05, -0.35, 0.05, -0.35, 0.05, 0.05,  0.05, 0.05,
    // left_hip    right_hip    left_knee    right_knee   left_ankle   right_ankle
    0.0, 0.0,      0.0, 0.0,    0.60, 0.40,  -0.45, 0.55, 0.58, 1.10,  -0.75, 1.10,
  ],
};

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

export const POSE_DATA = {
  squat_up: generateVariations(TEMPLATES.squat_up, EXAMPLES_PER_CLASS, NOISE_SIGMA, 42),
  squat_down: generateVariations(TEMPLATES.squat_down, EXAMPLES_PER_CLASS, NOISE_SIGMA, 137),
  pushup_up: generateVariations(TEMPLATES.pushup_up, EXAMPLES_PER_CLASS, NOISE_SIGMA, 256),
  pushup_down: generateVariations(TEMPLATES.pushup_down, EXAMPLES_PER_CLASS, NOISE_SIGMA, 389),
  lunge_up: generateVariations(TEMPLATES.lunge_up, EXAMPLES_PER_CLASS, NOISE_SIGMA, 512),
  lunge_down: generateVariations(TEMPLATES.lunge_down, EXAMPLES_PER_CLASS, NOISE_SIGMA, 631),
};

export { TEMPLATES, generateVariations };
