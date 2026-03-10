// Season history — past season browser and comparison
import { getSeasonHistory } from './seasonData.js';

/**
 * Render the season history list into a container element.
 */
export async function renderSeasonHistory(containerEl) {
  try {
    const seasons = await getSeasonHistory();

    if (!seasons.length) {
      containerEl.innerHTML = '<div class="history-empty">No completed seasons yet.</div>';
      return;
    }

    containerEl.innerHTML = seasons.map(s => {
      const summary = s.completion_summary || {};
      const stats = summary.stats || {};
      const isActive = s.status === 'active';

      return `
        <div class="history-card ${isActive ? 'history-active' : ''}">
          <div class="history-header">
            <div>
              <div class="history-name">${esc(s.name)}</div>
              <div class="history-dates">${esc(s.start_date)} — ${esc(s.end_date || 'ongoing')}</div>
            </div>
            <div class="history-status-badge ${s.status}">${s.status}</div>
          </div>
          ${!isActive && stats.completion_rate != null ? `
            <div class="history-stats">
              <div class="history-stat">
                <div class="history-stat-val">${stats.completion_rate}%</div>
                <div class="history-stat-label">Completion</div>
              </div>
              <div class="history-stat">
                <div class="history-stat-val">${stats.avg_adherence || 0}%</div>
                <div class="history-stat-label">Adherence</div>
              </div>
              <div class="history-stat">
                <div class="history-stat-val">${stats.completed || 0}/${stats.total_workouts || 0}</div>
                <div class="history-stat-label">Workouts</div>
              </div>
            </div>
          ` : ''}
          ${summary.summary ? `<div class="history-summary">${esc(summary.summary)}</div>` : ''}
          ${summary.highlights ? `
            <div class="history-highlights">
              ${(summary.highlights || []).map(h => `<span class="history-pill positive">${esc(h)}</span>`).join('')}
            </div>
          ` : ''}
          ${summary.areas_for_improvement ? `
            <div class="history-highlights">
              ${(summary.areas_for_improvement || []).map(a => `<span class="history-pill improve">${esc(a)}</span>`).join('')}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Season history error:', err);
    containerEl.innerHTML = '<div class="history-empty">Failed to load season history.</div>';
  }
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
