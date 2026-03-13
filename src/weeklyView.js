// Weekly View — redesigned with expanding day cards, Garmin comparison, workout modifier
import {
  getWeekWorkoutsByWeekNumber,
  getWorkoutLogsForSeason,
  getThisWeekWorkouts,
  getSeasonWorkouts,
} from './seasonData.js';
import { getSupabaseClient } from './supabase.js';
import { initWorkoutModifier, destroyWorkoutModifier } from './workoutModifier.js';

const TYPE_LABELS = {
  strength: 'STR',
  cardio: 'CRD',
  recovery: 'REC',
  mixed: 'MIX',
  rest: 'REST',
};

const DAY_NAMES_JS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT_JS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dayNameFromDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return DAY_NAMES_JS[d.getDay()];
}

function dayShortFromDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return DAY_SHORT_JS[d.getDay()];
}

// ── Public API ──────────────────────────────────────────────

export async function renderWeeklyView(container, { season, seasonState, onWeekChange }) {
  if (!container || !season || !seasonState) return;

  const weekNumber = seasonState.currentWeek;
  const today = new Date().toISOString().split('T')[0];

  // Fetch workouts for this week
  let workouts = await getThisWeekWorkouts(season.id);
  let displayWeek = weekNumber;

  if (!workouts.length) {
    workouts = await getSeasonWorkouts(season.id, 1);
    displayWeek = 1;
  }

  // Fetch workout logs
  const logs = await getWorkoutLogsForSeason(season.id);
  const logMap = new Map(logs.map(l => [l.workout_id, l]));

  // Fetch Garmin activities for the week date range
  const garminActivities = await fetchGarminActivitiesForWeek(workouts);

  // Get plan phases
  const plan = season.plan_json || {};
  const phase = getCurrentPhase(plan, displayWeek);

  renderWeek(container, {
    workouts,
    logMap,
    garminActivities,
    season,
    seasonState,
    displayWeek,
    phase,
    today,
    onWeekChange,
  });
}

export async function renderWeekByNumber(container, weekNumber, { season, seasonState, onWeekChange }) {
  if (!container || !season) return;

  const today = new Date().toISOString().split('T')[0];
  const workouts = await getWeekWorkoutsByWeekNumber(season.id, weekNumber);
  const logs = await getWorkoutLogsForSeason(season.id);
  const logMap = new Map(logs.map(l => [l.workout_id, l]));
  const garminActivities = await fetchGarminActivitiesForWeek(workouts);
  const plan = season.plan_json || {};
  const phase = getCurrentPhase(plan, weekNumber);

  renderWeek(container, {
    workouts,
    logMap,
    garminActivities,
    season,
    seasonState,
    displayWeek: weekNumber,
    phase,
    today,
    onWeekChange,
  });
}

// ── Render ──────────────────────────────────────────────────

function renderWeek(container, ctx) {
  const { workouts, logMap, garminActivities, season, seasonState, displayWeek, phase, today, onWeekChange } = ctx;

  // Adaptation banner
  const adaptBannerHtml = phase ? `
    <div class="wv-phase-banner">
      <span class="wv-phase-name">${esc(phase.name)}</span>
      ${phase.focus ? `<span class="wv-phase-focus">${esc(phase.focus)}</span>` : ''}
    </div>
  ` : '';

  // Week header with nav
  const canPrev = displayWeek > 1;
  const canNext = displayWeek < season.duration_weeks;

  container.innerHTML = `
    <div class="weekly-view">
      <div class="wv-header">
        <button class="wv-nav-btn" id="wvPrev" ${canPrev ? '' : 'disabled'}>\u2190</button>
        <div class="wv-header-center">
          <div class="wv-week-label">Week ${displayWeek} of ${season.duration_weeks}</div>
          ${adaptBannerHtml}
        </div>
        <button class="wv-nav-btn" id="wvNext" ${canNext ? '' : 'disabled'}>\u2192</button>
      </div>
      <div class="wv-days" id="wvDays"></div>
    </div>
  `;

  // Week nav
  const prevBtn = document.getElementById('wvPrev');
  const nextBtn = document.getElementById('wvNext');
  if (prevBtn) prevBtn.addEventListener('click', () => onWeekChange?.(displayWeek - 1));
  if (nextBtn) nextBtn.addEventListener('click', () => onWeekChange?.(displayWeek + 1));

  // Render day cards
  const daysContainer = document.getElementById('wvDays');
  for (const workout of workouts) {
    const log = logMap.get(workout.id);
    const garminMatch = findGarminMatch(garminActivities, workout);
    const dayState = getDayState(workout.date, today);

    const dayEl = createDayCard(workout, log, garminMatch, dayState, ctx);
    daysContainer.appendChild(dayEl);
  }
}

