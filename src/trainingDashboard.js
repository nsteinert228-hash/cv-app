// Training AI Dashboard — season-based training with workout logging
import { isSupabaseConfigured } from './supabase.js';
import { createAuthUI } from './authUI.js';
import {
  getTrainingRecommendation,
  getTodayReadiness,
  getRecentWorkouts,
  getTrainingPreferences,
  saveTrainingPreferences,
} from './trainingData.js';
import {
  initSeason,
  startNewSeason,
  finishSeason,
  checkAdaptations,
  getSeasonState,
} from './seasonManager.js';
import {
  getTodayWorkout,
  getThisWeekWorkouts,
  getSeasonWorkouts,
  getWorkoutLog,
  getWorkoutLogsForSeason,
} from './seasonData.js';
import { renderWorkoutConfirmation } from './workoutLogger.js';
import { renderAdaptationFeed } from './adaptationFeed.js';

// ── DOM refs ─────────────────────────────────────────────────

const dashboardContent = document.getElementById('dashboardContent');
const emptyState = document.getElementById('emptyState');

const aiLoading = document.getElementById('aiLoading');
const aiError = document.getElementById('aiError');
const aiErrorMsg = document.getElementById('aiErrorMsg');
const aiRetryBtn = document.getElementById('aiRetryBtn');

const controlsBar = document.getElementById('controlsBar');
const generatedAtEl = document.getElementById('generatedAt');
const regenBtn = document.getElementById('regenBtn');
const disclaimer = document.getElementById('disclaimer');

const prefsToggle = document.getElementById('prefsToggle');
const prefsPanel = document.getElementById('prefsPanel');
const prefGoals = document.getElementById('prefGoals');
const prefExperience = document.getElementById('prefExperience');
const prefInjuries = document.getElementById('prefInjuries');
const prefsSaveStatus = document.getElementById('prefsSaveStatus');

const quickStatsCard = document.getElementById('quickStatsCard');
const quickStats = document.getElementById('quickStats');

const seasonBanner = document.getElementById('seasonBanner');
const seasonNameEl = document.getElementById('seasonName');
const seasonProgressEl = document.getElementById('seasonProgress');
const seasonProgressFill = document.getElementById('seasonProgressFill');
const seasonAdherenceEl = document.getElementById('seasonAdherence');
const adaptationFeedEl = document.getElementById('adaptationFeed');

const seasonModal = document.getElementById('seasonModal');
const seasonModalTitle = document.getElementById('seasonModalTitle');
const seasonModalText = document.getElementById('seasonModalText');
const seasonModalActions = document.getElementById('seasonModalActions');

// ── State ────────────────────────────────────────────────────

let currentView = 'today';
let currentUser = null;
let activeSeason = null;
let seasonState = null;
const viewCache = {};
let preferences = {};
let prefSaveTimer = null;

// ── Auth ─────────────────────────────────────────────────────

const authUI = createAuthUI();
authUI.init({
  onSignIn() { refreshDashboard(); },
  onSignOut() {
    currentUser = null;
    activeSeason = null;
    seasonState = null;
    Object.keys(viewCache).forEach(k => delete viewCache[k]);
    refreshDashboard();
  },
});

// ── Preferences ──────────────────────────────────────────────

prefsToggle.addEventListener('click', () => {
  prefsPanel.classList.toggle('visible');
});

function getPrefsFromUI() {
  return {
    goals: prefGoals.value || undefined,
    experience: prefExperience.value || undefined,
    injuries: prefInjuries.value.trim() || undefined,
  };
}

function setPrefsUI(prefs) {
  prefGoals.value = prefs.goals || '';
  prefExperience.value = prefs.experience || '';
  prefInjuries.value = prefs.injuries || '';
}

function onPrefChange() {
  preferences = getPrefsFromUI();
  Object.keys(viewCache).forEach(k => delete viewCache[k]);

  clearTimeout(prefSaveTimer);
  prefsSaveStatus.textContent = 'Saving...';
  prefSaveTimer = setTimeout(async () => {
    try {
      await saveTrainingPreferences(preferences);
      prefsSaveStatus.textContent = 'Saved';
      setTimeout(() => { prefsSaveStatus.textContent = ''; }, 2000);
    } catch (err) {
      prefsSaveStatus.textContent = 'Save failed';
      console.error('Prefs save error:', err);
    }
  }, 800);
}

