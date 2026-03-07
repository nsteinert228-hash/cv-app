// Garmin Readiness Dashboard — phased loading, state machine, canvas charts
import { isSupabaseConfigured } from './supabase.js';
import { onAuthStateChange, getUser } from './auth.js';
import { createAuthUI } from './authUI.js';
import * as garmin from './garmin.js';

// ── DOM refs ─────────────────────────────────────────────────

const authSection = document.getElementById('authSection');
const authUI = createAuthUI();

const dashboardContent = document.getElementById('dashboardContent');
const emptyState = document.getElementById('emptyState');
const connectBtn = document.getElementById('connectGarminBtn');
const garminModal = document.getElementById('garminModal');
const garminEmailInput = document.getElementById('garminEmail');
const garminPasswordInput = document.getElementById('garminPassword');
const garminSubmit = document.getElementById('garminSubmit');
const garminCancel = document.getElementById('garminCancel');
const garminError = document.getElementById('garminError');

// Status bar
const statusBar = document.getElementById('statusBar');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const syncBtn = document.getElementById('syncBtn');
const disconnectBtn = document.getElementById('disconnectBtn');

// Error banner
const errorBanner = document.getElementById('errorBanner');
const errorMsg = document.getElementById('errorMsg');
const errorAction = document.getElementById('errorAction');
const errorDismiss = document.getElementById('errorDismiss');

// ── Auth (shared logic) ──────────────────────────────────────

authUI.init({
  onSignIn() { refreshDashboard(); },
  onSignOut() { refreshDashboard(); },
});

// ── Garmin connect modal ─────────────────────────────────────

if (connectBtn) {
  connectBtn.addEventListener('click', () => {
    garminEmailInput.value = '';
    garminPasswordInput.value = '';
    garminError.textContent = '';
    garminModal.classList.add('visible');
  });
}

if (garminCancel) garminCancel.addEventListener('click', () => garminModal.classList.remove('visible'));
if (garminModal) garminModal.addEventListener('click', (e) => { if (e.target === garminModal) garminModal.classList.remove('visible'); });

if (garminSubmit) {
  garminSubmit.addEventListener('click', async () => {
    const email = garminEmailInput.value.trim();
    const password = garminPasswordInput.value;
    if (!email || !password) { garminError.textContent = 'Please enter your Garmin credentials.'; return; }
    garminError.textContent = '';
    garminSubmit.disabled = true;
    garminSubmit.textContent = 'Connecting...';
    try {
      await garmin.connectGarmin(email, password);
      garminModal.classList.remove('visible');
      refreshDashboard();
    } catch (err) {
      garminError.textContent = err.message;
    }
    garminSubmit.disabled = false;
    garminSubmit.textContent = 'Connect';
  });
}

// ── Error banner ─────────────────────────────────────────────

if (errorDismiss) errorDismiss.addEventListener('click', () => hideErrorBanner());

function showErrorBanner(message, actionLabel, actionFn) {
  errorMsg.textContent = message;
  errorAction.textContent = actionLabel;
  errorAction.onclick = actionFn;
  errorBanner.classList.add('visible');
}

function hideErrorBanner() {
  errorBanner.classList.remove('visible');
}

// ── Status bar ───────────────────────────────────────────────

function updateStatusBar(state, lastSyncIso) {
  statusBar.classList.add('visible');

  const dotClasses = {
    active: 'active',
    pending: 'pending',
    syncing: 'syncing',
    sync_requested: 'syncing',
    error: 'error',
  };

  statusDot.className = `status-dot ${dotClasses[state] || ''}`;

  const labels = {
    active: lastSyncIso ? `Connected \u2014 last synced ${timeAgo(lastSyncIso)}` : 'Connected',
    pending: 'Connected \u2014 waiting for first sync',
    syncing: 'Syncing...',
    sync_requested: 'Sync requested...',
    error: 'Connection error',
  };

  statusText.textContent = labels[state] || state;
  syncBtn.style.display = (state === 'active' || state === 'pending') ? '' : 'none';
  disconnectBtn.style.display = (state === 'active' || state === 'pending' || state === 'error') ? '' : 'none';
}

function hideStatusBar() {
  statusBar.classList.remove('visible');
}

// ── Sync button ──────────────────────────────────────────────

let syncPollTimer = null;

