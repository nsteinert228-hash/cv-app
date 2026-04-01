// Training AI Dashboard — Home screen with 3-zone layout
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
  findMatchingGarminActivity,
  submitWorkoutLog,
  getGarminActivitiesByDateRange,
} from './seasonData.js';
import { renderWorkoutConfirmation } from './workoutLogger.js';
import { renderAdaptationFeed } from './adaptationFeed.js';
import { renderSeasonHistory } from './seasonHistory.js';
import { open as openDayDetail, close as closeDayDetail } from './dayDetail.js';
import { initPlanBuilder, destroyPlanBuilder } from './planBuilder.js';
import { renderWeeklyView, renderWeekByNumber } from './weeklyView.js';
import { renderSeasonOverview } from './seasonOverview.js';
import { renderGoalTracker } from './goalTracker.js';

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

// Preferences (now in overflow sheet)
const prefGoals = document.getElementById('prefGoals');
const prefExperience = document.getElementById('prefExperience');
const prefInjuries = document.getElementById('prefInjuries');
const prefsSaveStatus = document.getElementById('prefsSaveStatus');

const quickStatsCard = document.getElementById('quickStatsCard');
const quickStats = document.getElementById('quickStats');

// Legacy hidden elements (kept for compatibility)
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

// New zone elements
const heroCard = document.getElementById('heroCard');
const heroCardInner = document.getElementById('heroCardInner');
const heroTypeTag = document.getElementById('heroTypeTag');
const heroDuration = document.getElementById('heroDuration');
const heroTitle = document.getElementById('heroTitle');
const heroContext = document.getElementById('heroContext');
const heroStartBtn = document.getElementById('heroStartBtn');
const zoneWeek = document.getElementById('zoneWeek');
const zonePlan = document.getElementById('zonePlan');
const timelineScroll = document.getElementById('timelineScroll');
const weekTitle = document.getElementById('weekTitle');
const weekSubtitle = document.getElementById('weekSubtitle');
const planName = document.getElementById('planName');
const planMeta = document.getElementById('planMeta');
const planProgressFillNew = document.getElementById('planProgressFill');
const planExpandBtn = document.getElementById('planExpandBtn');
const planDetail = document.getElementById('planDetail');

// Readiness chips
const chipSleepVal = document.getElementById('chipSleepVal');
const chipBBVal = document.getElementById('chipBBVal');
const chipHRVVal = document.getElementById('chipHRVVal');
const chipSleepDot = document.getElementById('chipSleepDot');
const chipBBDot = document.getElementById('chipBBDot');
const chipHRVDot = document.getElementById('chipHRVDot');

// ── State ────────────────────────────────────────────────────

let currentView = 'week';
let viewingWeekNumber = null;
let currentUser = null;
let activeSeason = null;
let seasonState = null;
const viewCache = {};
let preferences = {};
let prefSaveTimer = null;
let readinessData = null;

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

// ── Overflow Menu ────────────────────────────────────────────

const overflowBtn = document.getElementById('overflowBtn');
const overflowBackdrop = document.getElementById('overflowBackdrop');

overflowBtn.addEventListener('click', () => {
  overflowBackdrop.classList.add('visible');
});

overflowBackdrop.addEventListener('click', (e) => {
  if (e.target === overflowBackdrop) {
    overflowBackdrop.classList.remove('visible');
  }
});

// ── Preferences ──────────────────────────────────────────────

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

// ── Plan Expand Toggle ──────────────────────────────────────

planExpandBtn.addEventListener('click', () => {
  const isExpanded = planDetail.classList.contains('visible');
  planDetail.classList.toggle('visible', !isExpanded);
  planExpandBtn.classList.toggle('expanded', !isExpanded);
  planExpandBtn.firstChild.textContent = isExpanded ? 'View Full Plan ' : 'Hide Plan ';
});

// ── Regenerate ───────────────────────────────────────────────

regenBtn.addEventListener('click', () => {
  overflowBackdrop.classList.remove('visible');
  delete viewCache[currentView];
  Object.keys(viewCache).forEach(k => delete viewCache[k]);
  if (activeSeason) {
    checkAdaptations(true).then(() => loadAllZones());
  } else {
    loadAllZones(true);
  }
});

aiRetryBtn.addEventListener('click', () => { loadAllZones(); });

// ── Main refresh ─────────────────────────────────────────────

async function refreshDashboard() {
  try {
    const { getUser } = await import('./auth.js');
    currentUser = await getUser();
  } catch { currentUser = null; }

  if (!currentUser) {
    dashboardContent.classList.remove('visible');
    emptyState.style.display = '';
    heroCard.style.display = 'none';
    zoneWeek.style.display = 'none';
    zonePlan.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';
  dashboardContent.classList.add('visible');

  const [prefs] = await Promise.all([
    getTrainingPreferences().catch(() => ({})),
    loadReadinessChips(),
    loadQuickStats(),
  ]);

  preferences = prefs;
  setPrefsUI(prefs);

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

    // Active season — show home zones, hide onboarding
    onboardingBlock.classList.remove('visible');
    heroCard.style.display = '';
    zoneWeek.style.display = '';
    zonePlan.style.display = '';

    renderAdaptationFeed(adaptationFeedEl, activeSeason.id);
    checkAdaptations().catch(() => {});
    initSeasonHistory();
    renderPlanConfigSummary(activeSeason);
    loadAllZones();
  } catch (err) {
    console.error('Season init error:', err);
    activeSeason = null;
    seasonState = null;
    renderPlanConfigSummary(null);
    loadAllZones();
  }
}

