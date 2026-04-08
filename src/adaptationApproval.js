// Adaptation Approval Modal — full-screen diff view with approve/reject/partial
import { applyAdaptation, rejectAdaptation } from './seasonData.js';
import { renderSparkline } from './progressionSparkline.js';

// ── Trigger Labels & Colors (from adaptationFeed.js) ────────

const TRIGGER_LABELS = {
  hrv_drop: 'HRV', sleep_decline: 'SLEEP', high_stress: 'STRESS',
  missed_workout: 'MISSED', overtraining: 'OVERTRAIN',
  high_readiness: 'READY', schedule: 'SCHED',
};

const TRIGGER_ICONS = {
  hrv_drop: '💓', sleep_decline: '😴', high_stress: '⚡',
  missed_workout: '📅', overtraining: '🛑',
  high_readiness: '🟢', schedule: '🔄',
};

const TRIGGER_COLORS = {
  hrv_drop: 'adapt-recovery', sleep_decline: 'adapt-recovery', high_stress: 'adapt-recovery',
  missed_workout: 'adapt-schedule', overtraining: 'adapt-recovery',
  high_readiness: 'adapt-performance', schedule: 'adapt-schedule',
};

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatDuration(min) {
  if (!min) return '';
  return `${min}m`;
}

// ── Render Readiness Snapshot ───────────────────────────────

function renderReadinessSnapshot(snapshot) {
  if (!snapshot) return '';

  const chips = [];
  if (snapshot.sleep_score != null) chips.push({ label: 'Sleep', val: snapshot.sleep_score, color: snapshot.sleep_score >= 70 ? 'var(--status-green)' : snapshot.sleep_score >= 40 ? 'var(--status-yellow)' : 'var(--status-red)' });
  if (snapshot.stress_avg != null) chips.push({ label: 'Stress', val: snapshot.stress_avg, color: snapshot.stress_avg <= 35 ? 'var(--status-green)' : snapshot.stress_avg <= 50 ? 'var(--status-yellow)' : 'var(--status-red)' });
  if (snapshot.hrv_status) chips.push({ label: 'HRV', val: snapshot.hrv_status.replace(/_/g, ' '), color: ['balanced', 'high'].includes(snapshot.hrv_status.toLowerCase()) ? 'var(--status-green)' : 'var(--status-yellow)' });
  if (snapshot.body_battery != null) chips.push({ label: 'BB', val: snapshot.body_battery, color: snapshot.body_battery >= 60 ? 'var(--status-green)' : snapshot.body_battery >= 30 ? 'var(--status-yellow)' : 'var(--status-red)' });

  if (!chips.length) return '';

  return `
    <div class="aa-readiness-snapshot">
      ${chips.map(c => `<span class="aa-readiness-chip"><span class="aa-chip-dot" style="background:${c.color}"></span>${c.label} <strong>${c.val}</strong></span>`).join('')}
    </div>`;
}

// ── Render Diff Table ───────────────────────────────────────

function renderDiffTable(proposedChanges) {
  if (!proposedChanges || !proposedChanges.length) return '<div class="aa-empty">No changes proposed</div>';

  const rows = proposedChanges.map((change, i) => {
    const isChanged = !change.no_change;
    const orig = change.original || {};
    const proposed = change.proposed || {};

    const origLabel = `${orig.title || '--'} ${orig.duration_minutes ? formatDuration(orig.duration_minutes) : ''}`;
    const proposedLabel = isChanged
      ? `${proposed.title || '--'} ${proposed.duration_minutes ? formatDuration(proposed.duration_minutes) : ''}`
      : 'No change';

    const intensityChanged = isChanged && orig.intensity !== proposed.intensity;
    const typeChanged = isChanged && orig.workout_type !== proposed.workout_type;

    return `
      <div class="aa-diff-row ${isChanged ? 'changed' : 'unchanged'}" data-index="${i}" data-workout-id="${change.workout_id || ''}">
        ${isChanged ? `<label class="aa-checkbox-wrap"><input type="checkbox" class="aa-day-checkbox" data-index="${i}" checked></label>` : '<div class="aa-checkbox-placeholder"></div>'}
        <div class="aa-diff-date">${formatDate(change.date)}</div>
        <div class="aa-diff-original">${esc(origLabel)}</div>
        <div class="aa-diff-arrow">${isChanged ? '→' : ''}</div>
        <div class="aa-diff-proposed ${isChanged ? 'highlight' : ''}">${esc(proposedLabel)}</div>
      </div>
      ${isChanged ? `<div class="aa-diff-detail" id="aaDiffDetail_${i}">
        ${change.change_summary ? `<div class="aa-change-summary">${esc(change.change_summary)}</div>` : ''}
        ${intensityChanged ? `<div class="aa-change-detail">Intensity: <span class="aa-old">${esc(orig.intensity || '--')}</span> → <span class="aa-new">${esc(proposed.intensity || '--')}</span></div>` : ''}
        ${typeChanged ? `<div class="aa-change-detail">Type: <span class="aa-old">${esc(orig.workout_type || '--')}</span> → <span class="aa-new">${esc(proposed.workout_type || '--')}</span></div>` : ''}
      </div>` : ''}`;
  }).join('');

  return `<div class="aa-diff-table">${rows}</div>`;
}

