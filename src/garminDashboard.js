// Garmin Readiness Dashboard — premium health intelligence layout
import { isSupabaseConfigured } from './supabase.js';
import { onAuthStateChange, getUser } from './auth.js';
import { createAuthUI } from './authUI.js';
import * as garmin from './garmin.js';
import { initProfilePanel } from './userProfileUI.js';

// ── Helpers ──────────────────────────────────────────────────

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ── DOM refs ─────────────────────────────────────────────────

const authSection = document.getElementById('authSection');
const authUI = createAuthUI();
initProfilePanel(authUI);

const dashboardContent = document.getElementById('dashboardContent');
const emptyState = document.getElementById('emptyState');
const connectBtn = document.getElementById('connectGarminBtn');
const garminModal = document.getElementById('garminModal');
const garminEmailInput = document.getElementById('garminEmail');
const garminPasswordInput = document.getElementById('garminPassword');
const garminSubmit = document.getElementById('garminSubmit');
const garminCancel = document.getElementById('garminCancel');
const garminError = document.getElementById('garminError');

const syncPill = document.getElementById('syncPill');
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

if (connectBtn) connectBtn.addEventListener('click', () => {
  garminEmailInput.value = ''; garminPasswordInput.value = ''; garminError.textContent = '';
  garminModal.classList.add('visible');
});
if (garminCancel) garminCancel.addEventListener('click', () => garminModal.classList.remove('visible'));
if (garminModal) garminModal.addEventListener('click', (e) => { if (e.target === garminModal) garminModal.classList.remove('visible'); });

if (garminSubmit) {
  garminSubmit.addEventListener('click', async () => {
    const email = garminEmailInput.value.trim();
    const password = garminPasswordInput.value;
    if (!email || !password) { garminError.textContent = 'Please enter your Garmin credentials.'; return; }
    garminError.textContent = ''; garminSubmit.disabled = true; garminSubmit.textContent = 'Connecting...';
    try { await garmin.connectGarmin(email, password); garminModal.classList.remove('visible'); refreshDashboard(); }
    catch (err) { garminError.textContent = err.message; }
    garminSubmit.disabled = false; garminSubmit.textContent = 'Connect';
  });
}

// ── Error banner ─────────────────────────────────────────────

if (errorDismiss) errorDismiss.addEventListener('click', () => hideErrorBanner());
function showErrorBanner(message, actionLabel, actionFn) {
  errorMsg.textContent = message; errorAction.textContent = actionLabel; errorAction.onclick = actionFn;
  errorBanner.classList.add('visible');
}
function hideErrorBanner() { errorBanner.classList.remove('visible'); }

// ── Sync pill ────────────────────────────────────────────────

function updateSyncPill(state, lastSyncIso) {
  syncPill.style.display = '';
  const dotMap = { active: 'active', pending: 'pending', syncing: 'syncing', sync_requested: 'syncing', error: 'error' };
  statusDot.className = `sync-pill-dot ${dotMap[state] || ''}`;
  const labels = {
    active: lastSyncIso ? `Connected — synced ${timeAgo(lastSyncIso)}` : 'Connected',
    pending: 'Waiting for first sync',
    syncing: 'Syncing...', sync_requested: 'Sync requested...',
    error: 'Connection error',
  };
  statusText.textContent = labels[state] || state;
  syncBtn.style.display = (state === 'active' || state === 'pending') ? '' : 'none';
  disconnectBtn.style.display = (state === 'active' || state === 'pending' || state === 'error') ? '' : 'none';
}
function hideSyncPill() { syncPill.style.display = 'none'; }

// ── Sync button ──────────────────────────────────────────────

