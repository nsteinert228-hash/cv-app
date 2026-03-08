// Training AI Dashboard — auth, preferences, view switching, AI content rendering
import { isSupabaseConfigured } from './supabase.js';
import { createAuthUI } from './authUI.js';
import {
  getTrainingRecommendation,
  getTodayReadiness,
  getRecentWorkouts,
  getTrainingPreferences,
  saveTrainingPreferences,
} from './trainingData.js';

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

// ── State ────────────────────────────────────────────────────

let currentView = 'today';
let currentUser = null;
const viewCache = {}; // { today: { data, fetchedAt }, week: {...}, plan: {...} }
let preferences = {};
let prefSaveTimer = null;

// ── Auth ─────────────────────────────────────────────────────

const authUI = createAuthUI();
authUI.init({
  onSignIn() { refreshDashboard(); },
  onSignOut() {
    currentUser = null;
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
  // Clear view cache since prefs changed
  Object.keys(viewCache).forEach(k => delete viewCache[k]);

  // Debounce save
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
  loadView(currentView, true);
});

aiRetryBtn.addEventListener('click', () => {
  loadView(currentView);
});

// ── Main refresh ─────────────────────────────────────────────

async function refreshDashboard() {
  // Check auth
  try {
    const { getUser } = await import('./auth.js');
    currentUser = await getUser();
  } catch { currentUser = null; }

  if (!currentUser) {
    dashboardContent.classList.remove('visible');
    emptyState.style.display = '';
    return;
  }

  emptyState.style.display = 'none';
  dashboardContent.classList.add('visible');

  // Load preferences and readiness in parallel
  const [prefs] = await Promise.all([
    getTrainingPreferences().catch(() => ({})),
    loadReadinessHero(),
    loadQuickStats(),
  ]);

  preferences = prefs;
  setPrefsUI(prefs);

  // Load the active view
  loadView(currentView);
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

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function loadView(view, force = false) {
  // Check client cache
  if (!force && viewCache[view] && (Date.now() - viewCache[view].fetchedAt) < CACHE_TTL) {
    renderView(view, viewCache[view].data);
    return;
  }

  showLoading();

  try {
    const data = await getTrainingRecommendation(view, preferences, force);
    viewCache[view] = { data, fetchedAt: Date.now() };
    renderView(view, data);
  } catch (err) {
    console.error('AI recommendation error:', err);
    hideAllContent();
    aiErrorMsg.textContent = err.message || 'Something went wrong. Please try again.';
    aiError.classList.add('visible');
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

  // Controls
  controlsBar.style.display = '';
  disclaimer.style.display = '';

  const genAt = data._generated_at;
  if (genAt) {
    const mins = Math.round((Date.now() - new Date(genAt).getTime()) / 60000);
    generatedAtEl.textContent = mins < 1 ? 'Generated just now' : `Generated ${mins} min ago`;
    if (data._cached) generatedAtEl.textContent += ' (cached)';
  }
}

// ── Render: Today ────────────────────────────────────────────

function renderToday(data) {
  const container = document.getElementById('contentToday');

  // Readiness banner
  const ra = data.readiness_assessment || {};
  const banner = document.getElementById('todayReadinessBanner');
  banner.className = `readiness-banner ${ra.level || 'moderate'}`;
  document.getElementById('todayReadinessLevel').textContent = `${ra.level || 'moderate'} readiness`;
  document.getElementById('todayReadinessSummary').textContent = ra.summary || '';

  const factors = document.getElementById('todayReadinessFactors');
  factors.innerHTML = (ra.key_factors || []).map(f =>
    `<span class="readiness-factor">${esc(f)}</span>`
  ).join('');

  // Workout
  const rec = data.recommendation || {};
  document.getElementById('todayWorkoutTitle').textContent = rec.title || 'No recommendation';

  const badge = document.getElementById('todayIntensityBadge');
  badge.textContent = rec.intensity || '--';
  badge.className = `workout-badge ${rec.intensity || 'moderate'}`;

  document.getElementById('todayDuration').textContent = rec.duration_minutes ? `${rec.duration_minutes} min` : '';
  document.getElementById('todayWorkoutDesc').textContent = rec.description || '';

  // Warmup
  const warmup = rec.warmup;
  const warmupSection = document.getElementById('todayWarmup');
  if (warmup && warmup.activities && warmup.activities.length) {
    warmupSection.style.display = '';
    document.getElementById('todayWarmupItems').textContent =
      `${warmup.duration_minutes || 5} min — ${warmup.activities.join(', ')}`;
  } else {
    warmupSection.style.display = 'none';
  }

  // Exercise table
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

  // Cooldown
  const cooldown = rec.cooldown;
  const cooldownSection = document.getElementById('todayCooldown');
  if (cooldown && cooldown.activities && cooldown.activities.length) {
    cooldownSection.style.display = '';
    document.getElementById('todayCooldownItems').textContent =
      `${cooldown.duration_minutes || 5} min — ${cooldown.activities.join(', ')}`;
  } else {
    cooldownSection.style.display = 'none';
  }

  // Alerts
  renderAlerts('todayAlerts', data.alerts);

  // Nutrition
  const nutCard = document.getElementById('todayNutrition');
  if (data.nutrition_tip) {
    nutCard.style.display = '';
    document.getElementById('todayNutritionText').textContent = data.nutrition_tip;
  } else {
    nutCard.style.display = 'none';
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

  // Calendar
  const cal = document.getElementById('weekCalendar');
  const today = new Date().toISOString().split('T')[0];
  cal.innerHTML = (data.days || []).map(d => {
    const isPast = d.date < today;
    const isToday = d.date === today || d.is_today;
    return `
      <div class="day-card${isToday ? ' is-today' : ''}${isPast && !isToday ? ' is-past' : ''}">
        <div class="day-name">${esc(d.day_name || '')}</div>
        <div class="day-date">${esc(d.date || '')}</div>
        <div class="day-type-icon">${TYPE_ICONS[d.type] || '\u{1F3CB}'}</div>
        <div class="day-title">${esc(d.title || '')}</div>
        <div class="day-focus">${esc(d.focus || '')}</div>
        <div class="day-intensity-bar ${d.intensity || 'moderate'}"></div>
        <div class="day-duration">${d.duration_minutes ? `${d.duration_minutes} min` : ''}</div>
      </div>
    `;
  }).join('');

  // Weekly goals
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

  // Assessment
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

  // Phase timeline
  const timeline = document.getElementById('planTimeline');
  timeline.innerHTML = (data.phases || []).map((p, i) => `
    <div class="phase-node${i === 0 ? ' current' : ''}">
      <div class="phase-week">Week ${p.week}</div>
      <div class="phase-name-text">${esc(p.name || '')}</div>
      <div class="phase-focus">${esc(p.focus || '')}</div>
      <div class="phase-details">${esc(p.intensity_range || '')} · ${p.sessions_per_week || '?'} sessions/week</div>
      ${p.key_workouts && p.key_workouts.length ? `<ul class="phase-workouts">${p.key_workouts.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    </div>
  `).join('');

  // Principles
  const principlesCard = document.getElementById('planPrinciplesCard');
  const principlesList = document.getElementById('planPrinciples');
  if (data.principles && data.principles.length) {
    principlesCard.style.display = '';
    principlesList.innerHTML = data.principles.map(p => `<li>${esc(p)}</li>`).join('');
  } else {
    principlesCard.style.display = 'none';
  }

  // Milestones
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
