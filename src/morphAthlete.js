// Morphing Athlete Animation — SVG stick figure that transitions between
// running, swimming, cycling, and lifting poses with fluid interpolation.

const ACCENT = '#C8FF00';
const ACCENT_DIM = 'rgba(200, 255, 0, 0.4)';
const SURFACE = 'rgba(255, 255, 255, 0.06)';

// Each pose: { head, torso, armL, armR, legL, legR } — arrays of [x,y] points
// Canvas: 160x160, figure centered around x=80
const POSES = {
  run: [
    { // stride extended
      head: [80, 38],
      neck: [80, 46],
      hip: [80, 80],
      handL: [64, 54], elbowL: [70, 64],
      handR: [96, 70], elbowR: [90, 60],
      footL: [62, 120], kneeL: [70, 98],
      footR: [100, 105], kneeR: [88, 96],
      lean: -6,
    },
    { // stride mid
      head: [80, 36],
      neck: [80, 44],
      hip: [80, 78],
      handL: [96, 56], elbowL: [90, 62],
      handR: [64, 68], elbowR: [70, 58],
      footL: [96, 108], kneeL: [86, 94],
      footR: [64, 118], kneeR: [72, 96],
      lean: -6,
    },
  ],
  swim: [
    { // pull stroke R
      head: [80, 62],
      neck: [80, 68],
      hip: [80, 80],
      handL: [50, 60], elbowL: [62, 58],
      handR: [112, 64], elbowR: [98, 60],
      footL: [96, 106], kneeL: [88, 92],
      footR: [104, 96], kneeR: [92, 88],
      lean: -12,
    },
    { // pull stroke L
      head: [80, 60],
      neck: [80, 66],
      hip: [80, 80],
      handL: [112, 62], elbowL: [98, 58],
      handR: [50, 62], elbowR: [62, 60],
      footL: [104, 98], kneeL: [92, 90],
      footR: [96, 108], kneeR: [88, 94],
      lean: -12,
    },
  ],
  cycle: [
    { // pedal up
      head: [74, 36],
      neck: [76, 44],
      hip: [82, 76],
      handL: [58, 52], elbowL: [64, 60],
      handR: [58, 52], elbowR: [64, 60],
      footL: [90, 108], kneeL: [94, 90],
      footR: [72, 100], kneeR: [70, 86],
      lean: -14,
    },
    { // pedal down
      head: [74, 36],
      neck: [76, 44],
      hip: [82, 76],
      handL: [58, 52], elbowL: [64, 60],
      handR: [58, 52], elbowR: [64, 60],
      footL: [72, 100], kneeL: [70, 86],
      footR: [90, 108], kneeR: [94, 90],
      lean: -14,
    },
  ],
  lift: [
    { // bottom of squat / deadlift
      head: [80, 44],
      neck: [80, 52],
      hip: [80, 82],
      handL: [62, 82], elbowL: [66, 68],
      handR: [98, 82], elbowR: [94, 68],
      footL: [68, 120], kneeL: [68, 100],
      footR: [92, 120], kneeR: [92, 100],
      lean: 0,
    },
    { // lockout overhead
      head: [80, 38],
      neck: [80, 46],
      hip: [80, 80],
      handL: [66, 24], elbowL: [68, 34],
      handR: [94, 24], elbowR: [92, 34],
      footL: [70, 120], kneeL: [72, 100],
      footR: [90, 120], kneeR: [88, 100],
      lean: 0,
    },
  ],
};

const ACTIVITY_ORDER = ['run', 'swim', 'cycle', 'lift'];
const ACTIVITY_LABELS = { run: 'Running', swim: 'Swimming', cycle: 'Cycling', lift: 'Lifting' };

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpPoint(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
}

function lerpPose(poseA, poseB, t) {
  const result = {};
  for (const key of Object.keys(poseA)) {
    if (key === 'lean') {
      result[key] = lerp(poseA[key], poseB[key], t);
    } else {
      result[key] = lerpPoint(poseA[key], poseB[key], t);
    }
  }
  return result;
}

