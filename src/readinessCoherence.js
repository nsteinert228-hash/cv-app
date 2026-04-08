// Readiness Coherence — detect stale adaptations, generate context-aware hero text

const STALE_THRESHOLD_HOURS = 6;

/**
 * Check if an adaptation is stale (readiness has recovered since it was created)
 */
export function isAdaptationStale(adaptation, currentReadiness) {
  if (!adaptation || !currentReadiness) return false;

  const createdAt = adaptation.created_at || adaptation.createdAt;
  if (!createdAt) return false;

  const ageHours = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
  if (ageHours < STALE_THRESHOLD_HOURS) return false;

  const trigger = adaptation.trigger;
  if (trigger === 'high_stress' && currentReadiness.stress_avg != null && currentReadiness.stress_avg < 35) return true;
  if (trigger === 'sleep_decline' && currentReadiness.sleep_score != null && currentReadiness.sleep_score >= 70) return true;
  if (trigger === 'hrv_drop' && ['balanced', 'high'].includes((currentReadiness.hrv_status || '').toLowerCase())) return true;
  if (trigger === 'overtraining' && currentReadiness.body_battery != null && currentReadiness.body_battery >= 60) return true;

  return false;
}

/**
 * Generate coherent hero context that accounts for active adaptations
 */
export function getCoherentContext(readinessData, workout, adaptation) {
  if (!adaptation) {
    return { text: generateStandardContext(readinessData, workout), isStale: false, adaptation: null };
  }

  const stale = isAdaptationStale(adaptation, readinessData);

  if (stale) {
    const sleep = readinessData?.sleep_score || 0;
    const hrv = (readinessData?.hrv_status || '').toLowerCase();
    return {
      text: `Your readiness has improved since this workout was adjusted (sleep ${sleep}, ${hrv} HRV). You can keep the lighter session or revert to the original plan.`,
      isStale: true,
      adaptation,
    };
  }

  return {
    text: adaptation.summary || generateStandardContext(readinessData, workout),
    isStale: false,
    adaptation,
  };
}

/**
 * Standard readiness-based context (same logic as trainingDashboard.js:747-773)
 */
function generateStandardContext(readinessData, workout) {
  if (!readinessData) {
    const rx = workout?.prescription_json || {};
    return rx.description || '';
  }

  const sleep = readinessData.sleep_score || 0;
  const bb = readinessData.body_battery || 0;
  const hrv = (readinessData.hrv_status || '').toLowerCase();
  const intensity = (workout?.intensity || 'moderate').toLowerCase();

  const readinessGood = sleep >= 70 && (hrv === 'balanced' || hrv === 'high');
  const readinessPoor = sleep < 50 || hrv === 'low' || bb < 30;

  if (readinessGood && intensity === 'low') {
    return `Recovery looks great (${sleep} sleep, ${hrv} HRV). Today's easy session is strategic — building aerobic base while staying fresh for harder days ahead.`;
  } else if (readinessGood && intensity === 'high') {
    return `You're well recovered (${sleep} sleep, ${hrv} HRV) — perfect day to push hard.`;
  } else if (readinessGood) {
    return `Good recovery (${sleep} sleep, ${hrv} HRV). Solid day for ${intensity} effort.`;
  } else if (readinessPoor && intensity === 'high') {
    return `Recovery indicators are low (${sleep} sleep${bb ? `, ${bb} battery` : ''}). Consider dialing back intensity today.`;
  } else if (readinessPoor) {
    return `Recovery is below baseline. Listen to your body and don't push beyond what feels right.`;
  }
  return `Your ${sleep} sleep score and ${hrv || 'steady'} HRV support ${intensity} effort today.`;
}

/**
 * Format adaptation age with readiness context
 */
export function formatAdaptationAge(adaptation) {
  const createdAt = adaptation.created_at || adaptation.createdAt;
  if (!createdAt) return 'Adjusted recently';

  const ageMs = Date.now() - new Date(createdAt).getTime();
  const ageHours = Math.round(ageMs / (1000 * 60 * 60));

  const snapshot = adaptation.readiness_snapshot;
  let readinessNote = '';
  if (snapshot) {
    const parts = [];
    if (snapshot.stress_avg) parts.push(`stress ${snapshot.stress_avg}`);
    if (snapshot.sleep_score) parts.push(`sleep ${snapshot.sleep_score}`);
    if (snapshot.hrv_status) parts.push(`HRV ${snapshot.hrv_status}`);
    readinessNote = parts.length ? ` when ${parts.join(', ')}` : '';
  }

  if (ageHours < 1) return `Adjusted just now${readinessNote}`;
  if (ageHours < 24) return `Adjusted ${ageHours}h ago${readinessNote}`;
  return `Adjusted ${Math.round(ageHours / 24)}d ago${readinessNote}`;
}