function showSeasonCreationPrompt() {
  heroCard.style.display = 'none';
  zoneWeek.style.display = 'none';
  zonePlan.style.display = 'none';
  renderPlanConfigSummary(null);

  const planBuilderContainer = document.getElementById('planBuilderContainer');
  if (planBuilderContainer) {
    onboardingBlock.classList.add('visible');
    onboardingPrefs.style.display = 'none';
    onboardingCTA.style.display = 'none';
    onboardingProgress.classList.remove('visible');
    onboardingError.textContent = '';

    const hero = onboardingBlock.querySelector('.onboarding-hero');
    if (hero) hero.style.display = 'none';

    planBuilderContainer.style.display = '';
    initPlanBuilder(planBuilderContainer, {
      onPlanCreated: async () => {
        destroyPlanBuilder();
        planBuilderContainer.style.display = 'none';
        onboardingBlock.classList.remove('visible');
        if (hero) hero.style.display = '';
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
    const obPrefs = {
      goals: obGoals.value || undefined,
      experience: obExperience.value || undefined,
      injuries: obInjuries.value.trim() || undefined,
    };
    preferences = obPrefs;
    setPrefsUI(obPrefs);
    saveTrainingPreferences(obPrefs).catch(() => {});

    onboardingPrefs.style.display = 'none';
    onboardingCTA.style.display = 'none';
    onboardingProgress.classList.add('visible');
    onboardingError.textContent = '';

    try {
      await startNewSeason();
      onboardingBlock.classList.remove('visible');
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
    heroCard.style.display = '';
    zoneWeek.style.display = '';
    loadAllZones();
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
      await finishSeason();
      seasonModal.classList.remove('visible');
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

// ── Stop & Restart Season ────────────────────────────────────

stopRestartBtn.addEventListener('click', () => {
  if (!activeSeason) return;
  overflowBackdrop.classList.remove('visible');

  seasonModalTitle.textContent = 'Stop & New Plan?';
  seasonModalText.textContent = `This will abandon "${activeSeason.name}" and let you build a brand-new training plan from scratch. Your workout logs will be preserved in history.`;
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

// ── Readiness Chips ──────────────────────────────────────────

async function loadReadinessChips() {
  try {
    const r = await getTodayReadiness();
    readinessData = r;

    chipSleepVal.textContent = r.sleep_score ?? '--';
    chipBBVal.textContent = r.body_battery ?? '--';
    chipHRVVal.textContent = r.hrv_status || (r.hrv_value ?? '--');

    // Color dots based on values
    const sleepScore = r.sleep_score || 0;
    chipSleepDot.className = `readiness-chip-dot ${sleepScore >= 70 ? 'green' : sleepScore >= 50 ? 'yellow' : 'red'}`;

    const bb = r.body_battery || 0;
    chipBBDot.className = `readiness-chip-dot ${bb >= 60 ? 'green' : bb >= 30 ? 'yellow' : 'red'}`;

    const hrvStatus = (r.hrv_status || '').toLowerCase();
    chipHRVDot.className = `readiness-chip-dot ${hrvStatus === 'balanced' || hrvStatus === 'high' ? 'green' : hrvStatus === 'low' || hrvStatus === 'unbalanced' ? 'yellow' : 'green'}`;

    // Add contextual labels
    const sleepLabel = sleepScore >= 80 ? 'Great' : sleepScore >= 60 ? 'OK' : 'Low';
    const bbLabel = bb >= 70 ? 'High' : bb >= 40 ? 'OK' : 'Low';
    const hrvLabel = hrvStatus === 'balanced' ? 'Balanced' : hrvStatus === 'high' ? 'High' : hrvStatus === 'low' ? 'Low' : hrvStatus || '--';

    // Update chip sub-labels if elements exist
    const chipSleepLabel = document.getElementById('chipSleepLabel');
    const chipBBLabel = document.getElementById('chipBBLabel');
    const chipHRVLabel = document.getElementById('chipHRVLabel');
    if (chipSleepLabel) chipSleepLabel.textContent = sleepLabel;
    if (chipBBLabel) chipBBLabel.textContent = bbLabel;
    if (chipHRVLabel) chipHRVLabel.textContent = hrvLabel;

    // Sparkline trends — inject mini SVG if trend data available
    try {
      const { getHrvTrend, getDailyTrend } = await import('./garmin.js');
      const [hrvTrend, dailyTrend] = await Promise.all([
        getHrvTrend().catch(() => []),
        getDailyTrend().catch(() => []),
      ]);

      injectSparkline('chipSleep', dailyTrend.map(d => d.resting_heart_rate).filter(Boolean));
      injectSparkline('chipBB', []); // body battery trend not in daily_summaries
      injectSparkline('chipHRV', hrvTrend.map(d => d.last_night_avg).filter(Boolean));
    } catch { /* sparklines are optional */ }

    // Also populate hidden legacy elements
    const heroSleep = document.getElementById('heroSleep');
    const heroBB = document.getElementById('heroBB');
    const heroHRV = document.getElementById('heroHRV');
    const heroStress = document.getElementById('heroStress');
    if (heroSleep) heroSleep.textContent = r.sleep_score ?? '--';
    if (heroBB) heroBB.textContent = r.body_battery ?? '--';
    if (heroHRV) heroHRV.textContent = r.hrv_value ?? '--';
    if (heroStress) heroStress.textContent = r.stress_avg ?? '--';
  } catch (err) {
    console.error('Readiness chips error:', err);
  }
}

function injectSparkline(chipId, values) {
  if (!values || values.length < 3) return;
  const chip = document.getElementById(chipId);
  if (!chip) return;

  // Remove existing sparkline
  const existing = chip.querySelector('.chip-sparkline');
  if (existing) existing.remove();

  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = 100 - ((v - min) / range) * 80 - 10; // 10-90% range
    return `${x},${y}`;
  }).join(' ');

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('chip-sparkline');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.innerHTML = `<polyline points="${points}"/>`;
  chip.appendChild(svg);
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

// ── Load All Zones ───────────────────────────────────────────

const TYPE_ICONS = {
  strength: 'STR',
  cardio: 'CRD',
  recovery: 'REC',
  mixed: 'MIX',
  rest: 'REST',
};

const CACHE_TTL = 5 * 60 * 1000;

async function loadAllZones(force = false) {
  showLoading();

  try {
    if (activeSeason) {
      await loadSeasonZones(force);
    } else {
      // Stateless fallback
      const [weekData, todayData] = await Promise.all([
        getTrainingRecommendation('week', preferences, force),
        getTrainingRecommendation('today', preferences, force),
      ]);
      weekData._todayData = todayData;
      renderHeroZone(todayData);
      renderTimelineZone(weekData);
      hideLoading();
    }
  } catch (err) {
    console.error('Zone load error:', err);
    hideLoading();
    const isNetworkError = err instanceof TypeError &&
      (err.message === 'Load failed' || err.message === 'Failed to fetch');
    const message = isNetworkError
      ? 'Unable to reach the server. Check your connection and try again.'
      : (err.message || 'Something went wrong. Please try again.');
    aiErrorMsg.textContent = message;
    aiError.classList.add('visible');
  }
}

async function loadSeasonZones(force) {
  const plan = activeSeason.plan_json || {};
  const today = new Date().toISOString().split('T')[0];

  // Load this week's workouts + logs in parallel
  const [weekWorkouts, allLogs] = await Promise.all([
    getWeekWorkoutsByWeekNumber(activeSeason.id, seasonState.currentWeek),
    getWorkoutLogsForSeason(activeSeason.id),
  ]);

  const logMap = new Map(allLogs.map(l => [l.workout_id, l]));
  const todayWorkout = weekWorkouts.find(w => w.date === today);

  // Auto-match: if today has no log and is a cardio type, check Garmin
  // Instead of silently submitting, show a confirmation banner so the user
  // can verify the match before it's logged.
  let pendingGarminMatch = null;
  const AUTO_MATCH_TYPES = new Set(['running', 'cycling', 'swimming', 'cardio']);
  if (todayWorkout && !logMap.has(todayWorkout.id) && AUTO_MATCH_TYPES.has(todayWorkout.workout_type)) {
    try {
      const garminActivity = await findMatchingGarminActivity(todayWorkout.workout_type, todayWorkout.date);
      if (garminActivity) {
        pendingGarminMatch = garminActivity;
      }
    } catch (err) {
      console.warn('Garmin auto-match failed:', err);
    }
  }

  // Render Hero (today's workout)
  if (todayWorkout) {
    renderSeasonHero(todayWorkout, logMap.get(todayWorkout.id), pendingGarminMatch);
  } else {
    renderRestDayHero();
  }

  // Render week summary (Item 5)
  renderWeekSummary(weekWorkouts, logMap, seasonState, activeSeason.plan_json || {});

  // Fetch Garmin activities for the week to match against planned workouts
  const weekDates = weekWorkouts.map(w => w.date);
  const minDate = weekDates.length ? weekDates.reduce((a, b) => a < b ? a : b) : today;
  const maxDate = weekDates.length ? weekDates.reduce((a, b) => a > b ? a : b) : today;
  let weekGarminActivities = [];
  try {
    weekGarminActivities = await getGarminActivitiesByDateRange(minDate, maxDate);
  } catch (err) {
    console.warn('Garmin activities fetch failed:', err);
  }

  // Auto-log past cardio workouts that have clear Garmin matches but no log
  const autoMatchTypes = new Set(['cardio', 'running', 'cycling', 'swimming']);
  for (const w of weekWorkouts) {
    if (w.date >= today || logMap.has(w.id) || !autoMatchTypes.has(w.workout_type)) continue;
    const match = weekGarminActivities.find(a => a.date === w.date);
    if (match) {
      try {
        await submitWorkoutLog(w.id, 'completed', {
          source_activity: match,
          duration_minutes: Math.round((match.duration_seconds || 0) / 60),
        }, match.activity_id, null, 'garmin_auto');
        // Add to logMap so UI renders correctly
        logMap.set(w.id, { workout_id: w.id, status: 'completed', source: 'garmin_auto' });
      } catch (err) {
        console.warn('Auto-log failed for', w.date, err);
      }
    }
  }

  // Render Timeline (this week)
  renderSeasonTimeline(weekWorkouts, logMap, today);

  // Render Plan overview
  renderPlanOverview(plan);

  hideLoading();

  controlsBar.style.display = '';
  disclaimer.style.display = '';
  generatedAtEl.textContent = `Season plan · Week ${seasonState?.currentWeek || '?'}`;
}

function showLoading() {
  aiError.classList.remove('visible');
  aiLoading.classList.add('visible');
}

function hideLoading() {
  aiLoading.classList.remove('visible');
}

// ── Zone 1: Hero Card ────────────────────────────────────────

function renderSeasonHero(workout, log, pendingGarminMatch = null) {
  const rx = workout.prescription_json || {};
  const typeAbbr = TYPE_ICONS[workout.workout_type] || workout.workout_type?.toUpperCase()?.slice(0, 3) || '---';

  heroTypeTag.textContent = typeAbbr;
  heroDuration.innerHTML = workout.duration_minutes ? `${workout.duration_minutes}<span>m</span>` : '--<span>m</span>';
  heroTitle.textContent = workout.title || 'Today\'s Workout';

  // Workout-type-specific gradient tint
  const typeGradients = {
    strength: 'radial-gradient(ellipse 70% 60% at 15% 20%, rgba(239, 68, 68, 0.08), transparent 60%), radial-gradient(ellipse 60% 50% at 85% 80%, rgba(168, 85, 247, 0.06), transparent 60%), var(--bg-surface-1)',
    cardio: 'radial-gradient(ellipse 70% 60% at 15% 20%, rgba(200, 255, 0, 0.06), transparent 60%), radial-gradient(ellipse 60% 50% at 85% 80%, rgba(0, 100, 200, 0.08), transparent 60%), var(--bg-surface-1)',
    recovery: 'radial-gradient(ellipse 70% 60% at 15% 20%, rgba(6, 182, 212, 0.08), transparent 60%), radial-gradient(ellipse 60% 50% at 85% 80%, rgba(74, 222, 128, 0.06), transparent 60%), var(--bg-surface-1)',
    mixed: 'radial-gradient(ellipse 70% 60% at 15% 20%, rgba(245, 158, 11, 0.08), transparent 60%), radial-gradient(ellipse 60% 50% at 85% 80%, rgba(200, 255, 0, 0.06), transparent 60%), var(--bg-surface-1)',
    rest: 'radial-gradient(ellipse 70% 60% at 50% 50%, rgba(85, 85, 85, 0.06), transparent 60%), var(--bg-surface-1)',
  };
  const inner = heroCard.querySelector('.hero-card-inner');
  if (inner) inner.style.background = typeGradients[workout.workout_type] || typeGradients.cardio;

  // Build context string from readiness + workout intensity
  let context = rx.description || '';
  if (readinessData) {
    const sleep = readinessData.sleep_score || 0;
    const bb = readinessData.body_battery || 0;
    const hrv = (readinessData.hrv_status || '').toLowerCase();
    const intensity = (workout.intensity || 'moderate').toLowerCase();

    // Readiness assessment
    const readinessGood = sleep >= 70 && (hrv === 'balanced' || hrv === 'high');
    const readinessPoor = sleep < 50 || hrv === 'low' || bb < 30;

    if (readinessGood && intensity === 'low') {
      // Good recovery but easy day planned — explain the periodization
      context = `Recovery looks great (${sleep} sleep, ${hrv} HRV). Today's easy session is strategic — building aerobic base while staying fresh for harder days ahead.`;
    } else if (readinessGood && intensity === 'high') {
      context = `You're well recovered (${sleep} sleep, ${hrv} HRV) — perfect day to push hard.`;
    } else if (readinessGood) {
      context = `Good recovery (${sleep} sleep, ${hrv} HRV). Solid day for ${intensity} effort.`;
    } else if (readinessPoor && intensity === 'high') {
      context = `Recovery indicators are low (${sleep} sleep${bb ? `, ${bb} battery` : ''}). Consider dialing back intensity today.`;
    } else if (readinessPoor) {
      context = `Recovery is below baseline. Listen to your body and don't push beyond what feels right.`;
    } else {
      context = `Your ${sleep} sleep score and ${hrv || 'steady'} HRV support ${intensity} effort today.`;
    }
  }
  heroContext.textContent = context;

  // Coaching notes (Item 1)
  const heroCoachNotes = document.getElementById('heroCoachNotes');
  if (heroCoachNotes) {
    heroCoachNotes.innerHTML = buildCoachingNotes(readinessData, workout);
  }

  // Garmin match confirmation banner — show detected activity for user to confirm
  const existingBanner = heroCard.querySelector('.garmin-confirm-banner');
  if (existingBanner) existingBanner.remove();

  if (pendingGarminMatch && !(log && log.status === 'completed')) {
    const durMin = pendingGarminMatch.duration_seconds ? Math.round(pendingGarminMatch.duration_seconds / 60) : '--';
    const banner = document.createElement('div');
    banner.className = 'garmin-confirm-banner';
    banner.innerHTML = `
      <div class="garmin-confirm-header">
        <span class="garmin-confirm-icon">GARMIN</span>
        <span class="garmin-confirm-label">Activity detected</span>
      </div>
      <div class="garmin-confirm-detail">
        ${esc(pendingGarminMatch.name || pendingGarminMatch.activity_type)} · ${durMin} min${pendingGarminMatch.avg_heart_rate ? ` · ${pendingGarminMatch.avg_heart_rate} avg HR` : ''}
      </div>
      <div class="garmin-confirm-actions">
        <button class="btn-primary garmin-confirm-yes">Confirm match</button>
        <button class="btn-ghost garmin-confirm-no">Not this one</button>
      </div>
    `;
    heroCard.querySelector('.hero-card-inner').appendChild(banner);

    banner.querySelector('.garmin-confirm-yes').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Saving...';
      try {
        const result = await submitWorkoutLog(
          workout.id, 'completed',
          { source_activity: pendingGarminMatch, duration_minutes: durMin },
          pendingGarminMatch.activity_id, null, 'garmin_confirmed'
        );
        banner.remove();
        renderSeasonHero(workout, {
          status: 'completed', source: 'garmin_confirmed',
          adherence_score: result?.adherence_score,
          garmin_activity_id: pendingGarminMatch.activity_id,
        });
        // Refresh timeline to show the checkmark
        loadAllZones();
      } catch (err) {
        btn.textContent = 'Error — try again';
        btn.disabled = false;
      }
    });

    banner.querySelector('.garmin-confirm-no').addEventListener('click', () => {
      banner.classList.add('dismissed');
      setTimeout(() => banner.remove(), 300);
    });
  }

  // Start button behavior
  if (log && log.status === 'completed') {
    heroStartBtn.textContent = 'Completed ✓';
    heroStartBtn.style.background = 'var(--status-green)';
    heroStartBtn.style.boxShadow = '0 0 20px rgba(74, 222, 128, 0.2)';
    heroStartBtn.disabled = true;
  } else {
    heroStartBtn.innerHTML = 'Start Workout <svg viewBox="0 0 24 24"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>';
    heroStartBtn.style.background = '';
    heroStartBtn.style.boxShadow = '';
    heroStartBtn.disabled = false;
  }

  // Click opens day detail
  heroStartBtn.onclick = () => {
    if (!heroStartBtn.disabled) {
      openDayDetail(workout, getDayDetailContext());
    }
  };

  heroCard.style.display = '';
}

function renderHeroZone(todayData) {
  if (!todayData || !todayData.recommendation) {
    renderRestDayHero();
    return;
  }

  const rec = todayData.recommendation;
  const typeAbbr = TYPE_ICONS[rec.type] || rec.type?.toUpperCase()?.slice(0, 3) || '---';

  heroTypeTag.textContent = typeAbbr;
  heroDuration.innerHTML = rec.duration_minutes ? `${rec.duration_minutes}<span>m</span>` : '--<span>m</span>';
  heroTitle.textContent = rec.title || 'Today\'s Workout';

  let context = rec.description || '';
  if (readinessData && readinessData.sleep_score) {
    const parts = [];
    if (readinessData.sleep_score) parts.push(`${readinessData.sleep_score} sleep score`);
    if (readinessData.hrv_status) parts.push(`${readinessData.hrv_status.toLowerCase()} HRV`);
    if (parts.length) {
      context = `Your ${parts.join(' and ')} suggest ${(rec.intensity || 'moderate').toLowerCase()} effort today.`;
    }
  }
  heroContext.textContent = context;
  heroCard.style.display = '';
}

function renderRestDayHero() {
  heroTypeTag.textContent = 'REST';
  heroDuration.innerHTML = '--<span>m</span>';
  heroTitle.textContent = 'Rest Day';

  let context = 'Recovery is part of the plan. Let your body adapt.';
  if (readinessData && readinessData.body_battery) {
    context = `Body battery at ${readinessData.body_battery}. Focus on recovery and mobility today.`;
  }
  heroContext.textContent = context;

  // Rest day guidance (Item 3)
  const heroCoachNotes = document.getElementById('heroCoachNotes');
  if (heroCoachNotes) {
    heroCoachNotes.innerHTML = buildRestDayGuidance(readinessData);
  }

  heroStartBtn.innerHTML = 'Rest Day';
  heroStartBtn.style.background = 'var(--bg-surface-3)';
  heroStartBtn.style.boxShadow = 'none';
  heroStartBtn.style.color = 'var(--text-secondary)';
  heroStartBtn.disabled = true;
  heroCard.style.display = '';
}

// ── Zone 2: Timeline ─────────────────────────────────────────

let _timelineWeek = null; // tracks which week the timeline is showing

function findGoalWorkoutId(workouts, milestones, weekNum) {
  // Find the milestone for this week
  const milestone = (milestones || []).find(m => {
    const match = (m.timeframe || '').match(/week\s*(\d+)/i);
    return match && parseInt(match[1], 10) === weekNum;
  });
  if (!milestone) return null;

  const goalText = (milestone.goal || '').toLowerCase();

  // Match goal keywords to workout attributes
  // "threshold effort" → high intensity cardio
  // "continuous run" → longer cardio
  // "VO2max intervals" → high intensity cardio
  // "strength" → strength workout
  const candidates = workouts.filter(w => w.workout_type !== 'rest');
  if (!candidates.length) return null;

  // Score each workout by relevance to the goal
  let best = null;
  let bestScore = -1;

  for (const w of candidates) {
    let score = 0;
    const title = (w.title || '').toLowerCase();
    const type = w.workout_type || '';
    const intensity = (w.intensity || '').toLowerCase();

    // Type matching
    if (goalText.includes('run') && type === 'cardio') score += 3;
    if (goalText.includes('threshold') && intensity === 'high') score += 4;
    if (goalText.includes('tempo') && intensity === 'moderate') score += 4;
    if (goalText.includes('interval') && intensity === 'high') score += 4;
    if (goalText.includes('vo2') && intensity === 'high') score += 4;
    if (goalText.includes('strength') && type === 'strength') score += 4;
    if (goalText.includes('aerobic') && type === 'cardio') score += 3;
    if (goalText.includes('endurance') && type === 'cardio') score += 3;
    if (goalText.includes('recovery') && type === 'recovery') score += 3;

    // Duration matching — longer workouts more likely to be the goal workout
    if (w.duration_minutes && w.duration_minutes >= 40) score += 1;

    // Title keyword overlap
    const goalWords = goalText.split(/\s+/).filter(w => w.length > 3);
    for (const gw of goalWords) {
      if (title.includes(gw)) score += 2;
    }

    if (score > bestScore) {
      bestScore = score;
      best = w;
    }
  }

  return bestScore > 0 && best ? best.id : null;
}

function renderSeasonTimeline(workouts, logMap, today, displayWeek) {
  const weekNum = displayWeek || seasonState.currentWeek;
  _timelineWeek = weekNum;
  const phase = getCurrentPhase(activeSeason.plan_json || {}, weekNum);
  const isCurrentWeek = weekNum === seasonState.currentWeek;
  const goalWorkoutId = findGoalWorkoutId(workouts, activeSeason.plan_json?.milestones, weekNum);

  weekTitle.textContent = isCurrentWeek ? `Week ${weekNum}` : `Week ${weekNum}`;
  weekSubtitle.textContent = phase ? phase.name : '';

  // Show/hide nav arrows
  const prevBtn = document.getElementById('tlPrevWeek');
  const nextBtn = document.getElementById('tlNextWeek');
  if (prevBtn) {
    prevBtn.style.display = weekNum > 1 ? '' : 'none';
    prevBtn.onclick = () => navigateTimelineWeek(weekNum - 1);
  }
  if (nextBtn) {
    nextBtn.style.display = weekNum < activeSeason.duration_weeks ? '' : 'none';
    nextBtn.onclick = () => navigateTimelineWeek(weekNum + 1);
  }

  const dayAbbrs = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  // Calculate streak for visual momentum
  let streak = 0;
  for (const w of workouts) {
    if (w.date > today) break;
    if (w.workout_type === 'rest') { streak++; continue; }
    const log = logMap.get(w.id);
    if (log && (log.status === 'completed' || log.status === 'partial')) { streak++; }
    else if (w.date < today) { streak = 0; }
  }

  timelineScroll.innerHTML = workouts.map((w, idx) => {
    const d = new Date(w.date + 'T00:00:00');
    const abbr = dayAbbrs[d.getDay()];
    const isToday = w.date === today;
    const isPast = w.date < today;
    const log = logMap.get(w.id);
    const isCompleted = log && log.status === 'completed';
    const isPartial = log && log.status === 'partial';
    const isSkipped = log && log.status === 'skipped';
    const isMissed = isPast && !isToday && !log && w.workout_type !== 'rest';
    const isRest = w.workout_type === 'rest';
    const typeAbbr = TYPE_ICONS[w.workout_type] || '—';

    // Determine visual state class
    let stateClass = '';
    if (isCompleted) stateClass = ' is-completed';
    else if (isPartial) stateClass = ' is-partial';
    else if (isSkipped) stateClass = ' is-skipped';
    else if (isMissed) stateClass = ' is-missed';
    else if (isRest && isPast) stateClass = ' is-completed';

    let statusHtml = '';
    if (isCompleted || (isRest && isPast)) {
      statusHtml = '<span class="tl-day-check"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></span>';
    } else if (isPartial) {
      statusHtml = '<span class="tl-day-partial">~</span>';
    } else if (isMissed) {
      statusHtml = '<span class="tl-day-missed">—</span>';
    } else if (w.duration_minutes) {
      statusHtml = `<span class="tl-day-dur">${w.duration_minutes}m</span>`;
    }

    // Adherence score for completed workouts
    let adherenceHtml = '';
    if (log && log.adherence_score != null && isCompleted) {
      adherenceHtml = `<span class="tl-day-adherence">${Math.round(log.adherence_score)}%</span>`;
    }

    const isGoalDay = w.id === goalWorkoutId;

    return `
      <div class="tl-day${isToday ? ' is-today' : ''}${isPast && !isToday ? ' is-past' : ''}${stateClass}${isGoalDay ? ' is-goal' : ''}" data-workout-id="${w.id}" data-day-idx="${idx}">
        ${isGoalDay ? '<span class="tl-goal-badge">🎯</span>' : ''}
        <span class="tl-day-abbr">${abbr}</span>
        <span class="tl-day-type">${typeAbbr}</span>
        ${statusHtml}
        ${adherenceHtml}
      </div>
    `;
  }).join('');

  // Scroll today into view
  requestAnimationFrame(() => {
    const todayCard = timelineScroll.querySelector('.tl-day.is-today');
    if (todayCard) {
      todayCard.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  });

  // Day card click → open day detail
  timelineScroll.querySelectorAll('.tl-day').forEach(card => {
    card.addEventListener('click', async () => {
      const idx = parseInt(card.dataset.dayIdx);
      const workout = workouts[idx];
      if (!workout) return;
      openDayDetail(workout, getDayDetailContext());
    });
  });

  zoneWeek.style.display = '';
}

function renderTimelineZone(weekData) {
  const days = weekData.days || [];
  const today = new Date().toISOString().split('T')[0];
  weekTitle.textContent = 'This Week';
  weekSubtitle.textContent = weekData.weekly_summary || '';

  timelineScroll.innerHTML = days.map((d, idx) => {
    const isToday = d.date === today || d.is_today;
    const isPast = d.date < today && !isToday;
    const typeAbbr = TYPE_ICONS[d.type] || '—';

    return `
      <div class="tl-day${isToday ? ' is-today' : ''}${isPast ? ' is-past' : ''}" data-day-idx="${idx}">
        <span class="tl-day-abbr">${(d.day_name || '').slice(0, 3).toUpperCase()}</span>
        <span class="tl-day-type">${typeAbbr}</span>
        ${d.duration_minutes ? `<span class="tl-day-dur">${d.duration_minutes}m</span>` : ''}
      </div>
    `;
  }).join('');

  requestAnimationFrame(() => {
    const todayCard = timelineScroll.querySelector('.tl-day.is-today');
    if (todayCard) todayCard.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  });

  zoneWeek.style.display = '';
}

// ── Zone 3: Plan Overview ────────────────────────────────────

function renderCurrentMilestone(milestones, currentWeek) {
  const container = document.getElementById('milestoneBanner');
  if (!container) return;

  if (!milestones.length) {
    container.style.display = 'none';
    return;
  }

  // Find the current or next upcoming milestone
  // Milestones have timeframe like "Week 2", "Week 4", "Week 6", "Week 8"
  let current = null;
  let next = null;

  for (const m of milestones) {
    const weekMatch = (m.timeframe || '').match(/week\s*(\d+)/i);
    if (!weekMatch) continue;
    const mWeek = parseInt(weekMatch[1], 10);

    if (mWeek === currentWeek) {
      current = { ...m, week: mWeek };
    } else if (mWeek > currentWeek && !next) {
      next = { ...m, week: mWeek };
    }
  }

  const milestone = current || next;
  if (!milestone) {
    container.style.display = 'none';
    return;
  }

  const isCurrent = milestone.week === currentWeek;
  const label = isCurrent ? 'This Week\'s Goal' : `Week ${milestone.week} Goal`;
  const icon = isCurrent ? '🎯' : '📍';

  container.innerHTML = `
    <div class="milestone-card${isCurrent ? ' is-current' : ''}">
      <div class="milestone-card-icon">${icon}</div>
      <div class="milestone-card-content">
        <div class="milestone-card-label">${esc(label)}</div>
        <div class="milestone-card-goal">${esc(milestone.goal)}</div>
      </div>
      ${!isCurrent ? `<div class="milestone-card-when">${esc(milestone.timeframe)}</div>` : ''}
    </div>
  `;
  container.style.display = '';
}

async function navigateTimelineWeek(weekNum) {
  if (!activeSeason || weekNum < 1 || weekNum > activeSeason.duration_weeks) return;

  const today = new Date().toISOString().split('T')[0];

  // Fetch workouts + logs for the target week
  const weekWorkouts = await getWeekWorkoutsByWeekNumber(activeSeason.id, weekNum);
  const allLogs = await getWorkoutLogsForSeason(activeSeason.id);
  const logMap = new Map(allLogs.map(l => [l.workout_id, l]));

  renderSeasonTimeline(weekWorkouts, logMap, today, weekNum);

  // Update week summary for the navigated week
  renderWeekSummary(weekWorkouts, logMap, seasonState, activeSeason.plan_json || {});

  // Update milestone banner for the navigated week
  renderCurrentMilestone(activeSeason.plan_json?.milestones || [], weekNum);
}

function renderPlanOverview(plan) {
  if (!activeSeason || !plan) {
    zonePlan.style.display = 'none';
    return;
  }

  planName.textContent = activeSeason.name || 'Training Plan';
  planMeta.textContent = `Week ${seasonState.currentWeek} of ${activeSeason.duration_weeks} · ${seasonState.daysRemaining} days left`;
  planProgressFillNew.style.width = `${seasonState.progressPct}%`;

  // Fill plan detail content
  const planSummaryEl = document.getElementById('planSummary');
  planSummaryEl.textContent = plan.summary || '';

  // Season stats
  const overviewEl = document.getElementById('planOverview');
  if (overviewEl) {
    overviewEl.style.display = 'flex';
    overviewEl.innerHTML = `
      <div class="plan-stat"><div class="plan-stat-val">${activeSeason.duration_weeks}</div><div class="plan-stat-label">Weeks</div></div>
      <div class="plan-stat"><div class="plan-stat-val">${(plan.phases || []).length}</div><div class="plan-stat-label">Phases</div></div>
    `;
  }

  // Assessment — athlete profile card
  const ca = plan.current_assessment || {};
  const assessGrid = document.getElementById('planAssessment');

  const levelColors = {
    beginner: '#06b6d4',
    intermediate: '#f59e0b',
    advanced: 'var(--accent)',
  };
  const lvl = (ca.fitness_level || '').toLowerCase();
  const lvlColor = levelColors[lvl] || 'var(--text-secondary)';

  assessGrid.innerHTML = `
    <div class="athlete-profile">
      <div class="ap-header">
        <div class="ap-level" style="color:${lvlColor};border-color:${lvlColor}">
          ${esc(ca.fitness_level || '--')}
        </div>
        <div class="ap-meta">
          <span class="ap-meta-label">Training Age</span>
          <span class="ap-meta-val">${esc(ca.training_age_estimate || '--')}</span>
        </div>
      </div>
      <div class="ap-section">
        <div class="ap-section-label">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${'var(--accent)'}" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
          Strengths
        </div>
        <div class="ap-tags">
          ${(ca.strengths || []).map(s => `<span class="ap-tag strength">${esc(s)}</span>`).join('')}
        </div>
      </div>
      <div class="ap-section">
        <div class="ap-section-label">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M12 20V10M18 20V4M6 20v-4"/></svg>
          Focus Areas
        </div>
        <div class="ap-tags">
          ${(ca.areas_to_improve || []).map(s => `<span class="ap-tag improve">${esc(s)}</span>`).join('')}
        </div>
      </div>
    </div>
  `;

  // Recovery signals (Item 6)
  renderRecoverySignals(readinessData);

  // Phase timeline
  const currentWeek = seasonState?.currentWeek || 1;
  const timeline = document.getElementById('planTimeline');
  timeline.innerHTML = (plan.phases || []).map((p) => {
    const weeks = p.weeks || [p.week];
    const isCurrent = weeks.some(w => w === currentWeek);

    return `
      <div class="phase-node${isCurrent ? ' current' : ''}">
        <div class="phase-week">Week${weeks.length > 1 ? 's' : ''} ${weeks.join('-')}${isCurrent ? ' (current)' : ''}</div>
        <div class="phase-name-text">${esc(p.name || '')}</div>
        <div class="phase-focus">${esc(p.focus || '')}</div>
      </div>
    `;
  }).join('');

  // Season overview stats
  const overviewContainer = document.getElementById('seasonOverviewContainer');
  if (overviewContainer && activeSeason) {
    renderSeasonOverview(overviewContainer, activeSeason.id, currentWeek);
  }

  // Goal tracker
  const goalContainer = document.getElementById('goalTrackerContainer');
  if (goalContainer && activeSeason) {
    renderGoalTracker(goalContainer, activeSeason.id);
  }

  // Principles
  const principlesList = document.getElementById('planPrinciples');
  if (plan.principles && plan.principles.length) {
    principlesList.style.display = '';
    principlesList.innerHTML = plan.principles.map(p => `<li>${esc(p)}</li>`).join('');
  }

  // Milestones — render current/upcoming milestone in the timeline zone,
  // not buried in the collapsible plan detail
  const milestonesList = document.getElementById('planMilestones');
  if (milestonesList) milestonesList.style.display = 'none'; // hide from plan detail

  renderCurrentMilestone(plan.milestones || [], currentWeek);

  zonePlan.style.display = '';
}

// ── Coaching Notes (Item 1) ──────────────────────────────────

function buildCoachingNotes(rd, workout) {
  if (!rd) return '';
  const notes = [];
  const sleep = rd.sleep_score || 0;
  const bb = rd.body_battery || 0;
  const hrv = (rd.hrv_status || '').toLowerCase();
  const stress = rd.stress_avg || 0;

  if (sleep < 60) {
    notes.push({ color: 'red', text: 'Sleep was below optimal — prioritize form over intensity. Stop if you feel dizzy.' });
  } else if (sleep > 80) {
    notes.push({ color: 'green', text: 'Great sleep — you have room to push for progressive overload today.' });
  }

  if (bb < 40) {
    notes.push({ color: 'yellow', text: 'Low energy reserves — consider reducing sets by 1 or shortening rest periods.' });
  } else if (bb > 70) {
    notes.push({ color: 'green', text: 'Strong energy reserves — you\'re primed for a solid session.' });
  }

  if (hrv === 'low' || hrv === 'unbalanced') {
    notes.push({ color: 'yellow', text: 'Your nervous system is still recovering — keep intensity moderate and avoid max efforts.' });
  } else if ((hrv === 'balanced' || hrv === 'high') && sleep > 80 && bb > 70) {
    notes.push({ color: 'green', text: 'Great recovery across the board — push for progressive overload today.' });
  }

  if (stress > 50) {
    notes.push({ color: 'yellow', text: 'Elevated stress detected — breathing exercises between sets will help.' });
  }

  // Workout-type-specific cues
  const rx = workout.prescription_json || {};
  if (workout.workout_type === 'cardio') {
    notes.push({ color: 'blue', text: `Target zone: ${(workout.intensity || 'moderate').toLowerCase()} effort — aim for ${workout.duration_minutes || '--'} minutes` });
  } else if (workout.workout_type === 'strength' && rx.notes) {
    notes.push({ color: 'blue', text: `Focus cues: ${rx.notes}` });
  }

  if (!notes.length) return '';
  return notes.map(n =>
    `<div class="coach-note-item"><span class="coach-note-dot ${n.color}"></span><span>${esc(n.text)}</span></div>`
  ).join('');
}

// ── Rest Day Guidance (Item 3) ──────────────────────────────

function buildRestDayGuidance(rd) {
  if (!rd) return '';
  const notes = [];
  const bb = rd.body_battery || 0;
  const stress = rd.stress_avg || 0;

  if (bb < 30) {
    notes.push({ color: 'red', text: 'Priority: sleep and hydration. Skip all activity today.' });
  } else if (bb <= 60) {
    notes.push({ color: 'yellow', text: 'Light mobility work: 10-15 min foam rolling or gentle yoga' });
  } else {
    notes.push({ color: 'green', text: 'Active recovery: 20-30 min easy walk, light swim, or stretching' });
  }

  if (stress > 50) {
    notes.push({ color: 'yellow', text: 'Consider: 10 min guided breathing or meditation' });
  }

  if (!notes.length) return '';
  return notes.map(n =>
    `<div class="coach-note-item"><span class="coach-note-dot ${n.color}"></span><span>${esc(n.text)}</span></div>`
  ).join('');
}

// ── Week Summary (Item 5) ───────────────────────────────────

function renderWeekSummary(weekWorkouts, logMap, state, plan) {
  const container = document.getElementById('weekSummary');
  if (!container) return;

  const today = new Date().toISOString().split('T')[0];
  const total = weekWorkouts.filter(w => w.workout_type !== 'rest').length;
  let completed = 0;
  let adherenceSum = 0;
  let adherenceCount = 0;
  let adaptedCount = 0;
  let missedCount = 0;

  for (const w of weekWorkouts) {
    if (w.workout_type === 'rest') continue;
    const log = logMap.get(w.id);
    if (log && log.status === 'completed') {
      completed++;
      if (log.adherence_score != null) {
        adherenceSum += log.adherence_score;
        adherenceCount++;
      }
    } else if (w.date < today && !log) {
      missedCount++;
    }
    if (w.is_adapted) adaptedCount++;
  }

  const avgAdherence = adherenceCount > 0 ? Math.round(adherenceSum / adherenceCount) : null;

  // Forward-looking: next week's phase
  const nextWeek = (state?.currentWeek || 1) + 1;
  const nextPhase = getCurrentPhase(plan, nextWeek);

  // Build coaching narrative based on progress
  const remaining = total - completed - missedCount;
  const dayOfWeek = new Date().getDay(); // 0=Sun
  const narrative = buildWeekNarrative(completed, total, remaining, missedCount, avgAdherence, dayOfWeek, weekWorkouts, logMap, today);

  let html = '';
  if (narrative) {
    html += `<div class="week-summary-narrative">${esc(narrative)}</div>`;
  }
  html += '<div class="week-summary">';
  html += `<div class="week-summary-stat"><strong>${completed}</strong> of <strong>${total}</strong> workouts</div>`;
  html += '<div class="week-summary-divider"></div>';
  if (avgAdherence !== null) {
    html += `<div class="week-summary-stat"><strong>${avgAdherence}%</strong> avg adherence</div>`;
    html += '<div class="week-summary-divider"></div>';
  }
  if (adaptedCount > 0) {
    html += `<div class="week-summary-stat"><strong>${adaptedCount}</strong> adapted</div>`;
    html += '<div class="week-summary-divider"></div>';
  }
  if (missedCount > 0) {
    html += `<div class="week-summary-stat"><strong>${missedCount}</strong> missed</div>`;
    html += '<div class="week-summary-divider"></div>';
  }
  if (nextPhase) {
    html += `<div class="week-summary-phase">Next: ${esc(nextPhase.name)}</div>`;
  }
  html += '</div>';

  container.innerHTML = html;
}

// ── Week Narrative ──────────────────────────────────────────

function buildWeekNarrative(completed, total, remaining, missed, avgAdherence, dayOfWeek, workouts, logMap, today) {
  if (total === 0) return '';

  // All done
  if (completed === total && missed === 0) {
    return 'All workouts completed this week — great consistency.';
  }

  // Perfect so far, more to go
  if (completed > 0 && missed === 0 && remaining > 0) {
    // Describe what's next
    const nextWorkout = workouts.find(w => w.date >= today && w.workout_type !== 'rest' && !logMap.get(w.id));
    const nextType = nextWorkout ? nextWorkout.workout_type : null;
    if (remaining === 1 && nextType) {
      return `One ${nextType} session left to close out the week.`;
    }
    return `On track — ${remaining} session${remaining > 1 ? 's' : ''} remaining this week.`;
  }

  // Some missed
  if (missed > 0 && completed > 0) {
    if (remaining > 0) {
      return `${completed} done, ${remaining} left — stay with it.`;
    }
    return `${completed} of ${total} completed this week. Every session counts.`;
  }

  // Nothing done yet, early in week
  if (completed === 0 && dayOfWeek <= 2) {
    return `${total} sessions planned this week — let's get started.`;
  }

  // Nothing done, mid/late week
  if (completed === 0 && missed > 0) {
    return `${remaining} session${remaining > 1 ? 's' : ''} still ahead — pick one and go.`;
  }

  return '';
}

// ── Recovery Signals (Item 6) ───────────────────────────────

function renderRecoverySignals(rd) {
  const container = document.getElementById('recoverySignals');
  if (!container) return;
  if (!rd) { container.innerHTML = ''; return; }

  const signals = [
    {
      label: 'Sleep Score',
      value: rd.sleep_score ?? '--',
      threshold: '< 60',
      isAlert: (rd.sleep_score || 0) < 60,
      isWarn: (rd.sleep_score || 0) < 70 && (rd.sleep_score || 0) >= 60,
      action: 'Intensity may be reduced',
    },
    {
      label: 'Body Battery',
      value: rd.body_battery ?? '--',
      threshold: '< 30',
      isAlert: (rd.body_battery || 0) < 30,
      isWarn: (rd.body_battery || 0) < 60 && (rd.body_battery || 0) >= 30,
      action: 'Workout volume may be reduced',
    },
    {
      label: 'HRV Status',
      value: rd.hrv_status || '--',
      threshold: 'low / unbalanced',
      isAlert: ['low', 'unbalanced'].includes((rd.hrv_status || '').toLowerCase()),
      isWarn: false,
      action: 'Max efforts may be limited',
    },
    {
      label: 'Stress Avg',
      value: rd.stress_avg ?? '--',
      threshold: '> 50',
      isAlert: (rd.stress_avg || 0) > 50,
      isWarn: (rd.stress_avg || 0) > 40 && (rd.stress_avg || 0) <= 50,
      action: 'Recovery activities recommended',
    },
  ];

  let html = '<div class="recovery-signals">';
  html += '<div class="recovery-signals-title">Recovery Signals</div>';

  for (const s of signals) {
    const dotClass = s.isAlert ? 'alert' : s.isWarn ? 'warn' : 'ok';
    const statusText = s.isAlert ? 'ALERT' : s.isWarn ? 'WATCH' : 'OK';
    html += `
      <div class="recovery-signal-row">
        <div class="recovery-signal-label">${esc(s.label)}</div>
        <div class="recovery-signal-value">${esc(String(s.value))}</div>
        <div class="recovery-signal-status">
          <span class="recovery-signal-dot ${dotClass}"></span>
          ${statusText}
        </div>
      </div>
      ${s.isAlert ? `<div class="recovery-signal-action">&rarr; ${esc(s.action)}</div>` : ''}
    `;
  }

  html += '</div>';
  container.innerHTML = html;
}

// ── Plan Config Summary (Item 7) ────────────────────────────

function renderPlanConfigSummary(season) {
  const container = document.getElementById('planConfigSummary');
  const prefsSection = document.getElementById('prefsSection');
  if (!container) return;

  if (!season) {
    // No active season — show editable prefs, hide summary
    container.innerHTML = '';
    if (prefsSection) prefsSection.style.display = '';
    return;
  }

  // Active season — hide editable prefs, show read-only summary
  if (prefsSection) prefsSection.style.display = 'none';

  const config = season.plan_config || {};
  const prefs = season.preferences_snapshot || {};
  const currentWeek = seasonState?.currentWeek || 1;

  const trainingType = config.training_type || prefs.goals || '--';
  const skillLevel = config.skill_level || prefs.experience || '--';
  const daysPerWeek = config.days_per_week || '--';
  const duration = season.duration_weeks || '--';
  const preferred = config.preferred_activities || [];
  const avoided = config.avoided_exercises || [];
  const injuries = config.injuries || prefs.injuries || '';

  let html = '<div class="plan-config-summary">';
  html += '<div class="plan-config-title">Plan Configuration</div>';
  html += '<div class="plan-config-grid">';

  html += `<div class="plan-config-item"><div class="plan-config-label">Training Type</div><div class="plan-config-val">${esc(String(trainingType))}</div></div>`;
  html += `<div class="plan-config-item"><div class="plan-config-label">Skill Level</div><div class="plan-config-val">${esc(String(skillLevel))}</div></div>`;
  html += `<div class="plan-config-item"><div class="plan-config-label">Days / Week</div><div class="plan-config-val">${esc(String(daysPerWeek))}</div></div>`;
  html += `<div class="plan-config-item"><div class="plan-config-label">Duration</div><div class="plan-config-val">${esc(String(duration))} weeks (Week ${currentWeek})</div></div>`;

  if (preferred.length) {
    html += `<div class="plan-config-item full-width"><div class="plan-config-label">Preferred Activities</div><div class="plan-config-pills">${preferred.map(a => `<span class="plan-config-pill">${esc(a)}</span>`).join('')}</div></div>`;
  }

  if (avoided.length) {
    html += `<div class="plan-config-item full-width"><div class="plan-config-label">Avoiding</div><div class="plan-config-pills">${avoided.map(a => `<span class="plan-config-pill avoid">${esc(a)}</span>`).join('')}</div></div>`;
  }

  if (injuries) {
    html += `<div class="plan-config-item full-width"><div class="plan-config-label">Injuries / Notes</div><div class="plan-config-val">${esc(injuries)}</div></div>`;
  }

  html += '</div>';
  html += '<div class="plan-config-note">Preferences are locked during an active season. Use "Stop & Restart" to create a new plan with different settings.</div>';
  html += '</div>';

  container.innerHTML = html;
}

// ── Helpers ──────────────────────────────────────────────────

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

function renderAlerts(containerId, alerts) {
  const el = document.getElementById(containerId);
  if (!el) return;
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
  toggle.style.display = '';

  toggle.addEventListener('click', () => {
    overflowBackdrop.classList.remove('visible');
    const isOpen = container.classList.contains('visible');
    section.style.display = '';
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
    loadView: () => loadAllZones(),
    get currentView() { return 'week'; },
  };
}

function normalizePrescription(rx) {
  if (!rx) return { warmup: null, main_workout: [], cooldown: null };
  const warmup = Array.isArray(rx.warmup)
    ? { duration_minutes: 5, activities: rx.warmup }
    : rx.warmup || null;
  const main_workout = rx.exercises || rx.main_workout || [];
  const cooldown = Array.isArray(rx.cooldown)
    ? { duration_minutes: 5, activities: rx.cooldown }
    : rx.cooldown || null;
  return { warmup, main_workout, cooldown };
}

// ── Legacy compat: keep these functions for modules that import context
function renderView() { loadAllZones(); }
function loadView() { loadAllZones(); }

// ── Init ─────────────────────────────────────────────────────

if (isSupabaseConfigured()) {
  refreshDashboard();
}