function getDayState(date, today) {
  if (date < today) return 'past';
  if (date === today) return 'today';
  return 'future';
}

function createDayCard(workout, log, garminMatch, dayState, ctx) {
  const el = document.createElement('div');
  el.className = `wv-day-card wv-day-${dayState}`;

  const rx = workout.prescription_json || {};
  const exercises = rx.exercises || rx.main_workout || [];
  const dayName = dayNameFromDate(workout.date);
  const dayShort = dayShortFromDate(workout.date);

  // Collapsed header (always visible)
  const headerHtml = `
    <div class="wv-day-header" data-workout-id="${workout.id}">
      <div class="wv-day-icon">${TYPE_LABELS[workout.workout_type] || '—'}</div>
      <div class="wv-day-info">
        <div class="wv-day-name">${esc(dayName)} <span class="wv-day-date">${esc(workout.date)}</span></div>
        <div class="wv-day-title">${esc(workout.title)}</div>
      </div>
      <div class="wv-day-meta">
        <span class="wv-intensity-badge ${workout.intensity}">${esc(workout.intensity)}</span>
        ${workout.duration_minutes ? `<span class="wv-day-dur">${workout.duration_minutes}m</span>` : ''}
        ${workout.is_adapted ? '<span class="wv-adapted-badge">adapted</span>' : ''}
        ${renderLogBadge(log, dayState)}
      </div>
      ${dayState !== 'future' ? '<div class="wv-day-chevron">\u25BC</div>' : ''}
    </div>
  `;

  // Expanded content (varies by day state)
  let expandedHtml = '';
  if (dayState === 'past') {
    expandedHtml = renderPastDayContent(workout, log, garminMatch, rx, exercises);
  } else if (dayState === 'today') {
    expandedHtml = renderTodayContent(workout, log, garminMatch, rx, exercises);
  }
  // future days: no expanded content

  el.innerHTML = `
    ${headerHtml}
    <div class="wv-day-body ${dayState === 'future' ? 'hidden' : ''}" id="wvBody-${workout.id}">
      ${expandedHtml}
    </div>
  `;

  // Toggle expand/collapse for past/today
  if (dayState !== 'future') {
    const header = el.querySelector('.wv-day-header');
    const body = el.querySelector('.wv-day-body');
    header.style.cursor = 'pointer';
    header.addEventListener('click', () => {
      body.classList.toggle('collapsed');
      const chevron = header.querySelector('.wv-day-chevron');
      if (chevron) chevron.textContent = body.classList.contains('collapsed') ? '\u25B6' : '\u25BC';
    });
  }

  // Initialize workout modifier for today
  if (dayState === 'today') {
    setTimeout(() => {
      const modContainer = el.querySelector(`#wvModifier-${workout.id}`);
      if (modContainer) {
        initWorkoutModifier(modContainer, workout, ctx.season, {
          onWorkoutUpdated: () => {
            // Refresh the view
            ctx.onWeekChange?.(ctx.displayWeek);
          },
        });
      }
    }, 0);
  }

  return el;
}

