import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createGame,
  createPlayer,
  legalMoves,
  applyMove,
  endRound,
  canPlaceInRow,
  scoreTilePlacement,
  floorPenalty,
  endGameBonus,
  countTiles,
  isDraftOver,
  FLOOR_ROW,
  finalRanking,
} from '../src/engine/game.js';
import { COLORS, wallColumnFor, wallColorAt, FACTORIES_BY_PLAYERS } from '../src/engine/constants.js';

const two = () => createGame({ players: [{ name: 'A', type: 'human' }, { name: 'B' }], seed: 42 });

function tile(id, color) {
  return { id, color };
}

function emptyWall() {
  return Array.from({ length: 5 }, () => Array(5).fill(null));
}

test('wall pattern maps colors to the standard diagonal layout', () => {
  assert.equal(wallColumnFor(0, 0), 0);
  assert.equal(wallColumnFor(1, 0), 1);
  assert.equal(wallColumnFor(4, 4), 3);
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      assert.equal(wallColumnFor(r, wallColorAt(r, c)), c);
    }
  }
});

test('createGame deals the right number of factories and keeps 100 tiles', () => {
  for (const n of [2, 3, 4]) {
    const players = Array.from({ length: n }, (_, i) => ({ name: `P${i}` }));
    const state = createGame({ players, seed: 1 });
    assert.equal(state.factories.length, FACTORIES_BY_PLAYERS[n]);
    assert.ok(state.factories.every((f) => f.length === 4));
    assert.equal(countTiles(state), 100);
    assert.equal(state.bag.length, 100 - 4 * FACTORIES_BY_PLAYERS[n]);
    assert.equal(state.centerHasFirstPlayer, true);
    assert.equal(state.round, 1);
  }
});

test('the same seed produces the same deal', () => {
  const a = two();
  const b = two();
  assert.deepEqual(a.factories, b.factories);
  assert.deepEqual(a.bag.map((t) => t.id), b.bag.map((t) => t.id));
});

test('createGame rejects invalid player counts', () => {
  assert.throws(() => createGame({ players: [{ name: 'solo' }] }));
  assert.throws(() => createGame({ players: Array(5).fill({ name: 'x' }) }));
});

test('legalMoves lists every color on every factory plus a floor option', () => {
  const state = two();
  const moves = legalMoves(state);
  const factoryZeroColors = new Set(state.factories[0].map((t) => t.color));
  for (const color of factoryZeroColors) {
    const forColor = moves.filter((m) => m.source === 'factory' && m.index === 0 && m.color === color);
    // Empty board: every row accepts every color, plus the floor.
    assert.equal(forColor.length, 6);
    assert.ok(forColor.some((m) => m.row === FLOOR_ROW));
  }
  // Center is empty at the start of the game, so no center moves yet.
  assert.equal(moves.filter((m) => m.source === 'center').length, 0);
});

test('taking from a factory moves the rest to the center', () => {
  const state = two();
  const factory = state.factories[0].slice();
  const color = factory[0].color;
  const count = factory.filter((t) => t.color === color).length;
  const result = applyMove(state, { source: 'factory', index: 0, color, row: 4 });
  assert.equal(result.taken.length, count);
  assert.equal(state.factories[0].length, 0);
  assert.equal(state.center.length, 4 - count);
  assert.equal(state.players[0].lines[4].length, count);
  assert.equal(state.current, 1);
  assert.equal(countTiles(state), 100);
});

test('taking from the center first gives you the first-player token on the floor', () => {
  const state = two();
  const f = state.factories[0];
  const color = f[0].color;
  applyMove(state, { source: 'factory', index: 0, color, row: 4 });
  if (state.center.length === 0) return; // every tile in factory 0 was one color; nothing to test
  const centerColor = state.center[0].color;
  const result = applyMove(state, { source: 'center', index: 0, color: centerColor, row: 3 });
  assert.equal(result.tookFirstPlayer, true);
  assert.equal(state.centerHasFirstPlayer, false);
  assert.equal(state.nextStarter, 1);
  assert.ok(state.players[1].floor.some((t) => t.color === 'first'));
});

