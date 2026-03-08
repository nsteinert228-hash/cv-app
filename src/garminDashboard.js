// Garmin Readiness Dashboard — phased loading, canvas charts, trainer-oriented layout
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

const statusBar = document.getElementById('statusBar');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const syncBtn = document.getElementById('syncBtn');
const disconnectBtn = document.getElementById('disconnectBtn');

const errorBanner = document.getElementById('errorBanner');
const errorMsg = document.getElementById('errorMsg');
const errorAction = document.getElementById('errorAction');
const errorDismiss = document.getElementById('errorDismiss');

// ── Auth ─────────────────────────────────────────────────────

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
function hideErrorBanner() { errorBanner.classList.remove('visible'); }

// ── Status bar ───────────────────────────────────────────────

function updateStatusBar(state, lastSyncIso) {
  statusBar.classList.add('visible');
  const dotMap = { active: 'active', pending: 'pending', syncing: 'syncing', sync_requested: 'syncing', error: 'error' };
  statusDot.className = `status-dot ${dotMap[state] || ''}`;
  const labels = {
    active: lastSyncIso ? `Connected \u2014 last synced ${timeAgo(lastSyncIso)}` : 'Connected',
    pending: 'Connected \u2014 waiting for first sync',
    syncing: 'Syncing...', sync_requested: 'Sync requested...',
    error: 'Connection error',
  };
  statusText.textContent = labels[state] || state;
  syncBtn.style.display = (state === 'active' || state === 'pending') ? '' : 'none';
  disconnectBtn.style.display = (state === 'active' || state === 'pending' || state === 'error') ? '' : 'none';
}
function hideStatusBar() { statusBar.classList.remove('visible'); }

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
      setTimeout(() => { syncBtn.textContent = 'Sync'; syncBtn.style.color = ''; syncBtn.disabled = false; }, 2000);
      let pollCount = 0;
      clearInterval(syncPollTimer);
      syncPollTimer = setInterval(async () => {
        pollCount++;
        if (pollCount >= 6) { clearInterval(syncPollTimer); return; }
        try {
          const s = await garmin.getGarminStatus();
          if (s && s.status === 'active') { clearInterval(syncPollTimer); refreshDashboard(); }
        } catch { /* ignore */ }
      }, 10000);
    } catch (err) {
      syncBtn.textContent = 'Sync'; syncBtn.disabled = false;
      statusDot.className = 'status-dot active';
      showErrorBanner(`Sync failed: ${err.message}`, 'Retry', () => { hideErrorBanner(); syncBtn.click(); });
    }
  });
}

if (disconnectBtn) {
  disconnectBtn.addEventListener('click', async () => {
    disconnectBtn.disabled = true;
    try { await garmin.disconnectGarmin(); refreshDashboard(); }
    catch (err) { showErrorBanner(`Disconnect failed: ${err.message}`, 'Retry', () => { hideErrorBanner(); disconnectBtn.click(); }); }
    disconnectBtn.disabled = false;
  });
}

// ── Helpers ──────────────────────────────────────────────────

function timeAgo(iso) {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtDuration(s) {
  if (!s) return '--';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtPace(durationSec, distMeters) {
  if (!durationSec || !distMeters) return '';
  const paceSecPerMile = durationSec / (distMeters / 1609.34);
  const pm = Math.floor(paceSecPerMile / 60), ps = Math.round(paceSecPerMile % 60);
  return `${pm}:${String(ps).padStart(2, '0')}/mi`;
}

function fmtMiles(meters) {
  if (!meters) return '--';
  return (meters / 1609.34).toFixed(1) + ' mi';
}

function activityIcon(type) {
  const icons = { running: '\u{1F3C3}', resort_skiing: '\u{26F7}\uFE0F', cycling: '\u{1F6B4}', swimming: '\u{1F3CA}', hiking: '\u{1F6B6}', walking: '\u{1F6B6}', strength_training: '\u{1F4AA}' };
  return icons[type] || '\u{1F3CB}\uFE0F';
}

// ── Canvas: Arc Gauge ────────────────────────────────────────

function drawArcGauge(canvas, value, max, color, label) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const size = canvas.clientWidth;
  canvas.width = size * dpr; canvas.height = size * dpr;
  ctx.scale(dpr, dpr);

  const cx = size / 2, cy = size / 2, r = size * 0.38, lw = size * 0.09;
  const sa = 0.75 * Math.PI, ea = 2.25 * Math.PI;
  const pct = Math.min(value / max, 1);

  ctx.beginPath(); ctx.arc(cx, cy, r, sa, ea);
  ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.stroke();

  if (pct > 0) {
    ctx.beginPath(); ctx.arc(cx, cy, r, sa, sa + pct * (ea - sa));
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.stroke();
  }

  ctx.fillStyle = color;
  ctx.font = `700 ${size * 0.24}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(value, cx, cy - size * 0.02);

  if (label) {
    ctx.fillStyle = '#9ca3af';
    ctx.font = `500 ${size * 0.08}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.fillText(label, cx, cy + size * 0.16);
  }
}

