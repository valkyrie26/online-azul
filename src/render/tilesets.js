// Procedural tile artwork. Every set paints five canvases (one per Azul color)
// and describes how its tiles should be shaded in 3D. This module has no
// three.js dependency so the HUD can reuse the canvases for 2D previews.

import { COLORS } from '../engine/constants.js';
import { makeRng } from '../engine/rng.js';

export const TEXTURE_SIZE = 256;

// ---------------------------------------------------------------------------
// Helpers

function noise(ctx, size, amount, rng, alpha = 0.08) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
  void alpha;
}

function glaze(ctx, size, strength = 0.35) {
  const g = ctx.createRadialGradient(size * 0.3, size * 0.25, size * 0.05, size * 0.3, size * 0.25, size * 0.9);
  g.addColorStop(0, `rgba(255,255,255,${strength})`);
  g.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  g.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
}

function edge(ctx, size, color = 'rgba(0,0,0,0.35)', width = 6) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.strokeRect(width / 2, width / 2, size - width, size - width);
}

function star(ctx, cx, cy, outer, inner, points, rotation = 0) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rotation + (Math.PI * i) / points;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function petal(ctx, cx, cy, length, width, angle) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(width, -length * 0.35, width, -length * 0.8, 0, -length);
  ctx.bezierCurveTo(-width, -length * 0.8, -width, -length * 0.35, 0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function shade(hex, amount) {
  return mix(hex, amount > 0 ? '#ffffff' : '#000000', Math.abs(amount));
}

// ---------------------------------------------------------------------------
// Classic mosaic (azulejo ceramic)

const CLASSIC = [
  { base: '#1d4f9c', accent: '#8fc3ff', accent2: '#dbeeff' },
  { base: '#e8a23a', accent: '#b4521a', accent2: '#ffe59a' },
  { base: '#c23a2f', accent: '#f0b4a8', accent2: '#7a1811' },
  { base: '#202028', accent: '#d9d4c8', accent2: '#8d8a80' },
  { base: '#f2f1ea', accent: '#3fa7b5', accent2: '#1f6f7c' },
];

function paintClassic(ctx, size, color, rng) {
  const p = CLASSIC[color];
  const c = size / 2;
  ctx.fillStyle = p.base;
  ctx.fillRect(0, 0, size, size);
  ctx.lineJoin = 'round';

  switch (color) {
    case 0: {
      // Eight-pointed star with corner quarter circles.
      ctx.fillStyle = p.accent;
      star(ctx, c, c, size * 0.38, size * 0.16, 8, Math.PI / 8);
      ctx.fill();
      ctx.fillStyle = p.base;
      star(ctx, c, c, size * 0.24, size * 0.1, 8, Math.PI / 8);
      ctx.fill();
      ctx.fillStyle = p.accent2;
      ctx.beginPath();
      ctx.arc(c, c, size * 0.07, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.accent;
      for (const [x, y] of [[0, 0], [size, 0], [0, size], [size, size]]) {
        ctx.beginPath();
        ctx.arc(x, y, size * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = p.base;
      for (const [x, y] of [[0, 0], [size, 0], [0, size], [size, size]]) {
        ctx.beginPath();
        ctx.arc(x, y, size * 0.09, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 1: {
      // Floral: eight petals with a diamond core.
      ctx.fillStyle = p.accent;
      for (let i = 0; i < 8; i++) petal(ctx, c, c, size * 0.42, size * 0.09, (Math.PI * i) / 4);
      ctx.fillStyle = p.accent2;
      for (let i = 0; i < 4; i++) petal(ctx, c, c, size * 0.3, size * 0.06, (Math.PI * i) / 2 + Math.PI / 4);
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.arc(c, c, size * 0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.accent2;
      for (const [x, y] of [[0.14, 0.14], [0.86, 0.14], [0.14, 0.86], [0.86, 0.86]]) {
        ctx.beginPath();
        ctx.arc(x * size, y * size, size * 0.045, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 2: {
      // Lattice of diamonds.
      ctx.strokeStyle = p.accent2;
      ctx.lineWidth = size * 0.035;
      const step = size / 4;
      for (let i = -4; i <= 8; i++) {
        ctx.beginPath();
        ctx.moveTo(i * step, 0);
        ctx.lineTo(i * step + size, size);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(i * step, size);
        ctx.lineTo(i * step + size, 0);
        ctx.stroke();
      }
      ctx.fillStyle = p.accent;
      star(ctx, c, c, size * 0.22, size * 0.09, 4, 0);
      ctx.fill();
      ctx.fillStyle = p.base;
      ctx.beginPath();
      ctx.arc(c, c, size * 0.06, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 3: {
      // Concentric diamond and dots on black.
      ctx.strokeStyle = p.accent;
      ctx.lineWidth = size * 0.04;
      for (const r of [0.42, 0.3, 0.18]) {
        ctx.beginPath();
        ctx.moveTo(c, c - size * r);
        ctx.lineTo(c + size * r, c);
        ctx.lineTo(c, c + size * r);
        ctx.lineTo(c - size * r, c);
        ctx.closePath();
        ctx.stroke();
      }
      ctx.fillStyle = p.accent2;
      for (const [x, y] of [[0.5, 0.5], [0.12, 0.12], [0.88, 0.12], [0.12, 0.88], [0.88, 0.88]]) {
        ctx.beginPath();
        ctx.arc(x * size, y * size, size * 0.05, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 4: {
      // Turquoise snowflake on ivory.
      ctx.strokeStyle = p.accent;
      ctx.lineWidth = size * 0.04;
      ctx.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI * i) / 3;
        ctx.beginPath();
        ctx.moveTo(c, c);
        ctx.lineTo(c + Math.cos(a) * size * 0.4, c + Math.sin(a) * size * 0.4);
        ctx.stroke();
        for (const f of [0.55, 0.78]) {
          const bx = c + Math.cos(a) * size * 0.4 * f;
          const by = c + Math.sin(a) * size * 0.4 * f;
          for (const s of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(bx + Math.cos(a + s * 0.9) * size * 0.08, by + Math.sin(a + s * 0.9) * size * 0.08);
            ctx.stroke();
          }
        }
      }
      ctx.fillStyle = p.accent2;
      star(ctx, c, c, size * 0.11, size * 0.05, 6, 0);
      ctx.fill();
      break;
    }
  }
  noise(ctx, size, 22, rng);
  glaze(ctx, size, 0.3);
  edge(ctx, size, 'rgba(0,0,0,0.3)', 5);
}

// ---------------------------------------------------------------------------
// Stained glass

const GLASS = [
  ['#0b2f8a', '#1f63d6', '#4f9cf5'],
  ['#c77d00', '#f0b000', '#ffd54a'],
  ['#7d0b1c', '#c41a35', '#ef3f5a'],
  ['#120f24', '#2d2650', '#4d4480'],
  ['#8fc3e6', '#bfe0f5', '#e8f5ff'],
];

function paintGlass(ctx, size, color, rng) {
  const palette = GLASS[color];
  const n = 4;
  const cell = size / n;
  const pts = [];
  for (let y = 0; y <= n; y++) {
    pts.push([]);
    for (let x = 0; x <= n; x++) {
      const jx = x === 0 || x === n ? 0 : (rng() - 0.5) * cell * 0.7;
      const jy = y === 0 || y === n ? 0 : (rng() - 0.5) * cell * 0.7;
      pts[y].push([x * cell + jx, y * cell + jy]);
    }
  }
  const tri = (a, b, c) => {
    const shadeAmt = (rng() - 0.5) * 0.4;
    const base = palette[Math.floor(rng() * palette.length)];
    const g = ctx.createLinearGradient(a[0], a[1], c[0], c[1]);
    g.addColorStop(0, shade(base, shadeAmt + 0.15));
    g.addColorStop(1, shade(base, shadeAmt - 0.15));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.lineTo(c[0], c[1]);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#141414';
    ctx.lineWidth = size * 0.018;
    ctx.lineJoin = 'round';
    ctx.stroke();
  };
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const p00 = pts[y][x];
      const p10 = pts[y][x + 1];
      const p01 = pts[y + 1][x];
      const p11 = pts[y + 1][x + 1];
      if (rng() < 0.5) {
        tri(p00, p10, p11);
        tri(p00, p11, p01);
      } else {
        tri(p00, p10, p01);
        tri(p10, p11, p01);
      }
    }
  }
  glaze(ctx, size, 0.25);
  edge(ctx, size, '#141414', 8);
}

// ---------------------------------------------------------------------------
// Chocolate

const CHOCOLATE = [
  { base: '#3a1d10', swirl: '#5a3220', name: 'Dark' },
  { base: '#7a4526', swirl: '#9a6240', name: 'Milk' },
  { base: '#f1e2c2', swirl: '#d9c39a', name: 'White' },
  { base: '#b8701f', swirl: '#d99a4a', name: 'Caramel' },
  { base: '#c45a74', swirl: '#e58aa0', name: 'Ruby' },
];

function paintChocolate(ctx, size, color, rng) {
  const p = CHOCOLATE[color];
  ctx.fillStyle = p.base;
  ctx.fillRect(0, 0, size, size);
  ctx.lineCap = 'round';
  for (let i = 0; i < 14; i++) {
    ctx.strokeStyle = shade(p.swirl, (rng() - 0.5) * 0.3);
    ctx.globalAlpha = 0.25 + rng() * 0.3;
    ctx.lineWidth = size * (0.03 + rng() * 0.08);
    ctx.beginPath();
    ctx.moveTo(rng() * size, rng() * size);
    ctx.bezierCurveTo(rng() * size, rng() * size, rng() * size, rng() * size, rng() * size, rng() * size);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Embossed bar segment: inset square with highlight and shadow edges.
  const inset = size * 0.14;
  ctx.lineWidth = size * 0.03;
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  ctx.moveTo(inset, size - inset);
  ctx.lineTo(inset, inset);
  ctx.lineTo(size - inset, inset);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.moveTo(size - inset, inset);
  ctx.lineTo(size - inset, size - inset);
  ctx.lineTo(inset, size - inset);
  ctx.stroke();
  // Little monogram in the center.
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  star(ctx, size / 2, size / 2, size * 0.13, size * 0.07, 5, -Math.PI / 2);
  ctx.fill();
  noise(ctx, size, 14, rng);
  glaze(ctx, size, 0.25);
}

// ---------------------------------------------------------------------------
// Gemstone

const GEMS = [
  { base: '#1b47c9', name: 'Sapphire' },
  { base: '#f2b02c', name: 'Citrine' },
  { base: '#cf1f3f', name: 'Ruby' },
  { base: '#1c1b23', name: 'Onyx' },
  { base: '#e7eefb', name: 'Moonstone' },
];

function paintGem(ctx, size, color, rng) {
  const p = GEMS[color];
  const c = size / 2;
  ctx.fillStyle = p.base;
  ctx.fillRect(0, 0, size, size);
  const facets = 10;
  const tableR = size * 0.26;
  const outer = [];
  for (let i = 0; i < facets; i++) {
    const a = (Math.PI * 2 * i) / facets + Math.PI / facets;
    const r = size * (0.62 + rng() * 0.12);
    outer.push([c + Math.cos(a) * r, c + Math.sin(a) * r]);
  }
  for (let i = 0; i < facets; i++) {
    const a0 = (Math.PI * 2 * i) / facets;
    const a1 = (Math.PI * 2 * (i + 1)) / facets;
    const t0 = [c + Math.cos(a0) * tableR, c + Math.sin(a0) * tableR];
    const t1 = [c + Math.cos(a1) * tableR, c + Math.sin(a1) * tableR];
    const o = outer[i];
    const light = Math.cos(a0 - Math.PI * 1.25); // light from top-left
    ctx.fillStyle = shade(p.base, light * 0.32 + (rng() - 0.5) * 0.12);
    ctx.beginPath();
    ctx.moveTo(t0[0], t0[1]);
    ctx.lineTo(o[0], o[1]);
    ctx.lineTo(t1[0], t1[1]);
    ctx.closePath();
    ctx.fill();
    const o2 = outer[(i + 1) % facets];
    ctx.fillStyle = shade(p.base, light * 0.2 - 0.1 + (rng() - 0.5) * 0.12);
    ctx.beginPath();
    ctx.moveTo(t1[0], t1[1]);
    ctx.lineTo(o[0], o[1]);
    ctx.lineTo(o2[0], o2[1]);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = shade(p.base, 0.18);
  ctx.beginPath();
  ctx.arc(c, c, tableR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = size * 0.012;
  for (let i = 0; i < facets; i++) {
    const a = (Math.PI * 2 * i) / facets;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * tableR, c + Math.sin(a) * tableR);
    ctx.lineTo(outer[i][0], outer[i][1]);
    ctx.stroke();
  }
  glaze(ctx, size, 0.55);
  edge(ctx, size, 'rgba(0,0,0,0.5)', 10);
}

// ---------------------------------------------------------------------------
// Photo set (hand-painted Talavera tiles shipped in /assets)

const TALAVERA_FILES = ['tile1.jpg', 'tile5.jpg', 'tile2.jpg', 'tile3.jpg', 'tile4.jpg'];

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

// ---------------------------------------------------------------------------
// Registry

export const TILE_SETS = {
  classic: {
    id: 'classic',
    name: 'Classic Mosaic',
    tagline: 'Glazed azulejo ceramics, the way the game was born.',
    paint: paintClassic,
    style: { kind: 'ceramic', roughness: 0.35, metalness: 0.0, clearcoat: 0.4, rounded: 0.05 },
    labels: ['Blue', 'Yellow', 'Red', 'Black', 'Ivory'],
  },
  glass: {
    id: 'glass',
    name: 'Stained Glass',
    tagline: 'Leaded panes that glow when the light hits them.',
    paint: paintGlass,
    style: { kind: 'glass', roughness: 0.18, metalness: 0.0, clearcoat: 0.8, rounded: 0.02, emissive: 0.22, opacity: 0.97 },
    labels: ['Cobalt', 'Amber', 'Crimson', 'Violet', 'Frost'],
  },
  chocolate: {
    id: 'chocolate',
    name: 'Chocolate',
    tagline: 'Five flavours of confectionery, melt-proof.',
    paint: paintChocolate,
    style: { kind: 'chocolate', roughness: 0.32, metalness: 0.0, clearcoat: 0.5, rounded: 0.1 },
    labels: CHOCOLATE.map((c) => c.name),
  },
  gem: {
    id: 'gem',
    name: 'Gemstone',
    tagline: 'Faceted stones with a jeweller’s polish.',
    paint: paintGem,
    style: { kind: 'gem', roughness: 0.08, metalness: 0.25, clearcoat: 1.0, rounded: 0.08, emissive: 0.08 },
    labels: GEMS.map((g) => g.name),
  },
  talavera: {
    id: 'talavera',
    name: 'Talavera',
    tagline: 'Photographed hand-painted tiles from Puebla.',
    photos: TALAVERA_FILES,
    style: { kind: 'ceramic', roughness: 0.4, metalness: 0.0, clearcoat: 0.3, rounded: 0.04 },
    labels: ['Daisy', 'Fern', 'Poppy', 'Scroll', 'Dahlia'],
  },
};

export const TILE_SET_ORDER = ['classic', 'glass', 'chocolate', 'gem', 'talavera'];

/**
 * Build the five canvases for a tile set.
 * @returns {Promise<{id,name,style,labels,canvases:HTMLCanvasElement[],dataUrls:string[]}>}
 */
export async function buildTileSet(id, { seed = 'azul', size = TEXTURE_SIZE, assetBase = 'assets/' } = {}) {
  const def = TILE_SETS[id] || TILE_SETS.classic;
  const canvases = [];
  for (let color = 0; color < COLORS.length; color++) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (def.photos) {
      const img = await loadImage(assetBase + def.photos[color]);
      ctx.drawImage(img, 0, 0, size, size);
      glaze(ctx, size, 0.2);
      edge(ctx, size, 'rgba(0,0,0,0.25)', 5);
    } else {
      def.paint(ctx, size, color, makeRng(`${seed}-${id}-${color}`));
    }
    canvases.push(canvas);
  }
  return {
    id: def.id,
    name: def.name,
    tagline: def.tagline,
    style: def.style,
    labels: def.labels,
    canvases,
    dataUrls: canvases.map((c) => c.toDataURL('image/png')),
  };
}

/** Plain CSS colors used for highlights and the 2D mini boards. */
export const COLOR_SWATCH = ['#2b6fd6', '#f0b429', '#d9403a', '#2a2a33', '#eef2f5'];
