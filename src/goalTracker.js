// Goal Tracker — renders goal progress cards with auto-calculated current values
import { getTrainingGoals, updateGoalProgress } from './seasonData.js';
import { getSupabaseClient } from './supabase.js';

/**
 * Render goal progress cards into a container element.
 */
export async function renderGoalTracker(containerEl, seasonId) {
  if (!containerEl || !seasonId) return;

  try {
    const goals = await getTrainingGoals(seasonId);
    if (!goals.length) {
      containerEl.style.display = 'none';
      return;
    }

    // Auto-calculate current values
    await refreshGoalValues(goals);

    containerEl.innerHTML = `
      <div class="goal-tracker">
        <div class="goal-tracker-header">Training Goals</div>
        <div class="goal-cards">
          ${goals.map(g => renderGoalCard(g)).join('')}
        </div>
      </div>
    `;
    containerEl.style.display = '';
  } catch (err) {
    console.warn('Goal tracker failed:', err);
    containerEl.style.display = 'none';
  }
}

function renderGoalCard(goal) {
  const baseline = goal.baseline_value;
  const target = goal.target_value;
  const current = goal.current_value;
  const unit = goal.unit || '';
  const isAchieved = goal.status === 'achieved';

  let progressPct = 0;
  if (baseline != null && target != null && current != null && target !== baseline) {
    progressPct = Math.min(100, Math.max(0,
      Math.round(((current - baseline) / (target - baseline)) * 100)
    ));
  }

  const statusClass = isAchieved ? 'achieved' : progressPct >= 75 ? 'close' : '';

  return `
    <div class="goal-card ${statusClass}">
      <div class="goal-card-header">
        <span class="goal-card-title">${esc(goal.title)}</span>
        ${isAchieved ? '<span class="goal-achieved-badge">Achieved</span>' : ''}
      </div>
      <div class="goal-progress-bar">
        <div class="goal-progress-fill" style="width:${progressPct}%"></div>
      </div>
      <div class="goal-values">
        ${baseline != null ? `<span class="goal-val baseline">${baseline} ${esc(unit)}</span>` : ''}
        ${current != null ? `<span class="goal-val current">${current} ${esc(unit)}</span>` : '<span class="goal-val current">--</span>'}
        ${target != null ? `<span class="goal-val target">${target} ${esc(unit)}</span>` : ''}
      </div>
      <div class="goal-labels">
        <span>Baseline</span>
        <span>Current</span>
        <span>Target</span>
      </div>
    </div>
  `;
}

/**
 * Auto-calculate current values from workout logs and Garmin data.
 */
async function refreshGoalValues(goals) {
  const client = getSupabaseClient();
  if (!client) return;

  for (const goal of goals) {
    if (goal.status === 'achieved') continue;

    try {
      let currentValue = null;

      if (goal.category === 'strength_pr') {
        currentValue = await getMaxWeightForExercise(client, goal.title);
      } else if (goal.category === 'cardio_distance') {
        currentValue = await getBestDistance(client, goal.metric);
      } else if (goal.category === 'cardio_time') {
        currentValue = await getBestTime(client, goal.metric);
      } else if (goal.category === 'body_comp') {
        currentValue = await getLatestBodyComp(client, goal.metric);
      }

      if (currentValue != null && currentValue !== goal.current_value) {
        goal.current_value = currentValue;
        updateGoalProgress(goal.id, currentValue).catch(() => {});
      }
    } catch {
      // Skip failed calculations silently
    }
  }
}

async function getMaxWeightForExercise(client, exerciseTitle) {
  // Search workout_logs actual_json for max weight on matching exercises
  const { data: logs } = await client
    .from('workout_logs')
    .select('actual_json')
    .eq('status', 'completed')
    .order('date', { ascending: false })
    .limit(50);

  if (!logs) return null;

  let maxWeight = 0;
  const searchName = exerciseTitle.toLowerCase().replace(/^increase\s+/i, '');

  for (const log of logs) {
    const exercises = log.actual_json?.exercises || [];
    for (const ex of exercises) {
      if (ex.exercise && ex.exercise.toLowerCase().includes(searchName) && ex.weight) {
        maxWeight = Math.max(maxWeight, ex.weight);
      }
    }
  }

  return maxWeight > 0 ? maxWeight : null;
}

async function getBestDistance(client, metric) {
  const { data } = await client
    .from('activities')
    .select('distance_meters')
    .order('distance_meters', { ascending: false })
    .limit(1);

  if (!data?.[0]?.distance_meters) return null;
  return Math.round(data[0].distance_meters / 100) / 10; // km with 1 decimal
}

async function getBestTime(client, metric) {
  // For time goals (lower is better), get shortest duration for the activity type
  const { data } = await client
    .from('activities')
    .select('duration_seconds')
    .order('duration_seconds', { ascending: true })
    .limit(1);

  if (!data?.[0]?.duration_seconds) return null;
  return Math.round(data[0].duration_seconds / 60); // minutes
}

async function getLatestBodyComp(client, metric) {
  const { data } = await client
    .from('body_composition')
    .select('weight_kg, body_fat_pct')
    .order('date', { ascending: false })
    .limit(1);

  if (!data?.[0]) return null;
  if (metric === 'body_fat') return data[0].body_fat_pct;
  return data[0].weight_kg;
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}
