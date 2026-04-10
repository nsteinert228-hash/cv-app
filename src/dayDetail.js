// Day detail panel — drill down into a specific workout day
import { renderWorkoutConfirmation } from './workoutLogger.js';
import {
  findMatchingGarminActivity,
  swapWorkout,
  modifyWorkout,
  getThisWeekWorkouts,
  getAdaptationForDate,
  getPlanCompletion,
  revertWorkout,
  getProposedAdaptations,
  getWorkoutLog,
  getLocalToday,
} from './seasonData.js';
import { TRIGGER_LABELS, TRIGGER_COLORS } from './adaptationFeed.js';
import { isAdaptationStale, formatAdaptationAge } from './readinessCoherence.js';

// ── DOM refs ────────────────────────────────────────────────

const backdrop = document.getElementById('dayDetailBackdrop');
const titleEl = document.getElementById('dayDetailTitle');
const dateEl = document.getElementById('dayDetailDate');
const contentEl = document.getElementById('dayDetailContent');
const closeBtn = document.getElementById('dayDetailClose');

if (closeBtn) closeBtn.addEventListener('click', close);
if (backdrop) backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

// ── Public API ──────────────────────────────────────────────

export function close() {
  backdrop?.classList.remove('visible');
}

export async function open(workout, { normalizePrescription, esc, activeSeason, viewCache, loadView, currentView }) {
  if (!workout || !backdrop) return;

  titleEl.textContent = workout.title || workout.workout_type;
  dateEl.textContent = `${workout.date} · ${workout.intensity || 'moderate'} intensity · ${workout.duration_minutes || '--'} min`;
  backdrop.classList.add('visible');

  const rx = normalizePrescription(workout.prescription_json);
  const isCardio = workout.workout_type === 'cardio';

  // Determine temporal state — past workouts are read-only
  const today = getLocalToday();
  const dayState = workout.date < today ? 'past' : workout.date === today ? 'today' : 'future';

  let html = '';

  // Adaptation banner for adapted workouts
  if (workout.is_adapted && activeSeason) {
    try {
      const adaptation = await getAdaptationForDate(activeSeason.id, workout.date);
      if (adaptation) {
        const triggerLabel = TRIGGER_LABELS[adaptation.trigger] || TRIGGER_LABELS.unknown;
        const colorClass = TRIGGER_COLORS[adaptation.trigger] || 'adapt-schedule';

        // Parse summary: extract the concise change, strip verbose AI text
        const rawSummary = adaptation.summary || '';
        const { headline, detail } = parseAdaptationSummary(rawSummary, adaptation.trigger);

        // Trigger-specific icons and colors
        const triggerMeta = {
          hrv_drop: { icon: '💓', color: '#ef4444', desc: 'HRV drop detected' },
          sleep_decline: { icon: '😴', color: '#f59e0b', desc: 'Poor sleep recovery' },
          high_stress: { icon: '⚡', color: '#f59e0b', desc: 'Elevated stress' },
          missed_workout: { icon: '📅', color: '#888', desc: 'Missed session' },
          overtraining: { icon: '🛑', color: '#ef4444', desc: 'Overtraining risk' },
          high_readiness: { icon: '🟢', color: 'var(--accent)', desc: 'High readiness' },
          schedule: { icon: '🔄', color: '#06b6d4', desc: 'Plan adjusted' },
        };
        const meta = triggerMeta[adaptation.trigger] || { icon: '🔄', color: '#888', desc: 'Adjusted' };

        const ageText = formatAdaptationAge(adaptation);

        html += `
          <div class="adapt-card" style="border-left-color:${meta.color}">
            <div class="adapt-card-header">
              <span class="adapt-card-trigger" style="background:${meta.color}15;color:${meta.color}">${meta.icon} ${esc(meta.desc)}</span>
              <span class="adapt-card-age">${esc(ageText)}</span>
            </div>
            <div class="adapt-card-headline">${esc(headline)}</div>
            ${detail ? `<button class="adapt-card-toggle" onclick="this.nextElementSibling.classList.toggle('visible');this.textContent=this.textContent==='Show details'?'Hide details':'Show details'">Show details</button><div class="adapt-card-detail">${esc(detail)}</div>` : ''}
          </div>
        `;

        // Stale adaptation banner — only actionable for today/future, read-only for past
        if (dayState !== 'past') {
          let _readinessData = null;
          try {
            const { getTodayReadiness } = await import('./trainingData.js');
            _readinessData = await getTodayReadiness();
          } catch { /* ok */ }

          const stale = _readinessData ? isAdaptationStale(adaptation, _readinessData) : false;
          if (stale) {
            html += `
              <div class="stale-adaptation-banner">
                <div class="stale-banner-content">
                  <strong>Readiness Recovered</strong>
                  <p>${esc(ageText)}. Your current readiness supports the original plan.</p>
                </div>
                <div class="stale-banner-actions">
                  <button class="btn-primary btn-sm" id="staleRevertBtn" data-workout-id="${workout.id}">Revert to Original</button>
                  <button class="btn-ghost btn-sm" id="staleRefreshBtn">Refresh AI</button>
                  <button class="btn-ghost btn-sm" id="staleKeepBtn">Keep Adjusted</button>
                </div>
              </div>
            `;
          }
        }
      }
    } catch { /* ignore — don't block workout display */ }
  }

  // Garmin auto-detect for cardio (Approach A: detect then confirm)
  let _garminAutoMatch = null;
  if (isCardio) {
    try {
      const garminMatch = await findMatchingGarminActivity(workout.workout_type, workout.date);
      _garminAutoMatch = garminMatch;
      if (garminMatch) {
        const durMin = garminMatch.duration_seconds ? Math.round(garminMatch.duration_seconds / 60) : '--';
        html += `
          <div class="garmin-auto-detect">
            <span class="garmin-auto-detect-icon" style="font-size:0.6rem;font-weight:700;color:var(--accent)">GARMIN</span>
            <div class="garmin-auto-detect-info">
              <strong>Completed (verified via Garmin)</strong><br>
              ${esc(garminMatch.name || garminMatch.activity_type)} \u00B7 ${durMin} min
              ${garminMatch.avg_heart_rate ? ` \u00B7 ${garminMatch.avg_heart_rate} avg HR` : ''}
            </div>
          </div>
        `;
      }
    } catch { /* ignore */ }
  }

  // Prescription details
  if (rx.warmup && rx.warmup.activities && rx.warmup.activities.length) {
    html += `<div class="phase-section"><div class="phase-label">Warmup</div><div class="phase-items">${rx.warmup.duration_minutes || 5} min \u2014 ${rx.warmup.activities.map(esc).join(', ')}</div></div>`;
  }

  const exercises = rx.main_workout || [];
  if (exercises.length) {
    html += `<table class="exercise-table"><thead><tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th></tr></thead><tbody>`;
    html += exercises.map(ex => `
      <tr>
        <td>${esc(ex.exercise)}${ex.notes ? `<span class="exercise-notes">${esc(ex.notes)}</span>` : ''}</td>
        <td>${ex.sets || '--'}</td>
        <td>${esc(String(ex.reps || '--'))}</td>
        <td>${ex.rest_seconds ? `${ex.rest_seconds}s` : '--'}</td>
      </tr>
    `).join('');
    html += `</tbody></table>`;
  }

  if (rx.cooldown && rx.cooldown.activities && rx.cooldown.activities.length) {
    html += `<div class="phase-section" style="margin-top:12px"><div class="phase-label">Cooldown</div><div class="phase-items">${rx.cooldown.duration_minutes || 5} min \u2014 ${rx.cooldown.activities.map(esc).join(', ')}</div></div>`;
  }

  // Match insight card
  let _cachedCompletion = null;
  try {
    const completion = await getPlanCompletion(workout.id);
    _cachedCompletion = completion;
    if (completion && completion.match_type !== 'unmatched') {
      const breakdown = typeof completion.scoring_breakdown === 'string'
        ? JSON.parse(completion.scoring_breakdown) : (completion.scoring_breakdown || {});
      const scoreColor = completion.completion_score >= 80 ? 'green'
        : completion.completion_score >= 50 ? 'yellow' : 'red';

      html += `
        <div class="match-insight">
          <div class="match-insight-header">
            <span class="match-insight-label">Match Insight</span>
            <span class="match-insight-score ${scoreColor}">${Math.round(completion.completion_score)}%</span>
          </div>
          <div class="match-insight-reason">${esc(completion.match_reason || '')}</div>
          ${Object.keys(breakdown).length ? `
            <div class="match-insight-breakdown">
              ${_mibBar('Type', breakdown.type_score, 'Did the Garmin activity type match the planned workout type?')}
              ${_mibBar('Duration', breakdown.duration_score, 'How close was the actual duration to the prescribed time?')}
              ${_mibBar('Intensity', breakdown.intensity_score, 'Was the overall effort level (low/moderate/high) what the plan called for?')}
              ${_mibBar('Timing', breakdown.date_score, 'Was the activity done on the planned day, or offset by a day?')}
              ${_mibBar('Structure', breakdown.structure_score, breakdown.classification ? `Did the workout pattern match? Detected: ${breakdown.classification}` : 'Does the HR/pace pattern match the prescribed structure (intervals, tempo, easy, etc.)?')}
              ${_mibBar('Zones', breakdown.zone_score, 'How well does the time spent in each HR zone match the expected zone profile?')}
              ${_mibBar('Effort', breakdown.effort_score, breakdown.aerobic_te ? `Training effect and pace consistency. TE: ${breakdown.aerobic_te}${breakdown.pace_cv != null ? ', pace CV: ' + breakdown.pace_cv + '%' : ''}` : 'Combined training effect alignment and pace consistency from splits')}
            </div>
            ${breakdown.zones ? `
              <div class="mib-zones">
                <span class="mib-label">HR Zones</span>
                <div class="mib-zone-bar">
                  ${_zoneSegs(breakdown.zones)}
                </div>
              </div>
            ` : ''}
          ` : ''}
          <div class="match-insight-meta">
            ${completion.match_type} match · ${completion.activity_date || completion.match_date}${breakdown.classification && breakdown.classification !== 'unknown' ? ` · ${breakdown.classification}` : ''}${breakdown.aerobic_te ? ` · ${breakdown.aerobic_te} TE` : ''}
          </div>
        </div>
      `;
    }
  } catch { /* plan_completions may not exist yet */ }

  // Garmin Activity Card — embed if there's a linked activity
  html += '<div id="garminActivityEmbed"></div>';

  // Workout logger
  html += '<div id="dayDetailLogger"></div>';

  // Swap workout button — only for today and future workouts
  if (dayState !== 'past') {
    html += `
      <div class="day-detail-swap">
        <button class="btn-secondary" id="swapWorkoutBtn">Swap workout type</button>
        <div id="swapWorkoutPanel" style="display:none"></div>
      </div>
    `;
  }

  contentEl.innerHTML = html;

  // Wire custom tooltips on match insight bars and zones
  _wireMatchTooltips();

  // Render Garmin activity card if activity is linked
  try {
    const log = await getWorkoutLog(workout.id).catch(() => null);
    const garminActivityId = _cachedCompletion?.activity_id || log?.garmin_activity_id || _garminAutoMatch?.activity_id;
    if (garminActivityId) {
      const embedEl = document.getElementById('garminActivityEmbed');
      if (embedEl) {
        const { renderGarminActivityCard } = await import('./garminActivityCard.js');
        renderGarminActivityCard(embedEl, garminActivityId);
      }
    }
  } catch { /* ignore — don't block display */ }

  // Wire stale adaptation banner buttons
  const staleRevertBtn = document.getElementById('staleRevertBtn');
  if (staleRevertBtn) {
    staleRevertBtn.addEventListener('click', async () => {
      staleRevertBtn.disabled = true; staleRevertBtn.textContent = 'Reverting...';
      try {
        await revertWorkout(workout.id);
        close();
        window.dispatchEvent(new CustomEvent('utrain:adaptationResolved'));
      } catch (err) {
        staleRevertBtn.textContent = 'Failed'; staleRevertBtn.disabled = false;
      }
    });
  }
  document.getElementById('staleRefreshBtn')?.addEventListener('click', async () => {
    try {
      const proposals = await getProposedAdaptations(true);
      if (proposals.has_changes) {
        const { showAdaptationApproval } = await import('./adaptationApproval.js');
        showAdaptationApproval(proposals, { onComplete: () => { close(); window.dispatchEvent(new CustomEvent('utrain:adaptationResolved')); } });
      }
    } catch (err) { console.error('Refresh failed:', err); }
  });
  document.getElementById('staleKeepBtn')?.addEventListener('click', () => {
    document.querySelector('.stale-adaptation-banner')?.remove();
  });

  // Render workout logger
  const loggerEl = document.getElementById('dayDetailLogger');
  if (loggerEl) renderWorkoutConfirmation(loggerEl, workout);

  // Swap button
  const swapBtn = document.getElementById('swapWorkoutBtn');
  const swapPanel = document.getElementById('swapWorkoutPanel');
  if (swapBtn && swapPanel) {
    swapBtn.addEventListener('click', () => {
      swapPanel.style.display = swapPanel.style.display === 'none' ? '' : 'none';
      if (swapPanel.style.display !== 'none') {
        renderSwapUI(swapPanel, workout, { esc, activeSeason, viewCache, loadView, currentView });
      }
    });
  }
}

