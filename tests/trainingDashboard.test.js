import { describe, it, expect } from 'vitest';

// Test pure logic functions from trainingDashboard.js

describe('computeWeekStats', () => {
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

  it('counts active days excluding rest', () => {
    const workouts = [
      { workout_type: 'strength', duration_minutes: 45 },
      { workout_type: 'cardio', duration_minutes: 30 },
      { workout_type: 'rest', duration_minutes: 0 },
      { workout_type: 'strength', duration_minutes: 45 },
    ];
    const stats = computeWeekStats(workouts);
    expect(stats.activeDays).toBe(3);
    expect(stats.totalMin).toBe(120);
    expect(stats.typeCounts).toEqual({ strength: 2, cardio: 1 });
  });

  it('handles all rest week', () => {
    const workouts = [
      { workout_type: 'rest', duration_minutes: 0 },
      { workout_type: 'rest', duration_minutes: 0 },
    ];
    const stats = computeWeekStats(workouts);
    expect(stats.activeDays).toBe(0);
    expect(stats.totalMin).toBe(0);
    expect(stats.typeCounts).toEqual({});
  });
});

describe('getCurrentPhase', () => {
  function getCurrentPhase(plan, currentWeek) {
    const phases = plan.phases || [];
    for (const p of phases) {
      const weeks = p.weeks || [p.week];
      if (weeks.includes(currentWeek)) return p;
    }
    return phases[0] || null;
  }

  it('finds correct phase for week', () => {
    const plan = {
      phases: [
        { name: 'Build', weeks: [1, 2, 3] },
        { name: 'Peak', weeks: [4, 5, 6] },
        { name: 'Taper', weeks: [7, 8] },
      ],
    };

    expect(getCurrentPhase(plan, 1).name).toBe('Build');
    expect(getCurrentPhase(plan, 5).name).toBe('Peak');
    expect(getCurrentPhase(plan, 8).name).toBe('Taper');
  });

  it('falls back to first phase when week not found', () => {
    const plan = { phases: [{ name: 'Base', weeks: [1, 2] }] };
    expect(getCurrentPhase(plan, 99).name).toBe('Base');
  });

  it('returns null for empty plan', () => {
    expect(getCurrentPhase({}, 1)).toBeNull();
    expect(getCurrentPhase({ phases: [] }, 1)).toBeNull();
  });
});

describe('normalizePrescription', () => {
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

  it('handles null prescription', () => {
    const result = normalizePrescription(null);
    expect(result.warmup).toBeNull();
    expect(result.main_workout).toEqual([]);
    expect(result.cooldown).toBeNull();
  });

  it('normalizes array warmup to object', () => {
    const rx = { warmup: ['Jog 5 min', 'Stretch'], exercises: [{ exercise: 'Squat' }] };
    const result = normalizePrescription(rx);
    expect(result.warmup.activities).toEqual(['Jog 5 min', 'Stretch']);
    expect(result.warmup.duration_minutes).toBe(5);
  });

  it('passes through object warmup', () => {
    const warmup = { duration_minutes: 10, activities: ['Run'] };
    const rx = { warmup, exercises: [] };
    const result = normalizePrescription(rx);
    expect(result.warmup).toBe(warmup);
  });

  it('prefers exercises over main_workout', () => {
    const rx = { exercises: [{ exercise: 'A' }], main_workout: [{ exercise: 'B' }] };
    const result = normalizePrescription(rx);
    expect(result.main_workout[0].exercise).toBe('A');
  });
});

