// ═══════════════════════════════════════════════════
// Murph UI — Cinematic renders with GSAP animations
// ═══════════════════════════════════════════════════
import { getMurphAttempt, PHASES, MURPH_TARGETS } from './murph.js';
import { MurphLeaderboard } from './murphLeaderboard.js';
import * as murphData from './murphData.js';
import { phaseTransition, staggerEntrance, pulseRing, glowBurst } from './interactions.js';

let _leaderboard = null;
let _onStartExercises = null;
let _onStopExercises = null;
let _lastPhase = null;

export function setMurphCallbacks({ onStartExercises, onStopExercises }) {
  _onStartExercises = onStartExercises;
  _onStopExercises = onStopExercises;
}

export function initMurphUI() {
  const murphPanel = document.getElementById('murphPanel');
  if (!murphPanel) return;

  const attempt = getMurphAttempt();
  attempt.restore();
  attempt.onChange(state => renderMurphState(state));
  renderMurphState(attempt.getState());
}

async function renderMurphState(state) {
  const murphPanel = document.getElementById('murphPanel');
  if (!murphPanel) return;

  // Skip re-render if phase hasn't changed (except exercises which update HUD)
  if (state.phase === _lastPhase && state.phase === PHASES.EXERCISES) return;

  const phaseChanged = state.phase !== _lastPhase;
  _lastPhase = state.phase;

  // Animate out if phase changed and content exists
  if (phaseChanged && murphPanel.children.length > 0 && state.phase !== PHASES.EXERCISES) {
    await phaseTransition(murphPanel.children[0], 'out').catch(() => {});
  }

  switch (state.phase) {
    case PHASES.SETUP: renderSetup(murphPanel); break;
    case PHASES.MILE1: renderMile1(murphPanel, state); break;
    case PHASES.EXERCISES: renderExercises(murphPanel, state); break;
    case PHASES.MILE2: renderMile2(murphPanel, state); break;
    case PHASES.SUMMARY: renderSummary(murphPanel, state); break;
  }

  // Animate in
  if (phaseChanged && murphPanel.children.length > 0 && state.phase !== PHASES.EXERCISES) {
    phaseTransition(murphPanel.children[0], 'in');
  }
}

// ═══ SETUP ═══════════════════════════════════════════