prefGoals.addEventListener('change', onPrefChange);
prefExperience.addEventListener('change', onPrefChange);
prefInjuries.addEventListener('input', onPrefChange);

// ── View Toggle ──────────────────────────────────────────────

document.querySelectorAll('.view-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    if (view === currentView) return;

    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentView = view;
    loadView(view);
  });
});

// ── Regenerate ───────────────────────────────────────────────

regenBtn.addEventListener('click', () => {
  delete viewCache[currentView];
  if (activeSeason && currentView !== 'plan') {
    checkAdaptations(true).then(() => loadView(currentView));
  } else {
    loadView(currentView, true);
  }
});

aiRetryBtn.addEventListener('click', () => { loadView(currentView); });

// ── Main refresh ─────────────────────────────────────────────

async function refreshDashboard() {
  try {
    const { getUser } = await import('./auth.js');
    currentUser = await getUser();
  } catch { currentUser = null; }

  if (!currentUser) {
    dashboardContent.classList.remove('visible');
    emptyState.style.display = '';
    seasonBanner.classList.remove('visible');
    return;
  }

  emptyState.style.display = 'none';
  dashboardContent.classList.add('visible');

  const [prefs] = await Promise.all([
    getTrainingPreferences().catch(() => ({})),
    loadReadinessHero(),
    loadQuickStats(),
  ]);

  preferences = prefs;
  setPrefsUI(prefs);

  // Initialize season
  await loadSeasonState();
}

// ── Season Lifecycle ─────────────────────────────────────────

async function loadSeasonState() {
  try {
    const result = await initSeason();
    activeSeason = result.season;
    seasonState = result.state;

    if (result.needsCreation) {
      showSeasonCreationPrompt();
      return;
    }

    if (result.isExpired) {
      showSeasonCompletionPrompt();
      return;
    }

    // Active season — render banner and load view
    renderSeasonBanner();
    renderAdaptationFeed(adaptationFeedEl, activeSeason.id);
    checkAdaptations().catch(() => {}); // background
    loadView(currentView);
  } catch (err) {
    console.error('Season init error:', err);
    // Fall back to stateless mode
    activeSeason = null;
    seasonState = null;
    seasonBanner.classList.remove('visible');
    loadView(currentView);
  }
}

function showSeasonCreationPrompt() {
  seasonModalTitle.textContent = 'Start Your Training Season';
  seasonModalText.textContent = 'Ready to start your 8-week personalized training season? We\'ll analyze your health data and create a progressive plan tailored to your goals.';
  seasonModalActions.innerHTML = `
    <button class="btn-primary" id="seasonStartBtn">Start Season</button>
    <button class="btn-ghost" id="seasonSkipBtn">Use without a season</button>
  `;
  seasonModal.classList.add('visible');

  document.getElementById('seasonStartBtn').addEventListener('click', async () => {
    seasonModalText.textContent = 'Creating your training season... This may take a moment.';
    seasonModalActions.innerHTML = '<div class="ai-loading-icon" style="animation:pulse-ai 1.5s infinite">&#129504;</div>';
    try {
      await startNewSeason();
      seasonModal.classList.remove('visible');
      await loadSeasonState();
    } catch (err) {
      seasonModalText.textContent = `Failed to create season: ${err.message}`;
      seasonModalActions.innerHTML = `
        <button class="btn-primary" id="seasonRetryBtn">Retry</button>
        <button class="btn-ghost" id="seasonSkipBtn2">Skip</button>
      `;
      document.getElementById('seasonRetryBtn').addEventListener('click', () => {
        showSeasonCreationPrompt();
      });
      document.getElementById('seasonSkipBtn2').addEventListener('click', () => {
        seasonModal.classList.remove('visible');
        loadView(currentView);
      });
    }
  });

  document.getElementById('seasonSkipBtn').addEventListener('click', () => {
    seasonModal.classList.remove('visible');
    loadView(currentView);
  });
}

