// Azul rules engine. Pure data + functions, no DOM. State objects are plain
// JSON-serialisable so they can be cloned, saved, and inspected in tests.
//
// A tile is { id: number, color: 0..4 }. The first-player marker is the special
// tile { id: 'first', color: 'first' } and only ever lives in the center or on a
// floor line.

import {
  COLOR_COUNT,
  TILES_PER_COLOR,
  WALL_SIZE,
  FACTORY_CAPACITY,
  FLOOR_PENALTIES,
  FACTORIES_BY_PLAYERS,
  FIRST_PLAYER_TOKEN,
  BONUS_ROW,
  BONUS_COLUMN,
  BONUS_COLOR,
  wallColumnFor,
} from './constants.js';
import { hashSeed, shuffle } from './rng.js';

export const FLOOR_ROW = -1;

export function isFirstPlayerToken(tile) {
  return tile && tile.color === FIRST_PLAYER_TOKEN;
}

// ---------------------------------------------------------------------------
// Construction

export function createPlayer(spec, index) {
  return {
    index,
    name: spec.name || `Player ${index + 1}`,
    type: spec.type || 'ai', // 'human' | 'ai'
    difficulty: spec.difficulty || 'artisan',
    score: 0,
    wall: Array.from({ length: WALL_SIZE }, () => Array(WALL_SIZE).fill(null)),
    lines: Array.from({ length: WALL_SIZE }, () => []),
    floor: [],
  };
}

export function createGame({ players, seed = Date.now() } = {}) {
  if (!players || players.length < 2 || players.length > 4) {
    throw new Error('Azul needs 2 to 4 players');
  }
  const state = {
    rngState: hashSeed(seed),
    seed,
    round: 0,
    phase: 'draft', // 'draft' | 'roundEnd' | 'gameOver'
    players: players.map(createPlayer),
    factories: Array.from({ length: FACTORIES_BY_PLAYERS[players.length] }, () => []),
    center: [],
    centerHasFirstPlayer: false,
    bag: [],
    lid: [],
    current: 0,
    nextStarter: null,
    moveCount: 0,
    winner: null,
    history: [],
  };
  let id = 0;
  for (let c = 0; c < COLOR_COUNT; c++) {
    for (let i = 0; i < TILES_PER_COLOR; i++) state.bag.push({ id: id++, color: c });
  }
  shuffle(state, state.bag);
  startRound(state);
  return state;
}

export function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

// ---------------------------------------------------------------------------
// Round setup

function drawFromBag(state) {
  if (state.bag.length === 0 && state.lid.length > 0) {
    state.bag = shuffle(state, state.lid.splice(0));
  }
  return state.bag.pop() || null;
}

export function startRound(state) {
  state.round += 1;
  state.phase = 'draft';
  state.centerHasFirstPlayer = true;
  state.center = [];
  for (const factory of state.factories) {
    factory.length = 0;
    for (let i = 0; i < FACTORY_CAPACITY; i++) {
      const tile = drawFromBag(state);
      if (!tile) break;
      factory.push(tile);
    }
  }
  if (state.nextStarter !== null && state.nextStarter !== undefined) {
    state.current = state.nextStarter;
  }
  state.nextStarter = null;
  return state;
}

// ---------------------------------------------------------------------------
// Queries

export function currentPlayer(state) {
  return state.players[state.current];
}

export function isDraftOver(state) {
  return state.factories.every((f) => f.length === 0) && state.center.length === 0;
}

/** A color may go in a pattern row if the row is empty or holds that color, and
 *  the matching wall cell is still free. */
export function canPlaceInRow(player, row, color) {
  if (row < 0 || row >= WALL_SIZE) return false;
  const line = player.lines[row];
  if (line.length >= row + 1) return false;
  if (line.length > 0 && line[0].color !== color) return false;
  const col = wallColumnFor(row, color);
  return player.wall[row][col] === null;
}

function colorsIn(tiles) {
  const seen = new Set();
  for (const t of tiles) if (!isFirstPlayerToken(t)) seen.add(t.color);
  return [...seen].sort((a, b) => a - b);
}