test('overflow from a pattern line goes to the floor, then to the lid', () => {
  const state = two();
  // Rig factory 0 to hold four blue tiles.
  state.factories[0] = [tile(900, 0), tile(901, 0), tile(902, 0), tile(903, 0)];
  const result = applyMove(state, { source: 'factory', index: 0, color: 0, row: 0 });
  assert.equal(result.toLine.length, 1);
  assert.equal(result.toFloor.length, 3);
  assert.equal(state.players[0].floor.length, 3);

  // Fill the floor to 7 and overflow into the lid.
  const p = state.players[1];
  p.floor = Array.from({ length: 7 }, (_, i) => tile(800 + i, 2));
  state.factories[1] = [tile(910, 1), tile(911, 1), tile(912, 1), tile(913, 1)];
  const lidBefore = state.lid.length;
  const r2 = applyMove(state, { source: 'factory', index: 1, color: 1, row: FLOOR_ROW });
  assert.equal(r2.toLid.length, 4);
  assert.equal(state.lid.length, lidBefore + 4);
});

test('canPlaceInRow enforces color and wall constraints', () => {
  const p = createPlayer({ name: 'x' }, 0);
  assert.equal(canPlaceInRow(p, 0, 0), true);
  p.lines[1] = [tile(1, 2)];
  assert.equal(canPlaceInRow(p, 1, 2), true, 'same color allowed');
  assert.equal(canPlaceInRow(p, 1, 3), false, 'different color rejected');
  p.lines[1] = [tile(1, 2), tile(2, 2)];
  assert.equal(canPlaceInRow(p, 1, 2), false, 'full line rejected');
  p.wall[2][wallColumnFor(2, 4)] = tile(5, 4);
  assert.equal(canPlaceInRow(p, 2, 4), false, 'color already on wall in that row');
  assert.equal(canPlaceInRow(p, 2, 1), true);
});

test('illegal moves throw', () => {
  const state = two();
  assert.throws(() => applyMove(state, { source: 'center', index: 0, color: 0, row: 0 }));
  assert.throws(() => applyMove(state, { source: 'factory', index: 0, color: 99, row: 0 }));
});

test('scoreTilePlacement counts contiguous runs in both directions', () => {
  const wall = emptyWall();
  wall[2][2] = tile(1, 0);
  assert.equal(scoreTilePlacement(wall, 2, 2), 1, 'lone tile');
  wall[2][1] = tile(2, 0);
  assert.equal(scoreTilePlacement(wall, 2, 2), 2, 'horizontal pair');
  wall[1][2] = tile(3, 0);
  wall[0][2] = tile(4, 0);
  assert.equal(scoreTilePlacement(wall, 2, 2), 2 + 3, 'horizontal + vertical');
  wall[2][4] = tile(5, 0); // not adjacent (gap at col 3) -> not counted
  assert.equal(scoreTilePlacement(wall, 2, 2), 5);
});

test('floor penalties follow -1 -1 -2 -2 -2 -3 -3 and cap at seven tiles', () => {
  assert.equal(floorPenalty([]), 0);
  assert.equal(floorPenalty([1]), -1);
  assert.equal(floorPenalty([1, 1, 1]), -4);
  assert.equal(floorPenalty(Array(7).fill(1)), -14);
  assert.equal(floorPenalty(Array(9).fill(1)), -14);
});

test('endGameBonus awards rows, columns and colors', () => {
  const wall = emptyWall();
  for (let c = 0; c < 5; c++) wall[0][c] = tile(c, wallColorAt(0, c));
  assert.deepEqual(endGameBonus(wall), { rows: 1, cols: 0, colors: 0, total: 2 });
  for (let r = 0; r < 5; r++) wall[r][0] = tile(10 + r, wallColorAt(r, 0));
  assert.deepEqual(endGameBonus(wall), { rows: 1, cols: 1, colors: 0, total: 9 });
  for (let r = 0; r < 5; r++) wall[r][wallColumnFor(r, 2)] = tile(20 + r, 2);
  const bonus = endGameBonus(wall);
  assert.equal(bonus.colors, 1);
  assert.equal(bonus.total, 2 + 7 + 10);
});