function showSeasonCompletionPrompt() {
  seasonModalTitle.textContent = 'Season Complete!';
  seasonModalText.textContent = `Your "${activeSeason.name}" season has ended. Review your results and start a new season.`;
  seasonModalActions.innerHTML = `
    <button class="btn-primary" id="seasonCompleteBtn">Complete & Review</button>
    <button class="btn-secondary" id="seasonNewBtn">Start New Season</button>
  `;
  seasonModal.classList.add('visible');

  document.getElementById('seasonCompleteBtn').addEventListener('click', async () => {
    seasonModalText.textContent = 'Generating your season review...';
    seasonModalActions.innerHTML = '<div class="ai-loading-icon" style="animation:pulse-ai 1.5s infinite">&#129504;</div>';
    try {
      const prevId = activeSeason.id;
      const result = await finishSeason();
      seasonModal.classList.remove('visible');
      // Could render a review screen here in the future
      showNewSeasonPrompt(prevId);
    } catch (err) {
      seasonModalText.textContent = `Error: ${err.message}`;
      seasonModalActions.innerHTML = '<button class="btn-ghost" onclick="this.closest(\'.season-modal\').classList.remove(\'visible\')">Close</button>';
    }
  });

  document.getElementById('seasonNewBtn').addEventListener('click', async () => {
    const prevId = activeSeason.id;
    seasonModalText.textContent = 'Completing current season...';
    seasonModalActions.innerHTML = '<div class="ai-loading-icon" style="animation:pulse-ai 1.5s infinite">&#129504;</div>';
    try {
      await finishSeason();
      seasonModal.classList.remove('visible');
      showNewSeasonPrompt(prevId);
    } catch (err) {
      seasonModalText.textContent = `Error: ${err.message}`;
    }
  });
}

function showNewSeasonPrompt(previousSeasonId) {
  seasonModalTitle.textContent = 'Start Next Season';
  seasonModalText.textContent = 'Your new season will build on your previous progress.';
  seasonModalActions.innerHTML = `
    <button class="btn-primary" id="seasonNextBtn">Start Season</button>
  `;
  seasonModal.classList.add('visible');

  document.getElementById('seasonNextBtn').addEventListener('click', async () => {
    seasonModalText.textContent = 'Creating your next training season...';
    seasonModalActions.innerHTML = '<div class="ai-loading-icon" style="animation:pulse-ai 1.5s infinite">&#129504;</div>';
    try {
      await startNewSeason(previousSeasonId);
      seasonModal.classList.remove('visible');
      await loadSeasonState();
    } catch (err) {
      seasonModalText.textContent = `Failed: ${err.message}`;
      seasonModalActions.innerHTML = '<button class="btn-ghost" onclick="this.closest(\'.season-modal\').classList.remove(\'visible\')">Close</button>';
    }
  });
}

async function renderSeasonBanner() {
  if (!activeSeason || !seasonState) {
    seasonBanner.classList.remove('visible');
    return;
  }

  const plan = activeSeason.plan_json || {};
  const phase = getCurrentPhase(plan, seasonState.currentWeek);
  const phaseLabel = phase ? ` · ${phase.name}` : '';

  seasonNameEl.textContent = activeSeason.name;
  seasonProgressEl.textContent = `Week ${seasonState.currentWeek} of ${activeSeason.duration_weeks}${phaseLabel} · ${seasonState.daysRemaining} days left`;
  seasonProgressFill.style.width = `${seasonState.progressPct}%`;
  seasonBanner.classList.add('visible');

  // Load adherence stats asynchronously
  try {
    const logs = await getWorkoutLogsForSeason(activeSeason.id);
    if (logs.length > 0) {
      const completed = logs.filter(l => l.status === 'completed').length;
      const avgAdherence = logs.reduce((s, l) => s + (l.adherence_score || 0), 0) / logs.length;
      seasonAdherenceEl.textContent = `${completed} logged · ${Math.round(avgAdherence)}% adherence`;
    }
  } catch { /* silent */ }
}

// ── Readiness Hero Bar ───────────────────────────────────────