function renderSetup(container) {
  // Only hide camera if Murph panel is actually visible
  if (isMurphVisible()) hideCameraStage();

  container.innerHTML = `
    <div class="murph-setup">
      <!-- Atmospheric background -->
      <div class="murph-atmo">
        <div class="murph-atmo-orb murph-atmo-orb-1"></div>
        <div class="murph-atmo-orb murph-atmo-orb-2"></div>
        <div class="murph-grid-lines"></div>
      </div>

      <div class="murph-hero reveal">
        <div class="murph-emblem">
          <svg viewBox="0 0 80 80" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <!-- Outer ring -->
            <circle cx="40" cy="40" r="36" stroke="var(--accent)" stroke-width="1" opacity="0.3"/>
            <circle cx="40" cy="40" r="32" stroke="var(--accent)" stroke-width="0.5" opacity="0.15"/>
            <!-- Star -->
            <path d="M40 12 L44.5 28 L62 28 L48 38 L53 55 L40 44 L27 55 L32 38 L18 28 L35.5 28 Z"
                  stroke="var(--accent)" stroke-width="1.5" fill="rgba(200,255,0,0.06)"/>
            <!-- Crosshair -->
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

      <div class="murph-breakdown reveal">
        <div class="murph-step tilt-card" data-step="1">
          <div class="murph-step-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          </div>
          <div class="murph-step-content">
            <span class="murph-step-num">01</span>
            <span class="murph-step-text">1-Mile Run</span>
          </div>
          <div class="murph-step-line"></div>
        </div>
        <div class="murph-step tilt-card" data-step="2">
          <div class="murph-step-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v10m0 0l-4-3m4 3l4-3M4 14h16v2a4 4 0 01-4 4H8a4 4 0 01-4-4v-2z"/></svg>
          </div>
          <div class="murph-step-content">
            <span class="murph-step-num">02</span>
            <span class="murph-step-text">100 Pull-ups</span>
          </div>
          <div class="murph-step-line"></div>
        </div>
        <div class="murph-step tilt-card" data-step="3">
          <div class="murph-step-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
          </div>
          <div class="murph-step-content">
            <span class="murph-step-num">03</span>
            <span class="murph-step-text">200 Push-ups</span>
          </div>
          <div class="murph-step-line"></div>
        </div>
        <div class="murph-step tilt-card" data-step="4">
          <div class="murph-step-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22V8m-4 6l4 4 4-4M4 4h16"/></svg>
          </div>
          <div class="murph-step-content">
            <span class="murph-step-num">04</span>
            <span class="murph-step-text">300 Squats</span>
          </div>
          <div class="murph-step-line"></div>
        </div>
        <div class="murph-step tilt-card" data-step="5">
          <div class="murph-step-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          </div>
          <div class="murph-step-content">
            <span class="murph-step-num">05</span>
            <span class="murph-step-text">1-Mile Run</span>
          </div>
        </div>
      </div>

      <div class="murph-reminders reveal">
        <div class="murph-reminder">
          <div class="murph-reminder-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <span>Garmin watch verifies your mile runs</span>
        </div>
        <div class="murph-reminder">
          <div class="murph-reminder-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          </div>
          <span>AI camera tracks all bodyweight reps</span>
        </div>
      </div>

      <button class="murph-start-btn magnetic ripple" id="murphStartBtn">
        <span class="murph-start-btn-text">START MURPH</span>
        <span class="murph-start-btn-glow"></span>
      </button>

      <button class="murph-leaderboard-btn magnetic" id="murphShowLeaderboard">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>
        Leaderboard
      </button>
    </div>
  `;

  // GSAP stagger entrance for steps
  setTimeout(() => staggerEntrance('.murph-step', { y: 30, stagger: 0.1, delay: 0.2 }), 50);

  document.getElementById('murphStartBtn').addEventListener('click', () => {
    getMurphAttempt().start();
  });

  document.getElementById('murphShowLeaderboard').addEventListener('click', () => {
    showLeaderboardModal();
  });
}

// ═══ MILE 1 ══════════════════════════════════════════

function renderMile1(container, state) {
  if (isMurphVisible()) hideCameraStage();

  container.innerHTML = `
    <div class="murph-phase-screen">
      <div class="murph-atmo">
        <div class="murph-atmo-orb murph-atmo-orb-1 pulse"></div>
        <div class="murph-atmo-orb murph-atmo-orb-3"></div>
      </div>

      <div class="murph-progress-strip">
        <div class="murph-progress-pip active">
          <span class="murph-pip-dot"></span><span class="murph-pip-label">Mile 1</span>
        </div>
        <div class="murph-progress-connector"></div>
        <div class="murph-progress-pip">
          <span class="murph-pip-dot"></span><span class="murph-pip-label">Exercises</span>
        </div>
        <div class="murph-progress-connector"></div>
        <div class="murph-progress-pip">
          <span class="murph-pip-dot"></span><span class="murph-pip-label">Mile 2</span>
        </div>
      </div>

      <div class="murph-timer-block">
        <div class="murph-phase-tag">MILE 1</div>
        <div class="murph-timer" id="murphTimerDisplay">${formatTimer(state.elapsed)}</div>
        <div class="murph-timer-sub">GO RUN</div>
      </div>

      <div class="murph-pulse-visual" id="murphPulseVisual">
        <div class="murph-pulse-circle c1"></div>
        <div class="murph-pulse-circle c2"></div>
        <div class="murph-pulse-circle c3"></div>
        <svg class="murph-run-icon" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="5" r="2.5"/>
          <path d="M7 22l3-7 3 1 4-9M14 16l3 6M5 12l2.5 3"/>
        </svg>
      </div>

      <p class="murph-phase-hint">Start your Garmin watch and come back when done.</p>

      <button class="murph-action-btn magnetic ripple" id="murphMile1Done">MILE 1 COMPLETE</button>
      <button class="murph-abandon-btn" id="murphAbandon">Abandon Attempt</button>
    </div>
  `;

  // Animate pulse rings
  pulseRing('.murph-pulse-circle.c1');

  document.getElementById('murphMile1Done').addEventListener('click', () => {
    getMurphAttempt().completeMile1();
  });
  document.getElementById('murphAbandon').addEventListener('click', () => {
    if (confirm('Abandon this Murph attempt?')) getMurphAttempt().abandon();
  });
}

