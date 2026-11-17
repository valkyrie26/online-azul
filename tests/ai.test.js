import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createGame, applyMove, endRound, isLegalMove, countTiles, FLOOR_ROW } from '../src/engine/game.js';
import { chooseMove, evaluatePlayer, DIFFICULTIES } from '../src/engine/ai.js';
import { makeRng } from '../src/engine/rng.js';

/** Play a full game with the given difficulties and return the final state. */
export function playGame(difficulties, seed) {
  const state = createGame({
    players: difficulties.map((d, i) => ({ name: `${d}-${i}`, type: 'ai', difficulty: d })),
    seed,
  });
  const rng = makeRng(seed);
  let guard = 0;
  while (state.phase !== 'gameOver') {
    if (state.phase === 'draft') {
      const player = state.players[state.current];
      const move = chooseMove(state, player.difficulty, rng);
      assert.ok(isLegalMove(state, move), `AI ${player.difficulty} returned illegal move`);
      applyMove(state, move);
    } else {
      endRound(state);
    }
    assert.equal(countTiles(state), 100, 'tile conservation');
    if (++guard > 5000) throw new Error('game did not terminate');
  }
  return state;
}

test('every difficulty always returns a legal move', () => {
  for (const d of Object.keys(DIFFICULTIES)) {
    const state = createGame({ players: [{ name: 'a', difficulty: d }, { name: 'b' }], seed: 7 });
    const rng = makeRng(7);
    for (let i = 0; i < 6; i++) {
      const move = chooseMove(state, d, rng);
      assert.ok(isLegalMove(state, move));
      applyMove(state, move);
    }
  }
});

test('AI choices are deterministic for a given rng seed', () => {
  const a = createGame({ players: [{ name: 'a' }, { name: 'b' }], seed: 11 });
  const b = createGame({ players: [{ name: 'a' }, { name: 'b' }], seed: 11 });
  assert.deepEqual(chooseMove(a, 'master', makeRng(3)), chooseMove(b, 'master', makeRng(3)));
});

test('artisan prefers completing a line over dumping tiles on the floor', () => {
  const state = createGame({ players: [{ name: 'a' }, { name: 'b' }], seed: 5 });
  // Give the current player a nearly complete line of blue (row 1 needs one more).
  state.players[0].lines[1] = [{ id: 999, color: 0 }];
  state.factories[0] = [
    { id: 990, color: 0 },
    { id: 991, color: 1 },
    { id: 992, color: 2 },
    { id: 993, color: 3 },
  ];
  const move = chooseMove(state, 'artisan', makeRng(1));
  assert.notEqual(move.row, FLOOR_ROW);
});

test('evaluatePlayer rewards completed lines and punishes floor tiles', () => {
  const state = createGame({ players: [{ name: 'a' }, { name: 'b' }], seed: 9 });
  const p = state.players[0];
  const empty = evaluatePlayer(p, state);
  p.lines[0] = [{ id: 1, color: 0 }];
  const withLine = evaluatePlayer(p, state);
  assert.ok(withLine > empty);
  p.floor = [{ id: 2, color: 1 }, { id: 3, color: 1 }, { id: 4, color: 1 }];
  const withFloor = evaluatePlayer(p, state);
  assert.ok(withFloor < withLine);
});

test('full self-play games finish for 2, 3 and 4 players', () => {
  const configs = [
    ['novice', 'artisan'],
    ['artisan', 'master', 'novice'],
    ['master', 'artisan', 'novice', 'artisan'],
  ];
  configs.forEach((cfg, i) => {
    const state = playGame(cfg, 100 + i);
    assert.equal(state.phase, 'gameOver');
    assert.ok(state.ranking.length === cfg.length);
    assert.ok(state.players.every((p) => p.score >= 0));
    assert.ok(state.players.some((p) => p.wall.some((row) => row.every(Boolean))));
  });
});

test('stronger strategies beat weaker ones over several games', () => {
  let masterWins = 0;
  const games = 6;
  for (let g = 0; g < games; g++) {
    // Alternate seat order so the first-move advantage does not bias the result.
    const order = g % 2 === 0 ? ['master', 'novice'] : ['novice', 'master'];
    const state = playGame(order, 300 + g);
    const winner = state.players[state.winner];
    if (winner.difficulty === 'master') masterWins++;
  }
  assert.ok(masterWins >= games - 1, `master won ${masterWins}/${games}`);
});