async function loadReadinessHero() {
  try {
    const r = await getTodayReadiness();
    document.getElementById('heroSleep').textContent = r.sleep_score ?? '--';
    document.getElementById('heroBB').textContent = r.body_battery ?? '--';
    document.getElementById('heroHRV').textContent = r.hrv_value ?? '--';
    document.getElementById('heroStress').textContent = r.stress_avg ?? '--';

    const badge = document.getElementById('heroHRVBadge');
    if (r.hrv_status) {
      badge.textContent = r.hrv_status;
      badge.style.display = '';
      badge.className = 'hm-badge';
      const cls = r.hrv_status.toLowerCase();
      if (cls === 'balanced') badge.classList.add('badge-green');
      else if (cls === 'low' || cls === 'unbalanced') badge.classList.add('badge-yellow');
      else if (cls === 'high') badge.classList.add('badge-blue');
      else badge.classList.add('badge-green');
    }
  } catch (err) {
    console.error('Readiness hero error:', err);
  }
}

// ── Quick Stats Footer ───────────────────────────────────────

async function loadQuickStats() {
  try {
    const workouts = await getRecentWorkouts(7);
    if (!workouts.length) { quickStatsCard.style.display = 'none'; return; }

    const totals = {};
    for (const w of workouts) {
      totals[w.exercise] = (totals[w.exercise] || 0) + w.total_reps;
    }

    quickStats.innerHTML = Object.entries(totals).map(([ex, count]) =>
      `<div class="qs-item"><div class="qs-val">${count}</div><div class="qs-label">${ex}</div></div>`
    ).join('');
    quickStatsCard.style.display = '';
  } catch (err) {
    console.error('Quick stats error:', err);
    quickStatsCard.style.display = 'none';
  }
}

// ── View Loading ─────────────────────────────────────────────

const CACHE_TTL = 5 * 60 * 1000;

async function loadView(view, force = false) {
  if (!force && viewCache[view] && (Date.now() - viewCache[view].fetchedAt) < CACHE_TTL) {
    renderView(view, viewCache[view].data);
    return;
  }

  showLoading();

  try {
    if (activeSeason) {
      await loadSeasonView(view);
    } else {
      // Fallback: stateless mode
      const data = await getTrainingRecommendation(view, preferences, force);
      viewCache[view] = { data, fetchedAt: Date.now() };
      renderView(view, data);
    }
  } catch (err) {
    console.error('View load error:', err);
    hideAllContent();
    aiErrorMsg.textContent = err.message || 'Something went wrong. Please try again.';
    aiError.classList.add('visible');
  }
}

function normalizePrescription(rx) {
  if (!rx) return { warmup: null, main_workout: [], cooldown: null };

  // Handle warmup: array of strings → { activities: [...] }
  const warmup = Array.isArray(rx.warmup)
    ? { duration_minutes: 5, activities: rx.warmup }
    : rx.warmup || null;

  // Handle exercises vs main_workout
  const main_workout = rx.exercises || rx.main_workout || [];

  // Handle cooldown: array of strings → { activities: [...] }
  const cooldown = Array.isArray(rx.cooldown)
    ? { duration_minutes: 5, activities: rx.cooldown }
    : rx.cooldown || null;

  return { warmup, main_workout, cooldown };
}

function computeWeekStats(workouts) {
  const activeDays = workouts.filter(w => w.workout_type !== 'rest').length;
  const totalMin = workouts.reduce((s, w) => s + (w.duration_minutes || 0), 0);
  const typeCounts = {};
  for (const w of workouts) {
    if (w.workout_type !== 'rest') {
      typeCounts[w.workout_type] = (typeCounts[w.workout_type] || 0) + 1;
    }
  }
  return { activeDays, totalMin, typeCounts };
}

function getCurrentPhase(plan, currentWeek) {
  const phases = plan.phases || [];
  for (const p of phases) {
    const weeks = p.weeks || [p.week];
    if (weeks.includes(currentWeek)) return p;
  }
  return phases[0] || null;
}

