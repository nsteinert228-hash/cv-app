// Training AI Dashboard — season-based training with workout logging
import { isSupabaseConfigured } from './supabase.js';
import { createAuthUI } from './authUI.js';
import { onAuthStateChange, getUser } from './auth.js';
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
  stopCurrentSeason,
  checkAdaptations,
  getSeasonState,
} from './seasonManager.js';
import {
  getTodayWorkout,
  getThisWeekWorkouts,
  getSeasonWorkouts,
  getWorkoutLog,
  getWorkoutLogsForSeason,
  getWeekWorkoutsByWeekNumber,
} from './seasonData.js';
import { renderWorkoutConfirmation } from './workoutLogger.js';
import { renderAdaptationFeed } from './adaptationFeed.js';
import { renderSeasonHistory } from './seasonHistory.js';
import { open as openDayDetail, close as closeDayDetail } from './dayDetail.js';
import { initPlanBuilder, destroyPlanBuilder } from './planBuilder.js';
import { renderWeeklyView, renderWeekByNumber } from './weeklyView.js';

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
const stopRestartBtn = document.getElementById('stopRestartBtn');

const seasonModal = document.getElementById('seasonModal');
const seasonModalTitle = document.getElementById('seasonModalTitle');
const seasonModalText = document.getElementById('seasonModalText');
const seasonModalActions = document.getElementById('seasonModalActions');

const onboardingBlock = document.getElementById('onboardingBlock');
const onboardingPrefs = document.getElementById('onboardingPrefs');
const onboardingCTA = document.getElementById('onboardingCTA');
const onboardingProgress = document.getElementById('onboardingProgress');
const onboardingError = document.getElementById('onboardingError');
const obGoals = document.getElementById('obGoals');
const obExperience = document.getElementById('obExperience');
const obInjuries = document.getElementById('obInjuries');
const obGenerateBtn = document.getElementById('obGenerateBtn');
const obSkipBtn = document.getElementById('obSkipBtn');

const viewToggle = document.getElementById('viewToggle');
const prefsCard = document.getElementById('prefsCard');

// ── State ────────────────────────────────────────────────────

let currentView = 'week'; // will be overridden to 'plan' when season exists
let viewingWeekNumber = null; // for browsing past weeks
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
  // Always check current auth state from Supabase
  try {
    currentUser = await getUser();
  } catch { currentUser = null; }

  authUI.updateAuthUI(currentUser);

  if (!currentUser) {
    dashboardContent.classList.remove('visible');
    emptyState.style.display = '';
    seasonBanner.classList.remove('visible');
    return;
  }

  emptyState.style.display = 'none';
  dashboardContent.classList.add('visible');

  try {
    const [prefs] = await Promise.all([
      getTrainingPreferences().catch(() => ({})),
      loadReadinessHero(),
      loadQuickStats(),
    ]);

    preferences = prefs;
    setPrefsUI(prefs);

    await loadSeasonState();
  } catch (err) {
    console.error('refreshDashboard error:', err);
    // Show error UI so user knows something went wrong
    aiErrorMsg.textContent = err.message || 'Failed to load training data. Please try again.';
    aiError.classList.add('visible');
  }
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

    // Active season — ensure onboarding is hidden and controls visible
    onboardingBlock.classList.remove('visible');
    viewToggle.style.display = '';
    prefsCard.style.display = '';

    // Default to Training Plan view
    if (currentView === 'week') {
      currentView = 'plan';
      document.querySelectorAll('.view-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.view === 'plan');
      });
    }

    renderSeasonBanner();
    renderAdaptationFeed(adaptationFeedEl, activeSeason.id);
    checkAdaptations().catch(() => {}); // background
    initSeasonHistory();
    await loadView(currentView);
  } catch (err) {
    console.error('Season init error:', err);
    activeSeason = null;
    seasonState = null;
    seasonBanner.classList.remove('visible');
    await loadView(currentView);
  }
}

