// Dependency-free tween manager used for every animation in the scene.

const active = new Set();

// Global speed multiplier (1 = normal). Used by the `?fast=N` dev hook so a
// whole game can be exercised quickly; every duration and wait is divided by it.
let timeScale = 1;
export function setTimeScale(scale) {
  timeScale = Math.max(0.01, scale || 1);
}

export const Easing = {
  linear: (t) => t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
  outQuad: (t) => 1 - (1 - t) * (1 - t),
};

/**
 * Animate a callback from 0 to 1 over `duration` ms. Resolves when finished.
 * `onUpdate(t)` receives the eased progress.
 */
export function tween({ duration = 400, delay = 0, easing = Easing.outCubic, onUpdate, onComplete }) {
  return new Promise((resolve) => {
    const entry = {
      start: null,
      delay: delay / timeScale,
      duration: duration / timeScale,
      easing,
      onUpdate,
      done: () => {
        active.delete(entry);
        onComplete?.();
        resolve();
      },
    };
    active.add(entry);
  });
}

/** Tween a THREE.Vector3-like object's x/y/z toward target values. */
export function tweenVector(vec, target, opts = {}) {
  const from = { x: vec.x, y: vec.y, z: vec.z };
  const arc = opts.arc || 0; // optional parabolic lift on y for "flying" tiles
  return tween({
    ...opts,
    onUpdate: (t) => {
      vec.x = from.x + (target.x - from.x) * t;
      vec.y = from.y + (target.y - from.y) * t + arc * Math.sin(Math.PI * t);
      vec.z = from.z + (target.z - from.z) * t;
      opts.onUpdate?.(t);
    },
  });
}

/** Advance all tweens; call once per frame with the current time (ms). */
export function updateTweens(now) {
  for (const entry of [...active]) {
    if (entry.start === null) entry.start = now + entry.delay;
    if (now < entry.start) continue;
    const t = Math.min(1, (now - entry.start) / Math.max(1, entry.duration));
    entry.onUpdate?.(entry.easing(t));
    if (t >= 1) entry.done();
  }
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms / timeScale));
}

export function activeTweenCount() {
  return active.size;
}