if (syncBtn) {
  syncBtn.addEventListener('click', async () => {
    syncBtn.disabled = true;
    syncBtn.textContent = 'Syncing...';
    statusDot.className = 'status-dot syncing';

    try {
      await garmin.requestSync();
      syncBtn.textContent = 'Requested!';
      syncBtn.style.color = '#10b981';
      setTimeout(() => {
        syncBtn.textContent = 'Sync';
        syncBtn.style.color = '';
        syncBtn.disabled = false;
      }, 2000);

      // Poll for sync completion
      let pollCount = 0;
      clearInterval(syncPollTimer);
      syncPollTimer = setInterval(async () => {
        pollCount++;
        if (pollCount >= 6) { clearInterval(syncPollTimer); return; }
        try {
          const status = await garmin.getGarminStatus();
          if (status && status.status === 'active') {
            clearInterval(syncPollTimer);
            refreshDashboard();
          }
        } catch { /* ignore poll errors */ }
      }, 10000);
    } catch (err) {
      syncBtn.textContent = 'Sync';
      syncBtn.disabled = false;
      statusDot.className = 'status-dot active';
      showErrorBanner(`Sync failed: ${err.message}`, 'Retry', () => { hideErrorBanner(); syncBtn.click(); });
    }
  });
}

// ── Disconnect button ────────────────────────────────────────

if (disconnectBtn) {
  disconnectBtn.addEventListener('click', async () => {
    disconnectBtn.disabled = true;
    try {
      await garmin.disconnectGarmin();
      refreshDashboard();
    } catch (err) {
      showErrorBanner(`Disconnect failed: ${err.message}`, 'Retry', () => { hideErrorBanner(); disconnectBtn.click(); });
    }
    disconnectBtn.disabled = false;
  });
}

// ── Time helper ──────────────────────────────────────────────

