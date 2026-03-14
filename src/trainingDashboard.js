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
} from './seasonData.js';
import { renderWorkoutConfirmation } from './workoutLogger.js';
import { renderAdaptationFeed } from './adaptationFeed.js';
import { renderSeasonHistory } from './seasonHistory.js';
import { open as openDayDetail, close as closeDayDetail } from './dayDetail.js';
import { initPlanBuilder, destroyPlanBuilder } from './planBuilder.js';
import { renderWeeklyView, renderWeekByNumber } from './weeklyView.js';
import { initMorphAthlete } from './morphAthlete.js';

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
let stopMorphAthlete = null;

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

    // Start morphing athlete animation
    let stopOnboardingMorph = initMorphAthlete(
      document.getElementById('morphAthleteOnboarding'),
      document.getElementById('morphLabelOnboarding'),
    );

    try {
      await startNewSeason();
      if (stopOnboardingMorph) { stopOnboardingMorph(); stopOnboardingMorph = null; }
      onboardingBlock.classList.remove('visible');
      await loadSeasonState();
    } catch (err) {
      if (stopOnboardingMorph) { stopOnboardingMorph(); stopOnboardingMorph = null; }
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

  // Render Hero (today's workout)
  if (todayWorkout) {
    renderSeasonHero(todayWorkout, logMap.get(todayWorkout.id));
  } else {
    renderRestDayHero();
  }

  // Render week summary (Item 5)
  renderWeekSummary(weekWorkouts, logMap, seasonState, activeSeason.plan_json || {});

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
  // Start morphing athlete in the AI loading container
  if (stopMorphAthlete) stopMorphAthlete();
  stopMorphAthlete = initMorphAthlete(
    document.getElementById('morphAthleteLoading'),
    document.getElementById('morphLabelLoading'),
  );
}

function hideLoading() {
  aiLoading.classList.remove('visible');
  if (stopMorphAthlete) { stopMorphAthlete(); stopMorphAthlete = null; }
}

// ── Zone 1: Hero Card ────────────────────────────────────────

function renderSeasonHero(workout, log) {
  const rx = workout.prescription_json || {};
  const typeAbbr = TYPE_ICONS[workout.workout_type] || workout.workout_type?.toUpperCase()?.slice(0, 3) || '---';

  heroTypeTag.textContent = typeAbbr;
  heroDuration.innerHTML = workout.duration_minutes ? `${workout.duration_minutes}<span>m</span>` : '--<span>m</span>';
  heroTitle.textContent = workout.title || 'Today\'s Workout';

  // Build context string from readiness data
  let context = rx.description || '';
  if (readinessData) {
    const parts = [];
    if (readinessData.sleep_score) parts.push(`${readinessData.sleep_score} sleep score`);
    if (readinessData.hrv_status) parts.push(`${readinessData.hrv_status.toLowerCase()} HRV`);
    if (parts.length) {
      context = `Your ${parts.join(' and ')} suggest ${(workout.intensity || 'moderate').toLowerCase()} effort today.`;
    }
  }
  heroContext.textContent = context;

  // Coaching notes (Item 1)
  const heroCoachNotes = document.getElementById('heroCoachNotes');
  if (heroCoachNotes) {
    heroCoachNotes.innerHTML = buildCoachingNotes(readinessData, workout);
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

function renderSeasonTimeline(workouts, logMap, today) {
  const phase = getCurrentPhase(activeSeason.plan_json || {}, seasonState.currentWeek);
  weekTitle.textContent = `Week ${seasonState.currentWeek}`;
  weekSubtitle.textContent = phase ? phase.name : '';

  const dayAbbrs = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  timelineScroll.innerHTML = workouts.map((w, idx) => {
    const d = new Date(w.date + 'T00:00:00');
    const abbr = dayAbbrs[d.getDay()];
    const isToday = w.date === today;
    const isPast = w.date < today;
    const log = logMap.get(w.id);
    const isCompleted = log && log.status === 'completed';
    const typeAbbr = TYPE_ICONS[w.workout_type] || '—';

    let statusHtml = '';
    if (isCompleted) {
      statusHtml = '<span class="tl-day-check"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></span>';
    } else if (w.duration_minutes) {
      statusHtml = `<span class="tl-day-dur">${w.duration_minutes}m</span>`;
    }

    return `
      <div class="tl-day${isToday ? ' is-today' : ''}${isPast && !isToday ? ' is-past' : ''}" data-workout-id="${w.id}" data-day-idx="${idx}">
        <span class="tl-day-abbr">${abbr}</span>
        <span class="tl-day-type">${typeAbbr}</span>
        ${statusHtml}
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

  // Assessment
  const ca = plan.current_assessment || {};
  const assessGrid = document.getElementById('planAssessment');
  assessGrid.innerHTML = `
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

  // Principles
  const principlesList = document.getElementById('planPrinciples');
  if (plan.principles && plan.principles.length) {
    principlesList.style.display = '';
    principlesList.innerHTML = plan.principles.map(p => `<li>${esc(p)}</li>`).join('');
  }

  // Milestones
  const milestonesList = document.getElementById('planMilestones');
  if (plan.milestones && plan.milestones.length) {
    milestonesList.style.display = '';
    milestonesList.innerHTML = plan.milestones.map(m => `
      <div class="milestone-item">
        <span class="milestone-time">${esc(m.timeframe)}</span>
        <span class="milestone-goal">${esc(m.goal)}</span>
      </div>
    `).join('');
  }

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

  let html = '<div class="week-summary">';
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
