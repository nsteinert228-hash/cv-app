// Unified User Profile — slide-in panel UI
import { getUserProfileData, clearProfileCache } from './userProfile.js';
import { signOut } from './auth.js';
import { connectGarmin, disconnectGarmin, requestSync } from './garmin.js';
import { getSupabaseClient } from './supabase.js';

let _panelOpen = false;
let _authUI = null;

// ── Readiness summary (from garminDashboard.js logic) ───────

function _computeReadinessSummary(sleepScore, bbCurrent, hrvStatus) {
  let score = 0;
  if (sleepScore >= 70) score += 2; else if (sleepScore >= 40) score += 1;
  if (bbCurrent >= 60) score += 2; else if (bbCurrent >= 30) score += 1;
  const hrvLower = (hrvStatus || '').toLowerCase();
  if (hrvLower === 'balanced' || hrvLower === 'above_baseline') score += 2;
  else if (hrvLower === 'below_baseline' || hrvLower === 'low') score += 0;
  else score += 1;

  if (score >= 5) return { text: 'Ready to Train', color: 'var(--status-green)' };
  if (score >= 3) return { text: 'Train with Caution', color: 'var(--status-yellow)' };
  return { text: 'Recovery Recommended', color: 'var(--status-red)' };
}

// ── Formatters ──────────────────────────────────────────────

function _fmtNumber(n) {
  return (n || 0).toLocaleString();
}