/** Every legal move for the current player: { source, index, color, row }. */
export function legalMoves(state, playerIndex = state.current) {
  if (state.phase !== 'draft') return [];
  const player = state.players[playerIndex];
  const moves = [];
  const addMoves = (source, index, tiles) => {
    for (const color of colorsIn(tiles)) {
      for (let row = 0; row < WALL_SIZE; row++) {
        if (canPlaceInRow(player, row, color)) moves.push({ source, index, color, row });
      }
      moves.push({ source, index, color, row: FLOOR_ROW });
    }
  };
  state.factories.forEach((f, i) => addMoves('factory', i, f));
  addMoves('center', 0, state.center);
  return moves;
}

export function isLegalMove(state, move) {
  return legalMoves(state).some(
    (m) =>
      m.source === move.source &&
      m.index === move.index &&
      m.color === move.color &&
      m.row === move.row,
  );
}

// ---------------------------------------------------------------------------
// Drafting

/**
 * Apply a drafting move for the current player. Mutates `state` and returns a
 * description of what moved so the UI can animate it.
 */
export function applyMove(state, move) {
  if (state.phase !== 'draft') throw new Error('Not in drafting phase');
  if (!isLegalMove(state, move)) {
    throw new Error(`Illegal move: ${JSON.stringify(move)}`);
  }
  const player = currentPlayer(state);
  const result = {
    player: state.current,
    move,
    taken: [],
    toLine: [],
    toFloor: [],
    toLid: [],
    toCenter: [],
    tookFirstPlayer: false,
  };

  // 1. Take tiles from the source.
  let pool;
  if (move.source === 'factory') {
    pool = state.factories[move.index];
    const rest = [];
    for (const t of pool) (t.color === move.color ? result.taken : rest).push(t);
    pool.length = 0;
    state.center.push(...rest);
    result.toCenter = rest;
  } else {
    pool = state.center;
    const rest = [];
    for (const t of pool) (t.color === move.color ? result.taken : rest).push(t);
    state.center = rest;
    if (state.centerHasFirstPlayer) {
      state.centerHasFirstPlayer = false;
      state.nextStarter = state.current;
      result.tookFirstPlayer = true;
      placeOnFloor(state, player, { id: FIRST_PLAYER_TOKEN, color: FIRST_PLAYER_TOKEN }, result);
    }
  }

  // 2. Place them.
  if (move.row === FLOOR_ROW) {
    for (const t of result.taken) placeOnFloor(state, player, t, result);
  } else {
    const line = player.lines[move.row];
    const capacity = move.row + 1;
    for (const t of result.taken) {
      if (line.length < capacity) {
        line.push(t);
        result.toLine.push(t);
      } else {
        placeOnFloor(state, player, t, result);
      }
    }
  }

  state.moveCount += 1;
  state.history.push({ round: state.round, player: state.current, move });

  // 3. Advance.
  if (isDraftOver(state)) {
    state.phase = 'roundEnd';
  } else {
    state.current = (state.current + 1) % state.players.length;
  }
  return result;
}

function placeOnFloor(state, player, tile, result) {
  if (player.floor.length < FLOOR_PENALTIES.length) {
    player.floor.push(tile);
    result.toFloor.push(tile);
  } else if (!isFirstPlayerToken(tile)) {
    state.lid.push(tile);
    result.toLid.push(tile);
  } else {
    // Overflowing first-player token still counts; keep it on the floor.
    player.floor.push(tile);
    result.toFloor.push(tile);
  }
}

// ---------------------------------------------------------------------------
// Scoring

/** Points for a tile newly placed at (row, col) on `wall` (cell must be filled). */
export function scoreTilePlacement(wall, row, col) {
  let horizontal = 1;
  for (let c = col - 1; c >= 0 && wall[row][c]; c--) horizontal++;
  for (let c = col + 1; c < WALL_SIZE && wall[row][c]; c++) horizontal++;
  let vertical = 1;
  for (let r = row - 1; r >= 0 && wall[r][col]; r--) vertical++;
  for (let r = row + 1; r < WALL_SIZE && wall[r][col]; r++) vertical++;
  if (horizontal > 1 && vertical > 1) return horizontal + vertical;
  if (horizontal > 1) return horizontal;
  if (vertical > 1) return vertical;
  return 1;
}