async function loadSeasonView(view) {
  if (view === 'today') {
    const workout = await getTodayWorkout(activeSeason.id);
    if (!workout) {
      const data = await getTrainingRecommendation(view, preferences);
      viewCache[view] = { data, fetchedAt: Date.now() };
      renderView(view, data);
      return;
    }

    const rx = normalizePrescription(workout.prescription_json);
    const plan = activeSeason.plan_json || {};
    const phase = getCurrentPhase(plan, seasonState.currentWeek);

    const data = {
      view: 'today',
      _from_season: true,
      _workout: workout,
      readiness_assessment: {
        level: workout.intensity === 'rest' ? 'low' : workout.intensity === 'high' ? 'high' : 'moderate',
        summary: phase ? `${phase.name} phase — ${phase.focus || ''}` : '',
        key_factors: phase ? [`Week ${seasonState.currentWeek}`, phase.intensity_range || ''].filter(Boolean) : [],
      },
      recommendation: {
        type: workout.workout_type,
        title: workout.title,
        intensity: workout.intensity,
        duration_minutes: workout.duration_minutes,
        description: (workout.prescription_json || {}).description || '',
        warmup: rx.warmup,
        main_workout: rx.main_workout,
        cooldown: rx.cooldown,
      },
      alerts: workout.is_adapted ? [{ type: 'info', message: 'This workout was adapted based on your recent health data' }] : [],
    };

    viewCache[view] = { data, fetchedAt: Date.now() };
    renderView(view, data);
  } else if (view === 'week') {
    const workouts = await getThisWeekWorkouts(activeSeason.id);
    const logs = await getWorkoutLogsForSeason(activeSeason.id);
    const logMap = new Map(logs.map(l => [l.workout_id, l]));

    const today = new Date().toISOString().split('T')[0];
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const plan = activeSeason.plan_json || {};
    const phase = getCurrentPhase(plan, seasonState.currentWeek);
    const weekStats = computeWeekStats(workouts);

    // Compute logged stats for the week
    const weekLogs = workouts.map(w => logMap.get(w.id)).filter(Boolean);
    const completedCount = weekLogs.filter(l => l.status === 'completed').length;

    // Training load label
    const loadLabel = weekStats.activeDays >= 6 ? 'High' : weekStats.activeDays >= 4 ? 'Moderate' : 'Low';
    const typeLabels = Object.entries(weekStats.typeCounts).map(([t, c]) => `${c} ${t}`).join(', ');

    const data = {
      view: 'week',
      _from_season: true,
      weekly_summary: phase
        ? `Week ${seasonState.currentWeek} · ${phase.name} — ${phase.focus || ''}`
        : `Week ${seasonState.currentWeek} of your ${activeSeason.name} season`,
      training_load_assessment: {
        recent_load: loadLabel,
        trend: phase ? phase.intensity_range || '--' : '--',
        phase_name: phase ? phase.name : '--',
      },
      days: workouts.map(w => {
        const log = logMap.get(w.id);
        return {
          date: w.date,
          day_name: dayNames[w.day_of_week - 1] || '',
          type: w.workout_type,
          title: w.title,
          intensity: w.intensity,
          duration_minutes: w.duration_minutes,
          focus: (w.prescription_json || {}).description || '',
          is_today: w.date === today,
          _log: log || null,
          _is_adapted: w.is_adapted,
        };
      }),
      weekly_goals: [
        { metric: 'Active Days', target: `${weekStats.activeDays} planned (${typeLabels})` },
        { metric: 'Total Training Time', target: `${weekStats.totalMin} minutes` },
        ...(completedCount > 0 ? [{ metric: 'Completed So Far', target: `${completedCount} of ${weekStats.activeDays} workouts` }] : []),
      ],
      alerts: [],
    };

    viewCache[view] = { data, fetchedAt: Date.now() };
    renderView(view, data);
  } else if (view === 'plan') {
    const plan = activeSeason.plan_json || {};
    const allWorkouts = await getSeasonWorkouts(activeSeason.id);

    // Compute per-phase stats from actual workout rows
    const enrichedPhases = (plan.phases || []).map(p => {
      const weeks = p.weeks || [p.week];
      const phaseWorkouts = allWorkouts.filter(w => weeks.includes(w.week_number));
      const activePerWeek = phaseWorkouts.filter(w => w.workout_type !== 'rest').length / (weeks.length || 1);
      const typeSet = new Set(phaseWorkouts.filter(w => w.workout_type !== 'rest').map(w => w.workout_type));
      const typeSummaries = [...typeSet].map(t => {
        const count = phaseWorkouts.filter(w => w.workout_type === t).length / (weeks.length || 1);
        return `${Math.round(count)}x ${t}/week`;
      });

      // Get representative workout titles (unique, non-rest, first week)
      const firstWeek = weeks[0];
      const sampleWorkouts = phaseWorkouts
        .filter(w => w.week_number === firstWeek && w.workout_type !== 'rest')
        .map(w => w.title);

      return {
        ...p,
        sessions_per_week: Math.round(activePerWeek),
        key_workouts: sampleWorkouts.length ? sampleWorkouts : typeSummaries,
      };
    });

    const data = {
      view: 'plan',
      _from_season: true,
      plan_name: activeSeason.name,
      plan_summary: plan.summary || '',
      current_assessment: plan.current_assessment || {},
      phases: enrichedPhases,
      principles: plan.principles || [],
      milestones: plan.milestones || [],
    };

    viewCache[view] = { data, fetchedAt: Date.now() };
    renderView(view, data);
  }
}