function renderLogBadge(log, dayState) {
  if (!log) {
    if (dayState === 'past') return '<span class="wv-log-badge missed">not logged</span>';
    return '';
  }
  const cls = log.status === 'completed' ? 'done' : log.status === 'skipped' ? 'skipped' : 'partial';
  const score = log.adherence_score != null ? ` ${Math.round(log.adherence_score)}%` : '';
  return `<span class="wv-log-badge ${cls}">${log.status}${score}</span>`;
}

// ── Past Day Content (side-by-side comparison) ──────────────

function renderPastDayContent(workout, log, garminMatch, rx, exercises) {
  const prescribedHtml = renderPrescription(rx, exercises);

  let actualHtml = '';
  if (garminMatch) {
    actualHtml = renderGarminActivity(garminMatch, workout);
  } else if (log) {
    actualHtml = renderLogSummary(log);
  } else {
    actualHtml = '<div class="wv-no-data">No activity recorded</div>';
  }

  // Determine match status
  let matchStatus = 'missed';
  if (garminMatch) {
    matchStatus = isTypeMatch(workout.workout_type, garminMatch.activity_type) ? 'matched' : 'substituted';
  } else if (log && log.status === 'completed') {
    matchStatus = 'matched';
  } else if (log && log.status !== 'skipped') {
    matchStatus = 'partial';
  }

  return `
    <div class="wv-comparison wv-match-${matchStatus}">
      <div class="wv-comparison-col">
        <div class="wv-col-label">Prescribed</div>
        ${prescribedHtml}
      </div>
      <div class="wv-comparison-divider">
        <div class="wv-match-indicator ${matchStatus}"></div>
      </div>
      <div class="wv-comparison-col">
        <div class="wv-col-label">Actual</div>
        ${actualHtml}
      </div>
    </div>
  `;
}

// ── Today Content ───────────────────────────────────────────

function renderTodayContent(workout, log, garminMatch, rx, exercises) {
  const prescribedHtml = renderPrescription(rx, exercises);

  let actualSection = '';
  if (garminMatch) {
    actualSection = `
      <div class="wv-today-actual">
        <div class="wv-col-label">Completed Activity</div>
        ${renderGarminActivity(garminMatch, workout)}
      </div>
    `;
  }

  return `
    <div class="wv-today-prescribed">
      ${prescribedHtml}
    </div>
    ${actualSection}
    <div class="wv-modifier-container" id="wvModifier-${workout.id}"></div>
  `;
}

// ── Shared Renderers ────────────────────────────────────────

function renderPrescription(rx, exercises) {
  let html = '';

  if (rx.description) {
    html += `<div class="wv-rx-desc">${esc(rx.description)}</div>`;
  }

  // Warmup
  const warmup = Array.isArray(rx.warmup) ? { activities: rx.warmup } : rx.warmup;
  if (warmup && warmup.activities && warmup.activities.length) {
    html += `<div class="wv-rx-phase"><span class="wv-rx-phase-label">Warmup</span> ${warmup.duration_minutes || 5}m \u2014 ${warmup.activities.map(esc).join(', ')}</div>`;
  }

  // Exercises
  if (exercises.length) {
    html += '<div class="wv-rx-exercises">';
    for (const ex of exercises) {
      html += `
        <div class="wv-rx-exercise">
          <span class="wv-rx-ex-name">${esc(ex.exercise)}</span>
          <span class="wv-rx-ex-detail">${ex.sets || '--'}x${ex.reps || '--'} ${ex.rest_seconds ? `(${ex.rest_seconds}s rest)` : ''}</span>
          ${ex.notes ? `<span class="wv-rx-ex-notes">${esc(ex.notes)}</span>` : ''}
        </div>
      `;
    }
    html += '</div>';
  }

  // Cooldown
  const cooldown = Array.isArray(rx.cooldown) ? { activities: rx.cooldown } : rx.cooldown;
  if (cooldown && cooldown.activities && cooldown.activities.length) {
    html += `<div class="wv-rx-phase"><span class="wv-rx-phase-label">Cooldown</span> ${cooldown.duration_minutes || 5}m \u2014 ${cooldown.activities.map(esc).join(', ')}</div>`;
  }

  return html || '<div class="wv-no-data">Rest day</div>';
}

