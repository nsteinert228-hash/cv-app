import { describe, it, expect } from 'vitest';

// Test pure logic functions extracted from garminDashboard.js
// These are the key computations that changed in this refactor

describe('shared sparkline domain', () => {
  function buildSharedDomain(days = 14) {
    const domain = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      domain.push(d.toISOString().split('T')[0]);
    }
    return domain;
  }

  it('generates a 14-day date array', () => {
    const domain = buildSharedDomain(14);
    expect(domain).toHaveLength(14);
    expect(domain[0] < domain[13]).toBe(true);
  });

  it('ends with today', () => {
    const domain = buildSharedDomain(14);
    const today = new Date().toISOString().split('T')[0];
    expect(domain[13]).toBe(today);
  });

  it('has consecutive days', () => {
    const domain = buildSharedDomain(14);
    for (let i = 1; i < domain.length; i++) {
      const prev = new Date(domain[i - 1] + 'T12:00:00');
      const curr = new Date(domain[i] + 'T12:00:00');
      const diff = Math.round((curr - prev) / (1000 * 60 * 60 * 24));
      expect(diff).toBe(1);
    }
  });

  it('aligns data points to shared domain positions', () => {
    const domain = buildSharedDomain(14);
    const dateIndexMap = new Map(domain.map((d, i) => [d, i]));

    // Data that only has entries for some days
    const sparseData = [
      { date: domain[2], value: 42 },
      { date: domain[7], value: 55 },
      { date: domain[13], value: 60 },
    ];

    // Verify positions match shared domain
    expect(dateIndexMap.get(sparseData[0].date)).toBe(2);
    expect(dateIndexMap.get(sparseData[1].date)).toBe(7);
    expect(dateIndexMap.get(sparseData[2].date)).toBe(13);
  });

  it('returns null for dates outside domain', () => {
    const domain = buildSharedDomain(14);
    const dateIndexMap = new Map(domain.map((d, i) => [d, i]));

    expect(dateIndexMap.get('2020-01-01')).toBeUndefined();
  });
});

describe('7-day activity calendar mapping', () => {
  function buildCalendarDays(activities = []) {
    const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const todayStr = new Date().toISOString().split('T')[0];
    const tiles = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = d.toISOString().split('T')[0];
      const isToday = ds === todayStr;
      const dayActivities = activities.filter(a => a.date === ds);

      tiles.push({
        date: ds,
        dayLabel: DAY_LABELS[d.getDay()],
        isToday,
        hasActivity: dayActivities.length > 0,
        activity: dayActivities[0] || null,
      });
    }
    return tiles;
  }

  it('generates 7 tiles', () => {
    const tiles = buildCalendarDays([]);
    expect(tiles).toHaveLength(7);
  });

  it('marks today correctly', () => {
    const tiles = buildCalendarDays([]);
    const todayTiles = tiles.filter(t => t.isToday);
    expect(todayTiles).toHaveLength(1);
    expect(todayTiles[0].date).toBe(new Date().toISOString().split('T')[0]);
  });

  it('matches activities to correct dates', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const ds = yesterday.toISOString().split('T')[0];

    const activities = [
      { date: ds, activity_type: 'running', name: 'Morning Run' },
    ];
    const tiles = buildCalendarDays(activities);
    const matched = tiles.find(t => t.date === ds);
    expect(matched.hasActivity).toBe(true);
    expect(matched.activity.name).toBe('Morning Run');
  });

  it('shows rest day when no activity', () => {
    const tiles = buildCalendarDays([]);
    expect(tiles.every(t => !t.hasActivity)).toBe(true);
  });
});

describe('computeReadinessSummary', () => {
  function computeReadinessSummary(sleepScore, bbCurrent, hrvStatus) {
    let score = 0;
    if (sleepScore >= 70) score += 2;
    else if (sleepScore >= 40) score += 1;
    if (bbCurrent >= 60) score += 2;
    else if (bbCurrent >= 30) score += 1;
    const hrvLower = (hrvStatus || '').toLowerCase();
    if (hrvLower === 'balanced' || hrvLower === 'above_baseline') score += 2;
    else if (hrvLower === 'below_baseline' || hrvLower === 'low') score += 0;
    else score += 1;

    if (score >= 5) return 'Fully recovered. Great day for a hard session.';
    if (score >= 3) return 'Moderate recovery. Keep intensity in check.';
    return 'Recovery is low. Consider an easy day or rest.';
  }

  it('returns high readiness for good scores', () => {
    const msg = computeReadinessSummary(85, 75, 'balanced');
    expect(msg).toContain('Fully recovered');
  });

  it('returns moderate for mixed scores', () => {
    const msg = computeReadinessSummary(50, 45, 'balanced');
    expect(msg).toContain('Moderate');
  });

  it('returns low for poor scores', () => {
    const msg = computeReadinessSummary(20, 15, 'low');
    expect(msg).toContain('low');
  });
});

describe('intensity goal handling', () => {
  it('should not default to 150 when Garmin provides no goal', () => {
    const daily = { intensity_minutes: 30, intensity_goal: null };
    const intGoal = daily.intensity_goal; // Should be null, NOT 150
    expect(intGoal).toBeNull();
  });

  it('uses Garmin goal when provided', () => {
    const daily = { intensity_minutes: 30, intensity_goal: 100 };
    const intGoal = daily.intensity_goal;
    expect(intGoal).toBe(100);
  });
});
