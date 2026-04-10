// Progression Sparkline — dual-line SVG chart showing planned vs actual training load

const INTENSITY_WEIGHT = { high: 1.0, moderate: 0.7, low: 0.4, rest: 0 };
const INTENSITY_MAP = {
  'Low': 25, 'Low to Moderate': 40, 'Moderate': 55,
  'Moderate to High': 70, 'High': 85, 'Very High': 95,
};

/**
 * Compute planned weekly load curve from plan_json phases.
 * Load = phaseIntensity * (0.7 + sessionDensity * 0.3), normalized to 0-100.
 * Each point carries metadata for tooltip display.
 */
export function computePlannedCurve(planJson, durationWeeks) {
  const phases = planJson?.plan?.phases || planJson?.phases || [];
  if (!phases.length) return [];
  const curve = [];

  for (let week = 1; week <= durationWeeks; week++) {
    const phase = phases.find(p => p.weeks && p.weeks.includes(week));
    const intensityLabel = phase?.intensity_range || 'Moderate';
    const baseLoad = INTENSITY_MAP[intensityLabel] || 50;
    const sessions = phase?.sessions_per_week || 4;
    const sessionFactor = sessions / 7;
    const load = Math.round(baseLoad * (0.7 + sessionFactor * 0.3));

    curve.push({
      week,
      load,
      phase: phase?.name || '',
      intensity: intensityLabel,
      sessions,
    });
  }
  return curve;
}

/**
 * Compute actual weekly load from workout logs.
 * Uses planned load as ceiling, scaled by completion and adherence.
 * actual_load = planned_load * (completedStimulus / maxStimulus)
 * Each point carries breakdown metadata for tooltip display.
 */
export function computeActualCurve(workouts, logs, currentWeek, plannedCurve) {
  const curve = [];

  for (let week = 1; week <= currentWeek; week++) {
    const weekWorkouts = workouts.filter(w => w.week_number === week && w.workout_type !== 'rest');
    const weekLogs = logs.filter(l => weekWorkouts.some(w => w.id === l.workout_id));
    const planned = plannedCurve?.find(p => p.week === week);
    const plannedLoad = planned?.load || 50;

    const total = weekWorkouts.length;
    let completed = 0;
    let totalAdherence = 0;
    let deliveredStimulus = 0;
    let maxStimulus = 0;

    for (const w of weekWorkouts) {
      const log = weekLogs.find(l => l.workout_id === w.id);
      const weight = INTENSITY_WEIGHT[w.intensity] || 0.5;
      maxStimulus += weight;

      if (log && (log.status === 'completed' || log.status === 'partial')) {
        completed++;
        const adherence = log.adherence_score ?? 80;
        totalAdherence += adherence;
        deliveredStimulus += weight * (adherence / 100);
      }
    }

    const load = maxStimulus > 0
      ? Math.round(plannedLoad * (deliveredStimulus / maxStimulus))
      : 0;

    const avgAdherence = completed > 0 ? Math.round(totalAdherence / completed) : 0;

    curve.push({
      week,
      load,
      completed,
      total,
      missed: total - completed,
      avgAdherence,
      plannedLoad,
      delta: load - plannedLoad,
    });
  }
  return curve;
}

/**
 * Render SVG sparkline into container
 * @param {HTMLElement} container
 * @param {Array<{week, load, ...}>} plannedCurve
 * @param {Array<{week, load, ...}>} actualCurve
 * @param {number} currentWeek
 * @param {Array} phases - from plan_json.plan.phases
 * @param {Object} options - { compact, interactive, projectedCurve, altProjectedCurve }
 */