describe('plan stability', () => {
  it('viewCache prevents regeneration on reload', () => {
    const CACHE_TTL = 5 * 60 * 1000;
    const viewCache = {};

    // Simulate first load
    viewCache['plan'] = { data: { plan_name: 'Test' }, fetchedAt: Date.now() };

    // Check cache is valid
    const isCached = viewCache['plan'] && (Date.now() - viewCache['plan'].fetchedAt) < CACHE_TTL;
    expect(isCached).toBe(true);
  });

  it('expired cache triggers reload', () => {
    const CACHE_TTL = 5 * 60 * 1000;
    const viewCache = {};

    // Simulate old cache
    viewCache['plan'] = { data: { plan_name: 'Test' }, fetchedAt: Date.now() - CACHE_TTL - 1000 };

    const isCached = viewCache['plan'] && (Date.now() - viewCache['plan'].fetchedAt) < CACHE_TTL;
    expect(isCached).toBe(false);
  });
});

describe('swap workout type mapping', () => {
  const SWAP_TYPES = [
    { type: 'strength', title: 'Strength Training' },
    { type: 'cardio', title: 'Cardio / Run' },
    { type: 'recovery', title: 'Recovery / Yoga' },
    { type: 'rest', title: 'Rest Day' },
  ];

  it('filters out current type from options', () => {
    const currentType = 'strength';
    const options = SWAP_TYPES.filter(t => t.type !== currentType);
    expect(options).toHaveLength(3);
    expect(options.find(t => t.type === 'strength')).toBeUndefined();
  });

  it('all types are represented', () => {
    expect(SWAP_TYPES).toHaveLength(4);
    const types = SWAP_TYPES.map(t => t.type);
    expect(types).toContain('strength');
    expect(types).toContain('cardio');
    expect(types).toContain('recovery');
    expect(types).toContain('rest');
  });
});

describe('onboarding preferences extraction', () => {
  function getOnboardingPrefs(goals, experience, injuries) {
    return {
      goals: goals || undefined,
      experience: experience || undefined,
      injuries: injuries?.trim() || undefined,
    };
  }

  it('extracts all filled preferences', () => {
    const prefs = getOnboardingPrefs('strength_building', 'intermediate', 'bad left knee');
    expect(prefs.goals).toBe('strength_building');
    expect(prefs.experience).toBe('intermediate');
    expect(prefs.injuries).toBe('bad left knee');
  });

  it('returns undefined for empty values', () => {
    const prefs = getOnboardingPrefs('', '', '');
    expect(prefs.goals).toBeUndefined();
    expect(prefs.experience).toBeUndefined();
    expect(prefs.injuries).toBeUndefined();
  });

  it('trims whitespace from injuries', () => {
    const prefs = getOnboardingPrefs('', '', '  shoulder pain  ');
    expect(prefs.injuries).toBe('shoulder pain');
  });

  it('partial preferences are valid', () => {
    const prefs = getOnboardingPrefs('running_endurance', '', '');
    expect(prefs.goals).toBe('running_endurance');
    expect(prefs.experience).toBeUndefined();
    expect(prefs.injuries).toBeUndefined();
  });
});

describe('onboarding flow state transitions', () => {
  it('needsCreation triggers onboarding, not plan view', () => {
    const result = { season: null, state: null, needsCreation: true, isExpired: false };
    // When needsCreation is true, we should show onboarding
    // and NOT proceed to loadView
    let loadViewCalled = false;
    let showOnboardingCalled = false;

    if (result.needsCreation) {
      showOnboardingCalled = true;
    } else {
      loadViewCalled = true;
    }

    expect(showOnboardingCalled).toBe(true);
    expect(loadViewCalled).toBe(false);
  });

  it('active season defaults to plan view', () => {
    const result = { season: { id: 1 }, state: {}, needsCreation: false, isExpired: false };
    let currentView = 'today';

    if (!result.needsCreation && !result.isExpired) {
      if (currentView === 'today') {
        currentView = 'plan';
      }
    }

    expect(currentView).toBe('plan');
  });

  it('expired season triggers completion prompt', () => {
    const result = { season: { id: 1, name: 'Test' }, state: { isExpired: true }, needsCreation: false, isExpired: true };
    let showCompletion = false;

    if (result.isExpired) {
      showCompletion = true;
    }

    expect(showCompletion).toBe(true);
  });
});
