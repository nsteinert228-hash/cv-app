// Workout confirmation UI — logging actual performance against prescriptions
import {
  submitWorkoutLog,
  getWorkoutLog,
  findMatchingGarminActivity,
  getSeasonById,
} from './seasonData.js';

// ── Render workout confirmation panel ────────────────────────

/**
 * Renders the workout confirmation UI inside a container element.
 * For strength: checkboxes per exercise with editable sets/reps.
 * For cardio: Garmin auto-match or manual entry.
 */
export async function renderWorkoutConfirmation(containerEl, workout) {
  const existingLog = await getWorkoutLog(workout.id);

  if (existingLog) {
    renderLoggedStatus(containerEl, workout, existingLog);
    return;
  }

  const prescription = workout.prescription_json || {};
  const isCardio = workout.workout_type === 'cardio';

  // Resolve weight_unit from the parent season
  if (workout.season_id && !workout.weight_unit) {
    try {
      const season = await getSeasonById(workout.season_id);
      if (season?.weight_unit) workout.weight_unit = season.weight_unit;
    } catch { /* fall back to default 'lbs' */ }
  }

  if (isCardio) {
    await renderCardioConfirmation(containerEl, workout, prescription);
  } else {
    renderStrengthConfirmation(containerEl, workout, prescription);
  }
}

// ── Strength confirmation ────────────────────────────────────