export function floorPenalty(floor) {
  let total = 0;
  for (let i = 0; i < floor.length && i < FLOOR_PENALTIES.length; i++) total += FLOOR_PENALTIES[i];
  return total;
}

export function completedRows(wall) {
  return wall.filter((row) => row.every(Boolean)).length;
}

export function completedColumns(wall) {
  let n = 0;
  for (let c = 0; c < WALL_SIZE; c++) {
    if (wall.every((row) => row[c])) n++;
  }
  return n;
}

export function completedColors(wall) {
  const counts = Array(COLOR_COUNT).fill(0);
  for (const row of wall) for (const t of row) if (t) counts[t.color]++;
  return counts.filter((n) => n === WALL_SIZE).length;
}

export function endGameBonus(wall) {
  const rows = completedRows(wall);
  const cols = completedColumns(wall);
  const colors = completedColors(wall);
  return {
    rows,
    cols,
    colors,
    total: rows * BONUS_ROW + cols * BONUS_COLUMN + colors * BONUS_COLOR,
  };
}

// ---------------------------------------------------------------------------
// Round end

/**
 * Wall-tiling phase. Moves completed pattern lines to the wall, scores them,
 * applies floor penalties, then either starts the next round or finishes the
 * game. Returns an ordered list of events for animation.
 */
export function endRound(state) {
  if (state.phase !== 'roundEnd') throw new Error('Draft is not finished');
  const events = [];

  state.players.forEach((player, p) => {
    for (let row = 0; row < WALL_SIZE; row++) {
      const line = player.lines[row];
      if (line.length !== row + 1) continue;
      const tile = line[line.length - 1];
      const col = wallColumnFor(row, tile.color);
      player.wall[row][col] = tile;
      const points = scoreTilePlacement(player.wall, row, col);
      player.score += points;
      const discarded = line.slice(0, -1);
      state.lid.push(...discarded);
      player.lines[row] = [];
      events.push({ type: 'wall', player: p, row, col, tile, points, discarded, score: player.score });
    }
    if (player.floor.length) {
      const penalty = floorPenalty(player.floor);
      const before = player.score;
      player.score = Math.max(0, player.score + penalty);
      const tiles = player.floor.filter((t) => !isFirstPlayerToken(t));
      state.lid.push(...tiles);
      const hadToken = player.floor.some(isFirstPlayerToken);
      player.floor = [];
      events.push({
        type: 'floor',
        player: p,
        penalty,
        applied: player.score - before,
        tiles,
        hadToken,
        score: player.score,
      });
    }
  });

  const gameOver = state.players.some((pl) => completedRows(pl.wall) > 0);
  if (gameOver) {
    state.players.forEach((player, p) => {
      const bonus = endGameBonus(player.wall);
      player.score += bonus.total;
      player.bonus = bonus;
      events.push({ type: 'bonus', player: p, ...bonus, score: player.score });
    });
    state.phase = 'gameOver';
    state.ranking = finalRanking(state);
    state.winner = state.ranking[0];
    events.push({ type: 'gameOver', ranking: state.ranking });
  } else {
    if (state.nextStarter === null) state.nextStarter = state.current;
    startRound(state);
    events.push({ type: 'newRound', round: state.round, starter: state.current });
  }
  return events;
}

/** Player indices sorted best to worst (score, then completed rows). */
export function finalRanking(state) {
  return state.players
    .map((p) => p.index)
    .sort((a, b) => {
      const pa = state.players[a];
      const pb = state.players[b];
      if (pb.score !== pa.score) return pb.score - pa.score;
      return completedRows(pb.wall) - completedRows(pa.wall);
    });
}

/** Total tiles currently tracked anywhere (should always be 100). */
export function countTiles(state) {
  let n = state.bag.length + state.lid.length + state.center.length;
  for (const f of state.factories) n += f.length;
  for (const p of state.players) {
    n += p.floor.filter((t) => !isFirstPlayerToken(t)).length;
    for (const line of p.lines) n += line.length;
    for (const row of p.wall) for (const t of row) if (t) n++;
  }
  return n;
}
