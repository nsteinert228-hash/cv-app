// ═══════════════════════════════════════════════════
// Murph UI — Phase renders, uses shared tracker camera
// ═══════════════════════════════════════════════════
import { getMurphAttempt, PHASES, MURPH_TARGETS } from './murph.js';
import { MurphLeaderboard } from './murphLeaderboard.js';
import * as murphData from './murphData.js';

let _leaderboard = null;
let _lastPhase = null;

export function initMurphUI() {
  const murphPanel = document.getElementById('murphPanel');
  if (!murphPanel) return;

  const attempt = getMurphAttempt();

  // Register listener before restore so restore's _emit() is handled here
  attempt.onChange(state => {
    if (state.phase === _lastPhase) {
      _updateTimerDisplay(state);
      return;
    }
    renderMurphState(state);
  });

  // restore() calls _emit() which triggers onChange above
  const restored = attempt.restore();

  // Only render explicitly if nothing was restored (restore didn't emit)
  if (!restored) {
    renderMurphState(attempt.getState());
  }
}

async function renderMurphState(state) {
  const murphPanel = document.getElementById('murphPanel');
  if (!murphPanel) return;

  const phaseChanged = state.phase !== _lastPhase;
  if (!phaseChanged) return;
  _lastPhase = state.phase;

  // Only manage tracker visibility when Murph tab is actually active
  const isMurphTabActive = murphPanel.classList.contains('active');
  if (isMurphTabActive && state.phase !== PHASES.EXERCISES) {
    _hideTrackerForMurph();
  }

  switch (state.phase) {
    case PHASES.SETUP: renderSetup(murphPanel); break;
    case PHASES.MILE1: renderMile1(murphPanel, state); break;
    case PHASES.EXERCISES: renderExercises(murphPanel, state); break;
    case PHASES.MILE2: renderMile2(murphPanel, state); break;
    case PHASES.SUMMARY: renderSummary(murphPanel, state); break;
  }
}

// ═══ SETUP ═══════════════════════════════════════════

function renderSetup(container) {
  container.innerHTML = `
    <div class="murph-setup">
      <div class="murph-atmo">
        <div class="murph-atmo-orb murph-atmo-orb-1"></div>
        <div class="murph-atmo-orb murph-atmo-orb-2"></div>
        <div class="murph-grid-lines"></div>
      </div>

      <div class="murph-hero">
        <div class="murph-emblem">
          <svg viewBox="0 0 80 80" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="40" cy="40" r="36" stroke="var(--accent)" stroke-width="1" opacity="0.3"/>
            <circle cx="40" cy="40" r="32" stroke="var(--accent)" stroke-width="0.5" opacity="0.15"/>
            <path d="M40 12 L44.5 28 L62 28 L48 38 L53 55 L40 44 L27 55 L32 38 L18 28 L35.5 28 Z"
                  stroke="var(--accent)" stroke-width="1.5" fill="rgba(200,255,0,0.06)"/>
            <line x1="40" y1="4" x2="40" y2="14" stroke="var(--accent)" stroke-width="0.5" opacity="0.5"/>
            <line x1="40" y1="66" x2="40" y2="76" stroke="var(--accent)" stroke-width="0.5" opacity="0.5"/>
            <line x1="4" y1="40" x2="14" y2="40" stroke="var(--accent)" stroke-width="0.5" opacity="0.5"/>
            <line x1="66" y1="40" x2="76" y2="40" stroke="var(--accent)" stroke-width="0.5" opacity="0.5"/>
          </svg>
        </div>
        <div class="murph-hero-tag">HERO WOD</div>
        <h2 class="murph-title">THE MURPH</h2>
        <p class="murph-subtitle">In honor of Navy Lt. Michael P. Murphy</p>
      </div>

      <div class="murph-breakdown">
        <div class="murph-step"><div class="murph-step-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></div><div class="murph-step-content"><span class="murph-step-num">01</span><span class="murph-step-text">1-Mile Run</span></div><div class="murph-step-line"></div></div>
        <div class="murph-step"><div class="murph-step-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v10m0 0l-4-3m4 3l4-3M4 14h16v2a4 4 0 01-4 4H8a4 4 0 01-4-4v-2z"/></svg></div><div class="murph-step-content"><span class="murph-step-num">02</span><span class="murph-step-text">100 Pull-ups</span></div><div class="murph-step-line"></div></div>
        <div class="murph-step"><div class="murph-step-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg></div><div class="murph-step-content"><span class="murph-step-num">03</span><span class="murph-step-text">200 Push-ups</span></div><div class="murph-step-line"></div></div>
        <div class="murph-step"><div class="murph-step-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22V8m-4 6l4 4 4-4M4 4h16"/></svg></div><div class="murph-step-content"><span class="murph-step-num">04</span><span class="murph-step-text">300 Squats</span></div><div class="murph-step-line"></div></div>
        <div class="murph-step"><div class="murph-step-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></div><div class="murph-step-content"><span class="murph-step-num">05</span><span class="murph-step-text">1-Mile Run</span></div></div>
      </div>

      <div class="murph-reminders">
        <div class="murph-reminder"><div class="murph-reminder-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div><span>Garmin watch verifies your mile runs</span></div>
        <div class="murph-reminder"><div class="murph-reminder-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></div><span>AI camera tracks all bodyweight reps</span></div>
      </div>

      <button class="murph-start-btn" id="murphStartBtn">
        <span class="murph-start-btn-text">START MURPH</span>
        <span class="murph-start-btn-glow"></span>
      </button>

      <button class="murph-leaderboard-btn" id="murphShowLeaderboard">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>
        Leaderboard
      </button>
    </div>
  `;

  document.getElementById('murphStartBtn').addEventListener('click', () => {
    getMurphAttempt().start();
  });
  document.getElementById('murphShowLeaderboard').addEventListener('click', () => {
    showLeaderboardModal();
  });
}