function _fmtTime(seconds) {
  if (!seconds) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function _fmtDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function _fmtMemberSince(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function _esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ── Section renderers ───────────────────────────────────────

function _renderHeader(identity) {
  const initial = identity.displayName ? identity.displayName[0].toUpperCase() : '?';
  const garminDot = identity.garminConnected
    ? `<span class="profile-garmin-dot connected"></span>Garmin Connected`
    : `<span class="profile-garmin-dot"></span>Garmin Not Connected`;
  const lastSync = identity.garminConnected && identity.garminLastSync
    ? `<span class="profile-sync-time">Last sync ${new Date(identity.garminLastSync).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>`
    : '';

  return `
    <div class="profile-header">
      <div class="profile-avatar-large">${initial}</div>
      <div class="profile-header-info">
        <div class="profile-display-name">${_esc(identity.displayName)}</div>
        <div class="profile-email">${_esc(identity.email)}</div>
        ${identity.memberSince ? `<div class="profile-member-since">Member since ${_fmtMemberSince(identity.memberSince)}</div>` : ''}
      </div>
      <div class="profile-garmin-chip">${garminDot}${lastSync}</div>
    </div>`;
}

function _renderReadiness(readiness) {
  if (!readiness || (!readiness.sleep_score && !readiness.body_battery && !readiness.hrv_status)) {
    return `
      <div class="profile-section" data-section="readiness">
        <div class="profile-section-title">TODAY'S READINESS</div>
        <div class="profile-empty-state">No readiness data available</div>
      </div>`;
  }

  const summary = _computeReadinessSummary(readiness.sleep_score, readiness.body_battery, readiness.hrv_status);

  return `
    <div class="profile-section" data-section="readiness">
      <div class="profile-section-title">TODAY'S READINESS</div>
      <div class="profile-readiness-card" id="profileReadinessCard">
        <div class="profile-readiness-summary" id="profileReadinessToggle">
          <div class="profile-readiness-status" style="color:${summary.color}">${summary.text}</div>
          <div class="profile-readiness-chips">
            <span class="profile-chip"><span class="profile-chip-dot" style="background:var(--status-blue)"></span>Sleep ${readiness.sleep_score ?? '--'}</span>
            <span class="profile-chip"><span class="profile-chip-dot" style="background:var(--accent)"></span>BB ${readiness.body_battery ?? '--'}</span>
            <span class="profile-chip"><span class="profile-chip-dot" style="background:var(--status-green)"></span>HRV ${readiness.hrv_value ?? '--'}</span>
          </div>
          <svg class="profile-chevron" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>
        </div>
        <div class="profile-readiness-detail" id="profileReadinessDetail">
          <div class="profile-detail-row"><span>Stress Avg</span><span>${readiness.stress_avg ?? '--'}</span></div>
          <div class="profile-detail-row"><span>Resting HR</span><span>${readiness.resting_hr ?? '--'} bpm</span></div>
          <div class="profile-detail-row"><span>Steps</span><span>${_fmtNumber(readiness.steps)}</span></div>
          <div class="profile-detail-row"><span>HRV Status</span><span>${(readiness.hrv_status || '--').replace(/_/g, ' ')}</span></div>
          <div class="profile-detail-row"><span>Body Battery</span><span>${readiness.bb_low ?? '--'} – ${readiness.bb_high ?? '--'}</span></div>
        </div>
      </div>
    </div>`;
}

function _renderMovements(movements) {
  const cards = ['squat', 'pushup', 'pullup', 'lunge'].map(key => {
    const m = movements[key];
    const label = key === 'pushup' ? 'Push-ups' : key === 'pullup' ? 'Pull-ups' : key === 'squat' ? 'Squats' : 'Lunges';
    const parts = [];
    if (m.cv) parts.push(`${_fmtNumber(m.cv)} tracker`);
    if (m.murph) parts.push(`${_fmtNumber(m.murph)} murph`);
    if (m.training) parts.push(`${_fmtNumber(m.training)} training`);
    const breakdown = parts.length ? parts.join(' · ') : 'No data yet';

    return `
      <div class="profile-movement-card">
        <div class="profile-movement-total">${_fmtNumber(m.total)}</div>
        <div class="profile-movement-label">${label}</div>
        <div class="profile-movement-breakdown">${breakdown}</div>
      </div>`;
  }).join('');

  let otherHtml = '';
  if (movements.other.length) {
    const otherRows = movements.other.slice(0, 10).map(ex => `
      <div class="profile-other-row">
        <span class="profile-other-name">${_esc(ex.name)}</span>
        <span class="profile-other-reps">${_fmtNumber(ex.totalReps)} reps</span>
        ${ex.confirmed ? '<span class="profile-confirmed-badge">✓ Confirmed</span>' : ''}
      </div>`).join('');

    otherHtml = `
      <div class="profile-subsection-title">TRAINER-CONFIRMED EXERCISES</div>
      ${otherRows}`;
  }

  return `
    <div class="profile-section" data-section="movements">
      <div class="profile-section-title">LIFETIME MOVEMENTS</div>
      <div class="profile-movements-grid">${cards}</div>
      ${otherHtml}
    </div>`;
}

function _renderMileage(mileage) {
  // Summary chips
  const summaryHtml = `
    <div class="profile-mileage-summary">
      <div class="profile-mileage-stat">
        <div class="profile-mileage-val">${mileage.thisWeek}</div>
        <div class="profile-mileage-label">This Week</div>
      </div>
      <div class="profile-mileage-stat">
        <div class="profile-mileage-val">${mileage.thisMonth}</div>
        <div class="profile-mileage-label">This Month</div>
      </div>
      <div class="profile-mileage-stat">
        <div class="profile-mileage-val">${mileage.thisYear}</div>
        <div class="profile-mileage-label">This Year</div>
      </div>
    </div>`;

  // Weekly bar chart
  const maxMiles = Math.max(...mileage.weeklyTrend.map(w => w.miles), 1);
  const currentWeekStart = mileage.weeklyTrend[mileage.weeklyTrend.length - 1]?.weekStart;
  const bars = mileage.weeklyTrend.map(w => {
    const pct = (w.miles / maxMiles) * 100;
    const isCurrent = w.weekStart === currentWeekStart;
    const weekLabel = new Date(w.weekStart + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `
      <div class="profile-bar-col" title="${weekLabel}: ${w.miles} mi">
        <div class="profile-bar ${isCurrent ? 'current' : ''}" style="height:${Math.max(pct, 2)}%"></div>
        <div class="profile-bar-label">${weekLabel.split(' ')[1]}</div>
      </div>`;
  }).join('');

  const barChart = `<div class="profile-bar-chart">${bars}</div>`;

  // Recent runs
  let runsHtml = '';
  if (mileage.recentRuns.length) {
    const rows = mileage.recentRuns.map(r => `
      <div class="profile-run-row">
        <span class="profile-run-date">${_fmtDate(r.date)}</span>
        <span class="profile-run-dist">${r.distanceMiles} mi</span>
        <span class="profile-run-pace">${r.paceMinPerMile || '--'} /mi</span>
        <span class="profile-run-hr">${r.avgHr ? `♥ ${r.avgHr}` : ''}</span>
        <span class="profile-run-source">${r.source === 'murph' ? 'Murph' : 'Garmin'}</span>
      </div>`).join('');
    runsHtml = `<div class="profile-runs-list">${rows}</div>`;
  }

  // Personal records
  const prsHtml = `
    <div class="profile-prs">
      <span>Longest Run: <strong>${mileage.longestRunMiles} mi</strong></span>
      <span>Fastest Mile: <strong>${mileage.fastestMilePace || '--'}</strong></span>
    </div>`;

  return `
    <div class="profile-section" data-section="mileage">
      <div class="profile-section-title">MILEAGE</div>
      ${summaryHtml}
      ${barChart}
      ${runsHtml}
      ${prsHtml}
    </div>`;
}

function _renderMurph(murph) {
  if (!murph.attemptsCompleted) return '';

  return `
    <div class="profile-section" data-section="murph">
      <div class="profile-section-title">MURPH</div>
      <div class="profile-murph-hero">
        <div class="profile-murph-best-label">BEST TIME</div>
        <div class="profile-murph-best-time">${_fmtTime(murph.bestTime)}</div>
      </div>
      <div class="profile-murph-stats">
        <div class="profile-murph-stat"><div class="profile-murph-stat-val">${murph.attemptsCompleted}</div><div class="profile-murph-stat-label">Attempts</div></div>
        <div class="profile-murph-stat"><div class="profile-murph-stat-val">${_fmtTime(murph.averageTime)}</div><div class="profile-murph-stat-label">Avg Time</div></div>
        <div class="profile-murph-stat"><div class="profile-murph-stat-val">${murph.bestMile1Pace || '--'}</div><div class="profile-murph-stat-label">Best Mile 1</div></div>
        <div class="profile-murph-stat"><div class="profile-murph-stat-val">${murph.bestMile2Pace || '--'}</div><div class="profile-murph-stat-label">Best Mile 2</div></div>
      </div>
      <div class="profile-murph-reps">
        <span>${_fmtNumber(murph.totalPullups)} pull-ups</span>
        <span>${_fmtNumber(murph.totalPushups)} push-ups</span>
        <span>${_fmtNumber(murph.totalSquats)} squats</span>
      </div>
    </div>`;
}

function _renderTraining(training) {
  if (!training.currentSeason && !training.seasonsCompleted) return '';

  let seasonHtml = '';
  if (training.currentSeason) {
    const s = training.currentSeason;
    const pct = Math.round((s.weekNumber / s.totalWeeks) * 100);
    const adherColor = s.adherencePercent >= 80 ? 'var(--status-green)' : s.adherencePercent >= 60 ? 'var(--status-yellow)' : 'var(--status-red)';

    seasonHtml = `
      <div class="profile-season-card">
        <div class="profile-season-name">${_esc(s.name)}</div>
        <div class="profile-season-week">Week ${s.weekNumber} of ${s.totalWeeks}</div>
        <div class="profile-progress-bar"><div class="profile-progress-fill" style="width:${pct}%"></div></div>
        <div class="profile-adherence" style="color:${adherColor}">${s.adherencePercent}% adherence</div>
      </div>`;
  }

  let goalsHtml = '';
  if (training.activeGoals.length) {
    const goalRows = training.activeGoals.map(g => {
      const pct = Math.min(100, Math.round((g.currentValue / g.targetValue) * 100));
      return `
        <div class="profile-goal-row">
          <div class="profile-goal-title">${_esc(g.title)}</div>
          <div class="profile-goal-progress">
            <div class="profile-progress-bar"><div class="profile-progress-fill" style="width:${pct}%"></div></div>
            <span class="profile-goal-pct">${pct}%</span>
          </div>
        </div>`;
    }).join('');
    goalsHtml = `<div class="profile-goals">${goalRows}</div>`;
  }

  const historyLine = training.seasonsCompleted
    ? `<div class="profile-season-history">${training.seasonsCompleted} season${training.seasonsCompleted === 1 ? '' : 's'} completed</div>`
    : '';

  return `
    <div class="profile-section" data-section="training">
      <div class="profile-section-title">TRAINING</div>
      ${seasonHtml}
      ${goalsHtml}
      ${historyLine}
    </div>`;
}

function _renderSettings(identity) {
  const garminSection = identity.garminConnected
    ? `<div class="profile-setting-row">
        <span>Garmin</span>
        <div class="profile-setting-actions">
          <button class="profile-btn-sm" id="profileSyncBtn">Sync</button>
          <button class="profile-btn-sm destructive" id="profileDisconnectBtn">Disconnect</button>
        </div>
      </div>`
    : `<div class="profile-setting-row">
        <span>Garmin</span>
        <button class="profile-btn-sm accent" id="profileConnectGarminBtn">Connect</button>
      </div>`;

  return `
    <div class="profile-section" data-section="settings">
      <div class="profile-section-title">SETTINGS</div>
      ${garminSection}
      <div class="profile-setting-row">
        <span>Weight</span>
        <div class="profile-segmented" id="profileWeightUnit">
          <button class="profile-seg-btn ${identity.preferredWeightUnit === 'lbs' ? 'active' : ''}" data-val="lbs">lbs</button>
          <button class="profile-seg-btn ${identity.preferredWeightUnit === 'kg' ? 'active' : ''}" data-val="kg">kg</button>
        </div>
      </div>
      <div class="profile-setting-row">
        <span>Distance</span>
        <div class="profile-segmented" id="profileDistanceUnit">
          <button class="profile-seg-btn ${identity.preferredDistanceUnit === 'mi' ? 'active' : ''}" data-val="mi">mi</button>
          <button class="profile-seg-btn ${identity.preferredDistanceUnit === 'km' ? 'active' : ''}" data-val="km">km</button>
        </div>
      </div>
      <button class="profile-signout-btn" id="profileSignOutBtn">Sign Out</button>
    </div>`;
}

// ── Panel rendering ─────────────────────────────────────────

function _renderLoading() {
  return `
    <div class="profile-loading">
      <div class="profile-loading-spinner"></div>
      <div class="profile-loading-text">Loading profile...</div>
    </div>`;
}

async function _renderPanel() {
  const inner = document.getElementById('profilePanelInner');
  if (!inner) return;

  inner.innerHTML = _renderLoading();

  try {
    const data = await getUserProfileData();

    inner.innerHTML = `
      <button class="profile-close-btn" id="profileCloseBtn" aria-label="Close profile">
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>
      </button>
      ${_renderHeader(data.identity)}
      ${_renderReadiness(data.readiness)}
      ${_renderMovements(data.movements)}
      ${_renderMileage(data.mileage)}
      ${_renderMurph(data.murph)}
      ${_renderTraining(data.training)}
      ${_renderSettings(data.identity)}
    `;

    _wireInteractions(data.identity);
  } catch (err) {
    console.error('Profile load error:', err);
    inner.innerHTML = `
      <button class="profile-close-btn" id="profileCloseBtn" aria-label="Close profile">
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>
      </button>
      <div class="profile-error">
        <div>Failed to load profile</div>
        <button class="profile-btn-sm accent" id="profileRetryBtn">Retry</button>
      </div>`;
    document.getElementById('profileCloseBtn')?.addEventListener('click', closeProfile);
    document.getElementById('profileRetryBtn')?.addEventListener('click', () => _renderPanel());
  }
}

function _wireInteractions(identity) {
  // Close
  document.getElementById('profileCloseBtn')?.addEventListener('click', closeProfile);

  // Readiness toggle
  const toggle = document.getElementById('profileReadinessToggle');
  const detail = document.getElementById('profileReadinessDetail');
  if (toggle && detail) {
    toggle.addEventListener('click', () => {
      const card = document.getElementById('profileReadinessCard');
      card?.classList.toggle('expanded');
    });
  }

  // Sign out
  document.getElementById('profileSignOutBtn')?.addEventListener('click', async () => {
    try {
      await signOut();
      clearProfileCache();
      closeProfile();
      // Auth UI will update via onAuthStateChange
    } catch (err) {
      console.warn('Sign out error:', err.message);
    }
  });

  // Garmin sync
  document.getElementById('profileSyncBtn')?.addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true; btn.textContent = 'Syncing...';
    try {
      await requestSync();
      btn.textContent = 'Done!'; btn.style.color = 'var(--status-green)';
      setTimeout(() => { btn.textContent = 'Sync'; btn.style.color = ''; btn.disabled = false; }, 2000);
    } catch (err) {
      btn.textContent = 'Failed'; btn.style.color = 'var(--status-red)';
      setTimeout(() => { btn.textContent = 'Sync'; btn.style.color = ''; btn.disabled = false; }, 2000);
    }
  });

  // Garmin disconnect
  document.getElementById('profileDisconnectBtn')?.addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true;
    try {
      await disconnectGarmin();
      clearProfileCache();
      _renderPanel(); // Re-render
    } catch (err) {
      btn.disabled = false;
      console.warn('Disconnect error:', err.message);
    }
  });

  // Garmin connect — redirect to garmin.html for the full connect flow
  document.getElementById('profileConnectGarminBtn')?.addEventListener('click', () => {
    window.location.href = 'garmin.html';
  });

  // Unit toggles
  _wireSegmented('profileWeightUnit', 'preferred_weight_unit');
  _wireSegmented('profileDistanceUnit', 'preferred_distance_unit');
}

