// Player board: a single source of truth for where every cell lives (used by
// the 3D scene for hit targets and tile placement) plus a canvas painter that
// draws the board artwork around those cells.
//
// Board-local coordinates: x grows to the right, y grows downward, origin at
// the top-left corner, units match world units.

import { FLOOR_PENALTIES, WALL_SIZE, wallColorAt } from '../engine/constants.js';

export const BOARD_W = 10;
export const BOARD_H = 7.4;
export const CELL = 0.64;
export const PITCH = 0.74;

const SCORE_CELL_W = 0.44;
const SCORE_CELL_H = 0.3;
const SCORE_ROW_PITCH = 0.33;
const SCORE_X0 = 0.8;
const SCORE_Y0 = 0.42;
const MID_Y0 = 2.45;
const WALL_X0 = 5.4;
const PATTERN_RIGHT = 4.7;
const FLOOR_Y0 = 6.35;
const FLOOR_X0 = 0.7;

export const layout = {
  /** Pattern line `row`, slot `k` where k = 0 is the rightmost slot. */
  patternCell(row, k) {
    return { x: PATTERN_RIGHT - (k + 1) * PITCH + (PITCH - CELL), y: MID_Y0 + row * PITCH, w: CELL, h: CELL };
  },
  wallCell(row, col) {
    return { x: WALL_X0 + col * PITCH, y: MID_Y0 + row * PITCH, w: CELL, h: CELL };
  },
  floorCell(i) {
    return { x: FLOOR_X0 + i * PITCH, y: FLOOR_Y0, w: CELL, h: CELL };
  },
  /** Score track cell for a score 0..100 (clamped). */
  scoreCell(score) {
    const s = Math.max(0, Math.min(100, Math.round(score)));
    if (s === 0) return { x: SCORE_X0 - SCORE_CELL_W - 0.06, y: SCORE_Y0, w: SCORE_CELL_W, h: SCORE_CELL_H };
    const row = Math.floor((s - 1) / 20);
    const col = (s - 1) % 20;
    return { x: SCORE_X0 + col * SCORE_CELL_W, y: SCORE_Y0 + row * SCORE_ROW_PITCH, w: SCORE_CELL_W, h: SCORE_CELL_H };
  },
  /** Bounding box of a whole row band (pattern line through wall) for hit testing. */
  rowBand(row) {
    const left = this.patternCell(row, row);
    const right = this.wallCell(row, WALL_SIZE - 1);
    return { x: left.x - 0.1, y: left.y - 0.05, w: right.x + right.w - left.x + 0.2, h: CELL + 0.1 };
  },
  floorBand() {
    const first = this.floorCell(0);
    const last = this.floorCell(FLOOR_PENALTIES.length - 1);
    return { x: first.x - 0.1, y: first.y - 0.25, w: last.x + last.w - first.x + 0.2, h: CELL + 0.35 };
  },
  center(rect) {
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  },
};