// Smooth easing
function easeInOutSine(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

function renderPose(pose, ctx2d, w, h, trailAlpha) {
  const c = ctx2d;
  c.save();

  // Lean transform
  if (pose.lean) {
    c.translate(w / 2, h * 0.75);
    c.rotate((pose.lean * Math.PI) / 180);
    c.translate(-w / 2, -h * 0.75);
  }

  const strokeColor = ACCENT;
  const headColor = ACCENT;
  c.lineCap = 'round';
  c.lineJoin = 'round';

  // Motion trail (fading afterimage)
  if (trailAlpha > 0) {
    c.globalAlpha = trailAlpha * 0.15;
    c.strokeStyle = ACCENT;
    c.lineWidth = 3;
    drawStick(c, pose, -4, 0);
    c.globalAlpha = trailAlpha * 0.07;
    drawStick(c, pose, -8, 0);
  }

  c.globalAlpha = 1;

  // Ground shadow (ellipse)
  c.fillStyle = 'rgba(200, 255, 0, 0.06)';
  c.beginPath();
  c.ellipse(80, 128, 28, 4, 0, 0, Math.PI * 2);
  c.fill();

  // Body
  c.strokeStyle = strokeColor;
  c.lineWidth = 2.5;
  drawStick(c, pose, 0, 0);

  // Head
  c.fillStyle = headColor;
  c.beginPath();
  c.arc(pose.head[0], pose.head[1], 8, 0, Math.PI * 2);
  c.fill();

  // Head inner (face direction hint)
  c.fillStyle = 'rgba(0, 0, 0, 0.35)';
  c.beginPath();
  c.arc(pose.head[0] + 2, pose.head[1] - 1, 5.5, 0, Math.PI * 2);
  c.fill();

  // Joint dots
  c.fillStyle = ACCENT;
  const joints = [pose.elbowL, pose.elbowR, pose.kneeL, pose.kneeR];
  for (const j of joints) {
    c.beginPath();
    c.arc(j[0], j[1], 2, 0, Math.PI * 2);
    c.fill();
  }

  // Hand/foot dots (slightly larger)
  c.fillStyle = ACCENT;
  const extremities = [pose.handL, pose.handR, pose.footL, pose.footR];
  for (const e of extremities) {
    c.beginPath();
    c.arc(e[0], e[1], 2.5, 0, Math.PI * 2);
    c.fill();
  }

  c.restore();
}

function drawStick(c, pose, dx, dy) {
  // Torso: neck to hip
  line(c, pose.neck, pose.hip, dx, dy);
  // Left arm: neck → elbow → hand
  line(c, pose.neck, pose.elbowL, dx, dy);
  line(c, pose.elbowL, pose.handL, dx, dy);
  // Right arm
  line(c, pose.neck, pose.elbowR, dx, dy);
  line(c, pose.elbowR, pose.handR, dx, dy);
  // Left leg: hip → knee → foot
  line(c, pose.hip, pose.kneeL, dx, dy);
  line(c, pose.kneeL, pose.footL, dx, dy);
  // Right leg
  line(c, pose.hip, pose.kneeR, dx, dy);
  line(c, pose.kneeR, pose.footR, dx, dy);
}

function line(c, a, b, dx, dy) {
  c.beginPath();
  c.moveTo(a[0] + dx, a[1] + dy);
  c.lineTo(b[0] + dx, b[1] + dy);
  c.stroke();
}

// Floating energy particles
class Particle {
  constructor() { this.reset(); }
  reset() {
    this.x = 80 + (Math.random() - 0.5) * 40;
    this.y = 90 + Math.random() * 30;
    this.vx = (Math.random() - 0.5) * 0.8;
    this.vy = -0.4 - Math.random() * 0.6;
    this.life = 1;
    this.decay = 0.008 + Math.random() * 0.01;
    this.size = 1.5 + Math.random() * 2;
  }
  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.life -= this.decay;
    if (this.life <= 0) this.reset();
  }
  draw(c) {
    c.globalAlpha = this.life * 0.5;
    c.fillStyle = ACCENT;
    c.beginPath();
    c.arc(this.x, this.y, this.size * this.life, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;
  }
}

/**
 * Initialize the morphing athlete animation in the given container.
 * Returns a stop() function to clean up.
 */
export function initMorphAthlete(containerEl, labelEl) {
  if (!containerEl) return () => {};

  // Create canvas at 2x for retina
  const canvas = document.createElement('canvas');
  const size = 160;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  containerEl.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // Particle system
  const particles = Array.from({ length: 6 }, () => new Particle());

  // Animation state
  let activityIdx = 0;
  let poseFrame = 0; // 0-1 within current activity's pose cycle
  let transitionProgress = 0; // 0 = fully in current, 1 = fully in next
  let isTransitioning = false;
  let animId = null;
  let lastTime = 0;
  let stopped = false;

  // Timing
  const POSE_CYCLE_SPEED = 2.2; // full cycles per second
  const ACTIVITY_HOLD_MS = 2700; // time on each activity before transitioning
  const TRANSITION_MS = 800; // morph duration between activities
  let holdTimer = 0;

  // Set initial label
  if (labelEl) labelEl.textContent = ACTIVITY_LABELS[ACTIVITY_ORDER[0]];

  function tick(timestamp) {
    if (stopped) return;
    if (!lastTime) lastTime = timestamp;
    const dt = Math.min(timestamp - lastTime, 50); // cap delta
    lastTime = timestamp;

    const currentActivity = ACTIVITY_ORDER[activityIdx];
    const nextActivity = ACTIVITY_ORDER[(activityIdx + 1) % ACTIVITY_ORDER.length];
    const currentPoses = POSES[currentActivity];
    const nextPoses = POSES[nextActivity];

    // Advance pose frame (oscillate between pose 0 and 1)
    poseFrame += (POSE_CYCLE_SPEED * dt) / 1000;
    const t = (Math.sin(poseFrame * Math.PI * 2) + 1) / 2; // 0-1 oscillation

    // Current activity's interpolated pose
    const currentPose = lerpPose(currentPoses[0], currentPoses[1], easeInOutSine(t));

    let drawPose;
    if (isTransitioning) {
      // Morph between activities
      transitionProgress += dt / TRANSITION_MS;
      if (transitionProgress >= 1) {
        transitionProgress = 0;
        isTransitioning = false;
        activityIdx = (activityIdx + 1) % ACTIVITY_ORDER.length;
        holdTimer = 0;
        if (labelEl) labelEl.textContent = ACTIVITY_LABELS[ACTIVITY_ORDER[activityIdx]];
        drawPose = currentPose;
      } else {
        const nextPose = lerpPose(nextPoses[0], nextPoses[1], easeInOutSine(t));
        drawPose = lerpPose(currentPose, nextPose, easeInOutSine(transitionProgress));
      }
    } else {
      holdTimer += dt;
      if (holdTimer >= ACTIVITY_HOLD_MS) {
        isTransitioning = true;
        transitionProgress = 0;
      }
      drawPose = currentPose;
    }

    // Clear
    ctx.clearRect(0, 0, size, size);

    // Draw particles
    for (const p of particles) {
      p.update();
      p.draw(ctx);
    }

    // Ground line
    ctx.strokeStyle = ACCENT_DIM;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.2;
    ctx.beginPath();
    ctx.moveTo(30, 128);
    ctx.lineTo(130, 128);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Draw the figure
    const trailAlpha = isTransitioning ? 0 : 0.6;
    renderPose(drawPose, ctx, size, size, trailAlpha);

    // Accent ring pulse (behind head during transition)
    if (isTransitioning) {
      const ringAlpha = Math.sin(transitionProgress * Math.PI) * 0.3;
      const ringSize = 12 + transitionProgress * 8;
      ctx.globalAlpha = ringAlpha;
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(drawPose.head[0], drawPose.head[1], ringSize, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    animId = requestAnimationFrame(tick);
  }

  animId = requestAnimationFrame(tick);

  return function stop() {
    stopped = true;
    if (animId) cancelAnimationFrame(animId);
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  };
}
