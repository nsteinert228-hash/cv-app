// Season overview dashboard — week-by-week progress, adherence, type distribution
import { getSeasonOverviewStats, getSeasonWorkouts, getWorkoutLogsForSeason, getSeasonById } from './seasonData.js';
import { computePlannedCurve, computeActualCurve, renderSparkline } from './progressionSparkline.js';

/**
 * Render the season progress overview into a container element.
 * Shows week completion bars, adherence sparkline, type distribution, and totals.
 */
export async function renderSeasonOverview(containerEl, seasonId, currentWeek) {
  if (!containerEl || !seasonId) return;

  try {
    const stats = await getSeasonOverviewStats(seasonId);
    containerEl.innerHTML = buildOverviewHTML(stats, currentWeek);
    containerEl.style.display = '';

    // Render progression sparkline
    const sparklineEl = containerEl.querySelector('#progressionSparkline');
    if (sparklineEl) {
      try {
        const [season, workouts, logs] = await Promise.all([
          getSeasonById(seasonId),
          getSeasonWorkouts(seasonId),
          getWorkoutLogsForSeason(seasonId),
        ]);
        if (season?.plan_json) {
          console.log('[sparkline] plan_json keys:', Object.keys(season.plan_json));
          console.log('[sparkline] plan_json.plan:', season.plan_json.plan ? Object.keys(season.plan_json.plan) : 'missing');
          console.log('[sparkline] phases:', season.plan_json?.plan?.phases || season.plan_json?.phases || 'none');
          const durationWeeks = season.duration_weeks || 8;
          const plannedCurve = computePlannedCurve(season.plan_json, durationWeeks);
          console.log('[sparkline] plannedCurve:', plannedCurve);
          const actualCurve = computeActualCurve(workouts || [], logs || [], currentWeek);
          const phases = season.plan_json?.plan?.phases || season.plan_json?.phases || [];
          if (plannedCurve.length > 0) {
            renderSparkline(sparklineEl, plannedCurve, actualCurve, currentWeek, phases, { compact: true });
          }
        }
      } catch (e) { console.warn('Sparkline render failed:', e); }
    }
  } catch (err) {
    console.warn('Season overview failed:', err);
    containerEl.style.display = 'none';
  }
}

function buildOverviewHTML(stats, currentWeek) {
  return `
    <div class="season-overview">
      <div class="season-overview-header">Season Progress</div>

      ${buildTotalsRow(stats)}
      ${buildWeekBars(stats.weekStats, currentWeek)}
      <div class="so-sparkline-section">
        <div class="so-sparkline-label">PLANNED VS ACTUAL</div>
        <div id="progressionSparkline" class="so-sparkline-container"></div>
        <div class="so-sparkline-legend">
          <span class="so-legend-item"><span class="so-legend-line dashed"></span>Planned</span>
          <span class="so-legend-item"><span class="so-legend-line solid"></span>Actual</span>
        </div>
      </div>
      ${buildTypeDistribution(stats.typeCounts)}
    </div>
  `;
}

// ── Totals row ───────────────────────────────────────────────

function buildTotalsRow(stats) {
  return `
    <div class="so-totals">
      <div class="so-total-item">
        <div class="so-total-val">${stats.completionRate}%</div>
        <div class="so-total-label">Completion</div>
      </div>
      <div class="so-total-item">
        <div class="so-total-val">${stats.avgAdherence != null ? stats.avgAdherence + '%' : '--'}</div>
        <div class="so-total-label">Adherence</div>
      </div>
      <div class="so-total-item">
        <div class="so-total-val">${stats.totalCompleted}/${stats.totalPlanned}</div>
        <div class="so-total-label">Workouts</div>
      </div>
      <div class="so-total-item">
        <div class="so-total-val">${stats.avgRpe != null ? stats.avgRpe : '--'}</div>
        <div class="so-total-label">Avg RPE</div>
      </div>
    </div>
  `;
}

// ── Week-by-week completion bars ─────────────────────────────

function buildWeekBars(weekStats, currentWeek) {
  if (!weekStats.length) return '';

  const rows = weekStats.map(w => {
    const total = w.completed + w.partial + w.skipped + w.unlogged + w.upcoming;
    if (total === 0) return '';

    const pct = (n) => Math.round(n / total * 100);
    const isCurrent = w.week === currentWeek;

    return `
      <div class="so-week-row${isCurrent ? ' current' : ''}">
        <div class="so-week-label">W${w.week}</div>
        <div class="so-week-bar">
          ${w.completed ? `<div class="so-bar-seg completed" style="width:${pct(w.completed)}%" title="${w.completed} completed"></div>` : ''}
          ${w.partial ? `<div class="so-bar-seg partial" style="width:${pct(w.partial)}%" title="${w.partial} partial"></div>` : ''}
          ${w.skipped ? `<div class="so-bar-seg skipped" style="width:${pct(w.skipped)}%" title="${w.skipped} skipped"></div>` : ''}
          ${w.unlogged ? `<div class="so-bar-seg unlogged" style="width:${pct(w.unlogged)}%" title="${w.unlogged} missed"></div>` : ''}
          ${w.upcoming ? `<div class="so-bar-seg upcoming" style="width:${pct(w.upcoming)}%" title="${w.upcoming} upcoming"></div>` : ''}
        </div>
        <div class="so-week-score">${w.avgAdherence != null ? w.avgAdherence + '%' : ''}</div>
      </div>
    `;
  }).join('');

  return `
    <div class="so-section">
      <div class="so-section-title">Weekly Completion</div>
      <div class="so-week-bars">${rows}</div>
      <div class="so-legend">
        <span class="so-legend-item"><span class="so-dot completed"></span>Strong (70%+)</span>
        <span class="so-legend-item"><span class="so-dot partial"></span>Partial (40-69%)</span>
        <span class="so-legend-item"><span class="so-dot skipped"></span>Weak/Skipped</span>
        <span class="so-legend-item"><span class="so-dot unlogged"></span>Missed</span>
        <span class="so-legend-item"><span class="so-dot upcoming"></span>Upcoming</span>
      </div>
    </div>
  `;
}

