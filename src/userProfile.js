// Unified User Profile — data aggregation layer
// Queries all 5 data silos and returns a single profile object
import { getSupabaseClient } from './supabase.js';
import { getTodayReadiness } from './trainingData.js';
import { getActiveSeason, getTrainingGoals, getSeasonHistory, toLocalDateStr } from './seasonData.js';
import { getGarminStatus } from './garmin.js';

const CACHE_KEY = 'utrain_profile_cache';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── Exercise Taxonomy ───────────────────────────────────────

export const EXERCISE_TAXONOMY = {
  squat:  ['squat', 'squats', 'back squat', 'front squat', 'goblet squat', 'air squat', 'barbell squat', 'db squat', 'bodyweight squat'],
  pushup: ['pushup', 'push-up', 'push up', 'pushups', 'push-ups', 'push ups'],
  pullup: ['pullup', 'pull-up', 'pull up', 'pullups', 'pull-ups', 'pull ups', 'chin-up', 'chin up', 'chinup'],
  lunge:  ['lunge', 'lunges', 'walking lunge', 'reverse lunge', 'forward lunge', 'db lunge', 'barbell lunge'],
};

function _taxonomyLookup(name) {
  const lower = (name || '').toLowerCase().trim();
  for (const [canonical, aliases] of Object.entries(EXERCISE_TAXONOMY)) {
    if (aliases.includes(lower)) return canonical;
  }
  return null;
}

function _parseReps(val) {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const match = val.match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }
  return 0;
}

// ── Private fetchers ────────────────────────────────────────

async function _getClient() {
  const client = getSupabaseClient();
  if (!client) return { client: null, user: null };
  const { data: { user } } = await client.auth.getUser();
  return { client, user };
}

