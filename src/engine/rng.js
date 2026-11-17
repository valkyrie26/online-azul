// Tiny seedable PRNG (mulberry32). The engine keeps the generator state inside
// the game state so that a seed fully determines a game and tests can replay it.

export function hashSeed(seed) {
  if (typeof seed === 'number') return seed >>> 0;
  let h = 1779033703 ^ String(seed).length;
  for (let i = 0; i < String(seed).length; i++) {
    h = Math.imul(h ^ String(seed).charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

/** Advance the generator stored on `holder.rngState`; returns a float in [0, 1). */
export function nextRandom(holder) {
  let t = (holder.rngState = (holder.rngState + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randomInt(holder, n) {
  return Math.floor(nextRandom(holder) * n);
}

/** In-place Fisher–Yates shuffle driven by the holder's generator. */
export function shuffle(holder, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(holder, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Standalone generator for callers (like the AI) that do not own a state. */
export function makeRng(seed) {
  const holder = { rngState: hashSeed(seed) };
  return () => nextRandom(holder);
}
