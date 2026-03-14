// Adaptation feed — notification bar for near-term plan changes
import {
  getUnacknowledgedAdaptations,
  acknowledgeAdaptation,
} from './seasonData.js';

export const TRIGGER_LABELS = {
  hrv_drop: 'HRV',
  sleep_decline: 'SLEEP',
  high_stress: 'STRESS',
  missed_workout: 'MISSED',
  overtraining: 'OVERTRAIN',
  high_readiness: 'READY',
  schedule: 'SCHED',
  unknown: 'ADJ',
};

export const TRIGGER_COLORS = {
  hrv_drop: 'adapt-recovery',
  sleep_decline: 'adapt-recovery',
  high_stress: 'adapt-recovery',
  missed_workout: 'adapt-schedule',
  overtraining: 'adapt-recovery',
  high_readiness: 'adapt-performance',
  schedule: 'adapt-schedule',
  unknown: 'adapt-schedule',
};

/**
 * Fetch and render unacknowledged near-term adaptations.
 * Returns the count of notifications rendered.
 */
export async function renderAdaptationFeed(containerEl, seasonId) {
  try {
    const adaptations = await getUnacknowledgedAdaptations(seasonId);

    if (!adaptations.length) {
      containerEl.innerHTML = '';
      containerEl.style.display = 'none';
      return 0;
    }

    containerEl.style.display = '';
    containerEl.innerHTML = adaptations.map(a => `
      <div class="adapt-item ${TRIGGER_COLORS[a.trigger] || 'adapt-schedule'}" data-id="${a.id}">
        <span class="adapt-icon">${TRIGGER_LABELS[a.trigger] || TRIGGER_LABELS.unknown}</span>
        <div class="adapt-content">
          <div class="adapt-summary">${esc(a.summary)}</div>
          <div class="adapt-date">${esc(a.affected_date)}</div>
        </div>
        <button class="adapt-dismiss" aria-label="Dismiss">Got it</button>
      </div>
    `).join('');

    // Bind dismiss handlers
    containerEl.querySelectorAll('.adapt-dismiss').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const item = e.target.closest('.adapt-item');
        const id = item.dataset.id;
        try {
          await acknowledgeAdaptation(id);
          item.remove();
          // Hide container if no more items
          if (!containerEl.querySelector('.adapt-item')) {
            containerEl.style.display = 'none';
          }
        } catch (err) {
          console.error('Failed to dismiss adaptation:', err);
        }
      });
    });

    return adaptations.length;
  } catch (err) {
    console.error('Adaptation feed error:', err);
    containerEl.innerHTML = '';
    containerEl.style.display = 'none';
    return 0;
  }
}

/**
 * Returns the count of unacknowledged adaptations (for badge display).
 */
export async function getAdaptationCount(seasonId) {
  try {
    const adaptations = await getUnacknowledgedAdaptations(seasonId);
    return adaptations.length;
  } catch {
    return 0;
  }
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