// ── Swap Workout ────────────────────────────────────────────

const SWAP_TYPES = [
  { type: 'strength', title: 'Strength Training', defaultDuration: 45 },
  { type: 'cardio', title: 'Cardio / Run', defaultDuration: 30 },
  { type: 'recovery', title: 'Recovery / Yoga', defaultDuration: 30 },
  { type: 'rest', title: 'Rest Day', defaultDuration: 0 },
];

function renderSwapUI(panelEl, workout, ctx) {
  const { esc } = ctx;
  const currentType = workout.workout_type;
  const otherTypes = SWAP_TYPES.filter(t => t.type !== currentType);

  panelEl.innerHTML = `
    <div style="margin-top:10px">
      <div style="font-size:0.72rem;color:var(--text-muted);font-weight:600;margin-bottom:8px">Replace "${esc(workout.title)}" with:</div>
      <div class="swap-options">
        ${otherTypes.map(t => `<button class="swap-option" data-type="${t.type}" data-title="${t.title}">${t.title}</button>`).join('')}
      </div>
      <div id="swapPreview"></div>
    </div>
  `;

  panelEl.querySelectorAll('.swap-option').forEach(btn => {
    btn.addEventListener('click', () => {
      panelEl.querySelectorAll('.swap-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      showSwapPreview(panelEl.querySelector('#swapPreview'), workout, btn.dataset.type, btn.dataset.title, ctx);
    });
  });
}

async function showSwapPreview(previewEl, workout, newType, newTitle, ctx) {
  const { esc, activeSeason, viewCache, loadView, currentView } = ctx;
  const weekWorkouts = await getThisWeekWorkouts(activeSeason.id);
  const otherDays = weekWorkouts.filter(w => w.id !== workout.id && w.workout_type !== 'rest');
  const typeCounts = {};
  for (const w of otherDays) {
    typeCounts[w.workout_type] = (typeCounts[w.workout_type] || 0) + 1;
  }
  typeCounts[newType] = (typeCounts[newType] || 0) + 1;
  const weekSummary = Object.entries(typeCounts).map(([t, c]) => `${c}x ${t}`).join(', ');
  const swapInfo = SWAP_TYPES.find(t => t.type === newType);

  previewEl.innerHTML = `
    <div class="swap-preview">
      <div class="swap-preview-title">Week after swap</div>
      <div>${weekSummary}</div>
      <div style="margin-top:6px;font-size:0.72rem;color:var(--text-muted)">
        Today: ${esc(newTitle)} (${swapInfo?.defaultDuration || '--'} min)
      </div>
    </div>
    <div class="swap-confirm-actions">
      <button class="btn-primary" id="confirmSwapBtn">Confirm Swap</button>
      <button class="btn-ghost" id="cancelSwapBtn">Cancel</button>
    </div>
  `;

  document.getElementById('confirmSwapBtn').addEventListener('click', async () => {
    const btn = document.getElementById('confirmSwapBtn');
    btn.disabled = true;
    btn.textContent = `Generating your ${newType} workout...`;
    try {
      if (newType === 'rest') {
        // Rest day doesn't need AI generation
        await swapWorkout(workout.id, newType, newTitle, { description: 'Rest day' });
      } else {
        // Use AI to generate a proper prescription with exercises
        await modifyWorkout(
          workout.id,
          `Change this workout to a ${newTitle} session. Generate appropriate exercises with sets, reps, and rest periods.`,
          activeSeason.id,
        );
      }

      delete viewCache['today'];
      delete viewCache['week'];
      close();
      loadView(currentView, true);
    } catch (err) {
      btn.textContent = `Error: ${err.message}`;
      btn.disabled = false;
    }
  });

  document.getElementById('cancelSwapBtn').addEventListener('click', () => {
    previewEl.innerHTML = '';
  });
}

// ── Match insight helpers ──────────────────────────────────

function _mibBar(label, score, tooltip) {
  if (score == null) return '';
  return `<div class="mib-item" data-tip="${tooltip}"><span class="mib-label">${label}</span><div class="mib-bar"><div class="mib-fill" style="width:${score}%"></div></div><span class="mib-val">${score}%</span></div>`;
}

const ZONE_META = {
  z1: { name: 'Recovery', range: '<60% max HR', color: '#3b82f6', icon: '💙' },
  z2: { name: 'Easy', range: '60–70% max HR', color: '#22c55e', icon: '💚' },
  z3: { name: 'Tempo', range: '70–80% max HR', color: '#eab308', icon: '💛' },
  z4: { name: 'Threshold', range: '80–90% max HR', color: '#f97316', icon: '🧡' },
  z5: { name: 'VO2max', range: '>90% max HR', color: '#ef4444', icon: '❤️' },
};

function _zoneSegs(zones) {
  return Object.entries(zones).map(([z, pct]) => {
    const meta = ZONE_META[z] || { name: z, range: '', color: '#888', icon: '' };
    return `<div class="mib-zone-seg zone-${z}" style="width:${pct}%"
      data-zone="${z}" data-zone-name="${meta.name}" data-zone-range="${meta.range}"
      data-zone-pct="${pct}" data-zone-color="${meta.color}"></div>`;
  }).join('');
}

/** Wire custom tooltips on match insight breakdown after DOM insert */
function _wireMatchTooltips() {
  const insight = document.querySelector('.match-insight');
  if (!insight) return;

  // Remove any existing tooltip
  let tip = document.getElementById('mibTip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'mibTip';
    tip.className = 'mib-tip';
    document.body.appendChild(tip);
  }

  function show(el, html) {
    tip.innerHTML = html;
    tip.classList.add('visible');
    // Position above the element
    const rect = el.getBoundingClientRect();
    const tipW = tip.offsetWidth;
    const tipH = tip.offsetHeight;
    let left = rect.left + rect.width / 2 - tipW / 2;
    let top = rect.top - tipH - 10;
    // Clamp horizontal
    if (left < 8) left = 8;
    if (left + tipW > window.innerWidth - 8) left = window.innerWidth - tipW - 8;
    // Flip below if clipped
    if (top < 8) top = rect.bottom + 10;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  function hide() {
    tip.classList.remove('visible');
  }

  // Score bar tooltips
  insight.querySelectorAll('.mib-item[data-tip]').forEach(item => {
    item.addEventListener('mouseenter', () => {
      const text = item.dataset.tip;
      const val = item.querySelector('.mib-val')?.textContent || '';
      const label = item.querySelector('.mib-label')?.textContent || '';
      const score = parseInt(val);
      const verdict = score >= 80 ? 'Strong' : score >= 50 ? 'Moderate' : 'Weak';
      const verdictColor = score >= 80 ? 'var(--accent)' : score >= 50 ? 'var(--status-yellow)' : 'var(--status-red)';
      show(item, `
        <div class="mib-tip-header">
          <span class="mib-tip-label">${label}</span>
          <span class="mib-tip-verdict" style="color:${verdictColor}">${verdict}</span>
        </div>
        <div class="mib-tip-body">${text}</div>
      `);
    });
    item.addEventListener('mouseleave', hide);
  });

  // Zone segment tooltips
  insight.querySelectorAll('.mib-zone-seg').forEach(seg => {
    seg.addEventListener('mouseenter', () => {
      const name = seg.dataset.zoneName;
      const range = seg.dataset.zoneRange;
      const pct = seg.dataset.zonePct;
      const color = seg.dataset.zoneColor;
      show(seg, `
        <div class="mib-tip-zone">
          <div class="mib-tip-zone-swatch" style="background:${color}"></div>
          <div>
            <div class="mib-tip-zone-name">${name}</div>
            <div class="mib-tip-zone-range">${range}</div>
          </div>
          <div class="mib-tip-zone-pct" style="color:${color}">${pct}%</div>
        </div>
      `);
    });
    seg.addEventListener('mouseleave', hide);
  });
}

// ── Adaptation summary parser ───────────────────────────────

function parseAdaptationSummary(raw, trigger) {
  // Common patterns in AI-generated summaries:
  // "User modification: "prompt" — AI response paragraph"
  // "Swapped "X" (type) → "Y" (type)"
  // "Changed rest day to an easy recovery run to meet your request. Long AI explanation..."

  // Strip user modification prefix
  let text = raw.replace(/^User modification:\s*"[^"]*"\s*—?\s*/i, '');

  // If it starts with "Swapped", that's already concise
  if (text.startsWith('Swapped ') || text.startsWith('Changed ')) {
    const firstSentence = text.split(/\.\s/)[0] + '.';
    const rest = text.slice(firstSentence.length).trim();
    return { headline: firstSentence, detail: rest || null };
  }

  // Split into first sentence (headline) and rest (detail)
  const sentences = text.split(/\.\s+/);
  if (sentences.length <= 1) {
    // Short enough as-is, just truncate if needed
    return { headline: text.length > 120 ? text.slice(0, 117) + '...' : text, detail: null };
  }

  const headline = sentences[0] + '.';
  const detail = sentences.slice(1).join('. ').trim();

  return {
    headline: headline.length > 120 ? headline.slice(0, 117) + '...' : headline,
    detail: detail || null,
  };
}
