// ═══════════════════════════════════════════════════
// Murph Leaderboard — Competition-grade scoreboard
// ═══════════════════════════════════════════════════
import * as data from './murphData.js';
import { staggerEntrance } from './interactions.js';

export class MurphLeaderboard {
  constructor(containerEl) {
    this.container = containerEl;
    this.entries = [];
    this.period = 'all';
    this.expandedId = null;
    this.currentUserId = null;
    this.showMyAttempts = false;
  }

  async init(userId) {
    this.currentUserId = userId;
    this.render();
    await this.refresh();
  }

  async refresh() {
    try {
      const result = await data.getLeaderboard(this.period);
      this.entries = result.entries || [];
    } catch (err) {
      console.error('Leaderboard fetch failed:', err);
      this.entries = [];
    }
    this.renderEntries();
  }

  render() {
    this.container.innerHTML = `
      <div class="lb-header">
        <div class="lb-title-row">
          <h3 class="lb-title">LEADERBOARD</h3>
          <span class="lb-count">${this.entries.length} entries</span>
        </div>
        <div class="lb-tabs">
          <button class="lb-tab ${!this.showMyAttempts ? 'active' : ''}" data-tab="all">Rankings</button>
          <button class="lb-tab ${this.showMyAttempts ? 'active' : ''}" data-tab="mine">My Attempts</button>
        </div>
      </div>
      <div class="lb-filters">
        ${['all', 'year', 'month', 'week'].map(p => `
          <button class="lb-filter ${this.period === p ? 'active' : ''}" data-period="${p}">
            ${p === 'all' ? 'All Time' : p === 'year' ? 'Year' : p === 'month' ? 'Month' : 'Week'}
          </button>
        `).join('')}
      </div>
      <div class="lb-entries" id="lbEntries"></div>
    `;

    this.container.querySelectorAll('.lb-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this.showMyAttempts = btn.dataset.tab === 'mine';
        this.render();
        this.refresh();
      });
    });

    this.container.querySelectorAll('.lb-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        this.period = btn.dataset.period;
        this.container.querySelectorAll('.lb-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.refresh();
      });
    });
  }

  renderEntries() {
    const entriesEl = this.container.querySelector('#lbEntries');
    if (!entriesEl) return;

    // Update count
    const countEl = this.container.querySelector('.lb-count');
    if (countEl) countEl.textContent = `${this.entries.length} entries`;

    let entries = this.entries;
    if (this.showMyAttempts) {
      entries = entries.filter(e => e.user_id === this.currentUserId);
    }

    if (entries.length === 0) {
      entriesEl.innerHTML = `
        <div class="lb-empty">
          <div class="lb-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="1.5" width="32" height="32">
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
            </svg>
          </div>
          <p>${this.showMyAttempts ? 'No attempts yet. Start your first Murph!' : 'No entries yet. Be the first!'}</p>
        </div>
      `;
      return;
    }

    entriesEl.innerHTML = entries.map((e, i) => {
      const isMe = e.user_id === this.currentUserId;
      const isExpanded = this.expandedId === e.attempt_id;
      const rankDisplay = this.showMyAttempts ? i + 1 : e.rank;
      const medal = rankDisplay === 1 ? 'gold' : rankDisplay === 2 ? 'silver' : rankDisplay === 3 ? 'bronze' : '';

      return `
        <div class="lb-row ${isMe ? 'lb-row-me' : ''} ${isExpanded ? 'lb-row-expanded' : ''} ${medal ? 'lb-row-podium' : ''}" data-id="${e.attempt_id}">
          <div class="lb-row-main">
            <div class="lb-rank ${medal}">
              ${medal ? rankMedal(rankDisplay) : rankDisplay}
            </div>
            <div class="lb-name-col">
              <span class="lb-name">${escapeHtml(e.display_name)}</span>
              ${isMe ? '<span class="lb-you">YOU</span>' : ''}
            </div>
            <div class="lb-time">${e.total_time_formatted}</div>
            <div class="lb-verified">${e.verified
              ? '<span class="lb-badge-verified">VERIFIED</span>'
              : '<span class="lb-badge-pending">PENDING</span>'
            }</div>
            <div class="lb-expand-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                ${isExpanded
                  ? '<polyline points="18 15 12 9 6 15"/>'
                  : '<polyline points="6 9 12 15 18 9"/>'
                }
              </svg>
            </div>
          </div>
          ${isExpanded ? `
            <div class="lb-detail">
              <div class="lb-detail-grid">
                <div class="lb-detail-item">
                  <span class="lb-detail-label">Mile 1</span>
                  <span class="lb-detail-value">${e.mile1_time_formatted || '--'}</span>
                  ${e.mile1_avg_pace ? `<span class="lb-detail-sub">${e.mile1_avg_pace}</span>` : ''}
                </div>
                <div class="lb-detail-item">
                  <span class="lb-detail-label">Pull-ups</span>
                  <span class="lb-detail-value">${e.pullups}</span>
                </div>
                <div class="lb-detail-item">
                  <span class="lb-detail-label">Push-ups</span>
                  <span class="lb-detail-value">${e.pushups}</span>
                </div>
                <div class="lb-detail-item">
                  <span class="lb-detail-label">Squats</span>
                  <span class="lb-detail-value">${e.squats}</span>
                </div>
                <div class="lb-detail-item">
                  <span class="lb-detail-label">Mile 2</span>
                  <span class="lb-detail-value">${e.mile2_time_formatted || '--'}</span>
                  ${e.mile2_avg_pace ? `<span class="lb-detail-sub">${e.mile2_avg_pace}</span>` : ''}
                </div>
                <div class="lb-detail-item">
                  <span class="lb-detail-label">Date</span>
                  <span class="lb-detail-value">${formatDateFull(e.date)}</span>
                </div>
              </div>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    // Row click → expand/collapse
    entriesEl.querySelectorAll('.lb-row-main').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.closest('.lb-row').dataset.id;
        this.expandedId = this.expandedId === id ? null : id;
        this.renderEntries();
      });
    });

    // GSAP stagger entrance
    setTimeout(() => staggerEntrance('.lb-row', { y: 12, stagger: 0.05, delay: 0.1 }), 50);
  }
}

function rankMedal(rank) {
  const icons = {
    1: '<svg viewBox="0 0 24 24" width="18" height="18" fill="#FFD700" stroke="#FFD700" stroke-width="1"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>',
    2: '<svg viewBox="0 0 24 24" width="18" height="18" fill="#C0C0C0" stroke="#C0C0C0" stroke-width="1"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>',
    3: '<svg viewBox="0 0 24 24" width="18" height="18" fill="#CD7F32" stroke="#CD7F32" stroke-width="1"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>',
  };
  return icons[rank] || rank;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDateFull(iso) {
  if (!iso) return '--';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
