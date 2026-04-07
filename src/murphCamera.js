// ═══════════════════════════════════════════════════
// Murph Camera — Independent camera instance
// Own video/canvas/detectLoop, shares detector/classifier
// ═══════════════════════════════════════════════════

import { computeScale, drawSkeleton, drawKeypoints } from './pose.js';
import { classifyPose } from './classifier.js';
import { EXERCISES, RepCounter, ExerciseDetector } from './exercises.js';

/**
 * Start an independent camera + pose detection loop inside a container.
 * @param {HTMLElement} containerEl - DOM element to render into
 * @param {object} detector - Shared MoveNet detector singleton
 * @param {object} classifier - Shared KNN classifier singleton
 * @param {function} onRep - Callback: onRep(exerciseName) when a rep is counted
 * @returns {function} cleanup - Call to stop camera and remove DOM elements
 */
export async function startMurphCamera(containerEl, detector, classifier, onRep) {
  // ── Create DOM elements ──
  const video = document.createElement('video');
  video.setAttribute('playsinline', '');
  video.style.display = 'none';
  containerEl.appendChild(video);

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block; width:100%; height:100%; object-fit:contain;';
  containerEl.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  // ── Start camera ──
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    });
  } catch (err) {
    console.error('Murph camera error:', err);
    containerEl.innerHTML = `<div style="color:var(--text-secondary);text-align:center;padding:20px;font-family:var(--font-mono);font-size:12px;">Camera unavailable: ${err.message}</div>`;
    return () => {};
  }

  video.srcObject = stream;
  await video.play();

  // Wait for video dimensions
  if (!video.videoWidth) {
    await new Promise(resolve => {
      video.addEventListener('loadeddata', resolve, { once: true });
      setTimeout(resolve, 2000);
    });
  }

  // ── Exercise detection state (local, independent) ──
  let exerciseDetector = new ExerciseDetector();
  let currentExercise = null;
  let repCounter = null;
  let lastRepCount = 0;
  let isRunning = true;
  let animFrameId = null;

  // ── Detect loop ──
  async function detectLoop() {
    if (!isRunning || !detector) return;

    if (!video.videoWidth || !video.videoHeight) {
      animFrameId = requestAnimationFrame(detectLoop);
      return;
    }

    const maxW = containerEl.clientWidth || 640;
    const maxH = containerEl.clientHeight || 480;
    const scale = computeScale(video.videoWidth, video.videoHeight, maxW, maxH);
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);

    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);

    const poses = await detector.estimatePoses(canvas);

    if (poses.length && poses[0].keypoints.length) {
      const keypoints = poses[0].keypoints;
      drawSkeleton(ctx, keypoints);
      drawKeypoints(ctx, keypoints);

      // Auto-detect exercise
      const prediction = await classifyPose(classifier, keypoints);
      const newKey = exerciseDetector.update(prediction);

      if (newKey) {
        const exercise = EXERCISES[newKey];
        currentExercise = exercise;
        repCounter = new RepCounter(exercise, classifier);
        lastRepCount = 0;
      }

      if (repCounter) {
        const result = await repCounter.update(keypoints, prediction);
        if (result.count > lastRepCount) {
          lastRepCount = result.count;
          if (onRep && currentExercise) {
            onRep(currentExercise.name);
          }
        }
      }
    }

    animFrameId = requestAnimationFrame(detectLoop);
  }

  // Draw first frame immediately
  if (video.videoWidth) {
    const maxW = containerEl.clientWidth || 640;
    const maxH = containerEl.clientHeight || 480;
    const scale = computeScale(video.videoWidth, video.videoHeight, maxW, maxH);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  }

  // Start the loop
  detectLoop();

  // ── Cleanup function ──
  return function cleanup() {
    isRunning = false;
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    video.srcObject = null;
    if (video.parentNode) video.remove();
    if (canvas.parentNode) canvas.remove();
  };
}