// ── Main Modal ──────────────────────────────────────────────

let _currentProposal = null;
let _onComplete = null;

export function showAdaptationApproval(proposalData, options = {}) {
  _currentProposal = proposalData;
  _onComplete = options.onComplete || null;

  // Remove existing modal if any
  const existing = document.getElementById('adaptationApprovalModal');
  if (existing) existing.remove();
  const existingBackdrop = document.getElementById('adaptationApprovalBackdrop');
  if (existingBackdrop) existingBackdrop.remove();

  const trigger = proposalData.trigger || 'schedule';
  const triggerLabel = TRIGGER_LABELS[trigger] || 'ADJ';
  const triggerIcon = TRIGGER_ICONS[trigger] || '🔄';
  const triggerColor = TRIGGER_COLORS[trigger] || 'adapt-schedule';

  // Build modal HTML
  const modalHtml = `
    <div class="aa-backdrop" id="adaptationApprovalBackdrop"></div>
    <div class="aa-modal" id="adaptationApprovalModal">
      <div class="aa-modal-inner">
        <!-- Close button -->
        <button class="aa-close-btn" id="aaCloseBtn" aria-label="Close">
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>
        </button>

        <!-- Section 1: Why This Change -->
        <div class="aa-section">
          <div class="aa-trigger-badge ${triggerColor}">
            <span class="aa-trigger-icon">${triggerIcon}</span>
            <span class="aa-trigger-label">${esc(triggerLabel)}</span>
          </div>
          <div class="aa-summary">${esc(proposalData.summary || 'AI suggests plan adjustments based on your current readiness.')}</div>
          ${renderReadinessSnapshot(proposalData.readiness_snapshot)}
        </div>

        <!-- Section 2: Diff Table -->
        <div class="aa-section">
          <div class="aa-section-title">NEXT 7 DAYS — WHAT'S CHANGING</div>
          ${renderDiffTable(proposalData.proposed_changes)}
        </div>

        <!-- Section 3: Projected Impact -->
        <div class="aa-section">
          <div class="aa-section-title">PROJECTED IMPACT</div>
          <div class="aa-sparkline-container" id="aaSparkline"></div>
          <div class="aa-sparkline-legend">
            <span class="aa-legend-item"><span class="aa-legend-line dashed dim"></span>Original Plan</span>
            <span class="aa-legend-item"><span class="aa-legend-line solid accent"></span>Your Progress</span>
            <span class="aa-legend-item"><span class="aa-legend-line dashed accent"></span>With Changes</span>
          </div>
        </div>

        <!-- Section 4: Actions -->
        <div class="aa-actions">
          <button class="aa-btn aa-btn-primary" id="aaApproveAll">Approve All</button>
          <button class="aa-btn aa-btn-secondary" id="aaKeepOriginal">Keep Original Plan</button>
          <button class="aa-btn aa-btn-tertiary" id="aaLetMeChoose">Let Me Choose</button>
        </div>

        <!-- Hidden: Apply Selected (shown when Let Me Choose is active) -->
        <div class="aa-actions aa-partial-actions" id="aaPartialActions" style="display:none">
          <button class="aa-btn aa-btn-primary" id="aaApplySelected">Apply Selected</button>
          <button class="aa-btn aa-btn-secondary" id="aaCancelPartial">Cancel</button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', modalHtml);

  // Animate in
  requestAnimationFrame(() => {
    document.getElementById('adaptationApprovalBackdrop')?.classList.add('visible');
    document.getElementById('adaptationApprovalModal')?.classList.add('visible');
  });

  // Render sparkline if data available
  if (options.plannedCurve && options.actualCurve) {
    const sparklineEl = document.getElementById('aaSparkline');
    if (sparklineEl) {
      renderSparkline(
        sparklineEl,
        options.plannedCurve,
        options.actualCurve,
        options.currentWeek || 1,
        options.phases || [],
        {
          compact: false,
          projectedCurve: options.projectedCurve || null,
          altProjectedCurve: options.altProjectedCurve || null,
        }
      );
    }
  }

  _wireModalInteractions();
}

function _wireModalInteractions() {
  const modal = document.getElementById('adaptationApprovalModal');
  if (!modal) return;

  // Close
  document.getElementById('aaCloseBtn')?.addEventListener('click', _closeModal);
  document.getElementById('adaptationApprovalBackdrop')?.addEventListener('click', _closeModal);

  // Escape key
  const escHandler = (e) => {
    if (e.key === 'Escape') { _closeModal(); document.removeEventListener('keydown', escHandler); }
  };
  document.addEventListener('keydown', escHandler);

  // Expand/collapse diff detail rows
  modal.querySelectorAll('.aa-diff-row.changed').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.aa-checkbox-wrap')) return; // Don't toggle on checkbox click
      const idx = row.dataset.index;
      const detail = document.getElementById(`aaDiffDetail_${idx}`);
      if (detail) detail.classList.toggle('expanded');
    });
  });

  // Approve All
  document.getElementById('aaApproveAll')?.addEventListener('click', async () => {
    const btn = document.getElementById('aaApproveAll');
    btn.disabled = true; btn.textContent = 'Applying...';
    try {
      await applyAdaptation({
        trigger: _currentProposal.trigger,
        summary: _currentProposal.summary,
        proposed_changes: _currentProposal.proposed_changes,
        readiness_snapshot: _currentProposal.readiness_snapshot,
      });
      _closeModal();
      if (_onComplete) _onComplete('approved');
    } catch (err) {
      console.error('Apply error:', err);
      btn.textContent = 'Failed — Retry';
      btn.disabled = false;
    }
  });

  // Keep Original
  document.getElementById('aaKeepOriginal')?.addEventListener('click', async () => {
    const btn = document.getElementById('aaKeepOriginal');
    btn.disabled = true; btn.textContent = 'Keeping...';
    try {
      await rejectAdaptation({
        trigger: _currentProposal.trigger,
        summary: _currentProposal.summary,
        proposed_changes: _currentProposal.proposed_changes,
        readiness_snapshot: _currentProposal.readiness_snapshot,
      });
      _closeModal();
      if (_onComplete) _onComplete('rejected');
    } catch (err) {
      console.error('Reject error:', err);
      btn.textContent = 'Failed — Retry';
      btn.disabled = false;
    }
  });

  // Let Me Choose — enable checkboxes
  document.getElementById('aaLetMeChoose')?.addEventListener('click', () => {
    modal.classList.add('partial-mode');
    document.querySelector('.aa-actions:not(.aa-partial-actions)').style.display = 'none';
    document.getElementById('aaPartialActions').style.display = '';
  });

  // Apply Selected
  document.getElementById('aaApplySelected')?.addEventListener('click', async () => {
    const btn = document.getElementById('aaApplySelected');
    btn.disabled = true; btn.textContent = 'Applying...';

    // Get checked indices
    const checked = [];
    modal.querySelectorAll('.aa-day-checkbox:checked').forEach(cb => {
      checked.push(parseInt(cb.dataset.index, 10));
    });

    // Filter proposed_changes to only checked ones
    const selectedChanges = _currentProposal.proposed_changes.filter((c, i) => {
      return !c.no_change && checked.includes(i);
    });

    try {
      await applyAdaptation({
        trigger: _currentProposal.trigger,
        summary: _currentProposal.summary,
        proposed_changes: selectedChanges,
        readiness_snapshot: _currentProposal.readiness_snapshot,
        partial: true,
      });
      _closeModal();
      if (_onComplete) _onComplete('partially_approved');
    } catch (err) {
      console.error('Partial apply error:', err);
      btn.textContent = 'Failed — Retry';
      btn.disabled = false;
    }
  });

  // Cancel partial
  document.getElementById('aaCancelPartial')?.addEventListener('click', () => {
    modal.classList.remove('partial-mode');
    document.querySelector('.aa-actions:not(.aa-partial-actions)').style.display = '';
    document.getElementById('aaPartialActions').style.display = 'none';
  });
}

function _closeModal() {
  const modal = document.getElementById('adaptationApprovalModal');
  const backdrop = document.getElementById('adaptationApprovalBackdrop');
  if (modal) modal.classList.remove('visible');
  if (backdrop) backdrop.classList.remove('visible');
  setTimeout(() => {
    modal?.remove();
    backdrop?.remove();
  }, 350);
  document.body.style.overflow = '';
}