function showLoading() {
  hideAllContent();
  aiLoading.classList.add('visible');
}

function hideAllContent() {
  aiLoading.classList.remove('visible');
  aiError.classList.remove('visible');
  document.getElementById('contentToday').classList.remove('visible');
  document.getElementById('contentWeek').classList.remove('visible');
  document.getElementById('contentPlan').classList.remove('visible');
  controlsBar.style.display = 'none';
  disclaimer.style.display = 'none';
}

function renderView(view, data) {
  hideAllContent();

  if (view === 'today') renderToday(data);
  else if (view === 'week') renderWeek(data);
  else if (view === 'plan') renderPlan(data);

  controlsBar.style.display = '';
  disclaimer.style.display = '';

  if (data._from_season) {
    generatedAtEl.textContent = `Season plan · Week ${seasonState?.currentWeek || '?'}`;
  } else {
    const genAt = data._generated_at;
    if (genAt) {
      const mins = Math.round((Date.now() - new Date(genAt).getTime()) / 60000);
      generatedAtEl.textContent = mins < 1 ? 'Generated just now' : `Generated ${mins} min ago`;
      if (data._cached) generatedAtEl.textContent += ' (cached)';
    }
  }
}

// ── Render: Today ────────────────────────────────────────────

function renderToday(data) {
  const container = document.getElementById('contentToday');

  const ra = data.readiness_assessment || {};
  const banner = document.getElementById('todayReadinessBanner');
  banner.className = `readiness-banner ${ra.level || 'moderate'}`;
  document.getElementById('todayReadinessLevel').textContent = `${ra.level || 'moderate'} readiness`;
  document.getElementById('todayReadinessSummary').textContent = ra.summary || '';

  const factors = document.getElementById('todayReadinessFactors');
  factors.innerHTML = (ra.key_factors || []).map(f =>
    `<span class="readiness-factor">${esc(f)}</span>`
  ).join('');

  const rec = data.recommendation || {};
  document.getElementById('todayWorkoutTitle').textContent = rec.title || 'No recommendation';

  const badge = document.getElementById('todayIntensityBadge');
  badge.textContent = rec.intensity || '--';
  badge.className = `workout-badge ${rec.intensity || 'moderate'}`;

  document.getElementById('todayDuration').textContent = rec.duration_minutes ? `${rec.duration_minutes} min` : '';
  document.getElementById('todayWorkoutDesc').textContent = rec.description || '';

  const warmup = rec.warmup;
  const warmupSection = document.getElementById('todayWarmup');
  if (warmup && warmup.activities && warmup.activities.length) {
    warmupSection.style.display = '';
    document.getElementById('todayWarmupItems').textContent =
      `${warmup.duration_minutes || 5} min — ${warmup.activities.join(', ')}`;
  } else {
    warmupSection.style.display = 'none';
  }

  const tbody = document.getElementById('todayExerciseBody');
  const exercises = rec.main_workout || [];
  tbody.innerHTML = exercises.map(ex => `
    <tr>
      <td>${esc(ex.exercise)}${ex.notes ? `<span class="exercise-notes">${esc(ex.notes)}</span>` : ''}</td>
      <td>${ex.sets || '--'}</td>
      <td>${esc(String(ex.reps || '--'))}</td>
      <td>${ex.rest_seconds ? `${ex.rest_seconds}s` : '--'}</td>
    </tr>
  `).join('');

  const cooldown = rec.cooldown;
  const cooldownSection = document.getElementById('todayCooldown');
  if (cooldown && cooldown.activities && cooldown.activities.length) {
    cooldownSection.style.display = '';
    document.getElementById('todayCooldownItems').textContent =
      `${cooldown.duration_minutes || 5} min — ${cooldown.activities.join(', ')}`;
  } else {
    cooldownSection.style.display = 'none';
  }

  renderAlerts('todayAlerts', data.alerts);

  const nutCard = document.getElementById('todayNutrition');
  if (data.nutrition_tip) {
    nutCard.style.display = '';
    document.getElementById('todayNutritionText').textContent = data.nutrition_tip;
  } else {
    nutCard.style.display = 'none';
  }

  // Workout logger (season mode only)
  const loggerContainer = document.getElementById('workoutLoggerContainer');
  if (data._from_season && data._workout) {
    renderWorkoutConfirmation(loggerContainer, data._workout);
  } else {
    loggerContainer.innerHTML = '';
  }

  container.classList.add('visible');
}