function renderGarminActivity(activity, workout) {
  const durMin = activity.duration_seconds ? Math.round(activity.duration_seconds / 60) : '--';
  const distKm = activity.distance_meters ? (activity.distance_meters / 1000).toFixed(1) : null;
  const matched = isTypeMatch(workout.workout_type, activity.activity_type);

  return `
    <div class="wv-garmin-activity ${matched ? 'matched' : 'substituted'}">
      <div class="wv-garmin-name">${esc(activity.name || activity.activity_type)}</div>
      <div class="wv-garmin-stats">
        <span>${durMin} min</span>
        ${distKm ? `<span>${distKm} km</span>` : ''}
        ${activity.avg_heart_rate ? `<span>${activity.avg_heart_rate} avg HR</span>` : ''}
        ${activity.calories ? `<span>${activity.calories} cal</span>` : ''}
      </div>
      <div class="wv-garmin-match-label">${matched ? 'Matches plan' : 'Substituted'}</div>
    </div>
  `;
}

function renderLogSummary(log) {
  const statusLabels = { completed: 'Completed', partial: 'Partial', skipped: 'Skipped', substituted: 'Substituted' };
  return `
    <div class="wv-log-summary">
      <div class="wv-log-status">${statusLabels[log.status] || log.status}</div>
      ${log.adherence_score != null ? `<div class="wv-log-adherence">${Math.round(log.adherence_score)}% adherence</div>` : ''}
      ${log.notes ? `<div class="wv-log-notes">${esc(log.notes)}</div>` : ''}
    </div>
  `;
}

// ── Garmin Data Fetching ────────────────────────────────────

async function fetchGarminActivitiesForWeek(workouts) {
  if (!workouts.length) return [];

  const client = getSupabaseClient();
  if (!client) return [];

  const dates = workouts.map(w => w.date);
  const minDate = dates.reduce((a, b) => a < b ? a : b);
  const maxDate = dates.reduce((a, b) => a > b ? a : b);

  try {
    const { data, error } = await client
      .from('activities')
      .select('activity_id, activity_type, name, date, duration_seconds, distance_meters, calories, avg_heart_rate, max_heart_rate')
      .gte('date', minDate)
      .lte('date', maxDate)
      .order('date', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Garmin activities fetch error:', err);
    return [];
  }
}

function findGarminMatch(activities, workout) {
  return activities.find(a => a.date === workout.date) || null;
}

const GARMIN_TYPE_MAP = {
  strength: ['STRENGTH_TRAINING', 'INDOOR_CARDIO'],
  cardio: ['RUNNING', 'CYCLING', 'LAP_SWIMMING', 'ELLIPTICAL', 'STAIR_CLIMBING', 'TREADMILL_RUNNING', 'INDOOR_CYCLING'],
  recovery: ['YOGA', 'PILATES', 'BREATHWORK', 'WALKING'],
  mixed: ['RUNNING', 'CYCLING', 'STRENGTH_TRAINING', 'INDOOR_CARDIO'],
};

function isTypeMatch(workoutType, garminType) {
  if (workoutType === 'rest') return false;
  const matchTypes = GARMIN_TYPE_MAP[workoutType] || [];
  return matchTypes.some(t => garminType?.toUpperCase().includes(t));
}

// ── Helpers ─────────────────────────────────────────────────

function getCurrentPhase(plan, currentWeek) {
  const phases = plan.phases || [];
  for (const p of phases) {
    const weeks = p.weeks || [p.week];
    if (weeks.includes(currentWeek)) return p;
  }
  return phases[0] || null;
}

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