function showSeasonCreationPrompt() {
  // Hide season-only UI
  viewToggle.style.display = 'none';
  prefsCard.style.display = 'none';
  seasonBanner.classList.remove('visible');

  // Show Plan Builder in the onboarding block
  const planBuilderContainer = document.getElementById('planBuilderContainer');
  if (planBuilderContainer) {
    onboardingBlock.classList.add('visible');
    onboardingPrefs.style.display = 'none';
    onboardingCTA.style.display = 'none';
    onboardingProgress.classList.remove('visible');
    onboardingError.textContent = '';

    // Hide the old onboarding hero text
    const hero = onboardingBlock.querySelector('.onboarding-hero');
    if (hero) hero.style.display = 'none';

    planBuilderContainer.style.display = '';
    initPlanBuilder(planBuilderContainer, {
      onPlanCreated: async () => {
        destroyPlanBuilder();
        planBuilderContainer.style.display = 'none';
        onboardingBlock.classList.remove('visible');
        if (hero) hero.style.display = '';
        viewToggle.style.display = '';
        prefsCard.style.display = '';
        await loadSeasonState();
      },
    });
    return;
  }

  // Fallback: old onboarding flow
  onboardingBlock.classList.add('visible');
  onboardingPrefs.style.display = '';
  onboardingCTA.style.display = '';
  onboardingProgress.classList.remove('visible');
  onboardingError.textContent = '';

  obGoals.value = preferences.goals || '';
  obExperience.value = preferences.experience || '';
  obInjuries.value = preferences.injuries || '';
}

// ── Onboarding Event Handlers ──────────────────────────────

if (obGenerateBtn) {
  obGenerateBtn.addEventListener('click', async () => {
    // Save preferences from onboarding form before creating season
    const obPrefs = {
      goals: obGoals.value || undefined,
      experience: obExperience.value || undefined,
      injuries: obInjuries.value.trim() || undefined,
    };
    preferences = obPrefs;
    setPrefsUI(obPrefs);

    // Save prefs (non-blocking)
    saveTrainingPreferences(obPrefs).catch(() => {});

    // Show progress
    onboardingPrefs.style.display = 'none';
    onboardingCTA.style.display = 'none';
    onboardingProgress.classList.add('visible');
    onboardingError.textContent = '';

    try {
      await startNewSeason();
      onboardingBlock.classList.remove('visible');
      viewToggle.style.display = '';
      prefsCard.style.display = '';
      await loadSeasonState();
    } catch (err) {
      onboardingProgress.classList.remove('visible');
      onboardingPrefs.style.display = '';
      onboardingCTA.style.display = '';
      onboardingError.textContent = `Failed to create season: ${err.message}`;
    }
  });
}

