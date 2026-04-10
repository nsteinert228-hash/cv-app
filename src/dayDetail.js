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
              ${breakdown.type_score != null ? `<div class="mib-item"><span class="mib-label">Type</span><div class="mib-bar"><div class="mib-fill" style="width:${breakdown.type_score}%"></div></div><span class="mib-val">${breakdown.type_score}%</span></div>` : ''}
              ${breakdown.duration_score != null ? `<div class="mib-item"><span class="mib-label">Duration</span><div class="mib-bar"><div class="mib-fill" style="width:${breakdown.duration_score}%"></div></div><span class="mib-val">${breakdown.duration_score}%</span></div>` : ''}
              ${breakdown.intensity_score != null ? `<div class="mib-item"><span class="mib-label">Intensity</span><div class="mib-bar"><div class="mib-fill" style="width:${breakdown.intensity_score}%"></div></div><span class="mib-val">${breakdown.intensity_score}%</span></div>` : ''}
              ${breakdown.date_score != null ? `<div class="mib-item"><span class="mib-label">Timing</span><div class="mib-bar"><div class="mib-fill" style="width:${breakdown.date_score}%"></div></div><span class="mib-val">${breakdown.date_score}%</span></div>` : ''}
              ${breakdown.structure_score != null ? `<div class="mib-item"><span class="mib-label">Structure</span><div class="mib-bar"><div class="mib-fill" style="width:${breakdown.structure_score}%"></div></div><span class="mib-val">${breakdown.structure_score}%</span></div>` : ''}
              ${breakdown.zone_score != null ? `<div class="mib-item"><span class="mib-label">Zones</span><div class="mib-bar"><div class="mib-fill" style="width:${breakdown.zone_score}%"></div></div><span class="mib-val">${breakdown.zone_score}%</span></div>` : ''}
              ${breakdown.effort_score != null ? `<div class="mib-item"><span class="mib-label">Effort</span><div class="mib-bar"><div class="mib-fill" style="width:${breakdown.effort_score}%"></div></div><span class="mib-val">${breakdown.effort_score}%</span></div>` : ''}
            </div>
            ${breakdown.zones ? `
              <div class="mib-zones">
                <span class="mib-label">HR Zones</span>
                <div class="mib-zone-bar">
                  ${Object.entries(breakdown.zones).map(([z, pct]) =>
                    `<div class="mib-zone-seg zone-${z}" style="width:${pct}%" title="${z.toUpperCase()}: ${pct}%"></div>`
                  ).join('')}
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
