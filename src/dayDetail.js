// Day detail panel — drill down into a specific workout day
import { renderWorkoutConfirmation } from './workoutLogger.js';
import {
  findMatchingGarminActivity,
  swapWorkout,
  getThisWeekWorkouts,
} from './seasonData.js';

// ── DOM refs ────────────────────────────────────────────────

const backdrop = document.getElementById('dayDetailBackdrop');
const titleEl = document.getElementById('dayDetailTitle');
const dateEl = document.getElementById('dayDetailDate');
const contentEl = document.getElementById('dayDetailContent');
const closeBtn = document.getElementById('dayDetailClose');

if (closeBtn) closeBtn.addEventListener('click', close);
if (backdrop) backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

// ── Public API ──────────────────────────────────────────────

export function close() {
  backdrop?.classList.remove('visible');
}

export async function open(workout, { normalizePrescription, esc, activeSeason, viewCache, loadView, currentView }) {
  if (!workout || !backdrop) return;

  titleEl.textContent = workout.title || workout.workout_type;
  dateEl.textContent = `${workout.date} · ${workout.intensity || 'moderate'} intensity · ${workout.duration_minutes || '--'} min`;
  backdrop.classList.add('visible');

  const rx = normalizePrescription(workout.prescription_json);
  const isCardio = workout.workout_type === 'cardio';

  let html = '';

  // Garmin auto-detect for cardio (Approach A: detect then confirm)
  if (isCardio) {
    try {
      const garminMatch = await findMatchingGarminActivity(workout.workout_type, workout.date);
      if (garminMatch) {
        const durMin = garminMatch.duration_seconds ? Math.round(garminMatch.duration_seconds / 60) : '--';
        html += `
          <div class="garmin-auto-detect">
            <span class="garmin-auto-detect-icon">\u{1F4F1}</span>
            <div class="garmin-auto-detect-info">
              <strong>Completed (verified via Garmin)</strong><br>
              ${esc(garminMatch.name || garminMatch.activity_type)} \u00B7 ${durMin} min
              ${garminMatch.avg_heart_rate ? ` \u00B7 ${garminMatch.avg_heart_rate} avg HR` : ''}
            </div>
          </div>
        `;
      }
    } catch { /* ignore */ }
  }

  // Prescription details
  if (rx.warmup && rx.warmup.activities && rx.warmup.activities.length) {
    html += `<div class="phase-section"><div class="phase-label">Warmup</div><div class="phase-items">${rx.warmup.duration_minutes || 5} min \u2014 ${rx.warmup.activities.map(esc).join(', ')}</div></div>`;
  }

  const exercises = rx.main_workout || [];
  if (exercises.length) {
    html += `<table class="exercise-table"><thead><tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th></tr></thead><tbody>`;
    html += exercises.map(ex => `
      <tr>
        <td>${esc(ex.exercise)}${ex.notes ? `<span class="exercise-notes">${esc(ex.notes)}</span>` : ''}</td>
        <td>${ex.sets || '--'}</td>
        <td>${esc(String(ex.reps || '--'))}</td>
        <td>${ex.rest_seconds ? `${ex.rest_seconds}s` : '--'}</td>
      </tr>
    `).join('');
    html += `</tbody></table>`;
  }

  if (rx.cooldown && rx.cooldown.activities && rx.cooldown.activities.length) {
    html += `<div class="phase-section" style="margin-top:12px"><div class="phase-label">Cooldown</div><div class="phase-items">${rx.cooldown.duration_minutes || 5} min \u2014 ${rx.cooldown.activities.map(esc).join(', ')}</div></div>`;
  }

  // Workout logger
  html += '<div id="dayDetailLogger"></div>';

  // Swap workout button
  html += `
    <div class="day-detail-swap">
      <button class="btn-secondary" id="swapWorkoutBtn">Swap workout type</button>
      <div id="swapWorkoutPanel" style="display:none"></div>
    </div>
  `;

  contentEl.innerHTML = html;

  // Render workout logger
  const loggerEl = document.getElementById('dayDetailLogger');
  if (loggerEl) renderWorkoutConfirmation(loggerEl, workout);

  // Swap button
  const swapBtn = document.getElementById('swapWorkoutBtn');
  const swapPanel = document.getElementById('swapWorkoutPanel');
  if (swapBtn && swapPanel) {
    swapBtn.addEventListener('click', () => {
      swapPanel.style.display = swapPanel.style.display === 'none' ? '' : 'none';
      if (swapPanel.style.display !== 'none') {
        renderSwapUI(swapPanel, workout, { esc, activeSeason, viewCache, loadView, currentView });
      }
    });
  }
}

