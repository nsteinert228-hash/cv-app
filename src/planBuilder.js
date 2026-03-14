// Plan Builder — step-by-step wizard for creating training plans
import { createSeason } from './seasonData.js';
import { saveTrainingPreferences } from './trainingData.js';
import { initMorphAthlete } from './morphAthlete.js';

const TRAINING_TYPES = [
  { id: 'endurance', label: 'Endurance', desc: 'Running, cycling, swimming — build aerobic base' },
  { id: 'strength', label: 'Strength', desc: 'Weightlifting, compound movements, progressive overload' },
  { id: 'crossfit', label: 'CrossFit', desc: 'Functional fitness, WODs, varied high-intensity' },
  { id: 'cycling', label: 'Cycling', desc: 'Road, mountain, or indoor cycling focus' },
  { id: 'triathlon', label: 'Triathlon', desc: 'Swim, bike, run — multi-sport training' },
  { id: 'hybrid', label: 'Hybrid', desc: 'Mix of strength and conditioning' },
];

const SKILL_LEVELS = [
  { id: 'beginner', label: 'Beginner', desc: 'New to structured training or returning after a long break' },
  { id: 'intermediate', label: 'Intermediate', desc: '6-24 months of consistent training' },
  { id: 'advanced', label: 'Advanced', desc: '2+ years, comfortable with periodization and progressive overload' },
];

const ACTIVITIES = [
  'Running', 'Cycling', 'Swimming', 'Rowing', 'Hiking',
  'Weightlifting', 'Yoga', 'Pilates', 'HIIT', 'Walking',
  'Rock Climbing', 'CrossFit', 'Martial Arts', 'Dance',
];

const AVOIDED_EXERCISES = [
  'Deadlift', 'Barbell Back Squat', 'Overhead Press', 'Bench Press',
  'Pull-ups', 'Lunges', 'Box Jumps', 'Burpees',
  'Barbell Row', 'Clean & Jerk', 'Snatch', 'Leg Press',
  'Running', 'Jump Rope',
];

const DURATION_OPTIONS = [4, 6, 8, 10, 12, 16];

// ── State ───────────────────────────────────────────────────

let currentStep = 0;
let builderData = {
  trainingType: null,
  skillLevel: null,
  preferredActivities: [],
  avoidedExercises: [],
  durationWeeks: 8,
  startDate: getNextMonday(),
  daysPerWeek: 5,
};
let containerEl = null;
let onComplete = null;

function getNextMonday() {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
}

// ── Public API ──────────────────────────────────────────────

export function initPlanBuilder(container, { onPlanCreated }) {
  containerEl = container;
  onComplete = onPlanCreated;
  currentStep = 0;
  builderData = {
    trainingType: null,
    skillLevel: null,
    preferredActivities: [],
    avoidedExercises: [],
    durationWeeks: 8,
    startDate: getNextMonday(),
    daysPerWeek: 5,
  };
  render();
}

export function destroyPlanBuilder() {
  if (containerEl) containerEl.innerHTML = '';
  containerEl = null;
}

// ── Render ──────────────────────────────────────────────────

