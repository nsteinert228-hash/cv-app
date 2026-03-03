// KNN pose classifier using @tensorflow-models/knn-classifier
// Classifies normalized pose keypoints into exercise phases

import { POSE_DATA } from './poseData.js';
import { K_NEIGHBORS, MIN_KEYPOINT_CONFIDENCE } from './config.js';

const BODY_INDICES = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

// Normalize keypoints: center on hip midpoint, scale by torso length,
// mirror to right-facing if needed. Returns flat 34-value array.
export function normalizeKeypoints(keypoints) {
  // Hip midpoint (indices 11, 12)
  const hipCx = (keypoints[11].x + keypoints[12].x) / 2;
  const hipCy = (keypoints[11].y + keypoints[12].y) / 2;

  // Shoulder midpoint (indices 5, 6)
  const shoulderCx = (keypoints[5].x + keypoints[6].x) / 2;
  const shoulderCy = (keypoints[5].y + keypoints[6].y) / 2;

  // Torso length (shoulder center to hip center)
  const dx = shoulderCx - hipCx;
  const dy = shoulderCy - hipCy;
  const torsoLen = Math.sqrt(dx * dx + dy * dy);

  if (torsoLen < 1e-6) return null; // degenerate pose

  // Detect facing direction: if shoulders are to the left of hips, person faces left
  const facingLeft = shoulderCx < hipCx;

  // Normalize each keypoint
  const result = new Float32Array(34);
  for (let i = 0; i < 17; i++) {
    let nx = (keypoints[i].x - hipCx) / torsoLen;
    const ny = (keypoints[i].y - hipCy) / torsoLen;

    // Mirror x if facing left so classifier always sees right-facing
    if (facingLeft) nx = -nx;

    result[i * 2] = nx;
    result[i * 2 + 1] = ny;
  }

  return result;
}

// Create and populate KNN classifier with pre-loaded pose data
export async function createPoseClassifier() {
  // knnClassifier is loaded as a global from CDN
  const classifier = knnClassifier.create();

  for (const [label, examples] of Object.entries(POSE_DATA)) {
    for (const example of examples) {
      const tensor = tf.tensor1d(example);
      classifier.addExample(tensor, label);
      tensor.dispose();
    }
  }

  return classifier;
}

// Classify a pose from raw keypoints. Returns { label, confidences } or null.
export async function classifyPose(classifier, keypoints) {
  // Gate: skip if any body keypoint has low confidence
  const minBodyConf = Math.min(...BODY_INDICES.map(i => keypoints[i].score));
  if (minBodyConf < MIN_KEYPOINT_CONFIDENCE) return null;

  const normalized = normalizeKeypoints(keypoints);
  if (!normalized) return null;

  const tensor = tf.tensor1d(normalized);
  try {
    const result = await classifier.predictClass(tensor, K_NEIGHBORS);
    return { label: result.label, confidences: result.confidences };
  } finally {
    tensor.dispose();
  }
}