// ═══ MILE 1 ══════════════════════════════════════════

function renderMile1(container, state) {
  container.innerHTML = `
    <div class="murph-phase-screen">
      <div class="murph-atmo">
        <div class="murph-atmo-orb murph-atmo-orb-1 pulse"></div>
        <div class="murph-atmo-orb murph-atmo-orb-3"></div>
      </div>

      <div class="murph-progress-strip">
        <div class="murph-progress-pip active"><span class="murph-pip-dot"></span><span class="murph-pip-label">Mile 1</span></div>
        <div class="murph-progress-connector"></div>
        <div class="murph-progress-pip"><span class="murph-pip-dot"></span><span class="murph-pip-label">Exercises</span></div>
        <div class="murph-progress-connector"></div>
        <div class="murph-progress-pip"><span class="murph-pip-dot"></span><span class="murph-pip-label">Mile 2</span></div>
      </div>

      <div class="murph-timer-block">
        <div class="murph-phase-tag">MILE 1</div>
        <div class="murph-timer" id="murphTimerDisplay">${formatTimer(state.elapsed)}</div>
        <div class="murph-timer-sub">GO RUN</div>
      </div>

      <div class="murph-pulse-visual">
        <div class="murph-pulse-circle c1"></div>
        <div class="murph-pulse-circle c2"></div>
        <div class="murph-pulse-circle c3"></div>
        <svg class="murph-run-icon" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="5" r="2.5"/><path d="M7 22l3-7 3 1 4-9M14 16l3 6M5 12l2.5 3"/>
        </svg>
      </div>

      <p class="murph-phase-hint">Start your Garmin watch and come back when done.</p>
      <button class="murph-action-btn" id="murphMile1Done">MILE 1 COMPLETE</button>
      <button class="murph-abandon-btn" id="murphAbandon">Abandon Attempt</button>
    </div>
  `;

  document.getElementById('murphMile1Done').addEventListener('click', () => {
    getMurphAttempt().completeMile1();
  });
  document.getElementById('murphAbandon').addEventListener('click', () => {
    if (confirm('Abandon this Murph attempt?')) getMurphAttempt().abandon();
  });
}

// ═══ EXERCISES ═══════════════════════════════════════

function renderExercises(container, state) {
  // The Murph exercises phase reuses the shared tracker camera.
  // Show the tracker panel (camera feed) and push it below the HUD.
  const trackerPanel = document.getElementById('trackerPanel');
  if (trackerPanel) trackerPanel.classList.remove('hidden');

  // Hide the tracker's own rep overlay — Murph HUD handles display
  const repOverlay = document.getElementById('repOverlay');
  if (repOverlay) repOverlay.style.display = 'none';

  const allDone = allTargetsMet(state.reps);
  container.innerHTML = `
    <div class="murph-exercises-hud" id="murphHUD">
      <div class="murph-hud-timer-row">
        <div class="murph-hud-timer">${formatTimer(state.elapsed)}</div>
      </div>
      <div class="murph-hud-wheels">
        ${renderRepWheel('PULL', state.reps.pullups, MURPH_TARGETS.pullups, 'pullups')}
        ${renderRepWheel('PUSH', state.reps.pushups, MURPH_TARGETS.pushups, 'pushups')}
        ${renderRepWheel('SQUAT', state.reps.squats, MURPH_TARGETS.squats, 'squats')}
      </div>
      <button class="murph-finish-pill ${allDone ? 'ready' : ''}" id="murphExercisesDone">
        ${allDone ? 'COMPLETE' : 'FINISH'}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>
  `;

  // Ensure tracker camera/detect loop is running
  if (window._resumeTracker) window._resumeTracker();

  document.getElementById('murphExercisesDone').addEventListener('click', () => {
    const reps = getMurphAttempt().getState().reps;
    if (!allTargetsMet(reps)) {
      const shortfall = buildShortfallText(reps);
      if (!confirm(`You're short: ${shortfall}. Continue anyway?`)) return;
    }
    getMurphAttempt().completeExercises();
  });
}

