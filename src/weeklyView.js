// Weekly View — redesigned with expanding day cards, Garmin comparison, workout modifier
import {
  getWeekWorkoutsByWeekNumber,
  getWorkoutLogsForSeason,
  getThisWeekWorkouts,
  getSeasonWorkouts,
  getLocalToday,
  toLocalDateStr,
} from './seasonData.js';
import { getSupabaseClient } from './supabase.js';
import { initWorkoutModifier, destroyWorkoutModifier } from './workoutModifier.js';
import { TRIGGER_LABELS } from './adaptationFeed.js';

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
  const today = getLocalToday();

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

  // Fetch Garmin activities + metrics for the week date range
  const garminActivities = await fetchGarminActivitiesForWeek(workouts);
  const metricsMap = await fetchActivityMetricsMap(garminActivities);

  // Get plan phases
  const plan = season.plan_json || {};
  const phase = getCurrentPhase(plan, displayWeek);

  renderWeek(container, {
    workouts,
    logMap,
    garminActivities,
    metricsMap,
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

  const today = getLocalToday();
  const workouts = await getWeekWorkoutsByWeekNumber(season.id, weekNumber);
  const logs = await getWorkoutLogsForSeason(season.id);
  const logMap = new Map(logs.map(l => [l.workout_id, l]));
  const garminActivities = await fetchGarminActivitiesForWeek(workouts);
  const metricsMap = await fetchActivityMetricsMap(garminActivities);
  const plan = season.plan_json || {};
  const phase = getCurrentPhase(plan, weekNumber);

  renderWeek(container, {
    workouts,
    logMap,
    garminActivities,
    metricsMap,
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
  const { workouts, logMap, garminActivities, metricsMap, season, seasonState, displayWeek, phase, today, onWeekChange } = ctx;

  // Ensure today always has a card, even if no workout exists in the DB
  const workoutsWithToday = ensureTodayIncluded(workouts, today, season, displayWeek);

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
  for (const workout of workoutsWithToday) {
    const log = logMap.get(workout.id);
    const garminMatch = findGarminMatch(garminActivities, workout);
    const dayState = getDayState(workout.date, today);

    const dayEl = createDayCard(workout, log, garminMatch, dayState, ctx);
    daysContainer.appendChild(dayEl);
  }
}

/** Ensure today always appears in the week's workout list, inserting a rest-day placeholder if needed */
function ensureTodayIncluded(workouts, today, season, displayWeek) {
  // Only inject if today falls within the displayed week's date range
  if (!workouts.length) {
    // No workouts at all — check if today belongs to this week via season dates
    const startDate = new Date(season.start_date + 'T00:00:00');
    const daysSinceStart = Math.floor((new Date(today + 'T00:00:00') - startDate) / (1000 * 60 * 60 * 24));
    const todayWeek = Math.floor(daysSinceStart / 7) + 1;
    if (todayWeek !== displayWeek) return workouts;
  } else {
    // Check if today falls within the date range of existing workouts for this week
    const minDate = workouts[0].date;
    const maxDate = workouts[workouts.length - 1].date;
    // Compute the Monday-Sunday range that covers the existing workouts
    const mondayOfWeek = new Date(minDate + 'T00:00:00');
    const dayOfWeek = mondayOfWeek.getDay();
    mondayOfWeek.setDate(mondayOfWeek.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const sundayOfWeek = new Date(mondayOfWeek);
    sundayOfWeek.setDate(mondayOfWeek.getDate() + 6);
    const mondayStr = toLocalDateStr(mondayOfWeek);
    const sundayStr = toLocalDateStr(sundayOfWeek);
    if (today < mondayStr || today > sundayStr) return workouts;
  }

  // Check if today already has a workout
  if (workouts.some(w => w.date === today)) return workouts;

  // Insert a synthetic rest-day placeholder for today
  const restPlaceholder = {
    id: `rest-placeholder-${today}`,
    date: today,
    workout_type: 'rest',
    title: 'Rest Day',
    intensity: 'low',
    duration_minutes: 0,
    is_adapted: false,
    prescription_json: { description: 'Scheduled rest day — recover and recharge.' },
    week_number: displayWeek,
    season_id: season.id,
    _isPlaceholder: true,
  };

  const merged = [...workouts, restPlaceholder].sort((a, b) => a.date.localeCompare(b.date));
  return merged;
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
        ${workout.is_adapted ? `<span class="wv-adapted-badge">adapted</span>${workout.adaptation_trigger ? `<span class="wv-trigger-tag">${esc(TRIGGER_LABELS[workout.adaptation_trigger] || '')}</span>` : ''}` : ''}
        ${renderLogBadge(log, dayState)}
      </div>
      <div class="wv-day-chevron">${dayState === 'future' ? '\u25B6' : '\u25BC'}</div>
    </div>
  `;

  // Expanded content (varies by day state)
  let expandedHtml = '';
  if (dayState === 'past') {
    expandedHtml = renderPastDayContent(workout, log, garminMatch, rx, exercises, ctx.metricsMap);
  } else if (dayState === 'today') {
    expandedHtml = renderTodayContent(workout, log, garminMatch, rx, exercises, ctx.metricsMap);
  } else {
    // Future days: show prescription preview when expanded
    expandedHtml = renderFutureContent(workout, rx, exercises);
  }

  el.innerHTML = `
    ${headerHtml}
    <div class="wv-day-body ${dayState === 'future' ? 'collapsed' : ''}" id="wvBody-${workout.id}">
      ${expandedHtml}
    </div>
  `;

  // Toggle expand/collapse for all day states
  const header = el.querySelector('.wv-day-header');
  const body = el.querySelector('.wv-day-body');
  header.style.cursor = 'pointer';
  header.addEventListener('click', () => {
    body.classList.toggle('collapsed');
    const chevron = header.querySelector('.wv-day-chevron');
    if (chevron) chevron.textContent = body.classList.contains('collapsed') ? '\u25B6' : '\u25BC';
  });

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

function renderPastDayContent(workout, log, garminMatch, rx, exercises, metricsMap) {
  const prescribedHtml = renderPrescription(rx, exercises);

  let actualHtml = '';
  if (garminMatch) {
    actualHtml = renderGarminActivity(garminMatch, workout, metricsMap?.get(garminMatch.activity_id));
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

  // Build a human-readable narrative for the match
  const narrative = buildMatchNarrative(matchStatus, workout, log, garminMatch);

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
    ${narrative ? `<div class="wv-match-narrative wv-narrative-${matchStatus}">${esc(narrative)}</div>` : ''}
  `;
}

// ── Today Content ───────────────────────────────────────────

function renderTodayContent(workout, log, garminMatch, rx, exercises, metricsMap) {
  const prescribedHtml = renderPrescription(rx, exercises);

  let actualSection = '';
  if (garminMatch) {
    actualSection = `
      <div class="wv-today-actual">
        <div class="wv-col-label">Completed Activity</div>
        ${renderGarminActivity(garminMatch, workout, metricsMap?.get(garminMatch.activity_id))}
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

// ── Future Day Content (preview) ─────────────────────────────

function renderFutureContent(workout, rx, exercises) {
  const prescribedHtml = renderPrescription(rx, exercises);

  return `
    <div class="wv-future-preview">
      <div class="wv-col-label">Preview</div>
      ${prescribedHtml}
    </div>
  `;
}

// ── Match Narrative ─────────────────────────────────────────

function buildMatchNarrative(matchStatus, workout, log, garminMatch) {
  if (matchStatus === 'matched' && log && log.adherence_score != null) {
    const score = Math.round(log.adherence_score);
    if (score >= 90) return `Completed as prescribed — ${score}% adherence.`;
    if (score >= 70) return `Mostly followed the plan — ${score}% adherence.`;
    return `Completed with modifications — ${score}% adherence.`;
  }

  if (matchStatus === 'matched' && garminMatch) {
    const durMin = garminMatch.duration_seconds ? Math.round(garminMatch.duration_seconds / 60) : null;
    const prescribed = workout.duration_minutes;
    if (durMin && prescribed && Math.abs(durMin - prescribed) <= 5) {
      return `${garminMatch.name || garminMatch.activity_type} matches the plan.`;
    }
    if (durMin && prescribed) {
      return `${garminMatch.name || garminMatch.activity_type} — ${durMin} min vs. ${prescribed} min prescribed.`;
    }
    return `Verified via Garmin activity.`;
  }

  if (matchStatus === 'substituted' && garminMatch) {
    return `Did ${garminMatch.name || garminMatch.activity_type} instead of ${workout.workout_type} — still counts.`;
  }

  if (matchStatus === 'partial') {
    return 'Partially completed — some exercises modified or skipped.';
  }

  if (matchStatus === 'missed') {
    return 'No activity recorded for this day.';
  }

  return '';
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

function renderGarminActivity(activity, workout, metrics) {
  const durMin = activity.duration_seconds ? Math.round(activity.duration_seconds / 60) : '--';
  const distKm = activity.distance_meters ? (activity.distance_meters / 1000).toFixed(1) : null;
  const matched = isTypeMatch(workout.workout_type, activity.activity_type);

  // Workout quality badge from activity_metrics
  let qualityBadge = '';
  if (metrics) {
    const cls = metrics.workout_classification;
    const details = typeof metrics.classification_details === 'string'
      ? JSON.parse(metrics.classification_details) : metrics.classification_details;
    const zones = details?.zones || {};
    const primaryZone = Object.entries(zones)
      .sort(([, a], [, b]) => b - a)[0];
    if (cls) {
      const zoneLabel = primaryZone ? ` / Zone ${primaryZone[0].replace('z', '')}` : '';
      qualityBadge = `<span class="wv-quality-badge">${cls}${zoneLabel}</span>`;
    }
  }

  return `
    <div class="wv-garmin-activity ${matched ? 'matched' : 'substituted'}">
      <div class="wv-garmin-name">${esc(activity.name || activity.activity_type)}${qualityBadge}</div>
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

async function fetchActivityMetricsMap(garminActivities) {
  if (!garminActivities.length) return new Map();

  const client = getSupabaseClient();
  if (!client) return new Map();

  const ids = garminActivities.map(a => a.activity_id).filter(Boolean);
  if (!ids.length) return new Map();

  try {
    const { data, error } = await client
      .from('activity_metrics')
      .select('activity_id, workout_classification, classification_details')
      .in('activity_id', ids);

    if (error) throw error;
    return new Map((data || []).map(m => [m.activity_id, m]));
  } catch (err) {
    // Table may not exist if migration not applied
    console.warn('Activity metrics fetch skipped:', err.message);
    return new Map();
  }
}

function findGarminMatch(activities, workout) {
  // Find the best match: prefer type-matched activities, then fall back to same-date
  const sameDateActivities = activities.filter(a => a.date === workout.date);
  if (!sameDateActivities.length) return null;

  // Try to find a type-matched activity first
  const typeMatch = sameDateActivities.find(a => isTypeMatch(workout.workout_type, a.activity_type));
  if (typeMatch) return typeMatch;

  // Fall back to any activity on that date
  return sameDateActivities[0];
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