export function renderSparkline(container, plannedCurve, actualCurve, currentWeek, phases, options = {}) {
  const { compact = true, projectedCurve = null, altProjectedCurve = null } = options;

  if (!plannedCurve.length) {
    container.innerHTML = '<div style="color:var(--text-tertiary);font-size:var(--text-xs);text-align:center;padding:8px">No plan data</div>';
    return;
  }

  const totalWeeks = plannedCurve.length;
  const maxLoad = Math.max(100, ...plannedCurve.map(p => p.load), ...actualCurve.map(a => a.load));

  // Square viewing box: height matches container width, scrollable if season is wide
  const H = 300;
  const W = Math.max(H, totalWeeks * 60);
  const padX = 16;
  const padTop = 28;
  const padBottom = 20;
  const chartW = W - padX * 2;
  const chartH = H - padTop - padBottom;

  // Interpolate weekly points into daily for smoother curves
  function interpolateDaily(weeklyCurve) {
    if (weeklyCurve.length < 2) return weeklyCurve.map(p => ({ day: (p.week - 1) * 7 + 3.5, load: p.load }));
    const daily = [];
    for (let i = 0; i < weeklyCurve.length - 1; i++) {
      const a = weeklyCurve[i], b = weeklyCurve[i + 1];
      for (let d = 0; d < 7; d++) {
        const t = d / 7;
        daily.push({ day: (a.week - 1) * 7 + d, load: a.load + (b.load - a.load) * t });
      }
    }
    const last = weeklyCurve[weeklyCurve.length - 1];
    daily.push({ day: (last.week - 1) * 7 + 3.5, load: last.load });
    return daily;
  }

  const totalDays = totalWeeks * 7;

  function x(day) { return padX + (day / Math.max(totalDays - 1, 1)) * chartW; }
  function xWeek(week) { return padX + (((week - 1) * 7 + 3.5) / Math.max(totalDays - 1, 1)) * chartW; }
  function y(load) { return padTop + chartH - (load / maxLoad) * chartH; }

  // Generate smooth SVG path from daily interpolated data
  function smoothPath(dailyCurve) {
    if (dailyCurve.length < 2) return '';
    const points = dailyCurve.map(p => ({ x: x(p.day), y: y(p.load) }));
    let d = `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1], curr = points[i];
      const cpx = (prev.x + curr.x) / 2;
      d += ` C ${cpx.toFixed(1)},${prev.y.toFixed(1)} ${cpx.toFixed(1)},${curr.y.toFixed(1)} ${curr.x.toFixed(1)},${curr.y.toFixed(1)}`;
    }
    return d;
  }

  function polyline(curve) {
    const daily = interpolateDaily(curve);
    return daily.map(p => `${x(p.day).toFixed(1)},${y(p.load).toFixed(1)}`).join(' ');
  }

  // Interpolate to daily
  const plannedDaily = interpolateDaily(plannedCurve);
  const actualDaily = interpolateDaily(actualCurve);

  // Divergence fill between planned and actual (using daily points)
  let divergenceFill = '';
  if (actualDaily.length >= 2) {
    const maxActualDay = actualDaily[actualDaily.length - 1].day;
    const actualPoints = actualDaily.map(p => `${x(p.day).toFixed(1)},${y(p.load).toFixed(1)}`);
    const plannedTrimmed = plannedDaily.filter(p => p.day <= maxActualDay);
    const plannedReverse = [...plannedTrimmed].reverse().map(p => `${x(p.day).toFixed(1)},${y(p.load).toFixed(1)}`);

    if (actualPoints.length && plannedReverse.length) {
      const avgActual = actualCurve.reduce((s, p) => s + p.load, 0) / actualCurve.length;
      const avgPlanned = plannedCurve.filter(p => p.week <= currentWeek).reduce((s, p) => s + p.load, 0) / Math.max(actualCurve.length, 1);
      const fillColor = avgActual >= avgPlanned
        ? 'rgba(74, 222, 128, 0.12)'
        : 'rgba(248, 113, 113, 0.12)';

      divergenceFill = `<polygon points="${actualPoints.join(' ')} ${plannedReverse.join(' ')}" fill="${fillColor}" stroke="none"/>`;
    }
  }

  // Phase labels (above chart)
  let phaseLabels = '';
  if (phases && phases.length) {
    phaseLabels = phases.map(p => {
      if (!p.weeks || !p.weeks.length) return '';
      const startWeek = Math.min(...p.weeks);
      const endWeek = Math.max(...p.weeks);
      const cx = (xWeek(startWeek) + xWeek(endWeek)) / 2;
      return `<text x="${cx.toFixed(1)}" y="10" text-anchor="middle" fill="var(--text-tertiary)" font-family="var(--font-mono)" font-size="8" letter-spacing="0.05em">${_escSvg(p.name || '')}</text>`;
    }).join('');
  }

  // Week ticks + grid lines
  const ticks = [];
  for (let w = 1; w <= totalWeeks; w++) {
    const tx = xWeek(w);
    ticks.push(`<line x1="${tx.toFixed(1)}" y1="${padTop}" x2="${tx.toFixed(1)}" y2="${H - padBottom}" stroke="var(--border-subtle)" stroke-width="0.5" opacity="0.3"/>`);
    ticks.push(`<text x="${tx.toFixed(1)}" y="${H - 2}" text-anchor="middle" fill="var(--text-tertiary)" font-family="var(--font-mono)" font-size="8">W${w}</text>`);
  }

  // Current week marker (pulsing circle)
  const currentActual = actualCurve.find(a => a.week === currentWeek);
  let marker = '';
  if (currentActual) {
    const cx = xWeek(currentActual.week).toFixed(1);
    const cy = y(currentActual.load).toFixed(1);
    marker = `
      <circle cx="${cx}" cy="${cy}" r="3.5" fill="var(--accent)" opacity="0.3">
        <animate attributeName="r" values="3.5;5;3.5" dur="2s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.3;0.1;0.3" dur="2s" repeatCount="indefinite"/>
      </circle>
      <circle cx="${cx}" cy="${cy}" r="2.5" fill="var(--accent)"/>`;
  }

  // Projected curves (for approval modal)
  let projectedLine = '';
  let altProjectedLine = '';
  if (projectedCurve && projectedCurve.length >= 2) {
    projectedLine = `<polyline points="${polyline(projectedCurve)}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="3 3" opacity="0.7"/>`;
  }
  if (altProjectedCurve && altProjectedCurve.length >= 2) {
    altProjectedLine = `<polyline points="${polyline(altProjectedCurve)}" fill="none" stroke="var(--status-yellow)" stroke-width="1.5" stroke-dasharray="3 3" opacity="0.5"/>`;
  }

  // Build smooth paths from daily data
  const plannedPath = smoothPath(plannedDaily);
  const actualPath = actualDaily.length >= 2 ? smoothPath(actualDaily) : '';

  // Interactive hover hit areas — invisible circles at each week point
  const hitAreas = [];
  for (let w = 1; w <= totalWeeks; w++) {
    const cx = xWeek(w).toFixed(1);
    // Use planned point y for future, actual for past/current
    const actual = actualCurve.find(a => a.week === w);
    const planned = plannedCurve.find(p => p.week === w);
    const cy = actual ? y(actual.load).toFixed(1) : (planned ? y(planned.load).toFixed(1) : y(0).toFixed(1));
    hitAreas.push(`<circle cx="${cx}" cy="${cy}" r="12" fill="transparent" class="sparkline-hit" data-week="${w}" style="cursor:pointer"/>`);
    // Small dot visible on hover
    hitAreas.push(`<circle cx="${cx}" cy="${cy}" r="2" fill="var(--text-muted)" class="sparkline-dot" data-week="${w}" opacity="0" style="pointer-events:none;transition:opacity 0.15s"/>`);
  }

  // Build wrapper with position:relative for tooltip positioning
  container.innerHTML = `
    <div class="sparkline-wrapper" style="position:relative">
      <svg viewBox="0 0 ${W} ${H}" style="width:${W}px;height:${H}px;display:block" class="progression-sparkline ${compact ? 'compact' : 'full'}">
        ${phaseLabels}
        ${ticks.join('')}
        ${divergenceFill}
        ${plannedPath ? `<path d="${plannedPath}" fill="none" stroke="var(--text-tertiary)" stroke-width="1.5" stroke-dasharray="5 4" opacity="0.5"/>` : ''}
        ${actualPath ? `<path d="${actualPath}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>` : ''}
        ${projectedLine}
        ${altProjectedLine}
        ${marker}
        ${hitAreas.join('')}
      </svg>
      <div class="sparkline-tooltip" style="display:none"></div>
    </div>`;

  // Wire hover interactions
  _wireTooltips(container, plannedCurve, actualCurve, phases, xWeek, y, W);
}

function _wireTooltips(container, plannedCurve, actualCurve, phases, xWeek, y, svgWidth) {
  const wrapper = container.querySelector('.sparkline-wrapper');
  const tooltip = container.querySelector('.sparkline-tooltip');
  const svg = container.querySelector('svg');
  if (!wrapper || !tooltip || !svg) return;

  svg.querySelectorAll('.sparkline-hit').forEach(hit => {
    hit.addEventListener('mouseenter', () => {
      const week = parseInt(hit.dataset.week);
      const planned = plannedCurve.find(p => p.week === week);
      const actual = actualCurve.find(a => a.week === week);
      const phase = phases?.find(p => p.weeks?.includes(week));

      // Show the dot
      svg.querySelectorAll(`.sparkline-dot[data-week="${week}"]`).forEach(d => d.setAttribute('opacity', '1'));

      // Build tooltip content
      const lines = [];
      lines.push(`<div class="stt-header">Week ${week}${phase ? ` · ${_escHtml(phase.name)}` : ''}</div>`);

      if (planned && actual) {
        const delta = actual.delta ?? (actual.load - planned.load);
        const deltaSign = delta >= 0 ? '+' : '';
        const deltaColor = delta >= 0 ? 'var(--accent)' : 'var(--status-red)';
        const deltaLabel = delta >= 0 ? 'ahead' : 'behind';

        lines.push(`<div class="stt-row"><span class="stt-label">Planned</span><span class="stt-val">${planned.load}</span></div>`);
        lines.push(`<div class="stt-row"><span class="stt-label">Actual</span><span class="stt-val" style="color:var(--accent)">${actual.load}</span></div>`);
        lines.push(`<div class="stt-delta" style="color:${deltaColor}">${deltaSign}${delta} ${deltaLabel}</div>`);
        lines.push('<div class="stt-divider"></div>');
        lines.push(`<div class="stt-row"><span class="stt-label">Completed</span><span class="stt-val">${actual.completed}/${actual.total} workouts</span></div>`);
        if (actual.completed > 0) {
          lines.push(`<div class="stt-row"><span class="stt-label">Adherence</span><span class="stt-val">${actual.avgAdherence}%</span></div>`);
        }
        if (actual.missed > 0) {
          lines.push(`<div class="stt-row stt-missed"><span class="stt-label">Missed</span><span class="stt-val">${actual.missed}</span></div>`);
        }
      } else if (planned) {
        // Future week — show plan info only
        lines.push(`<div class="stt-row"><span class="stt-label">Target load</span><span class="stt-val">${planned.load}</span></div>`);
        lines.push(`<div class="stt-row"><span class="stt-label">Intensity</span><span class="stt-val">${_escHtml(planned.intensity || '')}</span></div>`);
        lines.push(`<div class="stt-row"><span class="stt-label">Sessions</span><span class="stt-val">${planned.sessions || '--'}/wk</span></div>`);
      }

      tooltip.innerHTML = lines.join('');
      tooltip.style.display = '';

      // Position tooltip near the hit point
      const svgRect = svg.getBoundingClientRect();
      const wrapperRect = wrapper.getBoundingClientRect();
      const hitRect = hit.getBoundingClientRect();
      const tipWidth = tooltip.offsetWidth;
      const tipHeight = tooltip.offsetHeight;

      let left = hitRect.left - wrapperRect.left + hitRect.width / 2 - tipWidth / 2;
      let top = hitRect.top - wrapperRect.top - tipHeight - 8;

      // Clamp to stay within wrapper
      if (left < 4) left = 4;
      if (left + tipWidth > wrapper.offsetWidth - 4) left = wrapper.offsetWidth - tipWidth - 4;
      if (top < 0) top = hitRect.bottom - wrapperRect.top + 8; // flip below

      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    });

    hit.addEventListener('mouseleave', () => {
      const week = hit.dataset.week;
      svg.querySelectorAll(`.sparkline-dot[data-week="${week}"]`).forEach(d => d.setAttribute('opacity', '0'));
      tooltip.style.display = 'none';
    });
  });
}

function _escSvg(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
