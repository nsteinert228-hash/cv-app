// Progression Sparkline — dual-line SVG chart showing planned vs actual training load

/**
 * Compute planned weekly load curve from plan_json phases
 */
export function computePlannedCurve(planJson, durationWeeks) {
  if (!planJson?.plan?.phases) return [];
  const phases = planJson.plan.phases;
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

  const W = compact ? 300 : 400;
  const H = compact ? 60 : 100;
  const padX = 8;
  const padTop = compact ? 14 : 22;
  const padBottom = compact ? 10 : 16;
  const chartW = W - padX * 2;
  const chartH = H - padTop - padBottom;

  const totalWeeks = plannedCurve.length;
  const maxLoad = Math.max(100, ...plannedCurve.map(p => p.load), ...actualCurve.map(a => a.load));

  function x(week) { return padX + ((week - 1) / Math.max(totalWeeks - 1, 1)) * chartW; }
  function y(load) { return padTop + chartH - (load / maxLoad) * chartH; }

  function polyline(curve) {
    return curve.map(p => `${x(p.week).toFixed(1)},${y(p.load).toFixed(1)}`).join(' ');
  }

  // Divergence fill between planned and actual
  let divergenceFill = '';
  if (actualCurve.length >= 2) {
    // Build a closed polygon: actual forward, planned backward
    const actualPoints = actualCurve.map(p => `${x(p.week).toFixed(1)},${y(p.load).toFixed(1)}`);
    const plannedReverse = [...plannedCurve]
      .filter(p => p.week <= currentWeek)
      .reverse()
      .map(p => `${x(p.week).toFixed(1)},${y(p.load).toFixed(1)}`);

    if (actualPoints.length && plannedReverse.length) {
      // Determine color based on average divergence
      const avgActual = actualCurve.reduce((s, p) => s + p.load, 0) / actualCurve.length;
      const avgPlanned = plannedCurve.filter(p => p.week <= currentWeek).reduce((s, p) => s + p.load, 0) / Math.max(actualCurve.length, 1);
      const fillColor = avgActual >= avgPlanned
        ? 'rgba(74, 222, 128, 0.08)'
        : 'rgba(248, 113, 113, 0.08)';

      divergenceFill = `<polygon points="${actualPoints.join(' ')} ${plannedReverse.join(' ')}" fill="${fillColor}" stroke="none"/>`;
    }
  }

  // Phase labels (above chart)
  let phaseLabels = '';
  if (phases && phases.length && !compact) {
    phaseLabels = phases.map(p => {
      if (!p.weeks || !p.weeks.length) return '';
      const startWeek = Math.min(...p.weeks);
      const endWeek = Math.max(...p.weeks);
      const cx = (x(startWeek) + x(endWeek)) / 2;
      return `<text x="${cx.toFixed(1)}" y="8" text-anchor="middle" fill="var(--text-tertiary)" font-family="var(--font-mono)" font-size="7" letter-spacing="0.05em" text-transform="uppercase">${_escSvg(p.name || '')}</text>`;
    }).join('');
  }

  // Week ticks
  const ticks = [];
  const tickInterval = totalWeeks <= 8 ? 1 : totalWeeks <= 16 ? 2 : 4;
  for (let w = 1; w <= totalWeeks; w += tickInterval) {
    const tx = x(w);
    ticks.push(`<line x1="${tx.toFixed(1)}" y1="${H - padBottom + 2}" x2="${tx.toFixed(1)}" y2="${H - padBottom + 5}" stroke="var(--text-tertiary)" stroke-width="0.5" opacity="0.4"/>`);
    if (!compact || w === 1 || w === totalWeeks || w % tickInterval === 0) {
      ticks.push(`<text x="${tx.toFixed(1)}" y="${H - 1}" text-anchor="middle" fill="var(--text-tertiary)" font-family="var(--font-mono)" font-size="7">W${w}</text>`);
    }
  }

  // Current week marker (pulsing circle)
  const currentActual = actualCurve.find(a => a.week === currentWeek);
  let marker = '';
  if (currentActual) {
    const cx = x(currentActual.week).toFixed(1);
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

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="progression-sparkline ${compact ? 'compact' : 'full'}" preserveAspectRatio="xMidYMid meet">
      ${phaseLabels}
      ${divergenceFill}
      <polyline points="${polyline(plannedCurve)}" fill="none" stroke="var(--text-tertiary)" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.5"/>
      ${actualCurve.length >= 2 ? `<polyline points="${polyline(actualCurve)}" fill="none" stroke="var(--accent)" stroke-width="2"/>` : ''}
      ${projectedLine}
      ${altProjectedLine}
      ${marker}
      ${ticks.join('')}
    </svg>`;
}

function _escSvg(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