// ── Render: Week ─────────────────────────────────────────────

const TYPE_ICONS = {
  strength: '\u{1F4AA}',
  cardio: '\u{1F3C3}',
  recovery: '\u{1F9D8}',
  mixed: '\u{1F525}',
  rest: '\u{1F4A4}',
};

function renderWeek(data) {
  const container = document.getElementById('contentWeek');

  document.getElementById('weekSummary').textContent = data.weekly_summary || '';

  const tla = data.training_load_assessment || {};
  document.getElementById('weekLoad').textContent = tla.recent_load || '--';
  document.getElementById('weekTrend').textContent = tla.trend || '--';
  document.getElementById('weekPhase').textContent = tla.phase_name || '--';

  const cal = document.getElementById('weekCalendar');
  const today = new Date().toISOString().split('T')[0];
  cal.innerHTML = (data.days || []).map(d => {
    const isPast = d.date < today;
    const isToday = d.date === today || d.is_today;

    let logBadge = '';
    if (data._from_season) {
      if (d._log) {
        const cls = d._log.status === 'completed' ? 'done' : d._log.status === 'skipped' ? 'skipped' : 'partial';
        logBadge = `<div class="day-log-badge ${cls}">${d._log.status}${d._log.adherence_score != null ? ` ${Math.round(d._log.adherence_score)}%` : ''}</div>`;
      } else if (isPast && !isToday) {
        logBadge = '<div class="day-log-badge pending">not logged</div>';
      }
    }

    return `
      <div class="day-card${isToday ? ' is-today' : ''}${isPast && !isToday ? ' is-past' : ''}">
        <div class="day-name">${esc(d.day_name || '')}</div>
        <div class="day-date">${esc(d.date || '')}</div>
        <div class="day-type-icon">${TYPE_ICONS[d.type] || '\u{1F3CB}'}</div>
        <div class="day-title">${esc(d.title || '')}</div>
        <div class="day-focus">${esc(d.focus || '')}</div>
        <div class="day-intensity-bar ${d.intensity || 'moderate'}"></div>
        <div class="day-duration">${d.duration_minutes ? `${d.duration_minutes} min` : ''}</div>
        ${d._is_adapted ? '<div class="day-log-badge" style="background:#dbeafe;color:#1e40af">adapted</div>' : ''}
        ${logBadge}
      </div>
    `;
  }).join('');

  const goalsCard = document.getElementById('weekGoalsCard');
  const goalsList = document.getElementById('weekGoalsList');
  if (data.weekly_goals && data.weekly_goals.length) {
    goalsCard.style.display = '';
    goalsList.innerHTML = data.weekly_goals.map(g => `
      <li>
        <div class="goal-check"></div>
        <span><span class="goal-metric">${esc(g.metric)}</span> — ${esc(g.target)}</span>
      </li>
    `).join('');
  } else {
    goalsCard.style.display = 'none';
  }

  renderAlerts('weekAlerts', data.alerts);
  container.classList.add('visible');
}