// Helper: hide tracker panel when leaving exercises phase
function _hideTrackerForMurph() {
  const trackerPanel = document.getElementById('trackerPanel');
  if (trackerPanel) trackerPanel.classList.add('hidden');
  if (window._pauseTracker) window._pauseTracker();
}

// ═══ MILE 2 ══════════════════════════════════════════

function renderMile2(container, state) {
  container.innerHTML = `
    <div class="murph-phase-screen">
      <div class="murph-atmo">
        <div class="murph-atmo-orb murph-atmo-orb-1 pulse"></div>
        <div class="murph-atmo-orb murph-atmo-orb-4"></div>
      </div>

      <div class="murph-progress-strip">
        <div class="murph-progress-pip done"><span class="murph-pip-dot"></span><span class="murph-pip-label">Mile 1</span></div>
        <div class="murph-progress-connector done"></div>
        <div class="murph-progress-pip done"><span class="murph-pip-dot"></span><span class="murph-pip-label">Exercises</span></div>
        <div class="murph-progress-connector"></div>
        <div class="murph-progress-pip active"><span class="murph-pip-dot"></span><span class="murph-pip-label">Mile 2</span></div>
      </div>

      <div class="murph-timer-block">
        <div class="murph-phase-tag murph-phase-tag-finish">FINAL MILE</div>
        <div class="murph-timer" id="murphTimerDisplay">${formatTimer(state.elapsed)}</div>
        <div class="murph-timer-sub">FINISH STRONG</div>
      </div>

      <div class="murph-reps-summary-strip">
        <div class="murph-reps-chip"><span class="chip-val">${state.reps.pullups}</span><span class="chip-label">Pull-ups</span></div>
        <div class="murph-reps-chip"><span class="chip-val">${state.reps.pushups}</span><span class="chip-label">Push-ups</span></div>
        <div class="murph-reps-chip"><span class="chip-val">${state.reps.squats}</span><span class="chip-label">Squats</span></div>
      </div>

      <div class="murph-pulse-visual">
        <div class="murph-pulse-circle c1"></div>
        <div class="murph-pulse-circle c2"></div>
        <svg class="murph-run-icon" viewBox="0 0 24 24" fill="none" stroke="var(--status-green)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="5" r="2.5"/><path d="M7 22l3-7 3 1 4-9M14 16l3 6M5 12l2.5 3"/>
        </svg>
      </div>

      <button class="murph-action-btn murph-finish" id="murphFinish">FINISH MURPH</button>
      <button class="murph-abandon-btn" id="murphAbandon">Abandon Attempt</button>
    </div>
  `;

  document.getElementById('murphFinish').addEventListener('click', () => {
    getMurphAttempt().finish();
  });
  document.getElementById('murphAbandon').addEventListener('click', () => {
    if (confirm('Abandon this Murph attempt?')) getMurphAttempt().abandon();
  });
}

// ═══ SUMMARY ═════════════════════════════════════════

