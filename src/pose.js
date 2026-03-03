import { KEYPOINT_RADIUS, DISPLAY_THRESHOLD } from './config.js';

// Head keypoint indices to skip (not useful for lifting exercises)
export const HEAD_INDICES = new Set([0, 1, 2, 3, 4]);

// Skeleton adjacency pairs (COCO keypoint indices) — body only
export const SKELETON = [
  [5, 6],               // shoulder to shoulder
  [5, 7], [7, 9],       // left arm
  [6, 8], [8, 10],      // right arm
  [5, 11], [6, 12],     // torso sides
  [11, 12],             // hip to hip
  [11, 13], [13, 15],   // left leg
  [12, 14], [14, 16],   // right leg
];

// Red-green gradient based on confidence score
export function scoreToColor(score) {
  const r = Math.round(255 * (1 - score));
  const g = Math.round(255 * score);
  return `rgb(${r}, ${g}, 0)`;
}

// Compute scale factor to fit source dimensions within max bounds (never upscales)
export function computeScale(srcWidth, srcHeight, maxW, maxH) {
  return Math.min(maxW / srcWidth, maxH / srcHeight, 1.0);
}

// Draw skeleton lines between connected joints
export function drawSkeleton(ctx, keypoints) {
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';

  for (const [i, j] of SKELETON) {
    const kpA = keypoints[i];
    const kpB = keypoints[j];
    const minScore = Math.min(kpA.score, kpB.score);
    if (minScore < DISPLAY_THRESHOLD) continue;

    const avgScore = (kpA.score + kpB.score) / 2;

    ctx.save();
    ctx.globalAlpha = minScore;
    ctx.strokeStyle = scoreToColor(avgScore);
    ctx.beginPath();
    ctx.moveTo(kpA.x, kpA.y);
    ctx.lineTo(kpB.x, kpB.y);
    ctx.stroke();
    ctx.restore();
  }
}

// Draw keypoint circles (body joints only)
export function drawKeypoints(ctx, keypoints) {
  for (let i = 0; i < keypoints.length; i++) {
    if (HEAD_INDICES.has(i)) continue;

    const { x, y, score } = keypoints[i];
    if (score < DISPLAY_THRESHOLD) continue;

    ctx.save();
    ctx.globalAlpha = score;
    ctx.fillStyle = scoreToColor(score);
    ctx.beginPath();
    ctx.arc(x, y, KEYPOINT_RADIUS, 0, 2 * Math.PI);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}

// Create MoveNet detector
export async function createDetector() {
  await tf.ready();
  return poseDetection.createDetector(
    poseDetection.SupportedModels.MoveNet,
    { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
  );
}