test('endRound tiles completed lines, scores, applies penalties and refills', () => {
  const state = two();
  // Fast-forward: empty all sources so the draft is over.
  for (const f of state.factories) {
    state.lid.push(...f.splice(0));
  }
  state.center = [];
  state.centerHasFirstPlayer = false;
  state.phase = 'roundEnd';
  const p0 = state.players[0];
  p0.lines[0] = [tile(500, 0)];
  p0.lines[1] = [tile(501, 1), tile(502, 1)];
  p0.lines[2] = [tile(503, 2)]; // incomplete, must stay
  p0.floor = [tile(504, 3), { id: 'first', color: 'first' }];
  state.nextStarter = 0;

  const events = endRound(state);
  assert.equal(p0.wall[0][wallColumnFor(0, 0)].id, 500);
  assert.equal(p0.wall[1][wallColumnFor(1, 1)].id, 502);
  assert.equal(p0.lines[2].length, 1, 'incomplete line kept');
  assert.equal(p0.lines[1].length, 0);
  // blue at (0,0), yellow at (1,2): not adjacent, 1 + 1 = 2, floor -1 -1 = -2 -> 0
  assert.equal(p0.score, 0);
  assert.ok(events.some((e) => e.type === 'wall' && e.row === 0 && e.points === 1));
  assert.ok(events.some((e) => e.type === 'floor' && e.penalty === -2 && e.hadToken));
  assert.equal(events.at(-1).type, 'newRound');
  assert.equal(state.round, 2);
  assert.equal(state.phase, 'draft');
  assert.equal(state.current, 0);
  assert.equal(state.centerHasFirstPlayer, true);
  assert.ok(state.factories.every((f) => f.length === 4));
});

test('score never drops below zero', () => {
  const state = two();
  for (const f of state.factories) state.lid.push(...f.splice(0));
  state.phase = 'roundEnd';
  state.players[0].floor = Array.from({ length: 7 }, (_, i) => tile(700 + i, 0));
  state.players[0].score = 3;
  endRound(state);
  assert.equal(state.players[0].score, 0);
});

test('a completed wall row ends the game with bonuses and a ranking', () => {
  const state = two();
  for (const f of state.factories) state.lid.push(...f.splice(0));
  state.phase = 'roundEnd';
  const p1 = state.players[1];
  for (let c = 0; c < 4; c++) p1.wall[2][c] = tile(600 + c, wallColorAt(2, c));
  p1.lines[2] = [tile(610, wallColorAt(2, 4)), tile(611, wallColorAt(2, 4)), tile(612, wallColorAt(2, 4))];
  const events = endRound(state);
  assert.equal(state.phase, 'gameOver');
  assert.equal(p1.bonus.rows, 1);
  assert.equal(p1.score, 5 + 2, 'row of five scores 5, plus a 2 point row bonus');
  assert.equal(events.at(-1).type, 'gameOver');
  assert.deepEqual(finalRanking(state), [1, 0]);
  assert.equal(state.winner, 1);
});

test('ties are broken by completed rows', () => {
  const state = two();
  state.players[0].score = 10;
  state.players[1].score = 10;
  for (let c = 0; c < 5; c++) state.players[1].wall[0][c] = tile(c, wallColorAt(0, c));
  assert.deepEqual(finalRanking(state), [1, 0]);
});

test('bag refills from the lid when it runs out', () => {
  const state = two();
  state.lid.push(...state.bag.splice(0));
  for (const f of state.factories) state.lid.push(...f.splice(0));
  state.phase = 'roundEnd';
  endRound(state);
  assert.ok(state.factories.every((f) => f.length === 4));
  assert.equal(countTiles(state), 100);
});

test('isDraftOver is true only when factories and center are empty', () => {
  const state = two();
  assert.equal(isDraftOver(state), false);
  for (const f of state.factories) f.length = 0;
  state.center = [];
  assert.equal(isDraftOver(state), true);
});

test('COLORS exposes the five standard tile colors', () => {
  assert.deepEqual(COLORS, ['blue', 'yellow', 'red', 'black', 'white']);
});