function drawSkeletonGauge(canvas) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const size = canvas.clientWidth;
  canvas.width = size * dpr; canvas.height = size * dpr;
  ctx.scale(dpr, dpr);
  const cx = size / 2, cy = size / 2;
  ctx.beginPath(); ctx.arc(cx, cy, size * 0.38, 0.75 * Math.PI, 2.25 * Math.PI);
  ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = size * 0.09; ctx.lineCap = 'round'; ctx.stroke();
  ctx.fillStyle = '#d1d5db';
  ctx.font = `700 ${size * 0.24}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('--', cx, cy);
}

// ── Canvas: Sparkline (generic) ──────────────────────────────

function drawSparkline(canvas, data, { valueKey, color = '#10b981', bandLow, bandHigh, yLabel, emptyMsg = 'No data' } = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  const values = data.map(d => d[valueKey]).filter(v => v != null);
  if (!values.length) {
    ctx.fillStyle = '#9ca3af';
    ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(emptyMsg, w / 2, h / 2);
    return;
  }

  const pad = { top: 8, right: 8, bottom: 22, left: 32 };
  const cw = w - pad.left - pad.right, ch = h - pad.top - pad.bottom;

  let allVals = [...values];
  if (bandLow) allVals.push(...data.map(d => d[bandLow]).filter(v => v != null));
  if (bandHigh) allVals.push(...data.map(d => d[bandHigh]).filter(v => v != null));
  const minV = Math.floor(Math.min(...allVals) * 0.92);
  const maxV = Math.ceil(Math.max(...allVals) * 1.08);
  const range = maxV - minV || 1;

  const xStep = data.length > 1 ? cw / (data.length - 1) : cw / 2;
  const toX = i => pad.left + i * xStep;
  const toY = v => pad.top + ch - ((v - minV) / range) * ch;

  // Band
  if (bandLow && bandHigh) {
    ctx.fillStyle = `${color}18`;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) { const v = data[i][bandHigh]; if (v != null) ctx.lineTo(toX(i), toY(v)); }
    for (let i = data.length - 1; i >= 0; i--) { const v = data[i][bandLow]; if (v != null) ctx.lineTo(toX(i), toY(v)); }
    ctx.closePath(); ctx.fill();
  }

  // Line
  ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  let started = false;
  for (let i = 0; i < data.length; i++) {
    const v = data[i][valueKey]; if (v == null) continue;
    if (!started) { ctx.moveTo(toX(i), toY(v)); started = true; } else ctx.lineTo(toX(i), toY(v));
  }
  ctx.stroke();

  // Dots
  for (let i = 0; i < data.length; i++) {
    const v = data[i][valueKey]; if (v == null) continue;
    ctx.beginPath(); ctx.arc(toX(i), toY(v), 2.5, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
  }

  // X labels
  ctx.fillStyle = '#9ca3af'; ctx.font = '9px -apple-system, BlinkMacSystemFont, sans-serif'; ctx.textAlign = 'center';
  const every = Math.max(1, Math.floor(data.length / 5));
  for (let i = 0; i < data.length; i += every) {
    const d = new Date(data[i].date + 'T00:00:00');
    ctx.fillText(`${d.getMonth() + 1}/${d.getDate()}`, toX(i), h - 4);
  }

  // Y labels
  ctx.textAlign = 'right';
  ctx.fillText(maxV, pad.left - 4, pad.top + 6);
  ctx.fillText(minV, pad.left - 4, pad.top + ch + 4);
}

// ── Canvas: Sleep bar ────────────────────────────────────────

function drawSleepBar(canvas, deep, light, rem, awake) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  const total = (deep || 0) + (light || 0) + (rem || 0) + (awake || 0);
  if (total === 0) return;

  const barH = 24, y = (h - barH) / 2, radius = barH / 2;
  const segs = [
    { val: deep || 0, color: '#1e3a5f' }, { val: light || 0, color: '#60a5fa' },
    { val: rem || 0, color: '#a78bfa' }, { val: awake || 0, color: '#f59e0b' },
  ];

  ctx.fillStyle = '#e5e7eb'; ctx.beginPath(); ctx.roundRect(0, y, w, barH, radius); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.roundRect(0, y, w, barH, radius); ctx.clip();
  let x = 0;
  for (const s of segs) { if (s.val <= 0) continue; const sw = (s.val / total) * w; ctx.fillStyle = s.color; ctx.fillRect(x, y, sw, barH); x += sw; }
  ctx.restore();
}

// ── Canvas: Stress donut ─────────────────────────────────────

function drawStressDonut(canvas, rest, low, med, high, avgLabel) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const size = canvas.clientWidth;
  canvas.width = size * dpr; canvas.height = size * dpr;
  ctx.scale(dpr, dpr);

  const total = (rest || 0) + (low || 0) + (med || 0) + (high || 0);
  if (total === 0) {
    ctx.fillStyle = '#9ca3af'; ctx.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center'; ctx.fillText('No data', size / 2, size / 2); return;
  }

  const cx = size / 2, cy = size / 2, r = size * 0.36, lw = size * 0.14;
  const segs = [
    { val: rest || 0, color: '#10b981' }, { val: low || 0, color: '#60a5fa' },
    { val: med || 0, color: '#f59e0b' }, { val: high || 0, color: '#ef4444' },
  ];

  let angle = -Math.PI / 2;
  for (const s of segs) {
    if (s.val <= 0) continue;
    const sweep = (s.val / total) * Math.PI * 2;
    ctx.beginPath(); ctx.arc(cx, cy, r, angle, angle + sweep);
    ctx.strokeStyle = s.color; ctx.lineWidth = lw; ctx.stroke();
    angle += sweep;
  }

  ctx.fillStyle = '#1a1a1a';
  ctx.font = `700 ${size * 0.16}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(avgLabel || '--', cx, cy - size * 0.02);
  ctx.fillStyle = '#9ca3af';
  ctx.font = `500 ${size * 0.07}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.fillText('AVG STRESS', cx, cy + size * 0.12);
}

// ── Readiness summary logic ──────────────────────────────────

function computeReadinessSummary(sleepScore, bbCurrent, hrvStatus) {
  let score = 0;
  if (sleepScore >= 70) score += 2; else if (sleepScore >= 40) score += 1;
  if (bbCurrent >= 60) score += 2; else if (bbCurrent >= 30) score += 1;
  const hrvLower = (hrvStatus || '').toLowerCase();
  if (hrvLower === 'balanced' || hrvLower === 'above_baseline') score += 2;
  else if (hrvLower === 'below_baseline' || hrvLower === 'low') score += 0;
  else score += 1;

  if (score >= 5) return 'Fully recovered. Great day for a hard session.';
  if (score >= 3) return 'Moderate recovery. Keep intensity in check.';
  return 'Recovery is low. Consider an easy day or rest.';
}

function gaugeColor(val, thresholds = [70, 40]) {
  if (val >= thresholds[0]) return '#10b981';
  if (val >= thresholds[1]) return '#f59e0b';
  return '#ef4444';
}

// ── State machine ────────────────────────────────────────────

function showState(name, opts = {}) {
  hideErrorBanner();
  switch (name) {
    case 'not-signed-in':
      dashboardContent.style.display = 'none'; emptyState.style.display = 'block';
      emptyState.querySelector('p').textContent = 'Sign in to view your Garmin health dashboard.';
      if (connectBtn) connectBtn.style.display = 'none'; hideStatusBar(); break;
    case 'not-connected':
      dashboardContent.style.display = 'none'; emptyState.style.display = 'block';
      emptyState.querySelector('p').textContent = 'Connect your Garmin account to see your readiness dashboard.';
      if (connectBtn) connectBtn.style.display = ''; hideStatusBar(); break;
    case 'pending':
      emptyState.style.display = 'none'; dashboardContent.classList.add('visible'); dashboardContent.style.display = '';
      updateStatusBar('pending'); break;
    case 'active':
      emptyState.style.display = 'none'; dashboardContent.classList.add('visible'); dashboardContent.style.display = '';
      updateStatusBar('active', opts.lastSyncAt); break;
    case 'error':
      updateStatusBar('error');
      const actionLabel = opts.authError ? 'Reconnect' : 'Retry Sync';
      const actionFn = opts.authError
        ? () => { hideErrorBanner(); garminModal.classList.add('visible'); }
        : () => { hideErrorBanner(); syncBtn.click(); };
      showErrorBanner(opts.message || 'An error occurred.', actionLabel, actionFn);
      emptyState.style.display = 'none'; dashboardContent.classList.add('visible'); dashboardContent.style.display = ''; break;
    case 'network-error':
      dashboardContent.style.display = 'none'; emptyState.style.display = 'none'; hideStatusBar();
      showErrorBanner(opts.message || 'Unable to load. Check your connection.', 'Retry', () => { hideErrorBanner(); refreshDashboard(); }); break;
  }
}

// ── Dashboard rendering ──────────────────────────────────────

async function refreshDashboard() {
  const currentUser = authUI.getCurrentUser();
  if (!currentUser) { showState('not-signed-in'); return; }

  // Show skeletons
  emptyState.style.display = 'none';
  dashboardContent.classList.add('visible');
  dashboardContent.style.display = '';
  drawSkeletonGauge(document.getElementById('sleepGauge'));
  drawSkeletonGauge(document.getElementById('bbGauge'));

  // Connection check
  let status;
  try { status = await garmin.getGarminStatus(); }
  catch (err) { showState('network-error', { message: `Unable to load: ${err.message}` }); return; }
  if (!status) { showState('not-connected'); return; }

  const isAuthError = status.status === 'error' && status.error_message && /auth|login|credential|password|token/i.test(status.error_message);
  if (status.status === 'error') showState('error', { message: status.error_message, authError: isAuthError });
  else if (status.status === 'pending') showState('pending');

  let lastSyncAt = status.last_sync_at;
  try { const st = await garmin.getLastSyncTime(); if (st) lastSyncAt = st; } catch { /* ok */ }
  if (status.status === 'active') showState('active', { lastSyncAt });

  // ── Fetch all data in parallel ──
  const [sleep, hrv, daily, spo2, resp, activities, bodyComp, dailyTrend] = await Promise.all([
    garmin.getSleepDetailed().catch(() => null),
    garmin.getHrvTrend(14).catch(() => []),
    garmin.getDailySummaryDetailed().catch(() => null),
    garmin.getSpo2().catch(() => null),
    garmin.getRespiration().catch(() => null),
    garmin.getRecentActivities(5).catch(() => []),
    garmin.getBodyCompositionTrend(30).catch(() => []),
    garmin.getDailyTrend(14).catch(() => []),
  ]);

  // ── 1. Readiness Hero ──
  const sleepScore = sleep?.sleep_score ?? 0;
  drawArcGauge(document.getElementById('sleepGauge'), sleepScore, 100, gaugeColor(sleepScore), '');

  const bbVal = daily?.bb_current ?? 0;
  drawArcGauge(document.getElementById('bbGauge'), bbVal, 100, gaugeColor(bbVal, [60, 30]), '');

  const latestHrv = hrv.length ? hrv[hrv.length - 1] : null;
  const hrvVal = latestHrv?.last_night_avg ?? latestHrv?.weekly_avg;
  const hrvStatusStr = latestHrv?.status || '';
  document.getElementById('hrvValue').textContent = hrvVal != null ? Math.round(hrvVal) : '--';
  const hrvBadge = document.getElementById('hrvBadge');
  const hrvLower = hrvStatusStr.toLowerCase();
  hrvBadge.textContent = hrvStatusStr.replace(/_/g, ' ') || '--';
  hrvBadge.className = `hrv-badge ${hrvLower === 'balanced' ? 'balanced' : hrvLower.includes('low') ? 'low' : 'high'}`;
  if (latestHrv?.baseline_low != null && latestHrv?.baseline_upper != null) {
    document.getElementById('hrvBaseline').textContent = `Baseline: ${Math.round(latestHrv.baseline_low)}–${Math.round(latestHrv.baseline_upper)} ms`;
  }

  document.getElementById('readinessSummary').textContent = computeReadinessSummary(sleepScore, bbVal, hrvStatusStr);

  // ── 2. Recent Activity ──
  const activityList = document.getElementById('activityList');
  const activityStreak = document.getElementById('activityStreak');
  if (activities.length) {
    activityList.innerHTML = activities.slice(0, 3).map(a => `
      <div class="activity-item">
        <div class="activity-icon">${activityIcon(a.activity_type)}</div>
        <div class="activity-info">
          <div class="activity-name">${a.name || a.activity_type}</div>
          <div class="activity-stats">
            <span>${fmtMiles(a.distance_meters)}</span>
            <span>${fmtDuration(a.duration_seconds)}</span>
            <span>${a.avg_heart_rate ? a.avg_heart_rate + ' bpm' : ''}</span>
            <span>${fmtPace(a.duration_seconds, a.distance_meters)}</span>
          </div>
        </div>
        <div class="activity-ago">${timeAgo(a.start_time || a.date + 'T12:00:00Z')}</div>
      </div>
    `).join('');

    // 7-day streak
    const today = new Date();
    const streakDots = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const ds = d.toISOString().split('T')[0];
      const had = activities.some(a => a.date === ds);
      streakDots.push(`<div class="streak-dot ${had ? 'active' : 'rest'}" title="${ds}"></div>`);
    }
    activityStreak.innerHTML = streakDots.join('') + '<span class="streak-label">Last 7 days</span>';
  } else {
    activityList.innerHTML = '<div class="card-error">No recent activities</div>';
    activityStreak.innerHTML = '';
  }

  // ── 3. Daily Stats ──
  const stepGoal = daily?.step_goal || 10000;
  const intGoal = daily?.intensity_goal || 150;
  const flrGoal = daily?.floors_goal || 10;

  document.getElementById('qSteps').textContent = daily?.steps?.toLocaleString() ?? '--';
  document.getElementById('qStepsGoal').textContent = stepGoal.toLocaleString();
  document.getElementById('stepsProgressFill').style.width = `${Math.min((daily?.steps || 0) / stepGoal * 100, 100)}%`;

  document.getElementById('qIntensity').textContent = daily?.intensity_minutes ?? '--';
  document.getElementById('qIntensityGoal').textContent = intGoal;
  document.getElementById('intensityProgressFill').style.width = `${Math.min((daily?.intensity_minutes || 0) / intGoal * 100, 100)}%`;

  document.getElementById('qFloors').textContent = daily?.floors_climbed ?? '--';
  document.getElementById('qFloorsGoal').textContent = flrGoal;
  document.getElementById('floorsProgressFill').style.width = `${Math.min((daily?.floors_climbed || 0) / flrGoal * 100, 100)}%`;

  document.getElementById('qHR').textContent = daily?.resting_heart_rate ?? '--';
  document.getElementById('qHR7d').textContent = daily?.rhr_7d_avg ? `7d avg: ${daily.rhr_7d_avg}` : '';
  document.getElementById('qActiveCal').textContent = daily?.calories_active?.toLocaleString() ?? '--';
  document.getElementById('qTotalCal').textContent = daily?.calories_total ? `${daily.calories_total.toLocaleString()} total` : '';
  document.getElementById('qSpo2').textContent = spo2?.avg_spo2 ? `${Math.round(spo2.avg_spo2)}%` : '--';
  document.getElementById('qResp').textContent = resp?.avg_waking ? Math.round(resp.avg_waking) : '--';

  // ── 4. Sleep ──
  document.getElementById('sleepTotal').textContent = fmtDuration(sleep?.total_sleep_seconds);
  drawSleepBar(document.getElementById('sleepBar'), sleep?.deep_seconds, sleep?.light_seconds, sleep?.rem_seconds, sleep?.awake_seconds);
  document.getElementById('sleepDeep').textContent = fmtDuration(sleep?.deep_seconds);
  document.getElementById('sleepLight').textContent = fmtDuration(sleep?.light_seconds);
  document.getElementById('sleepRem').textContent = fmtDuration(sleep?.rem_seconds);
  document.getElementById('sleepAwake').textContent = fmtDuration(sleep?.awake_seconds);
  document.getElementById('scoreOverall').textContent = sleep?.sleep_score ?? '--';
  document.getElementById('scoreResp').textContent = sleep?.avg_respiration ? Math.round(sleep.avg_respiration) : (resp?.avg_sleeping ? Math.round(resp.avg_sleeping) : '--');
  document.getElementById('scoreSpo2').textContent = sleep?.avg_spo2 ? `${Math.round(sleep.avg_spo2)}%` : (spo2?.avg_spo2 ? `${Math.round(spo2.avg_spo2)}%` : '--');
  document.getElementById('scoreDuration').textContent = fmtDuration(sleep?.total_sleep_seconds);

  // ── 5. Trends ──
  const hrvMapped = (hrv || []).map(d => ({ ...d, baseline_high: d.baseline_upper }));
  drawSparkline(document.getElementById('hrvChart'), hrvMapped, {
    valueKey: 'last_night_avg', color: '#10b981', bandLow: 'baseline_low', bandHigh: 'baseline_high', emptyMsg: 'No HRV data yet',
  });

  drawSparkline(document.getElementById('rhrChart'), dailyTrend, {
    valueKey: 'resting_heart_rate', color: '#ef4444', emptyMsg: 'No HR data yet',
  });

  drawSparkline(document.getElementById('weightChart'), bodyComp, {
    valueKey: 'weight_kg', color: '#6366f1', emptyMsg: 'No weight data',
  });

  drawSparkline(document.getElementById('bodyFatChart'), bodyComp, {
    valueKey: 'body_fat_pct', color: '#f59e0b', emptyMsg: 'No body fat data',
  });

  // ── 6. Stress ──
  const stressAvgEl = document.getElementById('stressAvgValue');
  if (stressAvgEl) stressAvgEl.dataset.value = daily?.stress_avg ?? '--';
  const restS = daily?.rest_stress_duration, lowS = daily?.low_stress_duration;
  const medS = daily?.medium_stress_duration, highS = daily?.high_stress_duration;
  drawStressDonut(document.getElementById('stressDonut'), restS, lowS, medS, highS, daily?.stress_avg ?? '--');

  document.getElementById('stressRest').textContent = restS != null ? fmtDuration(restS) : '--';
  document.getElementById('stressLow').textContent = lowS != null ? fmtDuration(lowS) : '--';
  document.getElementById('stressMed').textContent = medS != null ? fmtDuration(medS) : '--';
  document.getElementById('stressHigh').textContent = highS != null ? fmtDuration(highS) : '--';

  // ── 7. Training Log ──
  const tbody = document.getElementById('trainingBody');
  if (activities.length) {
    tbody.innerHTML = activities.map(a => {
      const d = new Date(a.date + 'T00:00:00');
      const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
      const label = a.name || a.activity_type;
      return `<tr>
        <td>${activityIcon(a.activity_type)} ${label}<br><span style="font-size:0.65rem;color:var(--text-muted)">${dateStr}</span></td>
        <td>${fmtMiles(a.distance_meters)}</td>
        <td>${fmtDuration(a.duration_seconds)}</td>
        <td>${a.avg_heart_rate ?? '--'}</td>
        <td>${a.calories ?? '--'}</td>
      </tr>`;
    }).join('');
  } else {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px">No activities recorded</td></tr>';
  }
}

// ── Init ─────────────────────────────────────────────────────

async function init() {
  if (isSupabaseConfigured() && authSection) {
    authSection.classList.remove('hidden');
    onAuthStateChange(async (user) => { authUI.updateAuthUI(user); refreshDashboard(); });
    try {
      const user = await getUser();
      if (user && !authUI.getCurrentUser()) { authUI.updateAuthUI(user); refreshDashboard(); }
    } catch { /* session check failed */ }
  }
}

init();
