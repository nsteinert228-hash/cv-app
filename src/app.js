import {
  createDetector, computeScale, drawSkeleton, drawKeypoints, HEAD_INDICES,
} from './pose.js';
import { EXERCISES, RepCounter, ExerciseDetector } from './exercises.js';
import { createPoseClassifier, classifyPose } from './classifier.js';
import { SessionLog } from './sessionLog.js';
import { SET_IDLE_TIMEOUT } from './config.js';
import { isSupabaseConfigured } from './supabase.js';
import { onAuthStateChange } from './auth.js';
import { createAuthUI } from './authUI.js';
import * as db from './db.js';
import { getMurphAttempt, PHASES, MURPH_TARGETS } from './murph.js';
import { initMurphUI } from './murphUI.js';
import { initProfilePanel } from './userProfileUI.js';

// Camera helpers
async function startCamera(videoEl) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    });
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      throw new Error('Camera access denied. Please allow camera access in your browser settings.');
    }
    if (err.name === 'NotFoundError') {
      throw new Error('No camera found on this device.');
    }
    throw new Error(`Camera error: ${err.message}`);
  }
  videoEl.srcObject = stream;
  await videoEl.play();

  // Wait for video to have actual dimensions before returning
  if (!videoEl.videoWidth) {
    await new Promise(resolve => {
      videoEl.addEventListener('loadeddata', resolve, { once: true });
      // Fallback timeout in case loadeddata already fired
      setTimeout(resolve, 2000);
    });
  }

  return stream;
}

function stopCamera(stream, videoEl) {
  if (stream) stream.getTracks().forEach(t => t.stop());
  if (videoEl) videoEl.srcObject = null;
}

// DOM elements
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
let loadingOverlay = document.getElementById('loadingOverlay');
const fallbackControls = document.getElementById('fallbackControls');
const uploadInput = document.getElementById('uploadInput');
const uploadInput2 = document.getElementById('uploadInput2');
const cameraInput = document.getElementById('cameraInput');
const cameraToggle = document.getElementById('cameraToggle');
const video = document.getElementById('video');
const modeSelector = document.getElementById('modeSelector');
const modeTrigger = document.getElementById('modeTrigger');
const modeTriggerLabel = document.getElementById('modeTriggerLabel');
const exerciseBtns = document.querySelectorAll('[data-exercise]');
const resetBtn = document.getElementById('resetBtn');
const repOverlay = document.getElementById('repOverlay');
const repCountEl = document.getElementById('repCount');
const repLabelEl = document.getElementById('repLabel');
const sessionLogEl = document.getElementById('sessionLog');
const sessionSummaryEl = document.getElementById('sessionSummary');
const sessionEntriesEl = document.getElementById('sessionEntries');
const clearSessionBtn = document.getElementById('clearSessionBtn');

// Auth
const authSection = document.getElementById('authSection');
const authUI = createAuthUI();

let detector = null;
let poseClassifier = null;
let stream = null;
let animFrameId = null;
let isRunning = false;

// Exercise state
let currentExercise = null;
let repCounter = null;
let lastRepCount = 0;
let autoMode = false;
let exerciseDetector = null;
const sessionLog = new SessionLog(localStorage);


// Idle timeout — auto-log a set after configured idle period
let lastState = null;
let lastStateChangeTime = Date.now();

function getMaxDimensions() {
  const stage = document.querySelector('.camera-stage');
  if (stage) {
    return { maxW: stage.clientWidth, maxH: stage.clientHeight };
  }
  return {
    maxW: window.innerWidth - 40,
    maxH: window.innerHeight * 0.7,
  };
}

// Loading overlay
function hideLoadingOverlay() {
  if (!loadingOverlay) return;
  // Remove from DOM entirely — no CSS transition dependency
  loadingOverlay.remove();
  loadingOverlay = null;
}