let syncPollTimer = null;
if (syncBtn) {
  syncBtn.addEventListener('click', async () => {
    syncBtn.disabled = true; syncBtn.textContent = 'Syncing...';
    statusDot.className = 'sync-pill-dot syncing';
    try {
      await garmin.requestSync();
      syncBtn.textContent = 'Done!'; syncBtn.style.color = '#4ADE80';
      setTimeout(() => { syncBtn.textContent = 'Sync'; syncBtn.style.color = ''; syncBtn.disabled = false; }, 2000);
      let pollCount = 0;
      clearInterval(syncPollTimer);
      syncPollTimer = setInterval(async () => {
        pollCount++;
        if (pollCount >= 6) { clearInterval(syncPollTimer); return; }
        try { const s = await garmin.getGarminStatus(); if (s && s.status === 'active') { clearInterval(syncPollTimer); refreshDashboard(); } } catch {}
      }, 10000);
    } catch (err) {
      syncBtn.textContent = 'Sync'; syncBtn.disabled = false;
      statusDot.className = 'sync-pill-dot active';
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

// ── Time helpers ─────────────────────────────────────────────

function timeAgo(iso) {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now'; if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`; return `${Math.floor(hrs / 24)}d ago`;
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
  const labels = { running: 'RUN', resort_skiing: 'SKI', cycling: 'BIKE', swimming: 'SWIM', hiking: 'HIKE', walking: 'WALK', strength_training: 'STR' };
  return labels[type] || type?.substring(0, 3)?.toUpperCase() || '—';
}

// ── SVG Dial rendering ───────────────────────────────────────

// Arc circumference for 270° arc on r=40: 2π×40 × (270/360) = 188.5
const ARC_LENGTH = 2 * Math.PI * 40 * (270 / 360); // ≈188.5

function setDial(fillId, valId, descriptorId, value, max, thresholds = [70, 40]) {
  const fill = document.getElementById(fillId);
  const valEl = document.getElementById(valId);
  const descEl = document.getElementById(descriptorId);
  if (!fill || !valEl) return;

  const pct = Math.min(value / max, 1);
  const color = gaugeColor(value, thresholds);
  const offset = ARC_LENGTH * (1 - pct);

  fill.setAttribute('stroke', color);
  // Start at full offset, then animate to target
  fill.style.strokeDasharray = ARC_LENGTH;
  fill.style.strokeDashoffset = ARC_LENGTH;
  requestAnimationFrame(() => {
    fill.style.strokeDashoffset = offset;
  });

  valEl.textContent = value || '--';
  valEl.setAttribute('fill', color);

  if (descEl) {
    let label, labelColor;
    if (value >= thresholds[0]) { label = 'Excellent'; labelColor = '#4ADE80'; }
    else if (value >= thresholds[1]) { label = 'Moderate'; labelColor = '#FACC15'; }
    else { label = 'Low'; labelColor = '#F87171'; }
    descEl.textContent = label;
    descEl.style.color = labelColor;
  }
}

function gaugeColor(val, thresholds = [70, 40]) {
  if (val >= thresholds[0]) return '#4ADE80';
  if (val >= thresholds[1]) return '#FACC15';
  return '#F87171';
}

// ── Readiness summary ────────────────────────────────────────

function computeReadinessSummary(sleepScore, bbCurrent, hrvStatus) {
  let score = 0;
  if (sleepScore >= 70) score += 2; else if (sleepScore >= 40) score += 1;
  if (bbCurrent >= 60) score += 2; else if (bbCurrent >= 30) score += 1;
  const hrvLower = (hrvStatus || '').toLowerCase();
  if (hrvLower === 'balanced' || hrvLower === 'above_baseline') score += 2;
  else if (hrvLower === 'below_baseline' || hrvLower === 'low') score += 0;
  else score += 1;

  if (score >= 5) return "You're well-recovered. A moderate to hard effort is appropriate today.";
  if (score >= 3) return 'Moderate recovery. Keep intensity in check and listen to your body.';
  return 'Recovery is low. Consider an easy day or active rest.';
}

// ── Canvas: Sparkline (with glow) ────────────────────────────

function drawSparkline(canvas, data, { valueKey, color = '#4ADE80', bandLow, bandHigh, emptyMsg = 'No data', sharedDomain } = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  const values = data.map(d => d[valueKey]).filter(v => v != null);
  if (!values.length) {
    ctx.fillStyle = '#555555';
    ctx.font = "500 11px 'DM Sans', sans-serif";
    ctx.textAlign = 'center'; ctx.fillText(emptyMsg, w / 2, h / 2);
    return;
  }

  const pad = { top: 10, right: 8, bottom: 22, left: 32 };
  const cw = w - pad.left - pad.right, ch = h - pad.top - pad.bottom;

  let allVals = [...values];
  if (bandLow) allVals.push(...data.map(d => d[bandLow]).filter(v => v != null));
  if (bandHigh) allVals.push(...data.map(d => d[bandHigh]).filter(v => v != null));
  const minV = Math.floor(Math.min(...allVals) * 0.92);
  const maxV = Math.ceil(Math.max(...allVals) * 1.08);
  const range = maxV - minV || 1;

  const domain = sharedDomain || data.map(d => d.date);
  const domainLen = domain.length;
  const dateIndexMap = new Map(domain.map((d, i) => [d, i]));
  const xStep = domainLen > 1 ? cw / (domainLen - 1) : cw / 2;
  const toX = (dateStr) => { const idx = dateIndexMap.get(dateStr); return idx != null ? pad.left + idx * xStep : null; };
  const toY = v => pad.top + ch - ((v - minV) / range) * ch;

  // Baseline — single subtle horizontal line at mid
  const midY = pad.top + ch / 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad.left, midY); ctx.lineTo(pad.left + cw, midY); ctx.stroke();

  // Band (confidence interval)
  if (bandLow && bandHigh) {
    ctx.fillStyle = `${color}12`;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const v = data[i][bandHigh]; if (v == null) continue;
      const x = toX(data[i].date); if (x == null) continue; ctx.lineTo(x, toY(v));
    }
    for (let i = data.length - 1; i >= 0; i--) {
      const v = data[i][bandLow]; if (v == null) continue;
      const x = toX(data[i].date); if (x == null) continue; ctx.lineTo(x, toY(v));
    }
    ctx.closePath(); ctx.fill();
  }

  // Area fill under line
  ctx.beginPath();
  let firstX = null, lastX = null;
  for (let i = 0; i < data.length; i++) {
    const v = data[i][valueKey]; if (v == null) continue;
    const x = toX(data[i].date); if (x == null) continue;
    if (firstX == null) { firstX = x; ctx.moveTo(x, toY(v)); } else ctx.lineTo(x, toY(v));
    lastX = x;
  }
  if (firstX != null) {
    ctx.lineTo(lastX, pad.top + ch);
    ctx.lineTo(firstX, pad.top + ch);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch);
    grad.addColorStop(0, `${color}26`);
    grad.addColorStop(1, `${color}00`);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // Glowing line
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 4;
  ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  let started = false;
  for (let i = 0; i < data.length; i++) {
    const v = data[i][valueKey]; if (v == null) continue;
    const x = toX(data[i].date); if (x == null) continue;
    if (!started) { ctx.moveTo(x, toY(v)); started = true; } else ctx.lineTo(x, toY(v));
  }
  ctx.stroke();
  ctx.restore();

  // Dots
  for (let i = 0; i < data.length; i++) {
    const v = data[i][valueKey]; if (v == null) continue;
    const x = toX(data[i].date); if (x == null) continue;
    ctx.beginPath(); ctx.arc(x, toY(v), 2.5, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
  }

  // X labels
  ctx.fillStyle = '#555555'; ctx.font = "400 9px 'JetBrains Mono', monospace"; ctx.textAlign = 'center';
  const every = Math.max(1, Math.floor(domainLen / 5));
  for (let i = 0; i < domainLen; i += every) {
    const d = new Date(domain[i] + 'T00:00:00');
    ctx.fillText(`${d.getMonth() + 1}/${d.getDate()}`, pad.left + i * xStep, h - 4);
  }

  // Y labels
  ctx.textAlign = 'right';
  ctx.fillText(maxV, pad.left - 4, pad.top + 8);
  ctx.fillText(minV, pad.left - 4, pad.top + ch + 4);
}

// ── Sleep bar (HTML segments instead of canvas) ──────────────

function renderSleepBar(deep, light, rem, awake) {
  const bar = document.getElementById('sleepStageBar');
  const total = (deep || 0) + (light || 0) + (rem || 0) + (awake || 0);
  if (total === 0) { bar.innerHTML = ''; return; }
  bar.innerHTML = [
    { val: deep, cls: 'deep' }, { val: light, cls: 'light' },
    { val: rem, cls: 'rem' }, { val: awake, cls: 'awake' },
  ].filter(s => s.val > 0).map(s =>
    `<div class="sleep-seg ${s.cls}" style="width:${(s.val / total * 100).toFixed(1)}%"></div>`
  ).join('');
}

// ── Stress donut (SVG segments) ──────────────────────────────

function renderStressDonut(rest, low, med, high, avgLabel) {
  const svg = document.getElementById('stressSvg');
  const textEl = document.getElementById('stressAvgText');
  textEl.textContent = avgLabel || '--';

  const total = (rest || 0) + (low || 0) + (med || 0) + (high || 0);
  if (total === 0) return;

  // Remove old segments
  svg.querySelectorAll('.stress-seg').forEach(el => el.remove());

  const r = 38, circ = 2 * Math.PI * r;
  const gap = 4; // gap in px between segments
  const segs = [
    { val: rest, color: '#34d399' }, { val: low, color: '#60a5fa' },
    { val: med, color: '#fbbf24' }, { val: high, color: '#f87171' },
  ].filter(s => s.val > 0);

  const totalGap = segs.length * gap;
  const usable = circ - totalGap;

  let offset = circ * 0.25; // start at top
  for (const seg of segs) {
    const len = (seg.val / total) * usable;
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('class', 'stress-seg');
    circle.setAttribute('cx', '50'); circle.setAttribute('cy', '50'); circle.setAttribute('r', String(r));
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', seg.color);
    circle.setAttribute('stroke-width', '10');
    circle.setAttribute('stroke-linecap', 'round');
    circle.setAttribute('stroke-dasharray', `${len} ${circ - len}`);
    circle.setAttribute('stroke-dashoffset', String(offset));
    svg.insertBefore(circle, svg.querySelector('text'));
    offset -= len + gap;
  }
}

// ── Activity chart (for detail view) ─────────────────────────

function drawActivityChart(canvas, samples, { color, fillColor, unit, label, invertY = false, areaFill = false, durationSeconds = 0 } = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  if (!samples || !samples.length) {
    ctx.fillStyle = '#555555'; ctx.font = "500 11px 'DM Sans', sans-serif";
    ctx.textAlign = 'center'; ctx.fillText(`No ${label} data`, w / 2, h / 2); return;
  }

  const pad = { top: 6, right: 8, bottom: 20, left: 36 };
  const cw = w - pad.left - pad.right, ch = h - pad.top - pad.bottom;
  const values = samples.map(s => s.v);
  let minV = Math.min(...values), maxV = Math.max(...values);
  const rangePad = (maxV - minV) * 0.08 || 1;
  minV = Math.floor(minV - rangePad); maxV = Math.ceil(maxV + rangePad);
  const range = maxV - minV || 1;
  const toX = (i) => pad.left + (i / (samples.length - 1)) * cw;
  const toY = (v) => { const n = (v - minV) / range; return invertY ? pad.top + n * ch : pad.top + ch - n * ch; };

  // Area fill
  if (areaFill || fillColor) {
    ctx.beginPath();
    ctx.moveTo(toX(0), invertY ? pad.top : pad.top + ch);
    for (let i = 0; i < samples.length; i++) ctx.lineTo(toX(i), toY(samples[i].v));
    ctx.lineTo(toX(samples.length - 1), invertY ? pad.top : pad.top + ch);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch);
    grad.addColorStop(0, `${color}26`); grad.addColorStop(1, `${color}00`);
    ctx.fillStyle = grad; ctx.fill();
  }

  // Glowing line
  ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = 4;
  ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
  for (let i = 0; i < samples.length; i++) {
    const x = toX(i), y = toY(samples[i].v);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke(); ctx.restore();

  // Y labels
  ctx.fillStyle = '#555555'; ctx.font = "400 9px 'JetBrains Mono', monospace"; ctx.textAlign = 'right';
  ctx.fillText(maxV, pad.left - 4, invertY ? pad.top + ch + 4 : pad.top + 6);
  ctx.fillText(minV, pad.left - 4, invertY ? pad.top + 6 : pad.top + ch + 4);

  // X labels (time)
  ctx.textAlign = 'center';
  const totalDur = durationSeconds || samples[samples.length - 1].t;
  for (let i = 0; i <= 5; i++) {
    const frac = i / 5, secs = totalDur * frac, mins = Math.floor(secs / 60);
    const x = pad.left + frac * cw;
    ctx.fillText(totalDur >= 3600 ? `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}` : `${mins}m`, x, h - 4);
  }
}

// ── State machine ────────────────────────────────────────────

function showState(name, opts = {}) {
  hideErrorBanner();
  switch (name) {
    case 'not-signed-in':
      dashboardContent.style.display = 'none'; emptyState.style.display = 'block';
      emptyState.querySelector('p').textContent = 'Sign in to view your Garmin health dashboard.';
      if (connectBtn) connectBtn.style.display = 'none'; hideSyncPill(); break;
    case 'not-connected':
      dashboardContent.style.display = 'none'; emptyState.style.display = 'block';
      emptyState.querySelector('p').textContent = 'Connect your Garmin account to see your readiness dashboard.';
      if (connectBtn) connectBtn.style.display = ''; hideSyncPill(); break;
    case 'pending':
      emptyState.style.display = 'none'; dashboardContent.classList.add('visible'); dashboardContent.style.display = '';
      updateSyncPill('pending'); break;
    case 'active':
      emptyState.style.display = 'none'; dashboardContent.classList.add('visible'); dashboardContent.style.display = '';
      updateSyncPill('active', opts.lastSyncAt); break;
    case 'error':
      updateSyncPill('error');
      const actionLabel = opts.authError ? 'Reconnect' : 'Retry Sync';
      const actionFn = opts.authError
        ? () => { hideErrorBanner(); garminModal.classList.add('visible'); }
        : () => { hideErrorBanner(); syncBtn.click(); };
      showErrorBanner(opts.message || 'An error occurred.', actionLabel, actionFn);
      emptyState.style.display = 'none'; dashboardContent.classList.add('visible'); dashboardContent.style.display = ''; break;
    case 'network-error':
      dashboardContent.style.display = 'none'; emptyState.style.display = 'none'; hideSyncPill();
      showErrorBanner(opts.message || 'Unable to load. Check your connection.', 'Retry', () => { hideErrorBanner(); refreshDashboard(); }); break;
  }
}

// ── Dashboard rendering ──────────────────────────────────────

async function refreshDashboard() {
  const currentUser = authUI.getCurrentUser();
  if (!currentUser) { showState('not-signed-in'); return; }

  emptyState.style.display = 'none';
  dashboardContent.classList.add('visible');
  dashboardContent.style.display = '';

  let status;
  try { status = await garmin.getGarminStatus(); }
  catch (err) { showState('network-error', { message: `Unable to load: ${err.message}` }); return; }
  if (!status) { showState('not-connected'); return; }

  const isAuthError = status.status === 'error' && status.error_message && /auth|login|credential|password|token/i.test(status.error_message);
  if (status.status === 'error') showState('error', { message: status.error_message, authError: isAuthError });
  else if (status.status === 'pending') showState('pending');

  let lastSyncAt = status.last_sync_at;
  try { const st = await garmin.getLastSyncTime(); if (st) lastSyncAt = st; } catch {}
  if (status.status === 'active') showState('active', { lastSyncAt });

  // ── Fetch all data in parallel ──
  const [sleep, hrv, daily, resp, activities, bodyComp, dailyTrend] = await Promise.all([
    garmin.getSleepDetailed().catch(() => null),
    garmin.getHrvTrend(14).catch(() => []),
    garmin.getDailySummaryDetailed().catch(() => null),
    garmin.getRespiration().catch(() => null),
    garmin.getRecentActivities(5).catch(() => []),
    garmin.getBodyCompositionTrend(30).catch(() => []),
    garmin.getDailyTrend(14).catch(() => []),
  ]);

  // ── 1. Three Dials ──
  const sleepScore = sleep?.sleep_score ?? 0;
  setDial('sleepDialFill', 'sleepDialVal', 'sleepDescriptor', sleepScore, 100, [70, 40]);

  const bbVal = daily?.bb_current ?? 0;
  setDial('bbDialFill', 'bbDialVal', 'bbDescriptor', bbVal, 100, [60, 30]);

  const latestHrv = hrv.length ? hrv[hrv.length - 1] : null;
  const hrvVal = latestHrv?.last_night_avg ?? latestHrv?.weekly_avg;
  const hrvStatusStr = latestHrv?.status || '';
  const hrvNum = hrvVal != null ? Math.round(hrvVal) : 0;
  const hrvHigh = latestHrv?.baseline_upper || 70;
  const hrvLow = latestHrv?.baseline_low || 40;

  // HRV range visualization — position marker on the range bar
  const hrvValEl = document.getElementById('hrvDialVal');
  const hrvMarker = document.getElementById('hrvMarker');
  const hrvRangeLow = document.getElementById('hrvRangeLow');
  const hrvRangeHigh = document.getElementById('hrvRangeHigh');

  if (hrvValEl) hrvValEl.textContent = hrvNum || '--';
  if (hrvRangeLow) hrvRangeLow.textContent = Math.round(hrvLow);
  if (hrvRangeHigh) hrvRangeHigh.textContent = Math.round(hrvHigh);

  if (hrvMarker && hrvNum > 0) {
    // Map HRV value to 0-100% position on the bar
    // Range spans from hrvLow * 0.5 to hrvHigh * 1.5
    const barMin = Math.round(hrvLow * 0.5);
    const barMax = Math.round(hrvHigh * 1.5);
    const pct = Math.min(100, Math.max(0, ((hrvNum - barMin) / (barMax - barMin)) * 100));
    hrvMarker.style.left = `${pct}%`;
    // Color marker based on status
    const hrvLower = hrvStatusStr.toLowerCase();
    if (hrvLower === 'balanced') hrvMarker.style.background = '#4ADE80';
    else if (hrvLower.includes('above') || hrvLower.includes('high')) hrvMarker.style.background = '#60A5FA';
    else if (hrvLower.includes('low') || hrvLower.includes('below')) hrvMarker.style.background = '#FACC15';
    else hrvMarker.style.background = 'var(--text-secondary)';
  }

  // HRV descriptor uses status text
  const hrvDescriptor = document.getElementById('hrvDescriptor');
  const hrvLower = hrvStatusStr.toLowerCase();
  if (hrvLower === 'balanced') { hrvDescriptor.textContent = 'Balanced'; hrvDescriptor.style.color = '#4ADE80'; }
  else if (hrvLower.includes('above')) { hrvDescriptor.textContent = 'Above Baseline'; hrvDescriptor.style.color = '#60A5FA'; }
  else if (hrvLower.includes('low') || hrvLower.includes('below')) { hrvDescriptor.textContent = 'Below Baseline'; hrvDescriptor.style.color = '#FACC15'; }
  else { hrvDescriptor.textContent = hrvStatusStr.replace(/_/g, ' ') || '--'; }

  // Readiness summary
  document.getElementById('readinessSummary').textContent = computeReadinessSummary(sleepScore, bbVal, hrvStatusStr);

  // ── 2. Metric Cards ──
  const stepGoal = daily?.step_goal || 10000;
  const intGoal = daily?.intensity_goal;
  const flrGoal = daily?.floors_goal || 10;

  document.getElementById('qSteps').textContent = daily?.steps?.toLocaleString() ?? '--';
  document.getElementById('qStepsGoalSub').textContent = daily?.steps ? `of ${stepGoal.toLocaleString()}` : '';
  document.getElementById('qIntensity').textContent = daily?.intensity_minutes ?? '--';
  document.getElementById('qIntensityGoalSub').textContent = intGoal ? `of ${intGoal}` : '';
  document.getElementById('qFloors').textContent = daily?.floors_climbed ?? '--';
  document.getElementById('qFloorsGoalSub').textContent = daily?.floors_climbed ? `of ${flrGoal}` : '';
  document.getElementById('qHR').textContent = daily?.resting_heart_rate ?? '--';
  document.getElementById('qHR7d').textContent = daily?.rhr_7d_avg ? `7d avg: ${daily.rhr_7d_avg}` : '';
  document.getElementById('qActiveCal').textContent = daily?.calories_active?.toLocaleString() ?? '--';
  document.getElementById('qTotalCal').textContent = daily?.calories_total ? `${daily.calories_total.toLocaleString()} total` : '';
  document.getElementById('qResp').textContent = resp?.avg_waking ? Math.round(resp.avg_waking) : '--';

  // ── 3. Sleep ──
  document.getElementById('sleepTotal').textContent = fmtDuration(sleep?.total_sleep_seconds);
  renderSleepBar(sleep?.deep_seconds, sleep?.light_seconds, sleep?.rem_seconds, sleep?.awake_seconds);
  document.getElementById('sleepDeep').textContent = fmtDuration(sleep?.deep_seconds);
  document.getElementById('sleepLight').textContent = fmtDuration(sleep?.light_seconds);
  document.getElementById('sleepRem').textContent = fmtDuration(sleep?.rem_seconds);
  document.getElementById('sleepAwake').textContent = fmtDuration(sleep?.awake_seconds);
  document.getElementById('scoreOverall').textContent = sleep?.sleep_score ?? '--';
  document.getElementById('scoreResp').textContent = sleep?.avg_respiration ? Math.round(sleep.avg_respiration) : (resp?.avg_sleeping ? Math.round(resp.avg_sleeping) : '--');
  document.getElementById('scoreDuration').textContent = fmtDuration(sleep?.total_sleep_seconds);

  // ── 4. Trends (with glow) ──
  const sharedDomain = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    sharedDomain.push(d.toISOString().split('T')[0]);
  }

  const hrvMapped = (hrv || []).map(d => ({ ...d, baseline_high: d.baseline_upper }));
  drawSparkline(document.getElementById('hrvChart'), hrvMapped, {
    valueKey: 'last_night_avg', color: '#4ADE80', bandLow: 'baseline_low', bandHigh: 'baseline_high', emptyMsg: 'No HRV data yet', sharedDomain,
  });
  drawSparkline(document.getElementById('rhrChart'), dailyTrend, {
    valueKey: 'resting_heart_rate', color: '#F87171', emptyMsg: 'No HR data yet', sharedDomain,
  });
  drawSparkline(document.getElementById('weightChart'), bodyComp, {
    valueKey: 'weight_kg', color: '#818CF8', emptyMsg: 'No weight data', sharedDomain,
  });
  drawSparkline(document.getElementById('bodyFatChart'), bodyComp, {
    valueKey: 'body_fat_pct', color: '#FACC15', emptyMsg: 'No body fat data', sharedDomain,
  });

  // ── 5. Stress ──
  const restS = daily?.rest_stress_duration, lowS = daily?.low_stress_duration;
  const medS = daily?.medium_stress_duration, highS = daily?.high_stress_duration;
  renderStressDonut(restS, lowS, medS, highS, daily?.stress_avg ?? '--');
  document.getElementById('stressRest').textContent = restS != null ? fmtDuration(restS) : '--';
  document.getElementById('stressLow').textContent = lowS != null ? fmtDuration(lowS) : '--';
  document.getElementById('stressMed').textContent = medS != null ? fmtDuration(medS) : '--';
  document.getElementById('stressHigh').textContent = highS != null ? fmtDuration(highS) : '--';

  // ── 6. Activity Calendar ──
  const activityCalendar = document.getElementById('activityCalendar');
  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const localDate = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  const todayStr = localDate(new Date());

  const calTiles = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = localDate(d);
    const isToday = ds === todayStr;
    const dayActivities = activities.filter(a => a.date === ds);

    if (dayActivities.length > 0) {
      const a = dayActivities[0];
      const stats = [
        a.duration_seconds ? fmtDuration(a.duration_seconds) : '',
        a.distance_meters ? fmtMiles(a.distance_meters) : '',
        a.avg_heart_rate ? `${a.avg_heart_rate} bpm` : '',
      ].filter(Boolean).join('<br>');
      calTiles.push(`<div class="cal-tile${isToday ? ' is-today' : ''}" data-activity-id="${a.activity_id}" style="cursor:pointer">
        <div class="cal-tile-day">${DAY_LABELS[d.getDay()]}</div><div class="cal-tile-date">${d.getMonth() + 1}/${d.getDate()}</div>
        <div class="cal-tile-icon">${activityIcon(a.activity_type)}</div><div class="cal-tile-name">${esc(a.name || a.activity_type)}</div>
        <div class="cal-tile-stats">${stats}</div></div>`);
    } else {
      calTiles.push(`<div class="cal-tile${isToday ? ' is-today' : ''}">
        <div class="cal-tile-day">${DAY_LABELS[d.getDay()]}</div><div class="cal-tile-date">${d.getMonth() + 1}/${d.getDate()}</div>
        <div class="cal-tile-rest">Rest day</div></div>`);
    }
  }
  activityCalendar.innerHTML = calTiles.join('');

  // ── 7. Training Log ──
  const trainingCard = document.getElementById('trainingCard');
  const tbody = document.getElementById('trainingBody');
  if (activities.length) {
    trainingCard.style.display = '';
    tbody.innerHTML = activities.map(a => {
      const d = new Date(a.date + 'T00:00:00');
      const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
      return `<tr class="activity-row" data-activity-id="${a.activity_id}" style="cursor:pointer">
        <td>${activityIcon(a.activity_type)} ${esc(a.name || a.activity_type)}<br><span style="font-size:9px;font-family:var(--font-mono);color:var(--text-tertiary)">${dateStr}</span></td>
        <td>${fmtMiles(a.distance_meters)}</td><td>${fmtDuration(a.duration_seconds)}</td>
        <td>${a.avg_heart_rate ?? '--'}</td><td>${a.calories ?? '--'}</td></tr>
      <tr class="activity-detail-row" id="detail-${a.activity_id}" style="display:none">
        <td colspan="5" style="padding:0"><div class="activity-detail-panel" id="panel-${a.activity_id}"></div></td></tr>`;
    }).join('');

    tbody.querySelectorAll('.activity-row').forEach(row => {
      row.addEventListener('click', () => toggleActivityDetail(row.dataset.activityId));
    });
  } else {
    trainingCard.style.display = 'none';
  }

  // Calendar tile clicks
  activityCalendar.querySelectorAll('.cal-tile[data-activity-id]').forEach(tile => {
    tile.addEventListener('click', () => {
      const actId = tile.dataset.activityId;
      if (trainingLogContent.style.display === 'none') {
        trainingLogContent.style.display = '';
        trainingLogToggle.classList.add('expanded');
      }
      toggleActivityDetail(actId, true);
      const detailRow = document.getElementById(`detail-${actId}`);
      if (detailRow) detailRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
}

// ── Training Log toggle ──────────────────────────────────────

const trainingLogToggle = document.getElementById('trainingLogToggle');
const trainingLogContent = document.getElementById('trainingLogContent');
if (trainingLogToggle) {
  trainingLogToggle.addEventListener('click', () => {
    const isOpen = trainingLogContent.style.display !== 'none';
    trainingLogContent.style.display = isOpen ? 'none' : '';
    trainingLogToggle.classList.toggle('expanded', !isOpen);
  });
}

// ── Activity Detail View ──────────────────────────────────────

const _detailCache = {};
const _openDetails = new Set();

function classificationColor(cls) {
  const colors = { intervals: '#f87171', tempo: '#fbbf24', threshold: '#f97316', progression: '#a78bfa',
    'long run': '#60a5fa', recovery: '#34d399', easy: '#34d399', 'race effort': '#ef4444', pyramid: '#ec4899', mixed: '#8b8ba0', unclassified: '#555555' };
  return colors[cls] || '#555555';
}

function classificationLabel(cls) {
  if (!cls) return 'Unclassified';
  return cls.charAt(0).toUpperCase() + cls.slice(1);
}

async function toggleActivityDetail(activityId, forceOpen = false) {
  const detailRow = document.getElementById(`detail-${activityId}`);
  if (!detailRow) return;
  const isOpen = detailRow.style.display !== 'none';
  if (isOpen && !forceOpen) { detailRow.style.display = 'none'; _openDetails.delete(activityId); return; }
  detailRow.style.display = ''; _openDetails.add(activityId);
  const panel = document.getElementById(`panel-${activityId}`);
  if (panel.dataset.loaded) return;
  panel.innerHTML = '<div class="detail-loading">Loading activity details...</div>';
  try {
    let metrics = _detailCache[activityId];
    if (!metrics) { metrics = await garmin.getActivityMetrics(activityId); if (metrics) _detailCache[activityId] = metrics; }
    if (!metrics) { panel.innerHTML = '<div class="detail-empty">No detailed metrics available.</div>'; panel.dataset.loaded = '1'; return; }
    renderActivityDetail(panel, metrics); panel.dataset.loaded = '1';
  } catch (err) { panel.innerHTML = `<div class="detail-empty">Failed to load: ${esc(err.message)}</div>`; }
}

function renderActivityDetail(panel, metrics) {
  const cls = metrics.workout_classification || 'unclassified';
  const clsDetails = typeof metrics.classification_details === 'string' ? JSON.parse(metrics.classification_details) : (metrics.classification_details || {});
  const hrSamples = typeof metrics.heart_rate_samples === 'string' ? JSON.parse(metrics.heart_rate_samples) : (metrics.heart_rate_samples || []);
  const paceSamples = typeof metrics.pace_samples === 'string' ? JSON.parse(metrics.pace_samples) : (metrics.pace_samples || []);
  const elevSamples = typeof metrics.elevation_samples === 'string' ? JSON.parse(metrics.elevation_samples) : (metrics.elevation_samples || []);
  const splits = typeof metrics.splits === 'string' ? JSON.parse(metrics.splits) : (metrics.splits || []);
  const clsColor = classificationColor(cls);

  const zones = clsDetails.zones || {};
  const zoneBar = (zones.z1 != null) ? `<div class="zone-bar">
    <div class="zone-seg z1" style="width:${zones.z1}%"></div><div class="zone-seg z2" style="width:${zones.z2}%"></div>
    <div class="zone-seg z3" style="width:${zones.z3}%"></div><div class="zone-seg z4" style="width:${zones.z4}%"></div>
    <div class="zone-seg z5" style="width:${zones.z5}%"></div></div>
    <div class="zone-labels">
    <span class="zone-label"><span class="zone-dot z1"></span>Z1 ${zones.z1}%</span>
    <span class="zone-label"><span class="zone-dot z2"></span>Z2 ${zones.z2}%</span>
    <span class="zone-label"><span class="zone-dot z3"></span>Z3 ${zones.z3}%</span>
    <span class="zone-label"><span class="zone-dot z4"></span>Z4 ${zones.z4}%</span>
    <span class="zone-label"><span class="zone-dot z5"></span>Z5 ${zones.z5}%</span></div>` : '';

  let splitsHtml = '';
  if (splits.length > 0) {
    const rows = splits.map((s, i) => {
      const pace = s.avg_pace ? `${Math.floor(s.avg_pace)}:${String(Math.round((s.avg_pace % 1) * 60)).padStart(2, '0')}` : '--';
      return `<tr><td>${i + 1}</td><td>${pace}</td><td>${s.avg_hr ?? '--'}</td><td>${s.elevation_gain != null ? `+${Math.round(s.elevation_gain)}` : '--'}</td></tr>`;
    }).join('');
    splitsHtml = `<div class="detail-section"><div class="detail-section-title">Splits</div>
      <table class="splits-table"><thead><tr><th>#</th><th>Pace</th><th>HR</th><th>Elev</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  panel.innerHTML = `<div class="activity-detail-content">
    <div class="detail-header"><span class="classification-badge" style="background:${clsColor}20;color:${clsColor};border:1px solid ${clsColor}40">${classificationLabel(cls)}</span>
    <span class="classification-reason">${esc(clsDetails.reason || '')}</span></div>${zoneBar}
    <div class="detail-charts">
      <div class="detail-chart-wrap"><div class="detail-chart-label">Heart Rate (bpm)</div><canvas class="detail-chart" id="hrChart-${metrics.activity_id}"></canvas></div>
      <div class="detail-chart-wrap"><div class="detail-chart-label">Pace (min/km)</div><canvas class="detail-chart" id="paceChart-${metrics.activity_id}"></canvas></div>
      <div class="detail-chart-wrap"><div class="detail-chart-label">Elevation (m)</div><canvas class="detail-chart" id="elevChart-${metrics.activity_id}"></canvas></div>
    </div>${splitsHtml}</div>`;

  const dur = metrics.duration_seconds || 0;
  requestAnimationFrame(() => {
    drawActivityChart(document.getElementById(`hrChart-${metrics.activity_id}`), hrSamples, { color: '#F87171', fillColor: '#F8717118', unit: 'bpm', label: 'HR', durationSeconds: dur });
    drawActivityChart(document.getElementById(`paceChart-${metrics.activity_id}`), paceSamples, { color: '#60a5fa', fillColor: '#60a5fa18', unit: 'min/km', label: 'Pace', invertY: true, durationSeconds: dur });
    drawActivityChart(document.getElementById(`elevChart-${metrics.activity_id}`), elevSamples, { color: '#4ADE80', fillColor: '#4ADE8018', unit: 'm', label: 'Elevation', areaFill: true, durationSeconds: dur });
  });
}

// ── Init ─────────────────────────────────────────────────────

async function init() {
  if (isSupabaseConfigured() && authSection) {
    authSection.classList.remove('hidden');
    onAuthStateChange(async (user) => { authUI.updateAuthUI(user); refreshDashboard(); });
    try {
      const user = await getUser();
      if (user && !authUI.getCurrentUser()) { authUI.updateAuthUI(user); refreshDashboard(); }
    } catch {}
  }
}

init();
