// Season overview dashboard — week-by-week progress, adherence, type distribution
import { getSeasonOverviewStats } from './seasonData.js';

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
      ${buildAdherenceSparkline(stats.weekStats)}
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
        <span class="so-legend-item"><span class="so-dot completed"></span>Done</span>
        <span class="so-legend-item"><span class="so-dot partial"></span>Partial</span>
        <span class="so-legend-item"><span class="so-dot skipped"></span>Skipped</span>
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
  const total = Object.values(prescribed).reduce((a, b) => a + b, 0);
  if (total === 0) return '';

  const TYPE_LABELS = {
    strength: 'STR',
    cardio: 'CRD',
    recovery: 'REC',
    mixed: 'MIX',
    rest: 'REST',
  };

  const items = Object.entries(prescribed)
    .sort(([, a], [, b]) => b - a)
    .map(([type, count]) => {
      const pct = Math.round(count / total * 100);
      const label = TYPE_LABELS[type] || type.toUpperCase().slice(0, 3);
      return `
        <div class="so-type-item">
          <div class="so-type-bar-track">
            <div class="so-type-bar-fill ${type}" style="width:${pct}%"></div>
          </div>
          <div class="so-type-label">${label}</div>
          <div class="so-type-count">${count}</div>
        </div>
      `;
    }).join('');

  return `
    <div class="so-section">
      <div class="so-section-title">Workout Distribution</div>
      <div class="so-type-grid">${items}</div>
    </div>
  `;
}