function showFallbackControls(message) {
  if (statusEl) statusEl.textContent = message;
  const spinner = loadingOverlay?.querySelector('.loading-spinner');
  if (spinner) spinner.style.display = 'none';
  if (fallbackControls) fallbackControls.classList.add('visible');
}

// Update the persistent DOM rep counter overlay
let flashTimeout = null;

function updateRepOverlay(count, exerciseName, flashing) {
  repCountEl.textContent = count;
  repLabelEl.textContent = exerciseName;

  if (flashing) {
    repCountEl.classList.add('flash');
    clearTimeout(flashTimeout);
    flashTimeout = setTimeout(() => repCountEl.classList.remove('flash'), 300);
  }
}

function showRepOverlay(exerciseName) {
  repCountEl.textContent = '0';
  repLabelEl.textContent = exerciseName;
  repOverlay.style.display = 'block';
}

function _showMurphMilestone(exerciseName) {
  let flash = document.getElementById('murphMilestoneFlash');
  if (!flash) {
    flash = document.createElement('div');
    flash.id = 'murphMilestoneFlash';
    flash.className = 'murph-milestone-flash';
    document.body.appendChild(flash);
  }
  flash.textContent = `${exerciseName} COMPLETE`;
  flash.classList.remove('show');
  void flash.offsetWidth;
  flash.classList.add('show');
  setTimeout(() => flash.classList.remove('show'), 1500);
}

function hideRepOverlay() {
  repOverlay.style.display = 'none';
  repCountEl.classList.remove('flash');
  clearTimeout(flashTimeout);
}

function logCurrentExercise() {
  if (currentExercise && lastRepCount > 0) {
    sessionLog.addEntry(currentExercise.name, lastRepCount);
    renderSessionLog();
  }
}

function resetIdleTimer() {
  lastStateChangeTime = Date.now();
  lastState = null;
}

function trackStateChange(state) {
  if (state !== lastState) {
    lastState = state;
    lastStateChangeTime = Date.now();
  }
}

function checkSetIdleTimeout() {
  if (lastRepCount <= 0) return;
  if (Date.now() - lastStateChangeTime < SET_IDLE_TIMEOUT) return;

  logCurrentExercise();

  if (autoMode && exerciseDetector) {
    exerciseDetector.reset();
    currentExercise = null;
    repCounter = null;
    lastRepCount = 0;
    resetIdleTimer();
    showRepOverlay('Detecting...');
  } else if (repCounter) {
    repCounter.reset();
    lastRepCount = 0;
    resetIdleTimer();
    updateRepOverlay(0, currentExercise.name, false);
  }
}

// Session log — incremental DOM rendering with animation
let renderedLogCount = 0;

function renderSessionLog() {
  const entries = sessionLog.entries;
  if (entries.length === 0) {
    sessionLogEl.style.display = 'none';
    renderedLogCount = 0;
    return;
  }

  sessionLogEl.style.display = 'block';

  // Only add truly new entries
  const newEntries = entries.slice(renderedLogCount);
  for (const e of newEntries) {
    const time = e.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const div = document.createElement('div');
    div.className = 'log-entry new';
    div.innerHTML = `
      <span class="log-exercise">${e.exercise}</span>
      <span class="log-reps">${e.reps} rep${e.reps !== 1 ? 's' : ''}</span>
      <span class="log-time">${time}</span>
    `;
    sessionEntriesEl.insertBefore(div, sessionEntriesEl.firstChild);
    div.addEventListener('animationend', () => div.classList.remove('new'), { once: true });
  }
  renderedLogCount = entries.length;

  // Update summary
  const summary = sessionLog.getSummary();
  const total = sessionLog.totalReps;
  const parts = Object.entries(summary).map(([ex, reps]) => `${ex}: ${reps}`);
  sessionSummaryEl.textContent = `${total} reps — ${parts.join(', ')}`;
}