async function renderSummary(container, state) {
  let attempt = null;
  try { attempt = await murphData.getAttempt(getMurphAttempt().attemptId); } catch {}
  const hasProfile = await checkProfile();
  const m1Verified = !!attempt?.mile1_garmin_activity_id;
  const m2Verified = !!attempt?.mile2_garmin_activity_id;

  container.innerHTML = `
    <div class="murph-summary">
      <div class="murph-atmo"><div class="murph-atmo-orb murph-atmo-orb-5"></div></div>

      <div class="murph-summary-header">
        <div class="murph-complete-badge">MURPH COMPLETE</div>
        <div class="murph-total-time">${formatTimer(state.elapsed)}</div>
        <div class="murph-total-label">Total Time</div>
      </div>

      <div class="murph-summary-grid">
        ${summaryCard('Mile 1', attempt?.mile1_time_seconds ? formatTimer(Math.round(attempt.mile1_time_seconds)) : '--:--', m1Verified ? 'verified' : 'pending', attempt?.mile1_avg_pace || '')}
        ${summaryCard('Pull-ups', `${state.reps.pullups}`, state.reps.pullups >= MURPH_TARGETS.pullups ? 'complete' : 'short', `/ ${MURPH_TARGETS.pullups}`)}
        ${summaryCard('Push-ups', `${state.reps.pushups}`, state.reps.pushups >= MURPH_TARGETS.pushups ? 'complete' : 'short', `/ ${MURPH_TARGETS.pushups}`)}
        ${summaryCard('Squats', `${state.reps.squats}`, state.reps.squats >= MURPH_TARGETS.squats ? 'complete' : 'short', `/ ${MURPH_TARGETS.squats}`)}
        ${summaryCard('Mile 2', attempt?.mile2_time_seconds ? formatTimer(Math.round(attempt.mile2_time_seconds)) : '--:--', m2Verified ? 'verified' : 'pending', attempt?.mile2_avg_pace || '')}
      </div>

      <div class="murph-summary-actions">
        ${!hasProfile ? `
          <div class="murph-profile-prompt">
            <label class="murph-profile-label">Display Name for Leaderboard</label>
            <input type="text" class="murph-profile-input" id="murphDisplayName" placeholder="e.g. Nick S." maxlength="30">
          </div>
        ` : ''}
        <button class="murph-submit-btn" id="murphSubmitLeaderboard">SUBMIT TO LEADERBOARD</button>
        <button class="murph-secondary-btn" id="murphSyncGarmin">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
          Sync Garmin & Retry
        </button>
        <button class="murph-secondary-btn" id="murphBackToSetup">Done</button>
      </div>
    </div>
  `;

  document.getElementById('murphSubmitLeaderboard').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'SUBMITTING...';
    try {
      const nameInput = document.getElementById('murphDisplayName');
      if (nameInput && nameInput.value.trim()) await murphData.upsertProfile(nameInput.value.trim());
      await getMurphAttempt().submitToLeaderboard();
      btn.textContent = 'SUBMITTED';
      btn.classList.add('submitted');
    } catch (err) {
      btn.textContent = 'FAILED — TAP TO RETRY';
      btn.disabled = false;
    }
  });

  document.getElementById('murphSyncGarmin').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Syncing...';
    try {
      await getMurphAttempt().retryMileMatch();
      renderSummary(container, state);
    } catch {
      btn.textContent = 'Sync failed — try later';
      btn.disabled = false;
    }
  });

  document.getElementById('murphBackToSetup').addEventListener('click', () => {
    const a = getMurphAttempt();
    a.phase = PHASES.SETUP;
    a.attemptId = null;
    a.startedAt = null;
    a.finishedAt = null;
    a.reps = { pullups: 0, pushups: 0, squats: 0 };
    a._segments = { pullups: [], pushups: [], squats: [] };
    _lastPhase = null;
    a._emit();
  });
}

function summaryCard(label, value, status, sub) {
  const statusClass = status === 'verified' ? 'verified' : status === 'complete' ? 'complete' : status === 'short' ? 'short' : 'pending';
  const statusText = status === 'verified' ? 'GARMIN VERIFIED' : status === 'complete' ? 'COMPLETE' : status === 'short' ? 'SHORT' : 'AWAITING SYNC';
  return `
    <div class="murph-summary-card ${statusClass}">
      <div class="murph-summary-card-label">${label}</div>
      <div class="murph-summary-card-value">${value}</div>
      ${sub ? `<div class="murph-summary-card-sub">${sub}</div>` : ''}
      <div class="murph-summary-card-status status-${statusClass}">${statusText}</div>
    </div>
  `;
}

// ═══ HELPERS ═════════════════════════════════════════