if (obSkipBtn) {
  obSkipBtn.addEventListener('click', () => {
    // Save any preferences they entered
    const obPrefs = {
      goals: obGoals.value || undefined,
      experience: obExperience.value || undefined,
      injuries: obInjuries.value.trim() || undefined,
    };
    if (obPrefs.goals || obPrefs.experience || obPrefs.injuries) {
      preferences = obPrefs;
      setPrefsUI(obPrefs);
      saveTrainingPreferences(obPrefs).catch(() => {});
    }

    onboardingBlock.classList.remove('visible');
    viewToggle.style.display = '';
    prefsCard.style.display = '';
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
    seasonModalActions.innerHTML = '<div class="loading-spinner" style="margin:0 auto"></div>';
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
    seasonModalActions.innerHTML = '<div class="loading-spinner" style="margin:0 auto"></div>';
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
    seasonModalActions.innerHTML = '<div class="loading-spinner" style="margin:0 auto"></div>';
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

// ── Stop & Restart Season ────────────────────────────────────

stopRestartBtn.addEventListener('click', () => {
  if (!activeSeason) return;

  seasonModalTitle.textContent = 'Stop & New Plan?';
  seasonModalText.textContent = `This will abandon "${activeSeason.name}" and let you build a brand-new training plan from scratch. Your workout logs from this season will be preserved in history. This cannot be undone.`;
  seasonModalActions.innerHTML = `
    <button class="btn-danger" id="confirmStopRestart">Stop & New Plan</button>
    <button class="btn-ghost" id="cancelStopRestart">Cancel</button>
  `;
  seasonModal.classList.add('visible');

  document.getElementById('cancelStopRestart').addEventListener('click', () => {
    seasonModal.classList.remove('visible');
  });

  document.getElementById('confirmStopRestart').addEventListener('click', async () => {
    seasonModalText.textContent = 'Stopping current season...';
    seasonModalActions.innerHTML = '<div class="loading-spinner" style="margin:0 auto"></div>';

    try {
      await stopCurrentSeason();
      seasonModal.classList.remove('visible');
      activeSeason = null;
      seasonState = null;
      Object.keys(viewCache).forEach(k => delete viewCache[k]);
      // loadSeasonState will detect no active season and show the plan builder wizard
      await loadSeasonState();
    } catch (err) {
      seasonModalText.textContent = `Failed: ${err.message}`;
      seasonModalActions.innerHTML = '<button class="btn-ghost" id="closeStopRestartErr">Close</button>';
      document.getElementById('closeStopRestartErr').addEventListener('click', () => {
        seasonModal.classList.remove('visible');
      });
    }
  });
});

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
      if (view === 'week') {
        const [weekData, todayData] = await Promise.all([
          getTrainingRecommendation('week', preferences, force),
          getTrainingRecommendation('today', preferences, force),
        ]);
        weekData._todayData = todayData;
        viewCache[view] = { data: weekData, fetchedAt: Date.now() };
        renderView(view, weekData);
      } else {
        const data = await getTrainingRecommendation(view, preferences, force);
        viewCache[view] = { data, fetchedAt: Date.now() };
        renderView(view, data);
      }
    }
  } catch (err) {
    console.error('View load error:', err);
    hideAllContent();
    const isNetworkError = err instanceof TypeError &&
      (err.message === 'Load failed' || err.message === 'Failed to fetch');
    const message = isNetworkError
      ? 'Unable to reach the server. Check your connection and try again.'
      : (err.message || 'Something went wrong. Please try again.');
    aiErrorMsg.textContent = message;
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

function dayNameFromDate(dateStr) {
  const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const d = new Date(dateStr + 'T00:00:00');
  return NAMES[d.getDay()];
}

async function loadSeasonView(view) {
  const plan = activeSeason.plan_json || {};

  if (view === 'week') {
    // Use the new weekly view component
    const weekContainer = document.getElementById('contentWeek');
    hideAllContent();
    weekContainer.classList.add('visible');
    controlsBar.style.display = '';
    disclaimer.style.display = '';
    generatedAtEl.textContent = `Season plan · Week ${seasonState?.currentWeek || '?'}`;

    await renderWeeklyView(weekContainer, {
      season: activeSeason,
      seasonState,
      onWeekChange: async (weekNum) => {
        await renderWeekByNumber(weekContainer, weekNum, {
          season: activeSeason,
          seasonState,
          onWeekChange: async (wn) => {
            await renderWeekByNumber(weekContainer, wn, {
              season: activeSeason,
              seasonState,
              onWeekChange: null,
            });
          },
        });
      },
    });
    return;

  } else if (view === 'plan') {
    const allWorkouts = await getSeasonWorkouts(activeSeason.id);

    // Build per-phase data from actual workout rows
    const enrichedPhases = (plan.phases || []).map(p => {
      const weeks = p.weeks || [p.week];
      const phaseWorkouts = allWorkouts.filter(w => weeks.includes(w.week_number));
      const activeWorkouts = phaseWorkouts.filter(w => w.workout_type !== 'rest');
      const activePerWeek = activeWorkouts.length / (weeks.length || 1);

      // Type distribution
      const typeCounts = {};
      for (const w of activeWorkouts) {
        typeCounts[w.workout_type] = (typeCounts[w.workout_type] || 0) + 1;
      }
      const typeSummary = Object.entries(typeCounts)
        .map(([t, c]) => `${Math.round(c / (weeks.length || 1))}x ${t}`)
        .join(', ');

      // Weekly schedule from first week in phase
      const firstWeek = weeks[0];
      const scheduleWorkouts = phaseWorkouts
        .filter(w => w.week_number === firstWeek)
        .sort((a, b) => a.day_of_week - b.day_of_week);

      const weeklySchedule = scheduleWorkouts.map(w => ({
        day: dayNameFromDate(w.date),
        dayShort: dayNameFromDate(w.date).slice(0, 3),
        title: w.title,
        type: w.workout_type,
        intensity: w.intensity,
        duration: w.duration_minutes,
      }));

      // Key exercises (unique, across all workouts in phase)
      const allExercises = new Set();
      for (const w of activeWorkouts) {
        const rx = w.prescription_json || {};
        const exList = rx.exercises || rx.main_workout || [];
        for (const ex of exList) {
          if (ex.exercise) allExercises.add(ex.exercise);
        }
      }
      const keyExercises = [...allExercises].slice(0, 8);

      // Total volume
      const totalMin = phaseWorkouts.reduce((s, w) => s + (w.duration_minutes || 0), 0);

      return {
        ...p,
        sessions_per_week: Math.round(activePerWeek),
        type_summary: typeSummary,
        key_workouts: p.key_workouts || weeklySchedule.filter(w => w.type !== 'rest').map(w => w.title),
        weekly_schedule: weeklySchedule,
        key_exercises: keyExercises,
        total_minutes: totalMin,
        total_sessions: activeWorkouts.length,
      };
    });

    // Season-level stats
    const totalActive = allWorkouts.filter(w => w.workout_type !== 'rest').length;
    const totalMinutes = allWorkouts.reduce((s, w) => s + (w.duration_minutes || 0), 0);

    const data = {
      view: 'plan',
      _from_season: true,
      plan_name: activeSeason.name,
      plan_summary: plan.summary || '',
      current_assessment: plan.current_assessment || {},
      phases: enrichedPhases,
      principles: plan.principles || [],
      milestones: plan.milestones || [],
      season_stats: {
        total_sessions: totalActive,
        total_minutes: totalMinutes,
        duration_weeks: activeSeason.duration_weeks,
      },
    };

    viewCache[view] = { data, fetchedAt: Date.now() };
    renderView(view, data);
  }
}

async function loadWeekByNumber(weekNumber) {
  if (!activeSeason) return;
  showLoading();

  try {
    const plan = activeSeason.plan_json || {};
    const workouts = await getWeekWorkoutsByWeekNumber(activeSeason.id, weekNumber);
    const logs = await getWorkoutLogsForSeason(activeSeason.id);
    const logMap = new Map(logs.map(l => [l.workout_id, l]));
    const today = new Date().toISOString().split('T')[0];
    const phase = getCurrentPhase(plan, weekNumber);
    const weekStats = computeWeekStats(workouts);

    const weekLogs = workouts.map(w => logMap.get(w.id)).filter(Boolean);
    const completedCount = weekLogs.filter(l => l.status === 'completed').length;
    const loadLabel = weekStats.activeDays >= 6 ? 'High' : weekStats.activeDays >= 4 ? 'Moderate' : 'Low';
    const typeLabels = Object.entries(weekStats.typeCounts).map(([t, c]) => `${c}x ${t}`).join(', ');

    const data = {
      view: 'week',
      _from_season: true,
      _weekNumber: weekNumber,
      weekly_summary: phase
        ? `Week ${weekNumber} · ${phase.name} — ${phase.focus || ''}`
        : `Week ${weekNumber} of ${activeSeason.name}`,
      training_load_assessment: {
        recent_load: loadLabel,
        trend: phase ? phase.intensity_range || '--' : '--',
        phase_name: phase ? phase.name : '--',
        total_minutes: weekStats.totalMin,
        active_days: weekStats.activeDays,
      },
      days: workouts.map(w => {
        const log = logMap.get(w.id);
        const rx = w.prescription_json || {};
        const exercises = rx.exercises || rx.main_workout || [];
        const exercisePreview = exercises.slice(0, 3).map(e => e.exercise).filter(Boolean);
        return {
          date: w.date,
          day_name: dayNameFromDate(w.date),
          type: w.workout_type,
          title: w.title,
          intensity: w.intensity,
          duration_minutes: w.duration_minutes,
          focus: rx.description || '',
          exercisePreview,
          is_today: w.date === today,
          _log: log || null,
          _is_adapted: w.is_adapted,
          _workout_id: w.id,
        };
      }),
      weekly_goals: [
        { metric: 'Active Days', target: `${weekStats.activeDays} sessions (${typeLabels || 'rest week'})` },
        { metric: 'Training Volume', target: `${weekStats.totalMin} minutes total` },
        ...(completedCount > 0 ? [{ metric: 'Progress', target: `${completedCount} of ${weekStats.activeDays} completed` }] : []),
        ...(phase && phase.focus ? [{ metric: 'Phase Focus', target: phase.focus }] : []),
      ],
      alerts: [],
      _todayData: (weekNumber === seasonState.currentWeek && viewCache['week']?.data?._todayData) || null,
    };

    // Clean up previous week nav
    const existingNav = document.querySelector('#weekNavContainer');
    if (existingNav) existingNav.remove();

    renderView('week', data);
  } catch (err) {
    console.error('Week load error:', err);
  }
}

function showLoading() {
  hideAllContent();
  aiLoading.classList.add('visible');
}

function hideAllContent() {
  aiLoading.classList.remove('visible');
  aiError.classList.remove('visible');
  document.getElementById('contentWeek').classList.remove('visible');
  document.getElementById('contentPlan').classList.remove('visible');
  controlsBar.style.display = 'none';
  disclaimer.style.display = 'none';
}

function renderView(view, data) {
  hideAllContent();

  if (view === 'week') renderWeek(data);
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

// ── Render: Today Section (within Week view) ─────────────────

function renderTodaySection(data) {
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
}

// ── Render: Week ─────────────────────────────────────────────

const TYPE_ICONS = {
  strength: 'STR',
  cardio: 'CRD',
  recovery: 'REC',
  mixed: 'MIX',
  rest: 'REST',
};

function renderWeek(data) {
  const container = document.getElementById('contentWeek');

  // Render today's workout section
  const todaySection = document.getElementById('todaySection');
  const td = data._todayData;
  if (td) {
    todaySection.style.display = '';
    renderTodaySection(td);
  } else {
    todaySection.style.display = 'none';
  }

  document.getElementById('weekSummary').textContent = data.weekly_summary || '';

  const tla = data.training_load_assessment || {};
  document.getElementById('weekLoad').textContent = tla.recent_load || '--';
  document.getElementById('weekTrend').textContent = tla.trend || '--';
  document.getElementById('weekPhase').textContent = tla.phase_name || '--';

  // Week navigation for browsing past weeks
  const weekNavHtml = (activeSeason && seasonState) ? `
    <div class="week-nav">
      <div class="week-nav-label">Week ${data._weekNumber || seasonState.currentWeek} of ${activeSeason.duration_weeks}</div>
      <div class="week-nav-btns">
        <button class="week-nav-btn" id="weekPrevBtn" ${(data._weekNumber || seasonState.currentWeek) <= 1 ? 'disabled' : ''}>&larr; Prev</button>
        <button class="week-nav-btn" id="weekNextBtn" ${(data._weekNumber || seasonState.currentWeek) >= seasonState.currentWeek ? 'disabled' : ''}>Next &rarr;</button>
      </div>
    </div>
  ` : '';

  const cal = document.getElementById('weekCalendar');
  const today = new Date().toISOString().split('T')[0];

  // Insert week nav before calendar (replace any previous)
  let navContainer = container.querySelector('#weekNavContainer');
  if (!navContainer) {
    navContainer = document.createElement('div');
    navContainer.id = 'weekNavContainer';
    cal.parentElement.insertBefore(navContainer, cal);
  }
  navContainer.innerHTML = weekNavHtml;

  cal.innerHTML = (data.days || []).map((d, idx) => {
    const isPast = d.date < today;
    const isToday = d.date === today || d.is_today;

    let logBadge = '';
    if (data._from_season && !data._isUpcoming) {
      if (d._log) {
        const cls = d._log.status === 'completed' ? 'done' : d._log.status === 'skipped' ? 'skipped' : 'partial';
        logBadge = `<div class="day-log-badge ${cls}">${d._log.status}${d._log.adherence_score != null ? ` ${Math.round(d._log.adherence_score)}%` : ''}</div>`;
      } else if (isPast && !isToday) {
        logBadge = '<div class="day-log-badge pending">not logged</div>';
      }
    }

    // Exercise preview for non-rest days
    const previewHtml = (d.exercisePreview && d.exercisePreview.length)
      ? `<div class="day-exercises">${d.exercisePreview.map(e => `<span class="day-ex-pill">${esc(e)}</span>`).join('')}</div>`
      : '';

    return `
      <div class="day-card${isToday ? ' is-today' : ''}${isPast && !isToday ? ' is-past' : ''}" data-day-index="${idx}" style="cursor:pointer">
        <div class="day-name">${esc(d.day_name || '')}</div>
        <div class="day-date">${esc(d.date || '')}</div>
        <div class="day-type-icon">${TYPE_ICONS[d.type] || '—'}</div>
        <div class="day-title">${esc(d.title || '')}</div>
        <div class="day-focus">${esc(d.focus || '')}</div>
        ${previewHtml}
        <div class="day-intensity-bar ${d.intensity || 'moderate'}"></div>
        <div class="day-duration">${d.duration_minutes ? `${d.duration_minutes} min` : ''}</div>
        ${d._is_adapted ? '<div class="day-log-badge" style="background:#dbeafe;color:#1e40af">adapted</div>' : ''}
        ${logBadge}
      </div>
    `;
  }).join('');

  // Day card click → open day detail
  cal.querySelectorAll('.day-card').forEach(card => {
    card.addEventListener('click', async () => {
      const idx = parseInt(card.dataset.dayIndex);
      const dayData = (data.days || [])[idx];
      if (!dayData || !dayData._workout_id) return;

      // Fetch the full workout from the season
      try {
        const { getSupabaseClient } = await import('./supabase.js');
        const client = getSupabaseClient();
        if (!client) return;
        const { data: workout } = await client
          .from('season_workouts')
          .select('*')
          .eq('id', dayData._workout_id)
          .single();

        if (workout) openDayDetail(workout, getDayDetailContext());
      } catch (err) {
        console.error('Day detail fetch error:', err);
      }
    });
  });

  // Week navigation handlers
  const prevBtn = container.querySelector('#weekPrevBtn');
  const nextBtn = container.querySelector('#weekNextBtn');
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      const targetWeek = (data._weekNumber || seasonState.currentWeek) - 1;
      if (targetWeek >= 1) loadWeekByNumber(targetWeek);
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      const targetWeek = (data._weekNumber || seasonState.currentWeek) + 1;
      if (targetWeek <= seasonState.currentWeek) loadWeekByNumber(targetWeek);
    });
  }

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

  // Season overview stats
  const ss = data.season_stats || {};
  const overviewEl = document.getElementById('planOverview');
  if (overviewEl && ss.total_sessions) {
    overviewEl.style.display = '';
    overviewEl.innerHTML = `
      <div class="plan-stat"><div class="plan-stat-val">${ss.duration_weeks}</div><div class="plan-stat-label">Weeks</div></div>
      <div class="plan-stat"><div class="plan-stat-val">${ss.total_sessions}</div><div class="plan-stat-label">Workouts</div></div>
      <div class="plan-stat"><div class="plan-stat-val">${Math.round(ss.total_minutes / 60)}h</div><div class="plan-stat-label">Total Time</div></div>
      <div class="plan-stat"><div class="plan-stat-val">${(data.phases || []).length}</div><div class="plan-stat-label">Phases</div></div>
    `;
  }

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
    const detailParts = [p.intensity_range, sessionsText, p.type_summary].filter(Boolean).join(' · ');

    // Weekly schedule mini-table
    const schedule = p.weekly_schedule || [];
    const scheduleHtml = schedule.length ? `
      <div class="phase-schedule">
        ${schedule.map(s => `
          <div class="phase-sched-day">
            <span class="phase-sched-label">${esc(s.dayShort)}</span>
            <span class="phase-sched-type ${s.type}">${TYPE_ICONS[s.type] || ''}</span>
            <span class="phase-sched-title">${esc(s.title)}</span>
            ${s.duration ? `<span class="phase-sched-dur">${s.duration}m</span>` : ''}
          </div>
        `).join('')}
      </div>
    ` : '';

    // Key exercises
    const exercisesHtml = (p.key_exercises && p.key_exercises.length) ? `
      <div class="phase-exercises">
        <span class="phase-ex-label">Key exercises:</span>
        ${p.key_exercises.map(e => `<span class="phase-ex-pill">${esc(e)}</span>`).join('')}
      </div>
    ` : '';

    return `
      <div class="phase-node${isCurrent ? ' current' : ''}">
        <div class="phase-week">Week${weeks.length > 1 ? 's' : ''} ${weeks.join('-')}${isCurrent ? ' (current)' : ''}</div>
        <div class="phase-name-text">${esc(p.name || '')}</div>
        <div class="phase-focus">${esc(p.focus || '')}</div>
        ${detailParts ? `<div class="phase-details">${esc(detailParts)}</div>` : ''}
        ${scheduleHtml}
        ${exercisesHtml}
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

// ── Season History ───────────────────────────────────────────

function initSeasonHistory() {
  const section = document.getElementById('seasonHistorySection');
  const toggle = document.getElementById('historyToggle');
  const container = document.getElementById('historyContainer');

  if (!section || !toggle || !container) return;
  section.style.display = '';

  toggle.addEventListener('click', () => {
    const isOpen = container.classList.contains('visible');
    container.classList.toggle('visible', !isOpen);
    if (!isOpen && !container.dataset.loaded) {
      renderSeasonHistory(container);
      container.dataset.loaded = 'true';
    }
  });
}

// ── Day Detail Helper ────────────────────────────────────────

function getDayDetailContext() {
  return {
    normalizePrescription,
    esc,
    activeSeason,
    viewCache,
    loadView,
    get currentView() { return currentView; },
  };
}

// ── Init ─────────────────────────────────────────────────────

if (isSupabaseConfigured()) {
  const authSection = document.getElementById('authSection');
  if (authSection) authSection.classList.remove('hidden');

  // Listen for auth changes (sign-in, sign-out, token refresh)
  onAuthStateChange(async () => {
    try { await refreshDashboard(); } catch (err) { console.error('Auth state change error:', err); }
  });

  // Initial load — getUser() inside refreshDashboard handles session check
  refreshDashboard();
}