// Pause/resume tracker detect loop (used when switching tabs to avoid
// running two detector.estimatePoses() simultaneously)
function pauseTrackerLoop() {
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

function resumeTrackerLoop() {
  if (isRunning && !animFrameId) {
    detectLoop();
  }
}

// Full stop/restart tracker camera (iOS only allows one active camera stream)
function stopTrackerCamera() {
  pauseTrackerLoop();
  isRunning = false;
  stopCamera(stream, video);
  stream = null;
  canvas.style.display = 'none';
}

async function restartTrackerCamera() {
  if (stream) return; // already running
  try {
    stream = await startCamera(video);
    const { maxW, maxH } = getMaxDimensions();
    const scale = computeScale(video.videoWidth, video.videoHeight, maxW, maxH);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    isRunning = true;
    canvas.style.display = 'block';
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    detectLoop();
  } catch (err) {
    console.error('Failed to restart tracker camera:', err);
  }
}

// Expose for tab switching
window._pauseTracker = pauseTrackerLoop;
window._resumeTracker = resumeTrackerLoop;
window._stopTrackerCamera = stopTrackerCamera;
window._restartTrackerCamera = restartTrackerCamera;
window._getMurphAttempt = getMurphAttempt;

// Live detection loop
async function detectLoop() {
  if (!isRunning || !detector) return;

  // Wait for video to have actual dimensions before processing
  if (!video.videoWidth || !video.videoHeight) {
    animFrameId = requestAnimationFrame(detectLoop);
    return;
  }

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
    if (autoMode && exerciseDetector) {
      const prediction = await classifyPose(poseClassifier, keypoints);
      const newKey = exerciseDetector.update(prediction);

      if (newKey) {
        logCurrentExercise();
        const exercise = EXERCISES[newKey];
        currentExercise = exercise;
        repCounter = new RepCounter(exercise, poseClassifier);
        lastRepCount = 0;
        showRepOverlay(exercise.name);
      }

      if (repCounter) {
        const result = await repCounter.update(keypoints, prediction);
        trackStateChange(result.state);
        if (result.count > lastRepCount) {
          lastRepCount = result.count;
          updateRepOverlay(result.count, currentExercise.name, true);

          // Route reps to Murph attempt when in exercises phase
          const murph = getMurphAttempt();
          if (murph.phase === PHASES.EXERCISES && currentExercise) {
            const newTotal = murph.addRep(currentExercise.name);
            const key = currentExercise.name === 'Pull-ups' ? 'pullups'
              : currentExercise.name === 'Pushups' ? 'pushups'
              : currentExercise.name === 'Squats' ? 'squats' : null;
            if (key && newTotal === MURPH_TARGETS[key]) {
              _showMurphMilestone(currentExercise.name);
            }
          }
        } else {
          updateRepOverlay(result.count, currentExercise.name, false);
        }
      }
    } else if (repCounter) {
      const result = await repCounter.update(keypoints);
      trackStateChange(result.state);

      if (result.count > lastRepCount) {
        lastRepCount = result.count;
        updateRepOverlay(result.count, currentExercise.name, true);
      } else {
        updateRepOverlay(result.count, currentExercise.name, false);
      }
    }
  }

  // Check idle timeout every frame
  checkSetIdleTimeout();

  animFrameId = requestAnimationFrame(detectLoop);
}


async function handleStartCamera() {
  if (!detector) {
    if (statusEl) statusEl.textContent = 'Model not loaded yet. Please wait...';
    return;
  }

  try {
    if (statusEl) statusEl.textContent = 'Starting camera...';
    stream = await startCamera(video);

    // Set initial canvas size from video dimensions
    const { maxW, maxH } = getMaxDimensions();
    const scale = computeScale(video.videoWidth, video.videoHeight, maxW, maxH);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);

    isRunning = true;
    const stage = document.getElementById('cameraStage');
    if (stage) stage.classList.add('active');
    const onboarding = document.getElementById('onboardingOverlay');
    if (onboarding) onboarding.classList.add('hidden');
    canvas.style.display = 'block';
    hideLoadingOverlay();
    const pauseOv = document.getElementById('pauseOverlay');
    if (pauseOv) pauseOv.style.display = 'none';

    // Update camera toggle icon to "stop" state
    cameraToggle.title = 'Stop Camera';
    cameraToggle.innerHTML = '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

    // Draw first frame immediately so the canvas isn't black
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    detectLoop();
  } catch (err) {
    showFallbackControls(err.message);
  }
}

