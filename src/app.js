import {
  createDetector, computeScale, drawSkeleton, drawKeypoints, HEAD_INDICES,
} from './pose.js';
import { startCamera, stopCamera } from './camera.js';
import { EXERCISES, RepCounter } from './exercises.js';

// DOM elements
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const placeholder = document.getElementById('placeholder');
const uploadInput = document.getElementById('uploadInput');
const cameraInput = document.getElementById('cameraInput');
const cameraToggle = document.getElementById('cameraToggle');
const uploadControls = document.getElementById('uploadControls');
const video = document.getElementById('video');
const exerciseBtns = document.querySelectorAll('[data-exercise]');
const resetBtn = document.getElementById('resetBtn');

let detector = null;
let stream = null;
let animFrameId = null;
let isRunning = false;

// Exercise state
let currentExercise = null;
let repCounter = null;
let repFlashUntil = 0;
let lastRepCount = 0;

// FPS tracking
const FPS_BUFFER_SIZE = 30;
const frameTimes = [];
let lastFpsUpdate = 0;
let displayFps = 0;

function getMaxDimensions() {
  return {
    maxW: window.innerWidth - 40,
    maxH: window.innerHeight * 0.7,
  };
}

function updateFps(now) {
  frameTimes.push(now);
  if (frameTimes.length > FPS_BUFFER_SIZE) {
    frameTimes.shift();
  }
  if (frameTimes.length >= 2 && now - lastFpsUpdate > 500) {
    const elapsed = frameTimes[frameTimes.length - 1] - frameTimes[0];
    displayFps = Math.round((frameTimes.length - 1) / elapsed * 1000);
    lastFpsUpdate = now;
  }
}

// Draw rep counter overlay on canvas
function drawRepOverlay(ctx, count, exerciseName, w, h, flashing) {
  const padding = 16;
  const x = w - padding;
  const y = padding;

  ctx.save();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';

  // Rep count number
  const fontSize = flashing ? 64 : 48;
  ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = flashing ? '#00ff88' : '#ffffff';
  ctx.fillText(count, x, y);

  // Exercise name label
  ctx.font = '16px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillStyle = '#aaaaaa';
  ctx.fillText(exerciseName, x, y + fontSize + 4);

  ctx.restore();
}

// Live detection loop
async function detectLoop() {
  if (!isRunning || !detector) return;

  const now = performance.now();
  updateFps(now);

  const { maxW, maxH } = getMaxDimensions();
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

    // Exercise detection
    if (repCounter) {
      const result = repCounter.update(keypoints);

      if (result.count > lastRepCount) {
        repFlashUntil = now + 300;
        lastRepCount = result.count;
      }

      const flashing = now < repFlashUntil;
      drawRepOverlay(ctx, result.count, currentExercise.name, w, h, flashing);
    }

    const bodyKps = keypoints.filter((_, i) => !HEAD_INDICES.has(i));
    const avgScore = bodyKps.reduce((sum, kp) => sum + kp.score, 0) / bodyKps.length;
    statusEl.textContent = `Live — ${displayFps} fps — avg confidence: ${Math.round(avgScore * 100)}%`;
  } else {
    statusEl.textContent = `Live — ${displayFps} fps — no pose detected`;

    // Still draw the rep overlay even if no pose this frame
    if (repCounter) {
      const flashing = now < repFlashUntil;
      drawRepOverlay(ctx, repCounter.count, currentExercise.name, w, h, flashing);
    }
  }

  animFrameId = requestAnimationFrame(detectLoop);
}

async function handleStartCamera() {
  if (!detector) {
    statusEl.textContent = 'Model not loaded yet. Please wait...';
    return;
  }

  try {
    statusEl.textContent = 'Starting camera...';
    stream = await startCamera(video);

    isRunning = true;
    frameTimes.length = 0;
    displayFps = 0;

    canvas.style.display = 'block';
    placeholder.style.display = 'none';
    uploadControls.style.display = 'none';
    cameraToggle.textContent = 'Stop Camera';

    detectLoop();
  } catch (err) {
    statusEl.textContent = err.message;
  }
}

function handleStopCamera() {
  isRunning = false;
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  stopCamera(stream, video);
  stream = null;

  canvas.style.display = 'none';
  placeholder.style.display = 'flex';
  uploadControls.style.display = 'flex';
  cameraToggle.textContent = 'Start Camera';
  statusEl.textContent = 'Ready — upload a photo or start the camera.';
}

function handleCameraToggle() {
  if (isRunning) {
    handleStopCamera();
  } else {
    handleStartCamera();
  }
}

// Exercise selection
function selectExercise(key) {
  // Update button active states
  exerciseBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.exercise === key);
  });

  if (key === 'off' || !EXERCISES[key]) {
    currentExercise = null;
    repCounter = null;
    lastRepCount = 0;
    resetBtn.style.display = 'none';
    return;
  }

  const exercise = EXERCISES[key];

  // Only reset if switching to a different exercise
  if (currentExercise !== exercise) {
    currentExercise = exercise;
    repCounter = new RepCounter(exercise);
    lastRepCount = 0;
    repFlashUntil = 0;
  }

  resetBtn.style.display = 'inline-flex';
}

function handleReset() {
  if (repCounter) {
    repCounter.reset();
    lastRepCount = 0;
    repFlashUntil = 0;
  }
}

// Image upload pipeline (stops camera if running)
async function processImage(img) {
  if (isRunning) {
    handleStopCamera();
  }

  if (!detector) {
    statusEl.textContent = 'Model not loaded yet. Please wait...';
    return;
  }

  statusEl.textContent = 'Detecting pose...';

  const { maxW, maxH } = getMaxDimensions();
  const scale = computeScale(img.naturalWidth, img.naturalHeight, maxW, maxH);
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);

  canvas.width = w;
  canvas.height = h;
  canvas.style.display = 'block';
  placeholder.style.display = 'none';

  ctx.drawImage(img, 0, 0, w, h);

  const poses = await detector.estimatePoses(canvas);

  if (!poses.length || !poses[0].keypoints.length) {
    statusEl.textContent = 'No pose detected. Try a clearer photo of a person.';
    return;
  }

  const keypoints = poses[0].keypoints;
  drawSkeleton(ctx, keypoints);
  drawKeypoints(ctx, keypoints);

  const bodyKps = keypoints.filter((_, i) => !HEAD_INDICES.has(i));
  const avgScore = bodyKps.reduce((sum, kp) => sum + kp.score, 0) / bodyKps.length;
  statusEl.textContent = `Pose detected — average confidence: ${Math.round(avgScore * 100)}%`;
}

function handleFileInput(e) {
  const file = e.target.files[0];
  if (!file) return;

  const img = new Image();
  img.onload = () => processImage(img);
  img.src = URL.createObjectURL(file);
  e.target.value = '';
}

// Event listeners
uploadInput.addEventListener('change', handleFileInput);
cameraInput.addEventListener('change', handleFileInput);
cameraToggle.addEventListener('click', handleCameraToggle);
resetBtn.addEventListener('click', handleReset);

exerciseBtns.forEach(btn => {
  btn.addEventListener('click', () => selectExercise(btn.dataset.exercise));
});

// Initialize
async function init() {
  try {
    statusEl.textContent = 'Loading model...';
    detector = await createDetector();
    statusEl.textContent = 'Ready — upload a photo or start the camera.';
  } catch (err) {
    statusEl.textContent = `Error loading model: ${err.message}`;
    console.error('Model load error:', err);
  }
}

init();
