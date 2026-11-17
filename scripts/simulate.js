// AI vs AI tournament runner: `npm run simulate -- master artisan 50`
// Useful for tuning the heuristics. Prints win rates and average scores.

import { createGame, applyMove, endRound } from '../src/engine/game.js';
import { chooseMove, DIFFICULTIES } from '../src/engine/ai.js';
import { makeRng } from '../src/engine/rng.js';

const args = process.argv.slice(2);
const games = Number(args.find((a) => /^\d+$/.test(a))) || 20;
const difficulties = args.filter((a) => DIFFICULTIES[a]);
if (difficulties.length < 2) difficulties.push(...['master', 'artisan'].slice(difficulties.length));

const wins = Object.fromEntries(difficulties.map((d, i) => [`${d}#${i}`, 0]));
const totals = Object.fromEntries(difficulties.map((d, i) => [`${d}#${i}`, 0]));
let rounds = 0;
const started = Date.now();

for (let g = 0; g < games; g++) {
  const seed = 1000 + g;
  const rotate = g % difficulties.length;
  const seating = difficulties.map((_, i) => (i + rotate) % difficulties.length);
  const state = createGame({
    players: seating.map((slot) => ({ name: `${difficulties[slot]}#${slot}`, difficulty: difficulties[slot] })),
    seed,
  });
  const rng = makeRng(seed);
  while (state.phase !== 'gameOver') {
    if (state.phase === 'draft') {
      applyMove(state, chooseMove(state, state.players[state.current].difficulty, rng));
    } else {
      endRound(state);
    }
  }
  rounds += state.round;
  for (const p of state.players) totals[p.name] += p.score;
  wins[state.players[state.winner].name] += 1;
}

console.log(`${games} games, ${(rounds / games).toFixed(1)} rounds avg, ${Date.now() - started} ms`);
for (const key of Object.keys(wins)) {
  console.log(`${key.padEnd(12)} wins ${String(wins[key]).padStart(3)}  avg score ${(totals[key] / games).toFixed(1)}`);
}