function handleStopCamera() {
  logCurrentExercise();
  isRunning = false;
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  stopCamera(stream, video);
  stream = null;

  canvas.style.display = 'none';

  // Show paused overlay — tap to restart
  const cameraArea = canvas.parentElement;
  let pauseOverlay = document.getElementById('pauseOverlay');
  if (!pauseOverlay) {
    pauseOverlay = document.createElement('div');
    pauseOverlay.id = 'pauseOverlay';
    pauseOverlay.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(8,8,8,0.92);z-index:20;cursor:pointer;border-radius:16px';
    cameraArea.appendChild(pauseOverlay);
  }
  pauseOverlay.innerHTML = '<div style="font-size:48px;margin-bottom:12px">▶</div><div style="font-family:var(--font-mono);font-size:12px;color:var(--text-tertiary)">Tap to resume camera</div>';
  pauseOverlay.style.display = '';
  pauseOverlay.onclick = () => {
    pauseOverlay.style.display = 'none';
    handleStartCamera();
  };

  // Update camera toggle icon to "play" state
  cameraToggle.title = 'Start Camera';
  cameraToggle.innerHTML = '<svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
}

function handleCameraToggle() {
  if (isRunning) {
    handleStopCamera();
  } else {
    // Restore spinner and hide fallback for restart
    if (loadingOverlay) {
      const spinner = loadingOverlay.querySelector('.loading-spinner');
      if (spinner) spinner.style.display = '';
      if (fallbackControls) fallbackControls.classList.remove('visible');
    }
    handleStartCamera();
  }
}

// Exercise selection
const MODE_LABELS = { auto: 'Auto', squat: 'Squats', pushup: 'Pushups', lunge: 'Lunges', pullup: 'Pull-ups', off: 'Off' };

function selectExercise(key) {
  exerciseBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.exercise === key);
  });

  // Update trigger label and collapse menu
  modeTriggerLabel.textContent = MODE_LABELS[key] || key;
  modeSelector.classList.remove('open');

  logCurrentExercise();

  if (key === 'auto') {
    autoMode = true;
    exerciseDetector = new ExerciseDetector();
    currentExercise = null;
    repCounter = null;
    lastRepCount = 0;
    resetIdleTimer();
    showRepOverlay('Detecting...');
    resetBtn.style.display = 'inline-flex';
    return;
  }

  autoMode = false;
  exerciseDetector = null;

  if (key === 'off' || !EXERCISES[key]) {
    currentExercise = null;
    repCounter = null;
    lastRepCount = 0;
    resetIdleTimer();
    resetBtn.style.display = 'none';
    hideRepOverlay();
    return;
  }

  const exercise = EXERCISES[key];

  if (currentExercise !== exercise) {
    currentExercise = exercise;
    repCounter = new RepCounter(exercise, poseClassifier);
    lastRepCount = 0;
    resetIdleTimer();
    showRepOverlay(exercise.name);
  }

  resetBtn.style.display = 'inline-flex';
}

function handleReset() {
  if (repCounter) {
    logCurrentExercise();
    repCounter.reset();
    lastRepCount = 0;
    resetIdleTimer();
    const label = currentExercise?.name || 'Detecting...';
    updateRepOverlay(0, label, false);
  }
}