function formatTimer(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function _updateTimerDisplay(state) {
  if (state.phase === PHASES.EXERCISES) {
    updateMurphHUD(state);
    return;
  }
  const timerEl = document.getElementById('murphTimerDisplay');
  if (timerEl) timerEl.textContent = formatTimer(state.elapsed);
}

// SVG ring — full 360° circle, radius 42
const WHEEL_R = 42;
const WHEEL_CIRC = 2 * Math.PI * WHEEL_R;

function renderRepWheel(label, current, target, key) {
  const pct = Math.min(1, current / target);
  const offset = WHEEL_CIRC * (1 - pct);
  const done = current >= target;
  return `
    <div class="murph-wheel ${done ? 'done' : ''}" data-exercise="${key}">
      <svg viewBox="0 0 100 100" class="murph-wheel-svg">
        <circle class="murph-wheel-track" cx="50" cy="50" r="${WHEEL_R}" />
        <circle class="murph-wheel-fill" cx="50" cy="50" r="${WHEEL_R}"
          stroke-dasharray="${WHEEL_CIRC}" stroke-dashoffset="${offset}"
          transform="rotate(-90 50 50)" />
      </svg>
      <div class="murph-wheel-inner">
        <div class="murph-wheel-count">${current}</div>
        <div class="murph-wheel-target">/ ${target}</div>
      </div>
      <div class="murph-wheel-label">${label}</div>
    </div>
  `;
}

function allTargetsMet(reps) {
  return reps.pullups >= MURPH_TARGETS.pullups && reps.pushups >= MURPH_TARGETS.pushups && reps.squats >= MURPH_TARGETS.squats;
}

function totalProgress(reps) {
  const total = MURPH_TARGETS.pullups + MURPH_TARGETS.pushups + MURPH_TARGETS.squats;
  const done = Math.min(reps.pullups, MURPH_TARGETS.pullups) + Math.min(reps.pushups, MURPH_TARGETS.pushups) + Math.min(reps.squats, MURPH_TARGETS.squats);
  return Math.round((done / total) * 100);
}

function buildShortfallText(reps) {
  const parts = [];
  if (reps.pullups < MURPH_TARGETS.pullups) parts.push(`${MURPH_TARGETS.pullups - reps.pullups} pull-ups`);
  if (reps.pushups < MURPH_TARGETS.pushups) parts.push(`${MURPH_TARGETS.pushups - reps.pushups} push-ups`);
  if (reps.squats < MURPH_TARGETS.squats) parts.push(`${MURPH_TARGETS.squats - reps.squats} squats`);
  return parts.join(', ');
}

async function checkProfile() {
  try { return !!(await murphData.getProfile()); } catch { return false; }
}

function _showMilestoneFlash(exerciseName) {
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

// ═══ HUD UPDATE (per-second during exercises) ════════

export function updateMurphHUD(state) {
  const hud = document.getElementById('murphHUD');
  if (!hud) return;

  const timerEl = hud.querySelector('.murph-hud-timer');
  if (timerEl) timerEl.textContent = formatTimer(state.elapsed);

  const wheels = hud.querySelectorAll('.murph-wheel');
  const exercises = ['pullups', 'pushups', 'squats'];
  wheels.forEach((wheel, i) => {
    const key = exercises[i];
    if (!key) return;
    const current = state.reps[key];
    const target = MURPH_TARGETS[key];
    const pct = Math.min(1, current / target);
    const offset = WHEEL_CIRC * (1 - pct);
    const done = current >= target;
    const fill = wheel.querySelector('.murph-wheel-fill');
    const count = wheel.querySelector('.murph-wheel-count');
    if (fill) fill.style.strokeDashoffset = offset;
    if (count) count.textContent = current;
    wheel.classList.toggle('done', done);
  });

  const allDone = allTargetsMet(state.reps);
  const btn = document.getElementById('murphExercisesDone');
  if (btn) {
    btn.innerHTML = `${allDone ? 'COMPLETE' : 'FINISH'}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="9 18 15 12 9 6"/></svg>`;
    btn.classList.toggle('ready', allDone);
  }
}

// ═══ LEADERBOARD MODAL ═══════════════════════════════

async function showLeaderboardModal() {
  let modal = document.getElementById('murphLeaderboardModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'murphLeaderboardModal';
    modal.className = 'murph-modal-backdrop';
    modal.innerHTML = `
      <div class="murph-modal">
        <button class="murph-modal-close" id="murphModalClose">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div id="murphLeaderboardContainer"></div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('#murphModalClose').addEventListener('click', () => modal.classList.remove('open'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });
  }

  modal.classList.add('open');

  if (!_leaderboard) {
    const lbContainer = modal.querySelector('#murphLeaderboardContainer');
    _leaderboard = new MurphLeaderboard(lbContainer);
    try {
      const { getSupabaseClient } = await import('./supabase.js');
      const client = getSupabaseClient();
      if (client) {
        const { data: { session } } = await client.auth.getSession();
        await _leaderboard.init(session?.user?.id);
      }
    } catch { await _leaderboard.init(null); }
  } else {
    _leaderboard.refresh();
  }
}
