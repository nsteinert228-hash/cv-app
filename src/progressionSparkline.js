// Progression Sparkline — dual-line SVG chart showing planned vs actual training load

/**
 * Compute planned weekly load curve from plan_json phases
 */
export function computePlannedCurve(planJson, durationWeeks) {
  const phases = planJson?.plan?.phases || planJson?.phases || [];
  if (!phases.length) return [];
  const curve = [];

  const intensityMap = {
    'Low': 25, 'Low to Moderate': 40, 'Moderate': 55,
    'Moderate to High': 70, 'High': 85, 'Very High': 95,
  };

  for (let week = 1; week <= durationWeeks; week++) {
    const phase = phases.find(p => p.weeks && p.weeks.includes(week));
    const baseLoad = intensityMap[phase?.intensity_range] || 50;
    const sessionFactor = (phase?.sessions_per_week || 4) / 7;
    curve.push({ week, load: Math.round(baseLoad * (0.7 + sessionFactor * 0.3)) });
  }
  return curve;
}

/**
 * Compute actual weekly load from workout logs
 */
export function computeActualCurve(workouts, logs, currentWeek) {
  const curve = [];
  const intensityWeight = { high: 1.0, moderate: 0.7, low: 0.4, rest: 0 };

  for (let week = 1; week <= currentWeek; week++) {
    const weekWorkouts = workouts.filter(w => w.week_number === week);
    const weekLogs = logs.filter(l => weekWorkouts.some(w => w.id === l.workout_id));

    let totalScore = 0, totalWeight = 0;
    for (const w of weekWorkouts) {
      const log = weekLogs.find(l => l.workout_id === w.id);
      const weight = intensityWeight[w.intensity] || 0.5;
      const score = log ? (log.adherence_score || 0) : 0;
      totalScore += score * weight;
      totalWeight += weight;
    }
    curve.push({ week, load: totalWeight > 0 ? Math.round(totalScore / totalWeight) : 0 });
  }
  return curve;
}

/**
 * Render SVG sparkline into container
 * @param {HTMLElement} container
 * @param {Array<{week, load}>} plannedCurve
 * @param {Array<{week, load}>} actualCurve
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

  // Use wider SVG for scrollability on long seasons, square-ish aspect for compact
  const minW = compact ? 400 : 500;
  const W = Math.max(minW, totalWeeks * 50);
  const H = compact ? 160 : 200;
  const padX = 12;
  const padTop = compact ? 16 : 24;
  const padBottom = compact ? 14 : 18;
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
    // Subtle vertical grid line
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

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="progression-sparkline ${compact ? 'compact' : 'full'}" preserveAspectRatio="xMinYMid meet">
      ${phaseLabels}
      ${ticks.join('')}
      ${divergenceFill}
      ${plannedPath ? `<path d="${plannedPath}" fill="none" stroke="var(--text-tertiary)" stroke-width="1.5" stroke-dasharray="5 4" opacity="0.5"/>` : ''}
      ${actualPath ? `<path d="${actualPath}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>` : ''}
      ${projectedLine}
      ${altProjectedLine}
      ${marker}
    </svg>`;
}

function _escSvg(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