// Image upload pipeline (stops camera if running)
async function processImage(img) {
  if (isRunning) {
    handleStopCamera();
  }

  if (!detector) {
    if (statusEl) statusEl.textContent = 'Model not loaded yet. Please wait...';
    return;
  }

  if (statusEl) statusEl.textContent = 'Detecting pose...';

  const { maxW, maxH } = getMaxDimensions();
  const scale = computeScale(img.naturalWidth, img.naturalHeight, maxW, maxH);
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);

  canvas.width = w;
  canvas.height = h;
  canvas.style.display = 'block';
  hideLoadingOverlay();

  ctx.drawImage(img, 0, 0, w, h);

  const poses = await detector.estimatePoses(canvas);

  if (!poses.length || !poses[0].keypoints.length) {
    if (statusEl) statusEl.textContent = 'No pose detected. Try a clearer photo.';
    return;
  }

  const keypoints = poses[0].keypoints;
  drawSkeleton(ctx, keypoints);
  drawKeypoints(ctx, keypoints);

  if (statusEl) statusEl.textContent = 'Pose detected';
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
if (uploadInput2) uploadInput2.addEventListener('change', handleFileInput);
if (cameraInput) cameraInput.addEventListener('change', handleFileInput);
cameraToggle.addEventListener('click', handleCameraToggle);
resetBtn.addEventListener('click', handleReset);

if (clearSessionBtn) {
  clearSessionBtn.addEventListener('click', () => {
    sessionLog.reset();
    renderedLogCount = 0;
    sessionEntriesEl.innerHTML = '';
    sessionSummaryEl.textContent = '';
    sessionLogEl.style.display = 'none';
  });
}

exerciseBtns.forEach(btn => {
  btn.addEventListener('click', () => selectExercise(btn.dataset.exercise));
});

// Mode selector expand/collapse
modeTrigger.addEventListener('click', () => {
  modeSelector.classList.toggle('open');
});

document.addEventListener('click', (e) => {
  if (!modeSelector.contains(e.target)) {
    modeSelector.classList.remove('open');
  }
});

// --- Auth UI logic ---

authUI.init({
  async onSignIn(user) {
    if (clearSessionBtn) clearSessionBtn.style.display = 'inline';
    sessionLog.setDb(db);
    await sessionLog.pushLocalToRemote();
    await sessionLog.syncFromRemote();
    renderedLogCount = 0;
    sessionEntriesEl.innerHTML = '';
    renderSessionLog();
  },
  onSignOut() {
    if (clearSessionBtn) clearSessionBtn.style.display = 'none';
    sessionLog.setDb(null);
  },
});

// Initialize — auto-start camera and auto mode
async function init() {
  // Render any previously persisted session entries
  renderSessionLog();

  // Init profile panel
  initProfilePanel(authUI);

  // Show auth UI if Supabase is configured
  if (isSupabaseConfigured() && authSection) {
    authSection.classList.remove('hidden');
    onAuthStateChange(async (user) => {
      authUI.updateAuthUI(user);
      if (clearSessionBtn) clearSessionBtn.style.display = user ? 'inline' : 'none';
      if (user) {
        sessionLog.setDb(db);
        await sessionLog.syncFromRemote();
        renderedLogCount = 0;
        sessionEntriesEl.innerHTML = '';
        renderSessionLog();
      } else {
        sessionLog.setDb(null);
      }
    });
  }

  try {
    statusEl.textContent = 'Loading model...';
    detector = await createDetector();
    statusEl.textContent = 'Loading classifier...';
    poseClassifier = await createPoseClassifier();

    // Expose for onboarding overlay button
    window._startCamera = handleStartCamera;

    // Normal tracker flow — always start camera on tracker tab
    await handleStartCamera();
    selectExercise('auto');

    // Initialize Murph UI (shares tracker camera during exercises phase)
    initMurphUI();
  } catch (err) {
    showFallbackControls(`Error: ${err.message}`);
    console.error('Init error:', err);
  }
}

init();
