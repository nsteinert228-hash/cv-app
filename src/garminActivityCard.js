// Garmin Activity Card — expandable activity summary with HR chart, pace, splits, elevation
import { getSupabaseClient } from './supabase.js';

// ── Data Fetching ───────────────────────────────────────────

async function fetchActivityData(activityId) {
  const client = getSupabaseClient();
  if (!client) return null;

  const [activityRes, metricsRes] = await Promise.all([
    client.from('activities').select('*').eq('activity_id', activityId).maybeSingle(),
    client.from('activity_metrics').select('*').eq('activity_id', activityId).maybeSingle(),
  ]);

  return {
    activity: activityRes.data,
    metrics: metricsRes.data,
  };
}

// ── Formatters ──────────────────────────────────────────────

function formatDistance(meters, unit = 'mi') {
  if (!meters) return '--';
  const val = unit === 'mi' ? meters / 1609.34 : meters / 1000;
  return `${val.toFixed(1)} ${unit}`;
}

function formatPace(durationSec, distanceMeters, unit = 'mi') {
  if (!durationSec || !distanceMeters) return '--';
  const distUnits = unit === 'mi' ? distanceMeters / 1609.34 : distanceMeters / 1000;
  if (distUnits <= 0) return '--';
  const paceSeconds = durationSec / distUnits;
  const mins = Math.floor(paceSeconds / 60);
  const secs = Math.round(paceSeconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')} /${unit}`;
}

function formatDuration(seconds) {
  if (!seconds) return '--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function formatTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ── Activity Type Icons ─────────────────────────────────────

const TYPE_ICONS = {
  running: '<path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-3.5 15l1-4.5 2.1 2V22h2v-5.5L13 13l.5-2.5c1.1 1.2 2.7 2 4.5 2V11c-1.6 0-2.9-.7-3.6-1.7L13 7.3c-.4-.5-1-.8-1.6-.8-.2 0-.3 0-.5.1L6 8.3V13h2V9.6l1.8-.7L8 16l-4 1v2l6.5-2z"/>',
  trail_running: '<path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-3.5 15l1-4.5 2.1 2V22h2v-5.5L13 13l.5-2.5c1.1 1.2 2.7 2 4.5 2V11c-1.6 0-2.9-.7-3.6-1.7L13 7.3c-.4-.5-1-.8-1.6-.8-.2 0-.3 0-.5.1L6 8.3V13h2V9.6l1.8-.7L8 16l-4 1v2l6.5-2z"/>',
  cycling: '<path d="M15.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM5 12c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5zm0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5zm5.8-10l2.4-2.4.8.8c1.3 1.3 3 2.1 5 2.1V9c-1.5 0-2.7-.6-3.6-1.5l-1.9-1.9c-.5-.4-1-.6-1.6-.6s-1.1.2-1.4.6L7.8 8.4c-.4.4-.6.9-.6 1.4 0 .6.2 1.1.6 1.4L11 14v5h2v-6.2l-2.2-2.3zM19 12c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5zm0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5z"/>',
  strength_training: '<path d="M20.57 14.86L22 13.43 20.57 12 17 15.57 8.43 7 12 3.43 10.57 2 9.14 3.43 7.71 2 5.57 4.14 4.14 2.71 2.71 4.14l1.43 1.43L2 7.71l1.43 1.43L2 10.57 3.43 12 7 8.43 15.57 17 12 20.57 13.43 22l1.43-1.43L16.29 22l2.14-2.14 1.43 1.43 1.43-1.43-1.43-1.43L22 16.29z"/>',
};

function getTypeIcon(activityType) {
  const type = (activityType || '').toLowerCase();
  for (const [key, svg] of Object.entries(TYPE_ICONS)) {
    if (type.includes(key)) return svg;
  }
  // Generic activity icon
  return '<circle cx="12" cy="12" r="3"/><path d="M12 5v1m0 12v1m-7-7h1m12 0h1"/>';
}

function getTypeLabel(activityType) {
  if (!activityType) return 'Activity';
  return activityType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── HR Zone Coloring ────────────────────────────────────────

function hrZoneColor(bpm, maxHr) {
  if (!maxHr) maxHr = 190;
  const pct = bpm / maxHr;
  if (pct < 0.6) return 'var(--status-blue)';    // Zone 1
  if (pct < 0.7) return 'var(--status-green)';   // Zone 2
  if (pct < 0.8) return 'var(--status-yellow)';  // Zone 3
  if (pct < 0.9) return 'var(--status-red)';     // Zone 4
  return '#FF4444';                                // Zone 5
}

// ── SVG Chart Renderers ─────────────────────────────────────

function renderHrChart(samples, avgHr, maxHr) {
  if (!samples || samples.length < 2) return '';

  const W = 320, H = 80;
  const padX = 4, padY = 4;
  const chartW = W - padX * 2, chartH = H - padY * 2;

  const maxTime = samples[samples.length - 1].t;
  const minBpm = Math.min(...samples.map(s => s.v)) - 5;
  const maxBpm = Math.max(...samples.map(s => s.v)) + 5;
  const range = maxBpm - minBpm || 1;

  function x(t) { return padX + (t / maxTime) * chartW; }
  function y(v) { return padY + chartH - ((v - minBpm) / range) * chartH; }

  // Build polyline with gradient segments
  const points = samples.map(s => `${x(s.t).toFixed(1)},${y(s.v).toFixed(1)}`).join(' ');

  // Fill area under curve
  const fillPoints = `${x(samples[0].t).toFixed(1)},${(padY + chartH).toFixed(1)} ${points} ${x(samples[samples.length - 1].t).toFixed(1)},${(padY + chartH).toFixed(1)}`;

  // Avg HR line
  const avgY = y(avgHr).toFixed(1);

  return `
    <div class="gac-chart-section">
      <div class="gac-chart-label">Heart Rate</div>
      <svg viewBox="0 0 ${W} ${H}" class="gac-hr-chart" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="hrFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--status-red)" stop-opacity="0.2"/>
            <stop offset="100%" stop-color="var(--status-red)" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <polygon points="${fillPoints}" fill="url(#hrFill)"/>
        <polyline points="${points}" fill="none" stroke="var(--status-red)" stroke-width="1.5" stroke-linejoin="round"/>
        ${avgHr ? `<line x1="${padX}" y1="${avgY}" x2="${W - padX}" y2="${avgY}" stroke="var(--text-tertiary)" stroke-width="0.5" stroke-dasharray="3 2"/>
        <text x="${W - padX - 1}" y="${avgY - 3}" text-anchor="end" fill="var(--text-tertiary)" font-family="var(--font-mono)" font-size="7">avg ${avgHr}</text>` : ''}
      </svg>
      <div class="gac-chart-minmax">
        <span>${Math.round(minBpm + 5)} min</span>
        <span>${Math.round(maxBpm - 5)} max</span>
      </div>
    </div>`;
}

function renderPaceChart(samples) {
  if (!samples || samples.length < 2) return '';

  const W = 320, H = 60;
  const padX = 4, padY = 4;
  const chartW = W - padX * 2, chartH = H - padY * 2;

  const maxTime = samples[samples.length - 1].t;
  // Pace: lower is faster, so invert Y
  const values = samples.map(s => s.v).filter(v => v > 0 && v < 1200); // filter outliers
  if (values.length < 2) return '';
  const minPace = Math.min(...values);
  const maxPace = Math.max(...values);
  const range = maxPace - minPace || 1;

  function x(t) { return padX + (t / maxTime) * chartW; }
  function y(v) { return padY + ((v - minPace) / range) * chartH; } // inverted: faster = higher

  const points = samples
    .filter(s => s.v > 0 && s.v < 1200)
    .map(s => `${x(s.t).toFixed(1)},${y(s.v).toFixed(1)}`)
    .join(' ');

  return `
    <div class="gac-chart-section">
      <div class="gac-chart-label">Pace</div>
      <svg viewBox="0 0 ${W} ${H}" class="gac-pace-chart" preserveAspectRatio="xMidYMid meet">
        <polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round" opacity="0.8"/>
      </svg>
    </div>`;
}

function renderElevationProfile(samples) {
  if (!samples || samples.length < 2) return '';

  const W = 320, H = 40;
  const padX = 4, padY = 2;
  const chartW = W - padX * 2, chartH = H - padY * 2;

  const maxTime = samples[samples.length - 1].t;
  const elevations = samples.map(s => s.v);
  const minElev = Math.min(...elevations);
  const maxElev = Math.max(...elevations);
  const range = maxElev - minElev || 1;

  function x(t) { return padX + (t / maxTime) * chartW; }
  function y(v) { return padY + chartH - ((v - minElev) / range) * chartH; }

  const points = samples.map(s => `${x(s.t).toFixed(1)},${y(s.v).toFixed(1)}`).join(' ');
  const fillPoints = `${x(samples[0].t).toFixed(1)},${padY + chartH} ${points} ${x(samples[samples.length - 1].t).toFixed(1)},${padY + chartH}`;

  const gainFt = Math.round((maxElev - minElev) * 3.28084);

  return `
    <div class="gac-chart-section">
      <div class="gac-chart-label">Elevation <span class="gac-elev-gain">+${gainFt} ft</span></div>
      <svg viewBox="0 0 ${W} ${H}" class="gac-elev-chart" preserveAspectRatio="xMidYMid meet">
        <polygon points="${fillPoints}" fill="var(--bg-surface-3)" opacity="0.6"/>
        <polyline points="${points}" fill="none" stroke="var(--text-tertiary)" stroke-width="1" opacity="0.6"/>
      </svg>
    </div>`;
}

function renderSplitsTable(splits, unit = 'mi') {
  if (!splits || !splits.length) return '';

  const rows = splits.map((s, i) => {
    const dist = unit === 'mi' ? (s.distance_m / 1609.34).toFixed(1) : (s.distance_m / 1000).toFixed(1);
    const time = formatDuration(s.duration_s);
    const pace = s.avg_pace || (s.duration_s && s.distance_m ? formatPace(s.duration_s, s.distance_m, unit) : '--');
    const hr = s.avg_hr || '--';
    const elevGain = s.elevation_gain ? `+${Math.round(s.elevation_gain * 3.28084)}` : '--';

    return `
      <tr>
        <td>${i + 1}</td>
        <td>${dist} ${unit}</td>
        <td>${time}</td>
        <td>${typeof pace === 'string' ? pace : '--'}</td>
        <td>${hr}</td>
        <td>${elevGain}</td>
      </tr>`;
  }).join('');

  return `
    <div class="gac-chart-section">
      <div class="gac-chart-label">Splits</div>
      <table class="gac-splits-table">
        <thead><tr><th>#</th><th>Dist</th><th>Time</th><th>Pace</th><th>HR</th><th>Elev</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── Main Render ─────────────────────────────────────────────

export async function renderGarminActivityCard(container, activityId) {
  container.innerHTML = `
    <div class="gac-card gac-loading">
      <div class="gac-loading-text">Loading activity...</div>
    </div>`;

  try {
    const result = await fetchActivityData(activityId);
    if (!result?.activity) {
      container.innerHTML = '';
      return;
    }

    const { activity, metrics } = result;
    const isRun = (activity.activity_type || '').toLowerCase().includes('run');
    const typeIcon = getTypeIcon(activity.activity_type);
    const typeLabel = getTypeLabel(activity.activity_type);

    const hasDetails = metrics && (
      (metrics.heart_rate_samples && metrics.heart_rate_samples.length > 2) ||
      (metrics.splits && metrics.splits.length > 0)
    );

    // Compact card
    container.innerHTML = `
      <div class="gac-card" id="gacCard_${activityId}">
        <div class="gac-compact">
          <div class="gac-header">
            <svg class="gac-type-icon" viewBox="0 0 24 24" fill="var(--text-secondary)">${typeIcon}</svg>
            <div class="gac-header-info">
              <div class="gac-name">${esc(activity.name || typeLabel)}</div>
              <div class="gac-datetime">${formatDate(activity.date)}${activity.start_time ? ', ' + formatTime(activity.start_time) : ''}</div>
            </div>
          </div>
          <div class="gac-stats">
            <div class="gac-stat">
              <div class="gac-stat-val">${formatDistance(activity.distance_meters)}</div>
              <div class="gac-stat-label">Distance</div>
            </div>
            <div class="gac-stat">
              <div class="gac-stat-val">${formatDuration(activity.duration_seconds)}</div>
              <div class="gac-stat-label">Time</div>
            </div>
            ${isRun ? `<div class="gac-stat">
              <div class="gac-stat-val">${formatPace(activity.duration_seconds, activity.distance_meters)}</div>
              <div class="gac-stat-label">Pace</div>
            </div>` : ''}
            ${activity.avg_heart_rate ? `<div class="gac-stat">
              <div class="gac-stat-val">${activity.avg_heart_rate} <span class="gac-bpm">bpm</span></div>
              <div class="gac-stat-label">Avg HR</div>
            </div>` : ''}
            ${activity.elevation_gain_meters ? `<div class="gac-stat">
              <div class="gac-stat-val">${Math.round(activity.elevation_gain_meters * 3.28084)} ft</div>
              <div class="gac-stat-label">Elevation</div>
            </div>` : ''}
          </div>
          ${hasDetails ? `<button class="gac-expand-btn" id="gacExpand_${activityId}">
            <span>View Activity Details</span>
            <svg viewBox="0 0 24 24" width="14" height="14"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>
          </button>` : ''}
        </div>
        ${hasDetails ? `<div class="gac-expanded" id="gacExpanded_${activityId}">
          ${metrics.heart_rate_samples ? renderHrChart(metrics.heart_rate_samples, activity.avg_heart_rate, activity.max_heart_rate) : ''}
          ${isRun && metrics.pace_samples ? renderPaceChart(metrics.pace_samples) : ''}
          ${metrics.elevation_samples ? renderElevationProfile(metrics.elevation_samples) : ''}
          ${metrics.splits ? renderSplitsTable(metrics.splits) : ''}
        </div>` : ''}
      </div>`;

    // Wire expand/collapse
    if (hasDetails) {
      const expandBtn = document.getElementById(`gacExpand_${activityId}`);
      const expandedEl = document.getElementById(`gacExpanded_${activityId}`);
      const cardEl = document.getElementById(`gacCard_${activityId}`);
      if (expandBtn && expandedEl) {
        expandBtn.addEventListener('click', () => {
          cardEl.classList.toggle('expanded');
        });
      }
    }
  } catch (err) {
    console.error('Garmin activity card error:', err);
    container.innerHTML = '';
  }
}
