// Computer opponents. Three strategies of increasing strength:
//   novice  – mostly random, avoids obviously wasteful moves.
//   artisan – greedy: picks the move with the best immediate board value.
//   master  – two-ply: scores each candidate by its own value minus the best
//             reply the next player can make, plus end-game awareness.
//
// Everything here is deterministic given the rng function passed in.

import { COLOR_COUNT, WALL_SIZE, FLOOR_PENALTIES, wallColumnFor } from './constants.js';
import {
  legalMoves,
  applyMove,
  cloneState,
  scoreTilePlacement,
  floorPenalty,
  isFirstPlayerToken,
  FLOOR_ROW,
} from './game.js';

export const DIFFICULTIES = {
  novice: {
    id: 'novice',
    name: 'Novice',
    tagline: 'Plays on instinct. Makes mistakes.',
  },
  artisan: {
    id: 'artisan',
    name: 'Artisan',
    tagline: 'Greedy and tidy. Rarely wastes a tile.',
  },
  master: {
    id: 'master',
    name: 'Master',
    tagline: 'Reads your board and denies what you need.',
  },
};

// ---------------------------------------------------------------------------
// Board evaluation

/** Count tiles of each color that are still obtainable this round. */
function supplyByColor(state) {
  const counts = Array(COLOR_COUNT).fill(0);
  for (const f of state.factories) for (const t of f) counts[t.color]++;
  for (const t of state.center) if (!isFirstPlayerToken(t)) counts[t.color]++;
  return counts;
}

/**
 * Heuristic value of a player's position. Approximates the points the player
 * will earn at the end of the round plus progress toward future points.
 */
export function evaluatePlayer(player, state, options = {}) {
  const endGameWeight = options.endGameWeight ?? 0.35;
  const supply = supplyByColor(state);
  const wall = player.wall.map((row) => row.slice());
  let value = 0;

  // Completed lines will score when tiled; simulate placements in row order.
  for (let row = 0; row < WALL_SIZE; row++) {
    const line = player.lines[row];
    if (line.length === row + 1) {
      const col = wallColumnFor(row, line[0].color);
      wall[row][col] = line[0];
      value += scoreTilePlacement(wall, row, col);
    }
  }
  // Partially filled lines: credit progress, discounted by how hard it is to
  // finish (tiles still needed vs. tiles still in supply).
  for (let row = 0; row < WALL_SIZE; row++) {
    const line = player.lines[row];
    if (line.length === 0 || line.length === row + 1) continue;
    const color = line[0].color;
    const need = row + 1 - line.length;
    const col = wallColumnFor(row, color);
    wall[row][col] = line[0];
    const projected = scoreTilePlacement(wall, row, col);
    wall[row][col] = null;
    const feasibility = supply[color] >= need ? 1 : 0.4;
    const progress = line.length / (row + 1);
    value += projected * progress * 0.55 * feasibility;
    // A line we cannot finish this round leaks into the next one; small cost.
    if (supply[color] < need) value -= 0.5 * need;
  }

  value += floorPenalty(player.floor);

  // Structural bonuses: nearly complete rows / columns / colors are valuable.
  let structure = 0;
  const colorCounts = Array(COLOR_COUNT).fill(0);
  for (let r = 0; r < WALL_SIZE; r++) {
    let rowCount = 0;
    for (let c = 0; c < WALL_SIZE; c++) {
      if (wall[r][c]) {
        rowCount++;
        colorCounts[wall[r][c].color]++;
      }
    }
    structure += 2 * Math.pow(rowCount / WALL_SIZE, 2);
  }
  for (let c = 0; c < WALL_SIZE; c++) {
    let colCount = 0;
    for (let r = 0; r < WALL_SIZE; r++) if (wall[r][c]) colCount++;
    structure += 7 * Math.pow(colCount / WALL_SIZE, 3);
  }
  for (const n of colorCounts) structure += 10 * Math.pow(n / WALL_SIZE, 3);
  value += structure * endGameWeight;

  return value;
}

function moveWaste(player, move, tiles) {
  if (move.row === FLOOR_ROW) return tiles;
  const line = player.lines[move.row];
  return Math.max(0, tiles - (move.row + 1 - line.length));
}

function tilesForMove(state, move) {
  const pool = move.source === 'factory' ? state.factories[move.index] : state.center;
  return pool.filter((t) => t.color === move.color).length;
}

function pickBest(scored, rng, noise = 0) {
  let best = -Infinity;
  let choice = null;
  for (const entry of scored) {
    const v = entry.value + (noise ? (rng() - 0.5) * noise : 0);
    if (v > best) {
      best = v;
      choice = entry;
    }
  }
  return choice;
}

function nextPlayerIndex(state, playerIndex) {
  return (playerIndex + 1) % state.players.length;
}

// ---------------------------------------------------------------------------
// Strategies

function noviceMove(state, rng) {
  const moves = legalMoves(state);
  const player = state.players[state.current];
  const decent = moves.filter((m) => {
    const tiles = tilesForMove(state, m);
    return m.row !== FLOOR_ROW && moveWaste(player, m, tiles) <= 1;
  });
  const pool = decent.length && rng() < 0.85 ? decent : moves;
  return pool[Math.floor(rng() * pool.length)];
}

function greedyScores(state, playerIndex, options) {
  const moves = legalMoves(state, playerIndex);
  const baseline = evaluatePlayer(state.players[playerIndex], state, options);
  return moves.map((move) => {
    const next = cloneState(state);
    next.current = playerIndex;
    applyMove(next, move);
    const value = evaluatePlayer(next.players[playerIndex], next, options) - baseline;
    return { move, value, next };
  });
}

function artisanMove(state, rng) {
  const scored = greedyScores(state, state.current, {});
  return pickBest(scored, rng, 0.6).move;
}

function masterMove(state, rng) {
  const me = state.current;
  const nearEnd = state.players.some((p) => p.wall.some((row) => row.filter(Boolean).length >= 4));
  const options = { endGameWeight: nearEnd ? 0.9 : 0.4 };
  const scored = greedyScores(state, me, options).sort((a, b) => b.value - a.value);
  const candidates = scored.slice(0, 10);
  const opponent = nextPlayerIndex(state, me);

  const evaluated = candidates.map((entry) => {
    let reply = 0;
    if (entry.next.phase === 'draft' && entry.next.current === opponent) {
      const replies = greedyScores(entry.next, opponent, options);
      for (const r of replies) reply = Math.max(reply, r.value);
    }
    // Taking the first-player token is worth a little in a tight race.
    const token = entry.move.source === 'center' && state.centerHasFirstPlayer ? 0.8 : 0;
    return { move: entry.move, value: entry.value - 0.7 * reply + token };
  });
  return pickBest(evaluated, rng, 0.15).move;
}

const STRATEGIES = { novice: noviceMove, artisan: artisanMove, master: masterMove };

/**
 * Choose a move for the current player.
 * @param {object} state  engine state (not mutated)
 * @param {string} difficulty one of DIFFICULTIES keys
 * @param {() => number} rng   random source in [0, 1)
 */
export function chooseMove(state, difficulty = 'artisan', rng = Math.random) {
  const strategy = STRATEGIES[difficulty] || STRATEGIES.artisan;
  const move = strategy(state, rng);
  if (!move) throw new Error('No legal moves available');
  return move;
}

export { FLOOR_PENALTIES };