// ═══ EXERCISES ═══════════════════════════════════════

function renderExercises(container, state) {
  showCameraStage();
  if (_onStartExercises) _onStartExercises();

  container.innerHTML = `
    <div class="murph-exercises-hud" id="murphHUD">
      <div class="murph-hud-top">
        <div class="murph-hud-phase-tag">MURPH</div>
        <div class="murph-hud-timer">${formatTimer(state.elapsed)}</div>
        <div class="murph-hud-progress-pct" id="murphHudPct">${totalProgress(state.reps)}%</div>
      </div>
      <div class="murph-hud-reps">
        ${renderRepBar('Pull-ups', state.reps.pullups, MURPH_TARGETS.pullups, 'pullups')}
        ${renderRepBar('Push-ups', state.reps.pushups, MURPH_TARGETS.pushups, 'pushups')}
        ${renderRepBar('Squats', state.reps.squats, MURPH_TARGETS.squats, 'squats')}
      </div>
      <button class="murph-exercises-done-btn magnetic ripple" id="murphExercisesDone">
        ${allTargetsMet(state.reps) ? 'EXERCISES COMPLETE' : `FINISH EXERCISES`}
      </button>
    </div>
  `;

  document.getElementById('murphExercisesDone').addEventListener('click', () => {
    const reps = getMurphAttempt().getState().reps;
    if (!allTargetsMet(reps)) {
      const shortfall = buildShortfallText(reps);
      if (!confirm(`You're short: ${shortfall}. Continue anyway?`)) return;
    }
    if (_onStopExercises) _onStopExercises();
    getMurphAttempt().completeExercises();
  });
}

// ═══ MILE 2 ══════════════════════════════════════════

function renderMile2(container, state) {
  if (isMurphVisible()) hideCameraStage();
  if (_onStopExercises) _onStopExercises();

  container.innerHTML = `
    <div class="murph-phase-screen">
      <div class="murph-atmo">
        <div class="murph-atmo-orb murph-atmo-orb-1 pulse"></div>
        <div class="murph-atmo-orb murph-atmo-orb-4"></div>
      </div>

      <div class="murph-progress-strip">
        <div class="murph-progress-pip done">
          <span class="murph-pip-dot"></span><span class="murph-pip-label">Mile 1</span>
        </div>
        <div class="murph-progress-connector done"></div>
        <div class="murph-progress-pip done">
          <span class="murph-pip-dot"></span><span class="murph-pip-label">Exercises</span>
        </div>
        <div class="murph-progress-connector"></div>
        <div class="murph-progress-pip active">
          <span class="murph-pip-dot"></span><span class="murph-pip-label">Mile 2</span>
        </div>
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

      <div class="murph-pulse-visual" id="murphPulseVisual">
        <div class="murph-pulse-circle c1"></div>
        <div class="murph-pulse-circle c2"></div>
        <svg class="murph-run-icon" viewBox="0 0 24 24" fill="none" stroke="var(--status-green)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="5" r="2.5"/>
          <path d="M7 22l3-7 3 1 4-9M14 16l3 6M5 12l2.5 3"/>
        </svg>
      </div>

      <button class="murph-action-btn murph-finish magnetic ripple" id="murphFinish">FINISH MURPH</button>
      <button class="murph-abandon-btn" id="murphAbandon">Abandon Attempt</button>
    </div>
  `;

  pulseRing('.murph-pulse-circle.c1');

  document.getElementById('murphFinish').addEventListener('click', () => {
    glowBurst();
    getMurphAttempt().finish();
  });
  document.getElementById('murphAbandon').addEventListener('click', () => {
    if (confirm('Abandon this Murph attempt?')) getMurphAttempt().abandon();
  });
}

// ═══ SUMMARY ═════════════════════════════════════════

