// Garmin Readiness Dashboard — data loading + canvas chart rendering
import { isSupabaseConfigured } from './supabase.js';
import { signIn, signUp, signOut, onAuthStateChange } from './auth.js';
import * as garmin from './garmin.js';

// ── DOM refs ─────────────────────────────────────────────────

const authSection = document.getElementById('authSection');
const authUser = document.getElementById('authUser');
const authBtn = document.getElementById('authBtn');
const authModal = document.getElementById('authModal');
const authModalTitle = document.getElementById('authModalTitle');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authSubmit = document.getElementById('authSubmit');
const authCancel = document.getElementById('authCancel');
const authError = document.getElementById('authError');
const authToggleText = document.getElementById('authToggleText');
const authToggleLink = document.getElementById('authToggleLink');

const dashboardContent = document.getElementById('dashboardContent');
const emptyState = document.getElementById('emptyState');
const connectBtn = document.getElementById('connectGarminBtn');
const garminModal = document.getElementById('garminModal');
const garminEmailInput = document.getElementById('garminEmail');
const garminPasswordInput = document.getElementById('garminPassword');
const garminSubmit = document.getElementById('garminSubmit');
const garminCancel = document.getElementById('garminCancel');
const garminError = document.getElementById('garminError');

// ── Auth (shared logic) ──────────────────────────────────────

let authMode = 'signin';
let currentUser = null;

function updateAuthUI(user) {
  currentUser = user;
  if (user) {
    authUser.textContent = user.email;
    authBtn.textContent = 'Sign Out';
  } else {
    authUser.textContent = '';
    authBtn.textContent = 'Sign In';
  }
}

function showAuthModal() {
  authMode = 'signin';
  authModalTitle.textContent = 'Sign In';
  authSubmit.textContent = 'Sign In';
  authToggleText.textContent = "Don't have an account?";
  authToggleLink.textContent = 'Sign Up';
  authEmail.value = '';
  authPassword.value = '';
  authError.textContent = '';
  authModal.classList.add('visible');
}

function hideAuthModal() {
  authModal.classList.remove('visible');
  authError.textContent = '';
}

if (authBtn) {
  authBtn.addEventListener('click', async () => {
    if (currentUser) {
      try { await signOut(); updateAuthUI(null); refreshDashboard(); }
      catch (err) { console.warn('Sign out failed:', err.message); }
    } else {
      showAuthModal();
    }
  });
}

if (authCancel) authCancel.addEventListener('click', hideAuthModal);
if (authModal) authModal.addEventListener('click', (e) => { if (e.target === authModal) hideAuthModal(); });

if (authToggleLink) {
  authToggleLink.addEventListener('click', () => {
    if (authMode === 'signin') {
      authMode = 'signup';
      authModalTitle.textContent = 'Sign Up';
      authSubmit.textContent = 'Sign Up';
      authToggleText.textContent = 'Already have an account?';
      authToggleLink.textContent = 'Sign In';
    } else {
      authMode = 'signin';
      authModalTitle.textContent = 'Sign In';
      authSubmit.textContent = 'Sign In';
      authToggleText.textContent = "Don't have an account?";
      authToggleLink.textContent = 'Sign Up';
    }
    authError.textContent = '';
  });
}

if (authSubmit) {
  authSubmit.addEventListener('click', async () => {
    const email = authEmail.value.trim();
    const password = authPassword.value;
    if (!email || !password) { authError.textContent = 'Please enter email and password.'; return; }
    authError.textContent = '';
    authSubmit.disabled = true;
    try {
      if (authMode === 'signup') {
        await signUp(email, password);
        authError.style.color = 'var(--accent-dark)';
        authError.textContent = 'Check your email to confirm your account.';
        authSubmit.disabled = false;
        return;
      }
      const user = await signIn(email, password);
      updateAuthUI(user);
      hideAuthModal();
      refreshDashboard();
    } catch (err) {
      authError.style.color = '#ef4444';
      authError.textContent = err.message;
    }
    authSubmit.disabled = false;
  });
}

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
    try {
      await garmin.connectGarmin(email, password);
      garminModal.classList.remove('visible');
      refreshDashboard();
    } catch (err) {
      garminError.textContent = err.message;
    }
    garminSubmit.disabled = false;
  });
}

// ── Chart helpers ────────────────────────────────────────────