function _wireSegmented(containerId, column) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('.profile-seg-btn');
    if (!btn || btn.classList.contains('active')) return;
    const val = btn.dataset.val;

    // Update UI immediately
    container.querySelectorAll('.profile-seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Persist
    try {
      const client = getSupabaseClient();
      if (!client) return;
      const { data: { user } } = await client.auth.getUser();
      if (!user) return;
      await client.from('user_profiles').update({ [column]: val }).eq('user_id', user.id);
      clearProfileCache();
    } catch (err) {
      console.warn('Unit update error:', err.message);
    }
  });
}

// ── Public API ──────────────────────────────────────────────

export function openProfile() {
  const backdrop = document.getElementById('profileBackdrop');
  const panel = document.getElementById('profilePanel');
  if (!backdrop || !panel) return;

  _panelOpen = true;
  backdrop.classList.add('visible');
  panel.classList.add('visible');
  document.body.style.overflow = 'hidden';
  _renderPanel();
}

export function closeProfile() {
  const backdrop = document.getElementById('profileBackdrop');
  const panel = document.getElementById('profilePanel');
  if (!backdrop || !panel) return;

  _panelOpen = false;
  panel.classList.remove('visible');
  backdrop.classList.remove('visible');
  document.body.style.overflow = '';
}

export function initProfilePanel(authUI) {
  _authUI = authUI;

  const backdrop = document.getElementById('profileBackdrop');
  const avatarBtn = document.getElementById('profileAvatarBtn');

  // Backdrop click to close
  if (backdrop) {
    backdrop.addEventListener('click', closeProfile);
  }

  // Avatar button click
  if (avatarBtn) {
    avatarBtn.addEventListener('click', () => {
      if (avatarBtn.classList.contains('signed-in')) {
        openProfile();
      } else if (_authUI) {
        _authUI.showAuthModal();
      }
    });
  }

  // Escape key to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _panelOpen) closeProfile();
  });
}