function renderStrengthConfirmation(containerEl, workout, prescription) {
  const exercises = prescription.exercises || prescription.main_workout || [];
  const weightUnit = workout.weight_unit || 'lbs';

  const html = `
    <div class="workout-logger">
      <h4 class="logger-title">Log Your Workout</h4>
      <div class="logger-exercises">
        ${exercises.map((ex, i) => `
          <div class="logger-row" data-index="${i}">
            <label class="logger-check">
              <input type="checkbox" checked data-exercise="${i}">
              <span class="exercise-name">${esc(ex.exercise)}</span>
            </label>
            <div class="logger-fields">
              <label>Sets <input type="number" class="logger-input" data-field="sets" value="${ex.sets || 0}" min="0"></label>
              <label>Reps <input type="text" class="logger-input" data-field="reps" value="${esc(String(ex.reps || ''))}" size="6"></label>
              <label>Weight <input type="number" class="logger-input logger-weight-input" data-field="weight" value="${ex.weight || ''}" min="0" step="2.5" placeholder="—">${esc(weightUnit)}</label>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="logger-rpe">
        <label class="rpe-label">
          <span>Session RPE</span>
          <span class="rpe-value" id="rpeDisplay">5</span>
        </label>
        <input type="range" class="rpe-slider" id="rpeSlider" min="1" max="10" value="5" step="1">
        <div class="rpe-descriptors">
          <span>Easy</span><span>Moderate</span><span>Hard</span><span>Max</span>
        </div>
      </div>
      <div class="logger-notes">
        <textarea placeholder="Notes (optional)" class="logger-notes-input" rows="2"></textarea>
      </div>
      <div class="logger-actions">
        <button class="btn-primary logger-complete-btn">Complete as Prescribed</button>
        <button class="btn-secondary logger-log-btn">Log with Changes</button>
        <button class="btn-ghost logger-skip-btn">Skip Today</button>
      </div>
      <div class="logger-status"></div>
    </div>
  `;

  containerEl.innerHTML = html;

  // RPE slider live display
  const rpeSlider = containerEl.querySelector('#rpeSlider');
  const rpeDisplay = containerEl.querySelector('#rpeDisplay');
  if (rpeSlider && rpeDisplay) {
    rpeSlider.addEventListener('input', () => {
      rpeDisplay.textContent = rpeSlider.value;
    });
  }

  // "Complete as prescribed" — submit exactly as shown
  containerEl.querySelector('.logger-complete-btn').addEventListener('click', async () => {
    await submitLog(containerEl, workout, prescription, 'completed', true);
  });

  // "Log with changes" — submit user-edited values
  containerEl.querySelector('.logger-log-btn').addEventListener('click', async () => {
    await submitLog(containerEl, workout, prescription, 'completed', false);
  });

  // "Skip" — mark as skipped
  containerEl.querySelector('.logger-skip-btn').addEventListener('click', async () => {
    await submitLog(containerEl, workout, prescription, 'skipped', false);
  });
}

async function submitLog(containerEl, workout, prescription, status, asPrescribed) {
  const statusEl = containerEl.querySelector('.logger-status');
  statusEl.textContent = 'Saving...';
  statusEl.className = 'logger-status saving';

  try {
    const actualJson = asPrescribed
      ? buildPrescribedActual(prescription)
      : buildEditedActual(containerEl, prescription);

    const notes = containerEl.querySelector('.logger-notes-input')?.value?.trim() || null;
    const rpeSlider = containerEl.querySelector('#rpeSlider');
    const rpe = rpeSlider ? parseInt(rpeSlider.value, 10) : null;
    if (rpe !== null && !isNaN(rpe)) actualJson.rpe = rpe;

    const result = await submitWorkoutLog(workout.id, status, actualJson, null, notes);
    renderLoggedStatus(containerEl, workout, {
      status,
      adherence_score: result.adherence_score,
      actual_json: actualJson,
      notes,
    });
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.className = 'logger-status error';
  }
}

function buildPrescribedActual(prescription) {
  const exercises = (prescription.exercises || prescription.main_workout || []).map(ex => {
    const entry = {
      exercise: ex.exercise,
      sets_completed: ex.sets || 0,
      reps: ex.reps,
      completed: true,
    };
    if (ex.weight != null) entry.weight = ex.weight;
    return entry;
  });
  return { exercises };
}

function buildEditedActual(containerEl, prescription) {
  const rows = containerEl.querySelectorAll('.logger-row');
  const exercises = [];

  rows.forEach((row, i) => {
    const checked = row.querySelector('input[type="checkbox"]').checked;
    const setsInput = row.querySelector('[data-field="sets"]');
    const repsInput = row.querySelector('[data-field="reps"]');
    const weightInput = row.querySelector('[data-field="weight"]');
    const original = (prescription.exercises || prescription.main_workout || [])[i] || {};

    const entry = {
      exercise: original.exercise || `Exercise ${i + 1}`,
      sets_completed: checked ? parseInt(setsInput?.value || '0', 10) : 0,
      reps: repsInput?.value || original.reps || '0',
      completed: checked,
    };
    const w = parseFloat(weightInput?.value);
    if (!isNaN(w) && w > 0) entry.weight = w;
    exercises.push(entry);
  });

  return { exercises };
}

// ── Cardio confirmation ──────────────────────────────────────

async function renderCardioConfirmation(containerEl, workout, prescription) {
  const garminMatch = await findMatchingGarminActivity(workout.workout_type, workout.date);

  const html = `
    <div class="workout-logger">
      <h4 class="logger-title">Log Your Workout</h4>
      ${garminMatch ? `
        <div class="garmin-match">
          <div class="garmin-match-header">Garmin Activity Detected</div>
          <div class="garmin-match-detail">
            <span>${esc(garminMatch.name || garminMatch.activity_type)}</span>
            <span>${garminMatch.duration_seconds ? Math.round(garminMatch.duration_seconds / 60) + ' min' : ''}</span>
            ${garminMatch.distance_meters ? `<span>${(garminMatch.distance_meters / 1000).toFixed(1)} km</span>` : ''}
            ${garminMatch.avg_heart_rate ? `<span>${garminMatch.avg_heart_rate} avg HR</span>` : ''}
          </div>
          <button class="btn-primary logger-confirm-garmin">Confirm Garmin Activity</button>
        </div>
      ` : `
        <div class="garmin-match-none">No matching Garmin activity found for today</div>
      `}
      <div class="logger-manual-cardio">
        <label>Duration (min) <input type="number" class="logger-input" id="cardioDuration" value="${prescription.main_workout?.[0]?.reps || 30}" min="0"></label>
        <label>Notes <input type="text" class="logger-input" id="cardioNotes" placeholder="e.g. Zone 2, felt good"></label>
      </div>
      <div class="logger-actions">
        <button class="btn-secondary logger-manual-btn">Log Manually</button>
        <button class="btn-ghost logger-skip-btn">Skip Today</button>
      </div>
      <div class="logger-status"></div>
    </div>
  `;

  containerEl.innerHTML = html;

  // Garmin confirm
  const garminBtn = containerEl.querySelector('.logger-confirm-garmin');
  if (garminBtn && garminMatch) {
    garminBtn.addEventListener('click', async () => {
      const statusEl = containerEl.querySelector('.logger-status');
      statusEl.textContent = 'Saving...';
      try {
        const result = await submitWorkoutLog(
          workout.id, 'completed',
          { source_activity: garminMatch, duration_minutes: Math.round((garminMatch.duration_seconds || 0) / 60) },
          garminMatch.activity_id, null,
        );
        renderLoggedStatus(containerEl, workout, {
          status: 'completed',
          adherence_score: result.adherence_score,
          actual_json: { source_activity: garminMatch },
          source: 'garmin_confirmed',
        });
      } catch (err) {
        statusEl.textContent = `Error: ${err.message}`;
        statusEl.className = 'logger-status error';
      }
    });
  }

  // Manual
  containerEl.querySelector('.logger-manual-btn').addEventListener('click', async () => {
    const statusEl = containerEl.querySelector('.logger-status');
    statusEl.textContent = 'Saving...';
    try {
      const duration = parseInt(containerEl.querySelector('#cardioDuration')?.value || '0', 10);
      const notes = containerEl.querySelector('#cardioNotes')?.value?.trim() || null;
      const result = await submitWorkoutLog(workout.id, 'completed', { duration_minutes: duration }, null, notes);
      renderLoggedStatus(containerEl, workout, {
        status: 'completed',
        adherence_score: result.adherence_score,
        actual_json: { duration_minutes: duration },
        notes,
      });
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
      statusEl.className = 'logger-status error';
    }
  });

  // Skip
  containerEl.querySelector('.logger-skip-btn').addEventListener('click', async () => {
    const statusEl = containerEl.querySelector('.logger-status');
    statusEl.textContent = 'Saving...';
    try {
      await submitWorkoutLog(workout.id, 'skipped', {});
      renderLoggedStatus(containerEl, workout, { status: 'skipped', adherence_score: 0 });
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
      statusEl.className = 'logger-status error';
    }
  });
}

// ── Logged status display ────────────────────────────────────

function renderLoggedStatus(containerEl, workout, log) {
  const statusColor = {
    completed: 'logged-complete',
    partial: 'logged-partial',
    skipped: 'logged-skipped',
    substituted: 'logged-partial',
  };

  containerEl.innerHTML = `
    <div class="workout-logged ${statusColor[log.status] || ''}">
      <div class="logged-header">
        <span class="logged-badge">${log.status === 'completed' ? 'Completed' : log.status === 'skipped' ? 'Skipped' : 'Partial'}</span>
        ${log.adherence_score != null ? `<span class="logged-adherence">${Math.round(log.adherence_score)}% adherence</span>` : ''}
      </div>
      ${log.notes ? `<div class="logged-notes">${esc(log.notes)}</div>` : ''}
      ${log.source === 'garmin_confirmed' ? '<div class="logged-source">Verified via Garmin</div>' : ''}
    </div>
  `;
}

// ── Utility ──────────────────────────────────────────────────

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