// ── Swap Workout ────────────────────────────────────────────

const SWAP_TYPES = [
  { type: 'strength', title: 'Strength Training', icon: '\u{1F4AA}', defaultDuration: 45 },
  { type: 'cardio', title: 'Cardio / Run', icon: '\u{1F3C3}', defaultDuration: 30 },
  { type: 'recovery', title: 'Recovery / Yoga', icon: '\u{1F9D8}', defaultDuration: 30 },
  { type: 'rest', title: 'Rest Day', icon: '\u{1F4A4}', defaultDuration: 0 },
];

function renderSwapUI(panelEl, workout, ctx) {
  const { esc } = ctx;
  const currentType = workout.workout_type;
  const otherTypes = SWAP_TYPES.filter(t => t.type !== currentType);

  panelEl.innerHTML = `
    <div style="margin-top:10px">
      <div style="font-size:0.72rem;color:var(--text-muted);font-weight:600;margin-bottom:8px">Replace "${esc(workout.title)}" with:</div>
      <div class="swap-options">
        ${otherTypes.map(t => `<button class="swap-option" data-type="${t.type}" data-title="${t.title}">${t.icon} ${t.title}</button>`).join('')}
      </div>
      <div id="swapPreview"></div>
    </div>
  `;

  panelEl.querySelectorAll('.swap-option').forEach(btn => {
    btn.addEventListener('click', () => {
      panelEl.querySelectorAll('.swap-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      showSwapPreview(panelEl.querySelector('#swapPreview'), workout, btn.dataset.type, btn.dataset.title, ctx);
    });
  });
}

async function showSwapPreview(previewEl, workout, newType, newTitle, ctx) {
  const { esc, activeSeason, viewCache, loadView, currentView } = ctx;
  const weekWorkouts = await getThisWeekWorkouts(activeSeason.id);
  const otherDays = weekWorkouts.filter(w => w.id !== workout.id && w.workout_type !== 'rest');
  const typeCounts = {};
  for (const w of otherDays) {
    typeCounts[w.workout_type] = (typeCounts[w.workout_type] || 0) + 1;
  }
  typeCounts[newType] = (typeCounts[newType] || 0) + 1;
  const weekSummary = Object.entries(typeCounts).map(([t, c]) => `${c}x ${t}`).join(', ');
  const swapInfo = SWAP_TYPES.find(t => t.type === newType);

  previewEl.innerHTML = `
    <div class="swap-preview">
      <div class="swap-preview-title">Week after swap</div>
      <div>${weekSummary}</div>
      <div style="margin-top:6px;font-size:0.72rem;color:var(--text-muted)">
        Today: ${esc(newTitle)} (${swapInfo?.defaultDuration || '--'} min)
      </div>
    </div>
    <div class="swap-confirm-actions">
      <button class="btn-primary" id="confirmSwapBtn">Confirm Swap</button>
      <button class="btn-ghost" id="cancelSwapBtn">Cancel</button>
    </div>
  `;

  document.getElementById('confirmSwapBtn').addEventListener('click', async () => {
    const btn = document.getElementById('confirmSwapBtn');
    btn.disabled = true;
    btn.textContent = 'Swapping...';
    try {
      const defaultRx = newType === 'rest'
        ? { description: 'Rest day' }
        : { description: `${newTitle} session`, exercises: [] };

      await swapWorkout(workout.id, newType, newTitle, defaultRx);

      delete viewCache['today'];
      delete viewCache['week'];
      close();
      loadView(currentView, true);
    } catch (err) {
      btn.textContent = `Error: ${err.message}`;
      btn.disabled = false;
    }
  });

  document.getElementById('cancelSwapBtn').addEventListener('click', () => {
    previewEl.innerHTML = '';
  });
}