function render() {
  if (!containerEl) return;

  const steps = ['Training Type', 'Skill Level', 'Preferences', 'Schedule', 'Review'];

  containerEl.innerHTML = `
    <div class="plan-builder">
      <div class="pb-header">
        <h2 class="pb-title">Build Your Training Plan</h2>
        <div class="pb-steps">
          ${steps.map((s, i) => `
            <div class="pb-step ${i === currentStep ? 'active' : ''} ${i < currentStep ? 'done' : ''}">
              <div class="pb-step-num">${i < currentStep ? '\u2713' : i + 1}</div>
              <div class="pb-step-label">${esc(s)}</div>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="pb-body" id="pbBody"></div>
      <div class="pb-nav">
        ${currentStep > 0 ? '<button class="btn-secondary" id="pbBack">Back</button>' : '<div></div>'}
        ${currentStep < 4 ? '<button class="btn-primary" id="pbNext">Next</button>' : ''}
      </div>
    </div>
  `;

  const body = document.getElementById('pbBody');
  switch (currentStep) {
    case 0: renderTrainingType(body); break;
    case 1: renderSkillLevel(body); break;
    case 2: renderPreferences(body); break;
    case 3: renderSchedule(body); break;
    case 4: renderReview(body); break;
  }

  const backBtn = document.getElementById('pbBack');
  const nextBtn = document.getElementById('pbNext');
  if (backBtn) backBtn.addEventListener('click', () => { currentStep--; render(); });
  if (nextBtn) nextBtn.addEventListener('click', () => {
    if (validateStep()) { currentStep++; render(); }
  });
}

function validateStep() {
  switch (currentStep) {
    case 0: return !!builderData.trainingType;
    case 1: return !!builderData.skillLevel;
    case 2: return true; // preferences are optional
    case 3: return builderData.durationWeeks > 0 && builderData.startDate;
    default: return true;
  }
}

// ── Step 1: Training Type ───────────────────────────────────

function renderTrainingType(body) {
  body.innerHTML = `
    <div class="pb-section-title">What are you training for?</div>
    <div class="pb-card-grid">
      ${TRAINING_TYPES.map(t => `
        <button class="pb-type-card ${builderData.trainingType === t.id ? 'selected' : ''}" data-type="${t.id}">
          <div class="pb-type-label">${esc(t.label)}</div>
          <div class="pb-type-desc">${esc(t.desc)}</div>
        </button>
      `).join('')}
    </div>
  `;

  body.querySelectorAll('.pb-type-card').forEach(card => {
    card.addEventListener('click', () => {
      builderData.trainingType = card.dataset.type;
      body.querySelectorAll('.pb-type-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
    });
  });
}

// ── Step 2: Skill Level ─────────────────────────────────────

function renderSkillLevel(body) {
  body.innerHTML = `
    <div class="pb-section-title">What's your experience level?</div>
    <div class="pb-level-grid">
      ${SKILL_LEVELS.map(l => `
        <button class="pb-level-card ${builderData.skillLevel === l.id ? 'selected' : ''}" data-level="${l.id}">
          <div class="pb-level-label">${esc(l.label)}</div>
          <div class="pb-level-desc">${esc(l.desc)}</div>
        </button>
      `).join('')}
    </div>
  `;

  body.querySelectorAll('.pb-level-card').forEach(card => {
    card.addEventListener('click', () => {
      builderData.skillLevel = card.dataset.level;
      body.querySelectorAll('.pb-level-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
    });
  });
}

// ── Step 3: Preferences ─────────────────────────────────────

function renderPreferences(body) {
  body.innerHTML = `
    <div class="pb-section-title">Activities you enjoy</div>
    <div class="pb-pill-grid">
      ${ACTIVITIES.map(a => `
        <button class="pb-pill ${builderData.preferredActivities.includes(a) ? 'selected' : ''}" data-activity="${esc(a)}">${esc(a)}</button>
      `).join('')}
    </div>
    <div class="pb-section-title" style="margin-top:20px">Exercises to avoid</div>
    <div class="pb-pill-grid">
      ${AVOIDED_EXERCISES.map(e => `
        <button class="pb-pill avoid ${builderData.avoidedExercises.includes(e) ? 'selected' : ''}" data-avoid="${esc(e)}">${esc(e)}</button>
      `).join('')}
    </div>
  `;

  body.querySelectorAll('.pb-pill[data-activity]').forEach(pill => {
    pill.addEventListener('click', () => {
      const val = pill.dataset.activity;
      toggleArray(builderData.preferredActivities, val);
      pill.classList.toggle('selected');
    });
  });

  body.querySelectorAll('.pb-pill[data-avoid]').forEach(pill => {
    pill.addEventListener('click', () => {
      const val = pill.dataset.avoid;
      toggleArray(builderData.avoidedExercises, val);
      pill.classList.toggle('selected');
    });
  });
}

function toggleArray(arr, val) {
  const idx = arr.indexOf(val);
  if (idx >= 0) arr.splice(idx, 1);
  else arr.push(val);
}

// ── Step 4: Schedule ────────────────────────────────────────

function renderSchedule(body) {
  body.innerHTML = `
    <div class="pb-section-title">Plan duration</div>
    <div class="pb-duration-grid">
      ${DURATION_OPTIONS.map(d => `
        <button class="pb-duration-btn ${builderData.durationWeeks === d ? 'selected' : ''}" data-weeks="${d}">${d} weeks</button>
      `).join('')}
    </div>
    <div class="pb-schedule-fields">
      <div class="pb-field">
        <label>Start Date</label>
        <input type="date" id="pbStartDate" value="${builderData.startDate}">
      </div>
      <div class="pb-field">
        <label>Training Days / Week</label>
        <div class="pb-days-selector">
          ${[3,4,5,6,7].map(d => `
            <button class="pb-day-btn ${builderData.daysPerWeek === d ? 'selected' : ''}" data-days="${d}">${d}</button>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  body.querySelectorAll('.pb-duration-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      builderData.durationWeeks = parseInt(btn.dataset.weeks);
      body.querySelectorAll('.pb-duration-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  const dateInput = document.getElementById('pbStartDate');
  dateInput.addEventListener('change', () => { builderData.startDate = dateInput.value; });

  body.querySelectorAll('.pb-day-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      builderData.daysPerWeek = parseInt(btn.dataset.days);
      body.querySelectorAll('.pb-day-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });
}

// ── Step 5: Review & Create ─────────────────────────────────

function renderReview(body) {
  const type = TRAINING_TYPES.find(t => t.id === builderData.trainingType);
  const level = SKILL_LEVELS.find(l => l.id === builderData.skillLevel);

  body.innerHTML = `
    <div class="pb-section-title">Review Your Plan</div>
    <div class="pb-review">
      <div class="pb-review-row">
        <span class="pb-review-label">Training Type</span>
        <span class="pb-review-value">${type ? esc(type.label) : '--'}</span>
      </div>
      <div class="pb-review-row">
        <span class="pb-review-label">Skill Level</span>
        <span class="pb-review-value">${level ? esc(level.label) : '--'}</span>
      </div>
      <div class="pb-review-row">
        <span class="pb-review-label">Preferred Activities</span>
        <span class="pb-review-value">${builderData.preferredActivities.length ? builderData.preferredActivities.map(esc).join(', ') : 'None specified'}</span>
      </div>
      <div class="pb-review-row">
        <span class="pb-review-label">Avoided Exercises</span>
        <span class="pb-review-value">${builderData.avoidedExercises.length ? builderData.avoidedExercises.map(esc).join(', ') : 'None'}</span>
      </div>
      <div class="pb-review-row">
        <span class="pb-review-label">Duration</span>
        <span class="pb-review-value">${builderData.durationWeeks} weeks</span>
      </div>
      <div class="pb-review-row">
        <span class="pb-review-label">Start Date</span>
        <span class="pb-review-value">${builderData.startDate}</span>
      </div>
      <div class="pb-review-row">
        <span class="pb-review-label">Days / Week</span>
        <span class="pb-review-value">${builderData.daysPerWeek} days</span>
      </div>
    </div>
    <div class="pb-create-cta">
      <button class="btn-primary" id="pbCreateBtn">Create Training Plan</button>
      <div class="pb-create-status" id="pbCreateStatus"></div>
    </div>
  `;

  document.getElementById('pbCreateBtn').addEventListener('click', handleCreate);
}

async function handleCreate() {
  const btn = document.getElementById('pbCreateBtn');
  const status = document.getElementById('pbCreateStatus');
  btn.disabled = true;
  btn.textContent = 'Creating...';
  status.className = 'pb-create-status pb-create-loading';

  // Insert morphing athlete animation above status text
  const morphContainer = document.createElement('div');
  morphContainer.className = 'morph-athlete-container';
  const morphLabel = document.createElement('div');
  morphLabel.className = 'morph-activity-label';
  status.innerHTML = '';
  status.appendChild(morphContainer);
  status.appendChild(morphLabel);
  const statusText = document.createElement('div');
  statusText.style.cssText = 'margin-top:8px;font-size:var(--text-xs);color:var(--text-tertiary)';
  statusText.textContent = 'Analyzing your health data and building a personalized plan...';
  status.appendChild(statusText);

  let stopMorph = initMorphAthlete(morphContainer, morphLabel);

  try {
    // Build preferences for the edge function
    const preferences = {
      training_type: builderData.trainingType,
      skill_level: builderData.skillLevel,
      preferred_activities: builderData.preferredActivities,
      avoided_exercises: builderData.avoidedExercises,
      days_per_week: builderData.daysPerWeek,
      goals: builderData.trainingType, // map type to goal for backward compat
      experience: builderData.skillLevel,
    };

    // Save preferences
    saveTrainingPreferences(preferences).catch(() => {});

    // Create season with enhanced config
    const result = await createSeason(preferences, null, builderData.durationWeeks, {
      start_date: builderData.startDate,
      plan_config: builderData,
    });

    if (stopMorph) { stopMorph(); stopMorph = null; }
    status.textContent = 'Plan created successfully!';
    status.className = 'pb-create-status success';

    if (onComplete) onComplete(result);
  } catch (err) {
    if (stopMorph) { stopMorph(); stopMorph = null; }
    btn.disabled = false;
    btn.textContent = 'Create Training Plan';
    status.textContent = `Failed: ${err.message}`;
    status.className = 'pb-create-status error';
  }
}

// ── Helpers ─────────────────────────────────────────────────

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