// ── Adherence sparkline (CSS-only) ──────────────────────────

function buildAdherenceSparkline(weekStats) {
  const scored = weekStats.filter(w => w.avgAdherence != null);
  if (scored.length < 2) return '';

  const max = 100;
  const points = scored.map((w, i) => {
    const x = (i / (scored.length - 1)) * 100;
    const y = 100 - (w.avgAdherence / max) * 100;
    return `${x},${y}`;
  }).join(' ');

  return `
    <div class="so-section">
      <div class="so-section-title">Adherence Trend</div>
      <div class="so-sparkline-container">
        <svg class="so-sparkline" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/>
        </svg>
        <div class="so-sparkline-labels">
          <span>W${scored[0].week}</span>
          <span>W${scored[scored.length - 1].week}</span>
        </div>
      </div>
    </div>
  `;
}

// ── Type distribution ───────────────────────────────────────

function buildTypeDistribution(typeCounts) {
  const prescribed = typeCounts.prescribed;
  const actual = typeCounts.actual || {};
  const plannedTotal = Object.values(prescribed).reduce((a, b) => a + b, 0);
  if (plannedTotal === 0) return '';

  // Actual totals (excluding 'missed')
  const actualDone = Object.entries(actual)
    .filter(([k]) => k !== 'missed')
    .reduce((sum, [, v]) => sum + v, 0);

  const TYPE_LABELS = {
    strength: 'STR',
    cardio: 'CRD',
    recovery: 'REC',
    mixed: 'MIX',
    rest: 'REST',
  };

  const TYPE_COLORS = {
    strength: '#8b5cf6',
    cardio: 'var(--accent)',
    recovery: '#06b6d4',
    mixed: '#f59e0b',
    rest: 'var(--text-tertiary)',
  };

  // Get all types from both planned and actual
  const allTypes = [...new Set([...Object.keys(prescribed), ...Object.keys(actual)])]
    .filter(t => t !== 'missed' && t !== 'other')
    .sort((a, b) => (prescribed[b] || 0) - (prescribed[a] || 0));

  const rows = allTypes.map(type => {
    const plannedCount = prescribed[type] || 0;
    const actualCount = actual[type] || 0;
    const plannedPct = plannedTotal > 0 ? Math.round(plannedCount / plannedTotal * 100) : 0;
    const actualPct = actualDone > 0 ? Math.round(actualCount / actualDone * 100) : 0;
    const label = TYPE_LABELS[type] || type.toUpperCase().slice(0, 3);
    const color = TYPE_COLORS[type] || 'var(--text-tertiary)';

    // Tracking indicator
    const diff = actualPct - plannedPct;
    let trackIcon = '';
    if (actualDone > 0) {
      if (Math.abs(diff) <= 5) trackIcon = '<span class="dist-track on">on track</span>';
      else if (diff > 5) trackIcon = `<span class="dist-track over">+${diff}%</span>`;
      else trackIcon = `<span class="dist-track under">${diff}%</span>`;
    }

    return `
      <div class="so-dist-row">
        <div class="so-dist-label">${label}</div>
        <div class="so-dist-bars">
          <div class="so-dist-bar-pair">
            <div class="so-dist-bar planned">
              <div class="so-dist-fill" style="width:${plannedPct}%;background:${color};opacity:0.35"></div>
            </div>
            <div class="so-dist-bar actual">
              <div class="so-dist-fill" style="width:${actualPct}%;background:${color}"></div>
            </div>
          </div>
        </div>
        <div class="so-dist-pcts">
          <span class="so-dist-planned-pct">${plannedPct}%</span>
          <span class="so-dist-actual-pct">${actualDone > 0 ? actualPct + '%' : '--'}</span>
        </div>
        ${trackIcon}
      </div>
    `;
  }).join('');

  return `
    <div class="so-section">
      <div class="so-section-title">Workout Distribution</div>
      <div class="so-dist-header">
        <span></span>
        <span class="so-dist-col-label">Planned</span>
        <span class="so-dist-col-label">Actual</span>
        <span></span>
      </div>
      <div class="so-dist-grid">${rows}</div>
    </div>
  `;
}