async function fetchProfile() {
  const { client, user } = await _getClient();
  if (!client || !user) return null;
  const { data, error } = await client
    .from('user_profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) console.warn('fetchProfile error:', error.message);
  return { profile: data, email: user.email, userId: user.id, createdAt: user.created_at };
}

async function fetchCvTotals() {
  const { client, user } = await _getClient();
  if (!client || !user) return [];
  const { data, error } = await client
    .from('workout_entries')
    .select('exercise, reps');
  if (error) { console.warn('fetchCvTotals:', error.message); return []; }
  // Aggregate client-side (RLS scopes to user)
  const totals = {};
  for (const row of (data || [])) {
    const ex = (row.exercise || '').toLowerCase();
    totals[ex] = (totals[ex] || 0) + (row.reps || 0);
  }
  return totals;
}

async function fetchMurphTotals() {
  const { client, user } = await _getClient();
  if (!client || !user) return { pullups: 0, pushups: 0, squats: 0 };
  const { data, error } = await client
    .from('murph_attempts')
    .select('pullups_completed, pushups_completed, squats_completed')
    .eq('user_id', user.id)
    .in('status', ['completed', 'verified']);
  if (error) { console.warn('fetchMurphTotals:', error.message); return { pullups: 0, pushups: 0, squats: 0 }; }
  let pullups = 0, pushups = 0, squats = 0;
  for (const r of (data || [])) {
    pullups += r.pullups_completed || 0;
    pushups += r.pushups_completed || 0;
    squats += r.squats_completed || 0;
  }
  return { pullups, pushups, squats };
}

async function fetchCompletedMurphAttempts() {
  const { client, user } = await _getClient();
  if (!client || !user) return [];
  const { data, error } = await client
    .from('murph_attempts')
    .select('total_time_seconds, mile1_time_seconds, mile2_time_seconds, mile1_distance_meters, mile2_distance_meters, pullups_completed, pushups_completed, squats_completed, started_at')
    .eq('user_id', user.id)
    .in('status', ['completed', 'verified'])
    .order('started_at', { ascending: false });
  if (error) { console.warn('fetchMurphAttempts:', error.message); return []; }
  return data || [];
}

async function fetchTrainingLogs() {
  const { client, user } = await _getClient();
  if (!client || !user) return [];
  const { data, error } = await client
    .from('workout_logs')
    .select('actual_json, source, status')
    .eq('user_id', user.id)
    .in('status', ['completed', 'partial']);
  if (error) { console.warn('fetchTrainingLogs:', error.message); return []; }
  return data || [];
}

async function fetchRunActivities() {
  const { client, user } = await _getClient();
  if (!client || !user) return [];
  const runTypes = ['running', 'trail_running', 'treadmill_running', 'track_running'];
  const { data, error } = await client
    .from('activities')
    .select('date, activity_type, distance_meters, duration_seconds, avg_heart_rate, avg_pace')
    .eq('user_id', user.id)
    .in('activity_type', runTypes)
    .order('date', { ascending: false });
  if (error) { console.warn('fetchRunActivities:', error.message); return []; }
  return data || [];
}

async function fetchCompletedSeasonCount() {
  const history = await getSeasonHistory();
  return (history || []).filter(s => s.status === 'completed').length;
}

// ── Mileage computation ─────────────────────────────────────

const METERS_PER_MILE = 1609.34;

function _metersToMiles(m) { return (m || 0) / METERS_PER_MILE; }

function _secondsToPace(seconds, miles) {
  if (!miles || miles <= 0 || !seconds) return null;
  const paceSeconds = seconds / miles;
  const min = Math.floor(paceSeconds / 60);
  const sec = Math.round(paceSeconds % 60);
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function _formatPace(paceStr) {
  // If already formatted (from DB), return as-is
  if (typeof paceStr === 'string' && paceStr.includes(':')) return paceStr;
  return null;
}

function _getWeekStart(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1; // Monday start
  d.setDate(d.getDate() - diff);
  return toLocalDateStr(d);
}

function _computeMileage(garminRuns, murphAttempts) {
  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth();
  const todayStr = toLocalDateStr(now);
  const weekStartStr = _getWeekStart(todayStr);

  let totalMiles = 0, thisWeekMiles = 0, thisMonthMiles = 0, thisYearMiles = 0;
  let longestRunMiles = 0;
  let fastestMilePaceSec = Infinity;
  const weeklyMap = {};
  const recentRuns = [];

  // Garmin runs
  for (const run of garminRuns) {
    const miles = _metersToMiles(run.distance_meters);
    totalMiles += miles;
    if (miles > longestRunMiles) longestRunMiles = miles;

    const runDate = run.date;
    const rd = new Date(runDate + 'T00:00:00');
    if (rd.getFullYear() === thisYear) thisYearMiles += miles;
    if (rd.getFullYear() === thisYear && rd.getMonth() === thisMonth) thisMonthMiles += miles;
    if (runDate >= weekStartStr) thisWeekMiles += miles;

    // Weekly trend
    const ws = _getWeekStart(runDate);
    weeklyMap[ws] = (weeklyMap[ws] || 0) + miles;

    // Check fastest mile pace (for runs close to 1 mile)
    if (run.duration_seconds && miles > 0) {
      const paceSec = run.duration_seconds / miles;
      if (paceSec < fastestMilePaceSec) fastestMilePaceSec = paceSec;
    }

    // Recent runs list
    if (recentRuns.length < 10) {
      recentRuns.push({
        date: runDate,
        distanceMiles: Math.round(miles * 10) / 10,
        paceMinPerMile: _secondsToPace(run.duration_seconds, miles),
        avgHr: run.avg_heart_rate || null,
        source: 'garmin',
      });
    }
  }

  // Murph miles
  for (const m of murphAttempts) {
    const m1 = _metersToMiles(m.mile1_distance_meters);
    const m2 = _metersToMiles(m.mile2_distance_meters);
    const murphMiles = m1 + m2;
    totalMiles += murphMiles;

    // Check murph mile paces for fastest
    if (m.mile1_time_seconds && m1 > 0) {
      const p = m.mile1_time_seconds / m1;
      if (p < fastestMilePaceSec) fastestMilePaceSec = p;
    }
    if (m.mile2_time_seconds && m2 > 0) {
      const p = m.mile2_time_seconds / m2;
      if (p < fastestMilePaceSec) fastestMilePaceSec = p;
    }
  }

  // Build weekly trend (last 12 weeks)
  const weeklyTrend = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    const ws = _getWeekStart(toLocalDateStr(d));
    weeklyTrend.push({ weekStart: ws, miles: Math.round((weeklyMap[ws] || 0) * 10) / 10 });
  }

  const fastestPaceMin = Math.floor(fastestMilePaceSec / 60);
  const fastestPaceSec = Math.round(fastestMilePaceSec % 60);
  const fastestMilePace = fastestMilePaceSec < Infinity
    ? `${fastestPaceMin}:${fastestPaceSec.toString().padStart(2, '0')}`
    : null;

  return {
    totalMiles: Math.round(totalMiles * 10) / 10,
    thisWeek: Math.round(thisWeekMiles * 10) / 10,
    thisMonth: Math.round(thisMonthMiles * 10) / 10,
    thisYear: Math.round(thisYearMiles * 10) / 10,
    weeklyTrend,
    recentRuns,
    longestRunMiles: Math.round(longestRunMiles * 10) / 10,
    fastestMilePace,
  };
}

// ── Movement aggregation ────────────────────────────────────

function _computeMovements(cvTotals, murphTotals, trainingLogs) {
  const movements = {
    squat:  { total: 0, cv: 0, murph: 0, training: 0 },
    pushup: { total: 0, cv: 0, murph: 0, training: 0 },
    pullup: { total: 0, cv: 0, murph: 0, training: 0 },
    lunge:  { total: 0, cv: 0, murph: 0, training: 0 },
    other: [],
  };

  // CV tracker
  movements.squat.cv = cvTotals['squat'] || 0;
  movements.pushup.cv = cvTotals['pushup'] || 0;
  movements.pullup.cv = cvTotals['pullup'] || 0;
  movements.lunge.cv = cvTotals['lunge'] || 0;

  // Murph
  movements.pullup.murph = murphTotals.pullups;
  movements.pushup.murph = murphTotals.pushups;
  movements.squat.murph = murphTotals.squats;

  // Training logs
  const otherMap = {};
  for (const log of trainingLogs) {
    const json = log.actual_json;
    if (!json) continue;
    const exercises = json.exercises || json.main_workout || [];
    const confirmed = log.source === 'manual' || log.source === 'garmin_confirmed';

    for (const ex of exercises) {
      const name = ex.exercise || ex.name || '';
      const sets = parseInt(ex.sets, 10) || 1;
      const reps = _parseReps(ex.reps);
      const totalReps = sets * reps;
      if (!totalReps) continue;

      const canonical = _taxonomyLookup(name);
      if (canonical) {
        movements[canonical].training += totalReps;
      } else {
        const key = name.toLowerCase().trim();
        if (!otherMap[key]) otherMap[key] = { name, totalReps: 0, totalSets: 0, confirmed: false };
        otherMap[key].totalReps += totalReps;
        otherMap[key].totalSets += sets;
        if (confirmed) otherMap[key].confirmed = true;
      }
    }
  }

  // Compute totals
  for (const key of ['squat', 'pushup', 'pullup', 'lunge']) {
    movements[key].total = movements[key].cv + movements[key].murph + movements[key].training;
  }

  movements.other = Object.values(otherMap).sort((a, b) => b.totalReps - a.totalReps);

  return movements;
}

// ── Murph stats ─────────────────────────────────────────────

function _computeMurphStats(attempts) {
  if (!attempts.length) {
    return { attemptsCompleted: 0, bestTime: null, averageTime: null, bestMile1Pace: null, bestMile2Pace: null, totalPullups: 0, totalPushups: 0, totalSquats: 0 };
  }

  const times = attempts.map(a => a.total_time_seconds).filter(Boolean);
  const bestTime = times.length ? Math.min(...times) : null;
  const averageTime = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;

  let bestM1Sec = Infinity, bestM2Sec = Infinity;
  let totalPullups = 0, totalPushups = 0, totalSquats = 0;

  for (const a of attempts) {
    if (a.mile1_time_seconds && a.mile1_time_seconds < bestM1Sec) bestM1Sec = a.mile1_time_seconds;
    if (a.mile2_time_seconds && a.mile2_time_seconds < bestM2Sec) bestM2Sec = a.mile2_time_seconds;
    totalPullups += a.pullups_completed || 0;
    totalPushups += a.pushups_completed || 0;
    totalSquats += a.squats_completed || 0;
  }

  const fmtPace = (sec) => {
    if (sec === Infinity) return null;
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return {
    attemptsCompleted: attempts.length,
    bestTime,
    averageTime,
    bestMile1Pace: fmtPace(bestM1Sec),
    bestMile2Pace: fmtPace(bestM2Sec),
    totalPullups,
    totalPushups,
    totalSquats,
  };
}

// ── Training stats ──────────────────────────────────────────

async function _computeTraining(activeSeason, seasonCount) {
  let currentSeason = null;
  let activeGoals = [];

  if (activeSeason) {
    const startDate = new Date(activeSeason.start_date);
    const now = new Date();
    const daysDiff = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const weekNumber = Math.min(Math.floor(daysDiff / 7) + 1, activeSeason.duration_weeks);

    // Fetch adherence — scoped to active season
    const { client, user } = await _getClient();
    let adherencePercent = 0;
    if (client && user) {
      // Get this season's workouts
      const { data: workouts } = await client
        .from('season_workouts')
        .select('id')
        .eq('season_id', activeSeason.id);

      const workoutIds = (workouts || []).map(w => w.id);
      const totalPlanned = workoutIds.length;

      if (totalPlanned > 0) {
        // Get logs only for this season's workouts
        const { data: logs } = await client
          .from('workout_logs')
          .select('status')
          .eq('user_id', user.id)
          .in('workout_id', workoutIds);

        const completedOrPartial = (logs || []).filter(l => l.status === 'completed' || l.status === 'partial').length;
        adherencePercent = Math.round((completedOrPartial / totalPlanned) * 100);
      }
    }

    currentSeason = {
      name: activeSeason.name || `Season ${activeSeason.season_number}`,
      weekNumber,
      totalWeeks: activeSeason.duration_weeks,
      adherencePercent,
    };

    // Goals
    try {
      const goals = await getTrainingGoals(activeSeason.id);
      activeGoals = (goals || [])
        .filter(g => g.status === 'active')
        .map(g => ({
          title: g.title,
          currentValue: g.current_value || 0,
          targetValue: g.target_value || 1,
          unit: g.unit || '',
        }));
    } catch (e) {
      console.warn('Goals fetch error:', e.message);
    }
  }

  return {
    currentSeason,
    seasonsCompleted: seasonCount,
    activeGoals,
  };
}

// ── Main export ─────────────────────────────────────────────

export async function getUserProfileData(forceRefresh = false) {
  if (!forceRefresh) {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_TTL) return data;
      }
    } catch { /* ignore parse errors */ }
  }

  // Run all independent queries in parallel
  const [
    profileData,
    garminStatus,
    readiness,
    cvTotals,
    murphTotals,
    trainingLogs,
    garminRuns,
    murphAttempts,
    activeSeason,
    seasonCount,
  ] = await Promise.all([
    fetchProfile().catch(e => { console.warn('profile:', e.message); return null; }),
    getGarminStatus().catch(e => { console.warn('garmin:', e.message); return null; }),
    getTodayReadiness().catch(e => { console.warn('readiness:', e.message); return {}; }),
    fetchCvTotals().catch(e => { console.warn('cv:', e.message); return {}; }),
    fetchMurphTotals().catch(e => { console.warn('murph totals:', e.message); return { pullups: 0, pushups: 0, squats: 0 }; }),
    fetchTrainingLogs().catch(e => { console.warn('training logs:', e.message); return []; }),
    fetchRunActivities().catch(e => { console.warn('runs:', e.message); return []; }),
    fetchCompletedMurphAttempts().catch(e => { console.warn('murph attempts:', e.message); return []; }),
    getActiveSeason().catch(e => { console.warn('season:', e.message); return null; }),
    fetchCompletedSeasonCount().catch(e => { console.warn('season count:', e.message); return 0; }),
  ]);

  // Identity
  const profile = profileData?.profile;
  const identity = {
    displayName: profile?.display_name || profileData?.email?.split('@')[0] || 'User',
    avatarUrl: profile?.avatar_url || null,
    email: profileData?.email || '',
    memberSince: profile?.member_since || (profileData?.createdAt ? new Date(profileData.createdAt).toISOString().split('T')[0] : null),
    garminConnected: garminStatus?.status === 'connected',
    garminLastSync: garminStatus?.last_sync_at || null,
    preferredWeightUnit: profile?.preferred_weight_unit || 'lbs',
    preferredDistanceUnit: profile?.preferred_distance_unit || 'mi',
  };

  // Movements
  const movements = _computeMovements(cvTotals, murphTotals, trainingLogs);

  // Mileage
  const mileage = _computeMileage(garminRuns, murphAttempts);

  // Murph
  const murph = _computeMurphStats(murphAttempts);

  // Training
  const training = await _computeTraining(activeSeason, seasonCount);

  const result = { identity, readiness, movements, mileage, murph, training };

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data: result, timestamp: Date.now() }));
  } catch { /* localStorage full or unavailable */ }

  return result;
}

export function clearProfileCache() {
  localStorage.removeItem(CACHE_KEY);
}