async function renderSummary(container, state) {
  if (isMurphVisible()) hideCameraStage();

  let attempt = null;
  try { attempt = await murphData.getAttempt(getMurphAttempt().attemptId); } catch {}
  const hasProfile = await checkProfile();

  const m1Verified = !!attempt?.mile1_garmin_activity_id;
  const m2Verified = !!attempt?.mile2_garmin_activity_id;

  container.innerHTML = `
    <div class="murph-summary">
      <div class="murph-atmo">
        <div class="murph-atmo-orb murph-atmo-orb-5"></div>
      </div>

      <div class="murph-summary-header reveal">
        <div class="murph-complete-badge">MURPH COMPLETE</div>
        <div class="murph-total-time" id="murphTotalTime">${formatTimer(state.elapsed)}</div>
        <div class="murph-total-label">Total Time</div>
      </div>

      <div class="murph-summary-grid">
        ${summaryCard('Mile 1', attempt?.mile1_time_seconds ? formatTimer(Math.round(attempt.mile1_time_seconds)) : '--:--', m1Verified ? 'verified' : 'pending', attempt?.mile1_avg_pace || '')}
        ${summaryCard('Pull-ups', `${state.reps.pullups}`, state.reps.pullups >= MURPH_TARGETS.pullups ? 'complete' : 'short', `/ ${MURPH_TARGETS.pullups}`)}
        ${summaryCard('Push-ups', `${state.reps.pushups}`, state.reps.pushups >= MURPH_TARGETS.pushups ? 'complete' : 'short', `/ ${MURPH_TARGETS.pushups}`)}
        ${summaryCard('Squats', `${state.reps.squats}`, state.reps.squats >= MURPH_TARGETS.squats ? 'complete' : 'short', `/ ${MURPH_TARGETS.squats}`)}
        ${summaryCard('Mile 2', attempt?.mile2_time_seconds ? formatTimer(Math.round(attempt.mile2_time_seconds)) : '--:--', m2Verified ? 'verified' : 'pending', attempt?.mile2_avg_pace || '')}
      </div>

      <div class="murph-summary-actions reveal">
        ${!hasProfile ? `
          <div class="murph-profile-prompt">
            <label class="murph-profile-label">Display Name for Leaderboard</label>
            <input type="text" class="murph-profile-input" id="murphDisplayName" placeholder="e.g. Nick S." maxlength="30">
          </div>
        ` : ''}
        <button class="murph-submit-btn magnetic ripple" id="murphSubmitLeaderboard">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>
          SUBMIT TO LEADERBOARD
        </button>
        <button class="murph-secondary-btn magnetic" id="murphSyncGarmin">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
          Sync Garmin & Retry
        </button>
        <button class="murph-secondary-btn" id="murphBackToSetup">Done</button>
      </div>
    </div>
  `;

  setTimeout(() => staggerEntrance('.murph-summary-card', { y: 20, stagger: 0.06, delay: 0.3 }), 50);

  document.getElementById('murphSubmitLeaderboard').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-spinner"></span> SUBMITTING...';
    try {
      const nameInput = document.getElementById('murphDisplayName');
      if (nameInput && nameInput.value.trim()) {
        await murphData.upsertProfile(nameInput.value.trim());
      }
      await getMurphAttempt().submitToLeaderboard();
      btn.innerHTML = 'SUBMITTED';
      btn.classList.add('submitted');
    } catch (err) {
      btn.innerHTML = 'FAILED — TAP TO RETRY';
      btn.disabled = false;
      console.error('Submit failed:', err);
    }
  });

  document.getElementById('murphSyncGarmin').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-spinner"></span> Syncing...';
    try {
      await getMurphAttempt().retryMileMatch();
      renderSummary(container, state);
    } catch {
      btn.innerHTML = 'Sync failed — try later';
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
  const statusClass = status === 'verified' ? 'verified'
    : status === 'complete' ? 'complete'
    : status === 'short' ? 'short'
    : 'pending';
  const statusText = status === 'verified' ? 'GARMIN VERIFIED'
    : status === 'complete' ? 'COMPLETE'
    : status === 'short' ? 'SHORT'
    : 'AWAITING SYNC';

  return `
    <div class="murph-summary-card tilt-card ${statusClass}">
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

function renderRepBar(label, current, target, key) {
  const pct = Math.min(100, Math.round((current / target) * 100));
  const done = current >= target;
  return `
    <div class="murph-rep-row ${done ? 'done' : ''}" data-exercise="${key}">
      <span class="murph-rep-label">${label}</span>
      <div class="murph-rep-bar">
        <div class="murph-rep-fill" style="width:${pct}%"></div>
        <div class="murph-rep-glow" style="width:${pct}%"></div>
      </div>
      <span class="murph-rep-count">${current}<span class="murph-rep-target">/${target}</span></span>
    </div>
  `;
}

function allTargetsMet(reps) {
  return reps.pullups >= MURPH_TARGETS.pullups
    && reps.pushups >= MURPH_TARGETS.pushups
    && reps.squats >= MURPH_TARGETS.squats;
}

function totalProgress(reps) {
  const total = MURPH_TARGETS.pullups + MURPH_TARGETS.pushups + MURPH_TARGETS.squats;
  const done = Math.min(reps.pullups, MURPH_TARGETS.pullups)
    + Math.min(reps.pushups, MURPH_TARGETS.pushups)
    + Math.min(reps.squats, MURPH_TARGETS.squats);
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

function isMurphVisible() {
  const panel = document.getElementById('murphPanel');
  return panel && panel.classList.contains('active');
}

function hideCameraStage() {
  const stage = document.getElementById('cameraStage');
  if (stage) stage.classList.remove('active');
  // Restore hidden tracker elements
  const trackerPanel = document.getElementById('trackerPanel');
  if (trackerPanel) {
    trackerPanel.querySelectorAll('[data-murph-hidden]').forEach(el => {
      el.style.display = el.dataset.murphHidden || '';
      delete el.dataset.murphHidden;
    });
    // Re-hide tracker panel if Murph is active
    if (isMurphVisible()) trackerPanel.classList.add('hidden');
  }
}

function showCameraStage() {
  // Un-hide the tracker panel so the camera stage inside it is visible
  const trackerPanel = document.getElementById('trackerPanel');
  if (trackerPanel) {
    trackerPanel.classList.remove('hidden');
    // Hide non-camera tracker elements during Murph exercises
    trackerPanel.querySelectorAll('.onboarding-overlay, .movements-panel, .session-log, .training-callout').forEach(el => {
      el.dataset.murphHidden = el.style.display || '';
      el.style.display = 'none';
    });
  }
  const stage = document.getElementById('cameraStage');
  if (stage) stage.classList.add('active');
  // Hide onboarding if visible
  const onboarding = document.getElementById('onboardingOverlay');
  if (onboarding) onboarding.classList.add('hidden');
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

  // Animate modal in
  if (window.gsap) {
    gsap.from(modal.querySelector('.murph-modal'), { y: 60, opacity: 0, duration: 0.4, ease: 'power3.out' });
  }

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

// ═══ HUD UPDATE (per frame during exercises) ═════════

export function updateMurphHUD(state) {
  const hud = document.getElementById('murphHUD');
  if (!hud) return;

  const timerEl = hud.querySelector('.murph-hud-timer');
  if (timerEl) timerEl.textContent = formatTimer(state.elapsed);

  const pctEl = document.getElementById('murphHudPct');
  if (pctEl) pctEl.textContent = totalProgress(state.reps) + '%';

  const rows = hud.querySelectorAll('.murph-rep-row');
  const exercises = ['pullups', 'pushups', 'squats'];
  rows.forEach((row, i) => {
    const key = exercises[i];
    if (!key) return;
    const current = state.reps[key];
    const target = MURPH_TARGETS[key];
    const pct = Math.min(100, Math.round((current / target) * 100));
    const fill = row.querySelector('.murph-rep-fill');
    const glow = row.querySelector('.murph-rep-glow');
    const count = row.querySelector('.murph-rep-count');
    if (fill) fill.style.width = pct + '%';
    if (glow) glow.style.width = pct + '%';
    if (count) count.innerHTML = `${current}<span class="murph-rep-target">/${target}</span>`;
    row.classList.toggle('done', current >= target);
  });

  const btn = document.getElementById('murphExercisesDone');
  if (btn) {
    btn.textContent = allTargetsMet(state.reps) ? 'EXERCISES COMPLETE' : 'FINISH EXERCISES';
  }
}
