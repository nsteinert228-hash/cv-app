// ═══════════════════════════════════════════════════
// uTrain — Interaction Layer
// Custom cursor, magnetic buttons, 3D tilt cards,
// scroll reveals, animated counters, ripple effects
// ═══════════════════════════════════════════════════

const IS_TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// ── Custom Cursor ──────────────────────────────────

function initCursor() {
  if (IS_TOUCH) return;

  const cursor = document.createElement('div');
  cursor.className = 'u-cursor';
  const ring = document.createElement('div');
  ring.className = 'u-cursor-ring';
  document.body.appendChild(cursor);
  document.body.appendChild(ring);

  let cx = -100, cy = -100;
  let rx = -100, ry = -100;

  document.addEventListener('mousemove', e => {
    cx = e.clientX;
    cy = e.clientY;
  });

  // Ring follows with easing
  function tick() {
    rx += (cx - rx) * 0.15;
    ry += (cy - ry) * 0.15;
    cursor.style.transform = `translate(${cx}px, ${cy}px)`;
    ring.style.transform = `translate(${rx}px, ${ry}px)`;
    requestAnimationFrame(tick);
  }
  tick();

  // Scale ring on interactive elements
  const interactiveSelector = 'a, button, [role="button"], .tilt-card, .movement-card, .lb-row-main, input, .tracker-tab';

  document.addEventListener('mouseover', e => {
    if (e.target.closest(interactiveSelector)) {
      ring.classList.add('hover');
      cursor.classList.add('hover');
    }
  });
  document.addEventListener('mouseout', e => {
    if (e.target.closest(interactiveSelector)) {
      ring.classList.remove('hover');
      cursor.classList.remove('hover');
    }
  });

  document.addEventListener('mousedown', () => {
    cursor.classList.add('click');
    ring.classList.add('click');
  });
  document.addEventListener('mouseup', () => {
    cursor.classList.remove('click');
    ring.classList.remove('click');
  });
}

// ── Magnetic Buttons ───────────────────────────────

function initMagneticButtons() {
  if (IS_TOUCH) return;

  document.addEventListener('mousemove', e => {
    const btns = document.querySelectorAll('.magnetic');
    for (const btn of btns) {
      const rect = btn.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const distX = e.clientX - centerX;
      const distY = e.clientY - centerY;
      const dist = Math.sqrt(distX * distX + distY * distY);
      const threshold = 100;

      if (dist < threshold) {
        const pull = (1 - dist / threshold) * 12;
        const tx = (distX / dist) * pull;
        const ty = (distY / dist) * pull;
        btn.style.transform = `translate(${tx}px, ${ty}px)`;
      } else {
        btn.style.transform = '';
      }
    }
  });
}

// ── 3D Tilt Cards ──────────────────────────────────

function initTiltCards() {
  if (IS_TOUCH) return;

  document.addEventListener('mousemove', e => {
    const cards = document.querySelectorAll('.tilt-card');
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (
        e.clientX < rect.left || e.clientX > rect.right ||
        e.clientY < rect.top || e.clientY > rect.bottom
      ) {
        card.style.transform = '';
        card.style.setProperty('--glow-x', '50%');
        card.style.setProperty('--glow-y', '50%');
        continue;
      }

      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      const rotateX = (y - 0.5) * -8;
      const rotateY = (x - 0.5) * 8;

      card.style.transform = `perspective(600px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.02)`;
      card.style.setProperty('--glow-x', `${x * 100}%`);
      card.style.setProperty('--glow-y', `${y * 100}%`);
    }
  });
}

// ── Scroll Reveal ──────────────────────────────────

function initScrollReveal() {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
  );

  // Observe elements with .reveal class
  function scan() {
    document.querySelectorAll('.reveal:not(.revealed)').forEach(el => observer.observe(el));
  }

  scan();
  // Re-scan periodically for dynamically added elements
  const mo = new MutationObserver(scan);
  mo.observe(document.body, { childList: true, subtree: true });
}

// ── Ripple Effect ──────────────────────────────────

function initRipple() {
  document.addEventListener('click', e => {
    const target = e.target.closest('.ripple');
    if (!target) return;

    const rect = target.getBoundingClientRect();
    const ripple = document.createElement('span');
    ripple.className = 'ripple-wave';
    const size = Math.max(rect.width, rect.height) * 2;
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
    ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
    target.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  });
}

// ── Animated Number Counter ────────────────────────

export function animateCounter(el, target, duration = 1200) {
  if (!el || !window.gsap) {
    if (el) el.textContent = target;
    return;
  }

  const obj = { val: 0 };
  gsap.to(obj, {
    val: target,
    duration: duration / 1000,
    ease: 'power2.out',
    onUpdate: () => {
      el.textContent = Math.round(obj.val);
    },
  });
}

// ── Staggered List Entrance (GSAP) ────────────────

export function staggerEntrance(selector, options = {}) {
  if (!window.gsap) return;
  const els = document.querySelectorAll(selector);
  if (!els.length) return;

  gsap.from(els, {
    y: options.y ?? 20,
    opacity: 0,
    duration: options.duration ?? 0.5,
    stagger: options.stagger ?? 0.08,
    ease: options.ease ?? 'power2.out',
    delay: options.delay ?? 0,
  });
}

// ── Timer Pulse Ring (GSAP) ───────────────────────

export function pulseRing(selector) {
  if (!window.gsap) return;
  const el = document.querySelector(selector);
  if (!el) return;

  gsap.to(el, {
    scale: 1.3,
    opacity: 0.1,
    duration: 1.5,
    ease: 'power1.inOut',
    repeat: -1,
    yoyo: true,
  });
}

// ── Phase Transition (GSAP) ───────────────────────

export function phaseTransition(container, direction = 'in') {
  if (!window.gsap) return Promise.resolve();

  if (direction === 'in') {
    return new Promise(resolve => {
      gsap.from(container, {
        opacity: 0,
        y: 30,
        duration: 0.6,
        ease: 'power3.out',
        onComplete: resolve,
      });
    });
  } else {
    return new Promise(resolve => {
      gsap.to(container, {
        opacity: 0,
        y: -20,
        duration: 0.3,
        ease: 'power2.in',
        onComplete: resolve,
      });
    });
  }
}

// ── Glow Burst (for milestones) ───────────────────

export function glowBurst() {
  if (!window.gsap) return;

  const burst = document.createElement('div');
  burst.className = 'glow-burst';
  document.body.appendChild(burst);

  gsap.fromTo(burst,
    { scale: 0.5, opacity: 0.8 },
    {
      scale: 3,
      opacity: 0,
      duration: 0.8,
      ease: 'power2.out',
      onComplete: () => burst.remove(),
    }
  );
}

// ── Init All ───────────────────────────────────────

export function initInteractions() {
  initCursor();
  initMagneticButtons();
  initTiltCards();
  initScrollReveal();
  initRipple();
}