function drawArcGauge(canvas, value, max, color, bgColor, label) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const size = canvas.clientWidth;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  ctx.scale(dpr, dpr);

  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38;
  const lw = size * 0.09;
  const startAngle = 0.75 * Math.PI;
  const endAngle = 2.25 * Math.PI;
  const pct = Math.min(value / max, 1);

  // Background arc
  ctx.beginPath();
  ctx.arc(cx, cy, r, startAngle, endAngle);
  ctx.strokeStyle = bgColor;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Value arc
  if (pct > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, startAngle + pct * (endAngle - startAngle));
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // Center value text
  ctx.fillStyle = color;
  ctx.font = `700 ${size * 0.22}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(value, cx, cy - size * 0.02);

  // Label
  ctx.fillStyle = '#9ca3af';
  ctx.font = `500 ${size * 0.085}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.fillText(label, cx, cy + size * 0.16);
}

function drawHrvSparkline(canvas, data) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
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

  // Baseline band
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

  // HRV line
  ctx.beginPath();
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  let started = false;
  for (let i = 0; i < data.length; i++) {
    if (data[i].last_night_avg == null) continue;
    const x = toX(i);
    const y = toY(data[i].last_night_avg);
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Dots
  for (let i = 0; i < data.length; i++) {
    if (data[i].last_night_avg == null) continue;
    ctx.beginPath();
    ctx.arc(toX(i), toY(data[i].last_night_avg), 3, 0, Math.PI * 2);
    ctx.fillStyle = '#10b981';
    ctx.fill();
  }

  // X-axis labels (every other day)
  ctx.fillStyle = '#9ca3af';
  ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  const labelEvery = Math.max(1, Math.floor(data.length / 6));
  for (let i = 0; i < data.length; i += labelEvery) {
    const d = new Date(data[i].date + 'T00:00:00');
    const label = `${d.getMonth() + 1}/${d.getDate()}`;
    ctx.fillText(label, toX(i), h - 6);
  }

  // Y-axis labels
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

  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.36;
  const lw = size * 0.14;
  const segments = [
    { val: rest || 0, color: '#10b981', label: 'Rest' },
    { val: low || 0, color: '#60a5fa', label: 'Low' },
    { val: medium || 0, color: '#f59e0b', label: 'Medium' },
    { val: high || 0, color: '#ef4444', label: 'High' },
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

  // Center: avg stress text
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
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  const total = (deep || 0) + (light || 0) + (rem || 0) + (awake || 0);
  if (total === 0) return;

  const barH = 24;
  const y = (h - barH) / 2;
  const radius = barH / 2;
  const segments = [
    { val: deep || 0, color: '#1e3a5f' },
    { val: light || 0, color: '#60a5fa' },
    { val: rem || 0, color: '#a78bfa' },
    { val: awake || 0, color: '#f59e0b' },
  ];

  // Draw rounded rect background
  ctx.fillStyle = '#e5e7eb';
  ctx.beginPath();
  ctx.roundRect(0, y, w, barH, radius);
  ctx.fill();

  // Clip to rounded rect for segments
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
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  const barH = 20;
  const y = (h - barH) / 2;
  const radius = barH / 2;

  // Background
  ctx.fillStyle = '#e5e7eb';
  ctx.beginPath();
  ctx.roundRect(0, y, w, barH, radius);
  ctx.fill();

  // Fill based on end level
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

  // Start marker
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

function readinessColor(score) {
  if (score >= 60) return '#10b981';
  if (score >= 40) return '#f59e0b';
  return '#ef4444';
}

function readinessLabel(level) {
  if (!level) return '';
  return level.charAt(0).toUpperCase() + level.slice(1).toLowerCase();
}

// ── Dashboard rendering ──────────────────────────────────────

async function refreshDashboard() {
  if (!currentUser) {
    dashboardContent.style.display = 'none';
    emptyState.style.display = 'block';
    emptyState.querySelector('p').textContent = 'Sign in to view your Garmin health dashboard.';
    if (connectBtn) connectBtn.style.display = 'none';
    return;
  }

  const status = await garmin.getGarminStatus();
  if (!status) {
    dashboardContent.style.display = 'none';
    emptyState.style.display = 'block';
    emptyState.querySelector('p').textContent = 'Connect your Garmin account to see your readiness dashboard.';
    if (connectBtn) connectBtn.style.display = '';
    return;
  }

  emptyState.style.display = 'none';
  dashboardContent.style.display = 'block';

  // Fetch all data in parallel
  const [readiness, battery, sleep, hrv, daily, hr, spo2, resp] = await Promise.all([
    garmin.getTrainingReadiness().catch(() => null),
    garmin.getBodyBattery().catch(() => null),
    garmin.getSleepDetailed().catch(() => null),
    garmin.getHrvTrend(14).catch(() => []),
    garmin.getDailySummaryDetailed().catch(() => null),
    garmin.getHeartRateDaily().catch(() => null),
    garmin.getSpo2().catch(() => null),
    garmin.getRespiration().catch(() => null),
  ]);

  // 1. Readiness gauge
  const readinessCanvas = document.getElementById('readinessGauge');
  const score = readiness?.score ?? 0;
  const color = readinessColor(score);
  drawArcGauge(readinessCanvas, score, 100, color, '#e5e7eb', readinessLabel(readiness?.level) || 'Readiness');

  // 2. Body battery
  const bbCanvas = document.getElementById('bodyBatteryBar');
  drawBodyBatteryBar(bbCanvas, battery?.start_level, battery?.end_level);
  document.getElementById('bbStart').textContent = battery?.start_level ?? '--';
  document.getElementById('bbEnd').textContent = battery?.end_level ?? '--';
  document.getElementById('bbCharged').textContent = battery?.charged ? `+${battery.charged}` : '--';
  document.getElementById('bbDrained').textContent = battery?.drained ? `-${battery.drained}` : '--';

  // 3. Sleep
  const sleepCanvas = document.getElementById('sleepBar');
  drawSleepBar(sleepCanvas, sleep?.deep_sleep_seconds, sleep?.light_sleep_seconds, sleep?.rem_sleep_seconds, sleep?.awake_sleep_seconds);
  document.getElementById('sleepTotal').textContent = fmtDuration(sleep?.total_sleep_seconds);
  document.getElementById('sleepDeep').textContent = fmtDuration(sleep?.deep_sleep_seconds);
  document.getElementById('sleepLight').textContent = fmtDuration(sleep?.light_sleep_seconds);
  document.getElementById('sleepRem').textContent = fmtDuration(sleep?.rem_sleep_seconds);
  document.getElementById('sleepAwake').textContent = fmtDuration(sleep?.awake_sleep_seconds);

  // Sleep scores
  const scoreEls = {
    scoreOverall: sleep?.score_overall,
    scoreQuality: sleep?.score_quality,
    scoreDuration: sleep?.score_duration,
    scoreRecovery: sleep?.score_recovery,
  };
  for (const [id, val] of Object.entries(scoreEls)) {
    const el = document.getElementById(id);
    if (el) el.textContent = val ?? '--';
  }

  // 4. HRV sparkline
  const hrvCanvas = document.getElementById('hrvChart');
  drawHrvSparkline(hrvCanvas, hrv);

  // 5. Stress donut
  const stressAvgEl = document.getElementById('stressAvgValue');
  if (stressAvgEl) stressAvgEl.dataset.value = daily?.average_stress_level ?? '--';
  const stressCanvas = document.getElementById('stressDonut');
  drawStressDonut(stressCanvas, daily?.rest_stress_duration, daily?.low_stress_duration, daily?.medium_stress_duration, daily?.high_stress_duration);

  // 6. Quick stats
  const stepsVal = daily?.total_steps;
  const stepsGoal = daily?.daily_step_goal || 10000;
  document.getElementById('qSteps').textContent = stepsVal?.toLocaleString() ?? '--';
  document.getElementById('qStepsGoal').textContent = stepsGoal?.toLocaleString() ?? '10,000';
  const stepsBar = document.getElementById('stepsProgressFill');
  if (stepsBar) stepsBar.style.width = `${Math.min((stepsVal || 0) / stepsGoal * 100, 100)}%`;

  document.getElementById('qHR').textContent = hr?.resting_heart_rate ?? '--';
  document.getElementById('qHR7d').textContent = hr?.seven_day_avg_resting_hr ?? '--';
  document.getElementById('qSpo2').textContent = spo2?.average_spo2 ? `${Math.round(spo2.average_spo2)}%` : '--';
  document.getElementById('qResp').textContent = resp?.avg_waking_respiration ? `${Math.round(resp.avg_waking_respiration)}` : '--';
  document.getElementById('qIntensity').textContent = ((daily?.moderate_intensity_minutes || 0) + (daily?.vigorous_intensity_minutes || 0)) || '--';
  document.getElementById('qFloors').textContent = daily?.floors_ascended ?? '--';
}

// ── Init ─────────────────────────────────────────────────────

async function init() {
  if (isSupabaseConfigured() && authSection) {
    authSection.classList.remove('hidden');
    onAuthStateChange(async (user) => {
      updateAuthUI(user);
      refreshDashboard();
    });
  }
}

init();