// ── Render: Plan ─────────────────────────────────────────────

function renderPlan(data) {
  const container = document.getElementById('contentPlan');

  document.getElementById('planName').textContent = data.plan_name || 'Training Plan';
  document.getElementById('planSummary').textContent = data.plan_summary || '';

  const ca = data.current_assessment || {};
  const grid = document.getElementById('planAssessment');
  grid.innerHTML = `
    <div class="assessment-item">
      <div class="assessment-label">Fitness Level</div>
      <div class="assessment-pills"><span class="assessment-pill">${esc(ca.fitness_level || '--')}</span></div>
    </div>
    <div class="assessment-item">
      <div class="assessment-label">Training Age</div>
      <div class="assessment-pills"><span class="assessment-pill">${esc(ca.training_age_estimate || '--')}</span></div>
    </div>
    <div class="assessment-item">
      <div class="assessment-label">Strengths</div>
      <div class="assessment-pills">${(ca.strengths || []).map(s => `<span class="assessment-pill">${esc(s)}</span>`).join('')}</div>
    </div>
    <div class="assessment-item">
      <div class="assessment-label">Areas to Improve</div>
      <div class="assessment-pills">${(ca.areas_to_improve || []).map(s => `<span class="assessment-pill">${esc(s)}</span>`).join('')}</div>
    </div>
  `;

  const timeline = document.getElementById('planTimeline');
  const currentWeek = seasonState?.currentWeek || 1;
  timeline.innerHTML = (data.phases || []).map((p) => {
    const weeks = p.weeks || [p.week];
    const isCurrent = weeks.some(w => w === currentWeek);
    const sessionsText = p.sessions_per_week ? `${p.sessions_per_week} sessions/week` : '';
    const detailParts = [p.intensity_range, sessionsText].filter(Boolean).join(' · ');
    return `
      <div class="phase-node${isCurrent ? ' current' : ''}">
        <div class="phase-week">Week${weeks.length > 1 ? 's' : ''} ${weeks.join('-')}${isCurrent ? ' (current)' : ''}</div>
        <div class="phase-name-text">${esc(p.name || '')}</div>
        <div class="phase-focus">${esc(p.focus || '')}</div>
        ${detailParts ? `<div class="phase-details">${esc(detailParts)}</div>` : ''}
        ${p.key_workouts && p.key_workouts.length ? `<ul class="phase-workouts">${p.key_workouts.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      </div>
    `;
  }).join('');

  const principlesCard = document.getElementById('planPrinciplesCard');
  const principlesList = document.getElementById('planPrinciples');
  if (data.principles && data.principles.length) {
    principlesCard.style.display = '';
    principlesList.innerHTML = data.principles.map(p => `<li>${esc(p)}</li>`).join('');
  } else {
    principlesCard.style.display = 'none';
  }

  const milestonesCard = document.getElementById('planMilestonesCard');
  const milestonesList = document.getElementById('planMilestones');
  if (data.milestones && data.milestones.length) {
    milestonesCard.style.display = '';
    milestonesList.innerHTML = data.milestones.map(m => `
      <div class="milestone-item">
        <span class="milestone-time">${esc(m.timeframe)}</span>
        <span class="milestone-goal">${esc(m.goal)}</span>
      </div>
    `).join('');
  } else {
    milestonesCard.style.display = 'none';
  }

  container.classList.add('visible');
}

// ── Helpers ──────────────────────────────────────────────────

function renderAlerts(containerId, alerts) {
  const el = document.getElementById(containerId);
  if (!alerts || !alerts.length) { el.innerHTML = ''; return; }

  el.innerHTML = alerts.map(a =>
    `<span class="alert-pill ${a.type || 'info'}">${esc(a.message)}</span>`
  ).join('');
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ── Init ─────────────────────────────────────────────────────

if (isSupabaseConfigured()) {
  refreshDashboard();
}