function timeAgo(isoString) {
  if (!isoString) return '';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── Skeleton draw functions ──────────────────────────────────

function drawSkeletonGauge(canvas) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const size = canvas.clientWidth;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  ctx.scale(dpr, dpr);

  const cx = size / 2, cy = size / 2;
  const r = size * 0.38, lw = size * 0.09;

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0.75 * Math.PI, 2.25 * Math.PI);
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.stroke();

  ctx.fillStyle = '#d1d5db';
  ctx.font = `700 ${size * 0.22}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('--', cx, cy);
}

function drawSkeletonBar(canvas) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  const barH = 20, y = (h - barH) / 2;
  ctx.fillStyle = '#e5e7eb';
  ctx.beginPath();
  ctx.roundRect(0, y, w, barH, barH / 2);
  ctx.fill();
}

function drawSkeletonSparkline(canvas) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  ctx.fillStyle = '#e5e7eb';
  ctx.beginPath();
  ctx.roundRect(10, 10, w - 20, h - 20, 8);
  ctx.fill();

  ctx.fillStyle = '#d1d5db';
  ctx.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Loading...', w / 2, h / 2 + 4);
}

function drawSkeletonDonut(canvas) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const size = canvas.clientWidth;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  ctx.scale(dpr, dpr);

  const cx = size / 2, cy = size / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.36, 0, Math.PI * 2);
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = size * 0.14;
  ctx.stroke();
}

function showSkeletons() {
  // Draw skeleton canvases
  drawSkeletonGauge(document.getElementById('readinessGauge'));
  drawSkeletonBar(document.getElementById('bodyBatteryBar'));
  drawSkeletonBar(document.getElementById('sleepBar'));
  drawSkeletonSparkline(document.getElementById('hrvChart'));
  drawSkeletonDonut(document.getElementById('stressDonut'));

  // Reset text values
  const placeholders = [
    'bbStart', 'bbEnd', 'bbCharged', 'bbDrained',
    'sleepTotal', 'sleepDeep', 'sleepLight', 'sleepRem', 'sleepAwake',
    'scoreOverall', 'scoreQuality', 'scoreDuration', 'scoreRecovery',
    'qSteps', 'qHR', 'qHR7d', 'qSpo2', 'qResp', 'qIntensity', 'qFloors',
  ];
  for (const id of placeholders) {
    const el = document.getElementById(id);
    if (el) el.textContent = '--';
  }

  const stepsBar = document.getElementById('stepsProgressFill');
  if (stepsBar) stepsBar.style.width = '0%';
}

// ── Chart helpers ────────────────────────────────────────────

function drawArcGauge(canvas, value, max, color, bgColor, label) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const size = canvas.clientWidth;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  ctx.scale(dpr, dpr);

  const cx = size / 2, cy = size / 2;
  const r = size * 0.38, lw = size * 0.09;
  const startAngle = 0.75 * Math.PI;
  const endAngle = 2.25 * Math.PI;
  const pct = Math.min(value / max, 1);

  ctx.beginPath();
  ctx.arc(cx, cy, r, startAngle, endAngle);
  ctx.strokeStyle = bgColor;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.stroke();

  if (pct > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, startAngle + pct * (endAngle - startAngle));
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  ctx.fillStyle = color;
  ctx.font = `700 ${size * 0.22}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(value, cx, cy - size * 0.02);

  ctx.fillStyle = '#9ca3af';
  ctx.font = `500 ${size * 0.085}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.fillText(label, cx, cy + size * 0.16);
}

function drawHrvSparkline(canvas, data) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  if (!data.length) {
    ctx.fillStyle = '#9ca3af';
    ctx.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No HRV data yet', w / 2, h / 2);
    return;
  }

  const pad = { top: 10, right: 10, bottom: 28, left: 36 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;

  const values = data.map(d => d.last_night_avg).filter(v => v != null);
  const baseLows = data.map(d => d.baseline_low).filter(v => v != null);
  const baseHighs = data.map(d => d.baseline_high || d.baseline_balanced).filter(v => v != null);

  const allVals = [...values, ...baseLows, ...baseHighs];
  const minV = Math.floor(Math.min(...allVals) * 0.9);
  const maxV = Math.ceil(Math.max(...allVals) * 1.1);
  const range = maxV - minV || 1;

  const xStep = data.length > 1 ? cw / (data.length - 1) : cw / 2;
  const toX = i => pad.left + i * xStep;
  const toY = v => pad.top + ch - ((v - minV) / range) * ch;

  if (baseLows.length && baseHighs.length) {
    ctx.fillStyle = 'rgba(16, 185, 129, 0.1)';
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const bh = data[i].baseline_high || data[i].baseline_balanced;
      if (bh == null) continue;
      ctx.lineTo(toX(i), toY(bh));
    }
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i].baseline_low == null) continue;
      ctx.lineTo(toX(i), toY(data[i].baseline_low));
    }
    ctx.closePath();
    ctx.fill();
  }

  ctx.beginPath();
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  let started = false;
  for (let i = 0; i < data.length; i++) {
    if (data[i].last_night_avg == null) continue;
    const x = toX(i), y = toY(data[i].last_night_avg);
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  for (let i = 0; i < data.length; i++) {
    if (data[i].last_night_avg == null) continue;
    ctx.beginPath();
    ctx.arc(toX(i), toY(data[i].last_night_avg), 3, 0, Math.PI * 2);
    ctx.fillStyle = '#10b981';
    ctx.fill();
  }

  ctx.fillStyle = '#9ca3af';
  ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  const labelEvery = Math.max(1, Math.floor(data.length / 6));
  for (let i = 0; i < data.length; i += labelEvery) {
    const d = new Date(data[i].date + 'T00:00:00');
    const label = `${d.getMonth() + 1}/${d.getDate()}`;
    ctx.fillText(label, toX(i), h - 6);
  }

  ctx.textAlign = 'right';
  ctx.fillText(maxV, pad.left - 6, pad.top + 4);
  ctx.fillText(minV, pad.left - 6, pad.top + ch + 4);
}

function drawStressDonut(canvas, rest, low, medium, high) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const size = canvas.clientWidth;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  ctx.scale(dpr, dpr);

  const total = (rest || 0) + (low || 0) + (medium || 0) + (high || 0);
  if (total === 0) {
    ctx.fillStyle = '#9ca3af';
    ctx.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No data', size / 2, size / 2);
    return;
  }

  const cx = size / 2, cy = size / 2;
  const r = size * 0.36, lw = size * 0.14;
  const segments = [
    { val: rest || 0, color: '#10b981' },
    { val: low || 0, color: '#60a5fa' },
    { val: medium || 0, color: '#f59e0b' },
    { val: high || 0, color: '#ef4444' },
  ];

  let angle = -Math.PI / 2;
  for (const seg of segments) {
    if (seg.val <= 0) continue;
    const sweep = (seg.val / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, angle, angle + sweep);
    ctx.strokeStyle = seg.color;
    ctx.lineWidth = lw;
    ctx.stroke();
    angle += sweep;
  }

  const avgEl = document.getElementById('stressAvgValue');
  if (avgEl) {
    ctx.fillStyle = '#1a1a1a';
    ctx.font = `700 ${size * 0.16}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(avgEl.dataset.value || '--', cx, cy - size * 0.02);

    ctx.fillStyle = '#9ca3af';
    ctx.font = `500 ${size * 0.07}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.fillText('AVG STRESS', cx, cy + size * 0.12);
  }
}

function drawSleepBar(canvas, deep, light, rem, awake) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  const total = (deep || 0) + (light || 0) + (rem || 0) + (awake || 0);
  if (total === 0) return;

  const barH = 24, y = (h - barH) / 2, radius = barH / 2;
  const segments = [
    { val: deep || 0, color: '#1e3a5f' },
    { val: light || 0, color: '#60a5fa' },
    { val: rem || 0, color: '#a78bfa' },
    { val: awake || 0, color: '#f59e0b' },
  ];

  ctx.fillStyle = '#e5e7eb';
  ctx.beginPath();
  ctx.roundRect(0, y, w, barH, radius);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, y, w, barH, radius);
  ctx.clip();

  let x = 0;
  for (const seg of segments) {
    if (seg.val <= 0) continue;
    const sw = (seg.val / total) * w;
    ctx.fillStyle = seg.color;
    ctx.fillRect(x, y, sw, barH);
    x += sw;
  }
  ctx.restore();
}

function drawBodyBatteryBar(canvas, startLevel, endLevel) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  const barH = 20, y = (h - barH) / 2, radius = barH / 2;

  ctx.fillStyle = '#e5e7eb';
  ctx.beginPath();
  ctx.roundRect(0, y, w, barH, radius);
  ctx.fill();

  const level = endLevel || 0;
  const fillW = (level / 100) * w;
  const color = level >= 60 ? '#10b981' : level >= 30 ? '#f59e0b' : '#ef4444';

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, y, w, barH, radius);
  ctx.clip();
  ctx.fillStyle = color;
  ctx.fillRect(0, y, fillW, barH);
  ctx.restore();

  if (startLevel != null) {
    const sx = (startLevel / 100) * w;
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(sx, y - 4);
    ctx.lineTo(sx, y + barH + 4);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// ── Format helpers ───────────────────────────────────────────

function fmtDuration(seconds) {
  if (!seconds) return '--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── State machine ────────────────────────────────────────────

function showState(name, opts = {}) {
  hideErrorBanner();

  switch (name) {
    case 'not-signed-in':
      dashboardContent.style.display = 'none';
      emptyState.style.display = 'block';
      emptyState.querySelector('p').textContent = 'Sign in to view your Garmin health dashboard.';
      if (connectBtn) connectBtn.style.display = 'none';
      hideStatusBar();
      break;

    case 'not-connected':
      dashboardContent.style.display = 'none';
      emptyState.style.display = 'block';
      emptyState.querySelector('p').textContent = 'Connect your Garmin account to see your readiness dashboard.';
      if (connectBtn) connectBtn.style.display = '';
      hideStatusBar();
      break;

    case 'pending':
      emptyState.style.display = 'none';
      dashboardContent.classList.add('visible');
      dashboardContent.style.display = '';
      showSkeletons();
      updateStatusBar('pending');
      break;

    case 'active':
      emptyState.style.display = 'none';
      dashboardContent.classList.add('visible');
      dashboardContent.style.display = '';
      updateStatusBar('active', opts.lastSyncAt);
      break;

    case 'syncing':
      updateStatusBar('syncing');
      break;

    case 'error':
      updateStatusBar('error');
      if (opts.authError) {
        showErrorBanner(
          opts.message || 'Garmin authentication failed.',
          'Reconnect',
          () => { hideErrorBanner(); garminModal.classList.add('visible'); }
        );
      } else {
        showErrorBanner(
          opts.message || 'An error occurred.',
          'Retry Sync',
          () => { hideErrorBanner(); syncBtn.click(); }
        );
      }
      // Still show dashboard if we have data
      emptyState.style.display = 'none';
      dashboardContent.classList.add('visible');
      dashboardContent.style.display = '';
      break;

    case 'network-error':
      dashboardContent.style.display = 'none';
      emptyState.style.display = 'none';
      hideStatusBar();
      showErrorBanner(
        opts.message || 'Unable to load. Check your connection.',
        'Retry',
        () => { hideErrorBanner(); refreshDashboard(); }
      );
      break;
  }
}

// ── Dashboard rendering (phased) ─────────────────────────────

async function refreshDashboard() {
  const currentUser = authUI.getCurrentUser();

  if (!currentUser) {
    showState('not-signed-in');
    return;
  }

  // Phase 1: Show skeletons immediately
  emptyState.style.display = 'none';
  dashboardContent.classList.add('visible');
  dashboardContent.style.display = '';
  showSkeletons();

  // Phase 2: Connection check
  let status;
  try {
    status = await garmin.getGarminStatus();
  } catch (err) {
    showState('network-error', { message: `Unable to load: ${err.message}` });
    return;
  }

  if (!status) {
    showState('not-connected');
    return;
  }

  // Determine connection state
  const isAuthError = status.status === 'error' &&
    status.error_message && /auth|login|credential|password|token/i.test(status.error_message);

  if (status.status === 'error') {
    showState('error', {
      message: status.error_message || 'Connection error',
      authError: isAuthError,
    });
  } else if (status.status === 'pending' || status.status === 'sync_requested') {
    showState(status.status === 'pending' ? 'pending' : 'syncing');
  }

  // Fetch last sync time
  let lastSyncAt = status.last_sync_at;
  try {
    const syncTime = await garmin.getLastSyncTime();
    if (syncTime) lastSyncAt = syncTime;
  } catch { /* use connection's last_sync_at */ }

  if (status.status === 'active') {
    showState('active', { lastSyncAt });
  }

  // Phase 3: Data fetch — each card independently
  const renderSleepCard = garmin.getSleepDetailed()
    .then(sleep => {
      const readinessCanvas = document.getElementById('readinessGauge');
      const sleepScore = sleep?.sleep_score ?? 0;
      const sleepColor = sleepScore >= 70 ? '#10b981' : sleepScore >= 40 ? '#f59e0b' : '#ef4444';
      drawArcGauge(readinessCanvas, sleepScore, 100, sleepColor, '#e5e7eb', 'Sleep Score');

      const sleepCanvas = document.getElementById('sleepBar');
      drawSleepBar(sleepCanvas, sleep?.deep_seconds, sleep?.light_seconds, sleep?.rem_seconds, sleep?.awake_seconds);
      document.getElementById('sleepTotal').textContent = fmtDuration(sleep?.total_sleep_seconds);
      document.getElementById('sleepDeep').textContent = fmtDuration(sleep?.deep_seconds);
      document.getElementById('sleepLight').textContent = fmtDuration(sleep?.light_seconds);
      document.getElementById('sleepRem').textContent = fmtDuration(sleep?.rem_seconds);
      document.getElementById('sleepAwake').textContent = fmtDuration(sleep?.awake_seconds);
      document.getElementById('scoreOverall').textContent = sleep?.sleep_score ?? '--';
      document.getElementById('scoreDuration').textContent = fmtDuration(sleep?.total_sleep_seconds);
    })
    .catch(() => {
      document.getElementById('readinessGauge').parentElement.innerHTML =
        '<div class="card-error">Sleep data unavailable</div>';
    });

  const renderHrvCard = garmin.getHrvTrend(14)
    .then(hrv => {
      const hrvCanvas = document.getElementById('hrvChart');
      const hrvMapped = (hrv || []).map(d => ({ ...d, baseline_high: d.baseline_upper }));
      drawHrvSparkline(hrvCanvas, hrvMapped);
    })
    .catch(() => {
      document.getElementById('hrvChart').parentElement.innerHTML =
        '<div class="card-error">HRV data unavailable</div>';
    });

  const renderDailyCard = garmin.getDailySummaryDetailed()
    .then(daily => {
      document.getElementById('bbStart').textContent = daily?.resting_heart_rate ?? '--';
      document.getElementById('bbEnd').textContent = daily?.stress_avg ?? '--';
      document.getElementById('bbCharged').textContent = daily?.calories_active ? `${daily.calories_active.toLocaleString()}` : '--';
      document.getElementById('bbDrained').textContent = daily?.calories_total ? `${daily.calories_total.toLocaleString()}` : '--';

      const bbCanvas = document.getElementById('bodyBatteryBar');
      drawBodyBatteryBar(bbCanvas, null, 100 - (daily?.stress_avg || 0));

      // Stress donut — use real zone durations if available, fallback to approximation
      const stressAvgEl = document.getElementById('stressAvgValue');
      if (stressAvgEl) stressAvgEl.dataset.value = daily?.stress_avg ?? '--';
      const stressCanvas = document.getElementById('stressDonut');

      if (daily?.rest_stress_duration != null) {
        drawStressDonut(stressCanvas,
          daily.rest_stress_duration,
          daily.low_stress_duration,
          daily.medium_stress_duration,
          daily.high_stress_duration);
      } else {
        // Fallback: approximate from avg stress
        const avg = daily?.stress_avg || 0;
        const restEst = avg < 25 ? 60 : avg < 50 ? 30 : 10;
        const lowEst = avg < 25 ? 25 : avg < 50 ? 35 : 20;
        const medEst = avg < 25 ? 10 : avg < 50 ? 25 : 35;
        const highEst = avg < 25 ? 5 : avg < 50 ? 10 : 35;
        drawStressDonut(stressCanvas, restEst, lowEst, medEst, highEst);
      }

      // Quick stats
      const stepsVal = daily?.steps;
      const stepsGoal = 10000;
      document.getElementById('qSteps').textContent = stepsVal?.toLocaleString() ?? '--';
      document.getElementById('qStepsGoal').textContent = stepsGoal.toLocaleString();
      const stepsBar = document.getElementById('stepsProgressFill');
      if (stepsBar) stepsBar.style.width = `${Math.min((stepsVal || 0) / stepsGoal * 100, 100)}%`;

      document.getElementById('qHR').textContent = daily?.resting_heart_rate ?? '--';
      document.getElementById('qHR7d').textContent = daily?.min_heart_rate ?? '--';
      document.getElementById('qIntensity').textContent = daily?.intensity_minutes || '--';
      document.getElementById('qFloors').textContent = daily?.floors_climbed ?? '--';
    })
    .catch(() => {
      document.getElementById('bodyBatteryBar').parentElement.parentElement.innerHTML =
        '<div class="card-error">Daily data unavailable</div>';
    });

  const renderSpo2 = garmin.getSpo2()
    .then(spo2 => {
      document.getElementById('qSpo2').textContent = spo2?.avg_spo2 ? `${Math.round(spo2.avg_spo2)}%` : '--';
      document.getElementById('scoreQuality').textContent = spo2?.avg_spo2 ? `${Math.round(spo2.avg_spo2)}%` : '--';
    })
    .catch(() => {
      document.getElementById('qSpo2').textContent = 'N/A';
      document.getElementById('scoreQuality').textContent = 'N/A';
    });

  const renderResp = garmin.getRespiration()
    .then(resp => {
      document.getElementById('qResp').textContent = resp?.avg_waking ? `${Math.round(resp.avg_waking)}` : '--';
      document.getElementById('scoreRecovery').textContent = resp?.avg_sleeping ? `${Math.round(resp.avg_sleeping)}` : '--';
    })
    .catch(() => {
      document.getElementById('qResp').textContent = 'N/A';
      document.getElementById('scoreRecovery').textContent = 'N/A';
    });

  await Promise.all([renderSleepCard, renderHrvCard, renderDailyCard, renderSpo2, renderResp]);
}

// ── Init ─────────────────────────────────────────────────────

async function init() {
  if (isSupabaseConfigured() && authSection) {
    authSection.classList.remove('hidden');

    onAuthStateChange(async (user) => {
      authUI.updateAuthUI(user);
      refreshDashboard();
    });

    try {
      const user = await getUser();
      if (user && !authUI.getCurrentUser()) {
        authUI.updateAuthUI(user);
        refreshDashboard();
      }
    } catch { /* session check failed */ }
  }
}

init();