// ---------------------------------------------------------------------------
// Painting

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function parchment(ctx, w, h, rng) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#f6efe0');
  g.addColorStop(1, '#eadfca');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 0.06;
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = rng() < 0.5 ? '#000' : '#fff';
    const r = 1 + rng() * 3;
    ctx.beginPath();
    ctx.arc(rng() * w, rng() * h, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function tileBorder(ctx, w, h, S, accent) {
  // Blue-and-white azulejo border strip around the whole board.
  const band = 0.22 * S;
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, w, band);
  ctx.fillRect(0, h - band, w, band);
  ctx.fillRect(0, 0, band, h);
  ctx.fillRect(w - band, 0, band, h);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  const step = 0.5 * S;
  for (let x = band / 2; x < w; x += step) {
    ctx.beginPath();
    ctx.arc(x, band / 2, band * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, h - band / 2, band * 0.18, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let y = band / 2; y < h; y += step) {
    ctx.beginPath();
    ctx.arc(band / 2, y, band * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(w - band / 2, y, band * 0.18, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(band, band, w - 2 * band, h - 2 * band);
}

function cellFrame(ctx, r, S, { fill = 'rgba(255,255,255,0.55)', stroke = '#8c7b5a', dashed = false } = {}) {
  ctx.save();
  if (dashed) ctx.setLineDash([S * 0.04, S * 0.03]);
  roundRect(ctx, r.x * S, r.y * S, r.w * S, r.h * S, S * 0.05);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = S * 0.012;
  ctx.stroke();
  ctx.restore();
}

function text(ctx, str, x, y, size, { color = '#3b3225', font = 'Georgia, serif', weight = 'bold', align = 'center' } = {}) {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}

/**
 * Paint a board onto `canvas`.
 * @param canvas HTMLCanvasElement (will be resized)
 * @param options.tileCanvases canvases per color, used as faint wall markers
 * @param options.name player name shown on the board
 * @param options.accent CSS color for the border
 * @param options.scale pixels per unit
 */
export function paintBoard(canvas, { tileCanvases = [], name = '', accent = '#1f4e8c', scale = 150, rng = Math.random } = {}) {
  const S = scale;
  const w = Math.round(BOARD_W * S);
  const h = Math.round(BOARD_H * S);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  parchment(ctx, w, h, rng);
  tileBorder(ctx, w, h, S, accent);

  // Score track ---------------------------------------------------------------
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  roundRect(ctx, 0.3 * S, 0.3 * S, 9.4 * S, 1.95 * S, 0.1 * S);
  ctx.fill();
  for (let s = 0; s <= 100; s++) {
    const r = layout.scoreCell(s);
    const milestone = s % 5 === 0 && s > 0;
    cellFrame(ctx, r, S, {
      fill: milestone ? 'rgba(232,170,60,0.85)' : 'rgba(255,255,255,0.7)',
      stroke: '#8c7b5a',
    });
    if (milestone || s === 0) {
      text(ctx, String(s), (r.x + r.w / 2) * S, (r.y + r.h / 2) * S, S * 0.16, { color: '#3b3225' });
    }
  }

  // Title cartouche -----------------------------------------------------------
  ctx.save();
  roundRect(ctx, 0.5 * S, 2.5 * S, 2.75 * S, 1.3 * S, 0.12 * S);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = S * 0.025;
  ctx.stroke();
  text(ctx, 'AZUL', 1.875 * S, 3.0 * S, S * 0.5, { color: accent });
  text(ctx, name.toUpperCase().slice(0, 16), 1.875 * S, 3.52 * S, S * 0.17, { color: '#5a4c37', font: 'Trebuchet MS, sans-serif', weight: '600' });
  ctx.restore();

  // Pattern lines -------------------------------------------------------------
  for (let row = 0; row < WALL_SIZE; row++) {
    for (let k = 0; k <= row; k++) cellFrame(ctx, layout.patternCell(row, k), S);
    // Arrow toward the wall.
    const r = layout.patternCell(row, 0);
    const ax = (r.x + r.w + 0.08) * S;
    const ay = (r.y + r.h / 2) * S;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(ax, ay - 0.16 * S);
    ctx.lineTo(ax + 0.34 * S, ay);
    ctx.lineTo(ax, ay + 0.16 * S);
    ctx.closePath();
    ctx.fill();
  }

  // Wall ----------------------------------------------------------------------
  for (let row = 0; row < WALL_SIZE; row++) {
    for (let col = 0; col < WALL_SIZE; col++) {
      const r = layout.wallCell(row, col);
      const color = wallColorAt(row, col);
      cellFrame(ctx, r, S, { fill: 'rgba(255,255,255,0.6)' });
      const src = tileCanvases[color];
      ctx.save();
      ctx.globalAlpha = 0.38;
      roundRect(ctx, (r.x + 0.04) * S, (r.y + 0.04) * S, (r.w - 0.08) * S, (r.h - 0.08) * S, 0.04 * S);
      ctx.clip();
      if (src) {
        ctx.drawImage(src, (r.x + 0.04) * S, (r.y + 0.04) * S, (r.w - 0.08) * S, (r.h - 0.08) * S);
      } else {
        ctx.fillStyle = ['#2b6fd6', '#f0b429', '#d9403a', '#2a2a33', '#eef2f5'][color];
        ctx.fillRect((r.x + 0.04) * S, (r.y + 0.04) * S, (r.w - 0.08) * S, (r.h - 0.08) * S);
      }
      ctx.restore();
    }
  }

  // Floor line ----------------------------------------------------------------
  for (let i = 0; i < FLOOR_PENALTIES.length; i++) {
    const r = layout.floorCell(i);
    cellFrame(ctx, r, S, { fill: 'rgba(214,190,160,0.5)', stroke: '#8c5a3a' });
    text(ctx, String(FLOOR_PENALTIES[i]), (r.x + r.w / 2) * S, (r.y - 0.13) * S, S * 0.18, { color: '#8c3a2a' });
  }

  // Bonus legend --------------------------------------------------------------
  ctx.save();
  roundRect(ctx, 6.2 * S, 6.2 * S, 3.3 * S, 0.85 * S, 0.1 * S);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = S * 0.015;
  ctx.stroke();
  const legend = [
    ['Row', '+2'],
    ['Column', '+7'],
    ['Colour', '+10'],
  ];
  legend.forEach(([label, pts], i) => {
    const x = (6.45 + i * 1.08) * S;
    text(ctx, pts, x + 0.3 * S, 6.48 * S, S * 0.26, { color: accent });
    text(ctx, label, x + 0.3 * S, 6.82 * S, S * 0.13, { color: '#5a4c37', font: 'Trebuchet MS, sans-serif', weight: '600' });
  });
  ctx.restore();

  return canvas;
}
