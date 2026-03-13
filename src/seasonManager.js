// Season lifecycle management — init, state, expiry, completion
import {
  getActiveSeason,
  createSeason,
  completeSeason,
  triggerAdaptation,
} from './seasonData.js';
import { getTrainingPreferences } from './trainingData.js';

// ── State ────────────────────────────────────────────────────

let _activeSeason = null;
let _seasonState = null;

// ── Public API ───────────────────────────────────────────────

/**
 * Initialize the season on dashboard load.
 * Returns { season, state, needsCreation, isExpired }
 */
export async function initSeason() {
  _activeSeason = await getActiveSeason();

  if (!_activeSeason) {
    return { season: null, state: null, needsCreation: true, isExpired: false };
  }

  _seasonState = computeSeasonState(_activeSeason);

  if (_seasonState.isExpired) {
    return { season: _activeSeason, state: _seasonState, needsCreation: false, isExpired: true };
  }

  return { season: _activeSeason, state: _seasonState, needsCreation: false, isExpired: false };
}

/**
 * Create a new season. Called after user confirms.
 */
export async function startNewSeason(previousSeasonId = null, durationWeeks = 8, extraConfig = {}) {
  const prefs = await getTrainingPreferences();
  const result = await createSeason(prefs, previousSeasonId, durationWeeks, extraConfig);

  // Refresh active season
  _activeSeason = await getActiveSeason();
  _seasonState = _activeSeason ? computeSeasonState(_activeSeason) : null;

  return result;
}

/**
 * Complete the current season and return the summary.
 */
export async function finishSeason() {
  if (!_activeSeason) throw new Error('No active season');

  const result = await completeSeason(_activeSeason.id);

  _activeSeason = null;
  _seasonState = null;

  return result;
}

/**
 * Trigger background adaptation check.
 * Runs silently — errors are logged but not thrown.
 */
export async function checkAdaptations(force = false) {
  try {
    return await triggerAdaptation(force);
  } catch (err) {
    console.error('Adaptation check failed:', err);
    return { adaptations: [], _error: err.message };
  }
}

/**
 * Get current season and state without re-fetching.
 */
export function getSeasonState() {
  return { season: _activeSeason, state: _seasonState };
}

// ── Helpers ──────────────────────────────────────────────────

function computeSeasonState(season) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const startDate = new Date(season.start_date + 'T00:00:00');
  const endDate = new Date(season.end_date + 'T00:00:00');

  const daysSinceStart = Math.floor((today - startDate) / (1000 * 60 * 60 * 24));
  const totalDays = season.duration_weeks * 7;

  const currentWeek = Math.min(
    Math.max(Math.floor(daysSinceStart / 7) + 1, 1),
    season.duration_weeks,
  );

  const currentDay = Math.min(
    Math.max(daysSinceStart + 1, 1),
    totalDays,
  );

  const daysRemaining = Math.max(
    Math.floor((endDate - today) / (1000 * 60 * 60 * 24)),
    0,
  );

  const isExpired = today > endDate;
  const hasStarted = today >= startDate;
  const progressPct = totalDays > 0
    ? Math.min(Math.round((daysSinceStart / totalDays) * 100), 100)
    : 0;

  return {
    currentWeek,
    currentDay,
    totalDays,
    daysRemaining,
    isExpired,
    hasStarted,
    progressPct,
  };
}
