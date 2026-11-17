// Game controller: wires the rules engine, the AI, the 3D world and the HUD.

import { createGame, applyMove, endRound, legalMoves, currentPlayer, FLOOR_ROW } from './engine/game.js';
import { chooseMove, DIFFICULTIES } from './engine/ai.js';
import { makeRng } from './engine/rng.js';
import { World } from './render/world.js';
import { wait, setTimeScale } from './render/tween.js';
import { buildTileSet, TILE_SET_ORDER } from './render/tilesets.js';
import { Hud } from './ui/hud.js';
import { Audio } from './audio.js';

const AI_NAMES = ['Beatriz', 'Duarte', 'Catarina', 'Tomás', 'Leonor', 'Afonso'];
const HUMAN = 0;

const audio = new Audio();
const world = new World(document.getElementById('scene'), document.getElementById('popups'));
const hud = new Hud({
  onStart: startGame,
  onMenu: backToMenu,
  onCancel: cancelSelection,
  onFocusPlayer: (i) => world.focusPlayer(i),
  onOverview: () => world.focusOverview(),
  onToggleSound: () => {
    audio.setEnabled(!audio.enabled);
    hud.setSoundIcon(audio.enabled);
  },
});
hud.setSoundIcon(audio.enabled);

const app = {
  state: null,
  tileSet: null,
  rng: null,
  busy: true,
  selection: null,
  hoverRow: null,
  gameId: 0,
};

// ---------------------------------------------------------------------------
// Boot: build tile previews for the title screen, show an idle table.

async function boot() {
  const previews = {};
  for (const id of TILE_SET_ORDER) {
    try {
      const set = await buildTileSet(id, { size: 96, seed: 'preview' });
      previews[id] = set.dataUrls;
    } catch (err) {
      console.warn(err);
    }
  }
  hud.setPreviews(previews);
  const params = new URLSearchParams(location.search);
  if (params.has('play')) {
    // Dev/test hook: ?play=1&set=glass&opponents=2&difficulty=master&seed=7&auto=4&select=1
    document.getElementById('loading').remove();
    const saved = hud.readSettings();
    await startGame({
      name: params.get('name') || saved.name,
      opponents: Number(params.get('opponents')) || saved.opponents,
      difficulty: params.get('difficulty') || saved.difficulty,
      tileSet: params.get('set') || saved.tileSet,
    });
    return;
  }
  // Decorative demo game behind the title screen.
  const demo = createGame({ players: [{ name: 'Azul' }, { name: 'Demo' }], seed: 'title' });
  const set = await buildTileSet('classic', { seed: 'title' });
  await world.setup(demo, set, { factoryTexture: 'assets/azul_factory.jpg' });
  world.sync(demo, { animate: false });
  world.setIdle(true);
  hud.showTitle();
  document.getElementById('loading').remove();
}

/** Debug helpers driven by URL params; harmless in normal play. */
const debug = {
  params: new URLSearchParams(location.search),
  autoMoves: 0,
  init() {
    this.autoMoves = Number(this.params.get('auto')) || 0;
    if (this.params.has('fast')) setTimeScale(Number(this.params.get('fast')) || 10);
  },
  /** Returns true if the human's turn was played automatically. */
  async maybeAutoplay(gameId) {
    if (this.autoMoves <= 0) return false;
    this.autoMoves -= 1;
    const move = chooseMove(app.state, 'artisan', app.rng);
    await performMove(move, gameId);
    return true;
  },
  maybeSelect() {
    if (!this.params.has('select')) return;
    this.params.delete('select');
    const moves = legalMoves(app.state);
    const m = moves.find((x) => x.row !== FLOOR_ROW) || moves[0];
    selectSource({ source: m.source, index: m.index, color: m.color });
    const hover = this.params.has('hover') ? Number(this.params.get('hover')) : m.row;
    app.hoverRow = hover;
    world.highlightRows(HUMAN, app.selection.validRows, hover, app.selection.ids.length, app.selection.color);
  },
};
debug.init();
window.azul = { app, world, hud };

// ---------------------------------------------------------------------------
// Game lifecycle

async function startGame(settings) {
  const gameId = ++app.gameId;
  app.busy = true;
  app.selection = null;
  const seedParam = new URLSearchParams(location.search).get('seed');
  const seed = seedParam || Math.floor(Math.random() * 1e9);
  const players = [{ name: settings.name, type: 'human' }];
  for (let i = 0; i < settings.opponents; i++) {
    players.push({ name: `${AI_NAMES[i]}`, type: 'ai', difficulty: settings.difficulty });
  }
  app.state = createGame({ players, seed });
  app.rng = makeRng(`${seed}-ai`);
  app.tileSet = await buildTileSet(settings.tileSet, { seed });
  if (gameId !== app.gameId) return;

  hud.showGame();
  hud.setSeed(seed);
  hud.renderLegend(app.tileSet);
  hud.update(app.state, app.tileSet, { humanIndex: HUMAN });
  hud.log(`New game: ${players.length} players, ${DIFFICULTIES[settings.difficulty].name} opponents, ${app.tileSet.name} tiles.`);
  await world.setup(app.state, app.tileSet, { factoryTexture: 'assets/azul_factory.jpg' });
  world.setIdle(false);
  await world.sync(app.state, { animate: true });
  runTurn(gameId);
}

function backToMenu() {
  app.gameId++;
  app.busy = true;
  app.selection = null;
  world.clearHighlights();
  world.releaseGlow();
  world.setIdle(true);
  hud.showTitle();
}

async function runTurn(gameId) {
  if (gameId !== app.gameId) return;
  const state = app.state;
  if (state.phase === 'roundEnd') {
    await runRoundEnd(gameId);
    return;
  }
  if (state.phase === 'gameOver') {
    finishGame();
    return;
  }
  hud.update(state, app.tileSet, { humanIndex: HUMAN });
  const player = currentPlayer(state);
  if (player.type === 'human') {
    if (await debug.maybeAutoplay(gameId)) {
      runTurn(gameId);
      return;
    }
    app.busy = false;
    hud.setStatus('Your turn', 'Pick a colour from a factory or the centre');
    debug.maybeSelect();
    return;
  }
  app.busy = true;
  hud.setStatus(`${player.name} is thinking…`, DIFFICULTIES[player.difficulty].tagline);
  await wait(350);
  const move = chooseMove(state, player.difficulty, app.rng);
  if (gameId !== app.gameId) return;
  const ids = world.tileIdsFor(move.source, move.index, move.color);
  world.setSelection(ids);
  audio.select();
  await wait(650);
  if (gameId !== app.gameId) return;
  await performMove(move, gameId);
  runTurn(gameId);
}

async function performMove(move, gameId) {
  const state = app.state;
  const player = currentPlayer(state);
  const result = applyMove(state, move);
  if (gameId !== app.gameId) return;
  audio.place();
  hud.log(describeMove(player, result));
  if (result.tookFirstPlayer) hud.log(`${player.name} takes the first-player marker.`, 'muted');
  await world.animateMove(state, result);
  hud.update(state, app.tileSet, { humanIndex: HUMAN });
}

function describeMove(player, result) {
  const label = app.tileSet.labels[result.move.color];
  const n = result.taken.length;
  const from = result.move.source === 'factory' ? `factory ${result.move.index + 1}` : 'the centre';
  const where =
    result.move.row === FLOOR_ROW
      ? 'the floor'
      : `line ${result.move.row + 1}${result.toFloor.length ? ` (${result.toFloor.length} to floor)` : ''}`;
  return `${player.name} takes ${n} ${label} from ${from} → ${where}.`;
}

async function runRoundEnd(gameId) {
  const state = app.state;
  app.busy = true;
  app.selection = null;
  world.clearHighlights();
  hud.setStatus('Wall tiling', 'Completed pattern lines move to the wall');
  audio.roundEnd();
  const events = endRound(state);
  const byPlayer = new Map();
  for (const e of events) {
    if (e.player === undefined) continue;
    if (!byPlayer.has(e.player)) byPlayer.set(e.player, []);
    byPlayer.get(e.player).push(e);
  }
  for (const [p, list] of byPlayer) {
    if (gameId !== app.gameId) return;
    const player = state.players[p];
    hud.setStatus(`Scoring ${player.name}`, '');
    await world.focusPlayer(p);
    for (const e of list) {
      if (gameId !== app.gameId) return;
      if (e.type === 'wall') {
        audio.score(e.points);
        await world.animateWallEvent(e);
        hud.log(`${player.name} tiles row ${e.row + 1} for +${e.points}.`);
      } else if (e.type === 'floor') {
        if (e.applied) audio.penalty();
        await world.animateFloorEvent(e);
        if (e.applied) hud.log(`${player.name} loses ${-e.applied} on the floor line.`, 'bad');
      } else if (e.type === 'bonus') {
        if (e.total) audio.score(3);
        await world.animateBonusEvent(e);
        hud.log(`${player.name} end bonus: ${e.rows} rows, ${e.cols} columns, ${e.colors} colours = +${e.total}.`);
      }
      await wait(150);
    }
    hud.update(state, app.tileSet, { humanIndex: HUMAN });
    await wait(250);
  }
  if (gameId !== app.gameId) return;
  if (state.phase === 'gameOver') {
    await world.sync(state, { animate: true });
    finishGame();
    return;
  }
  hud.log(`Round ${state.round} begins. ${state.players[state.current].name} starts.`, 'muted');
  await world.focusPlayer(HUMAN);
  await world.sync(state, { animate: true, stagger: 30 });
  runTurn(gameId);
}

function finishGame() {
  const state = app.state;
  app.busy = true;
  hud.update(state, app.tileSet, { humanIndex: HUMAN });
  const winner = state.players[state.winner];
  hud.setStatus('Game over', `${winner.name} wins with ${winner.score} points`);
  hud.log(`Game over. ${winner.name} wins with ${winner.score}.`, 'good');
  audio.fanfare();
  world.focusOverview();
  setTimeout(() => hud.showGameOver(state, HUMAN), 900);
}

// ---------------------------------------------------------------------------
// Human input

function humanTurn() {
  return !app.busy && app.state && app.state.phase === 'draft' && currentPlayer(app.state).type === 'human';
}

function selectSource(pick) {
  const ids = world.tileIdsFor(pick.source, pick.index, pick.color);
  const moves = legalMoves(app.state).filter(
    (m) => m.source === pick.source && m.index === pick.index && m.color === pick.color,
  );
  app.selection = {
    source: pick.source,
    index: pick.index,
    color: pick.color,
    ids,
    validRows: moves.filter((m) => m.row !== FLOOR_ROW).map((m) => m.row),
  };
  app.hoverRow = null;
  world.setHover([]);
  world.setSelection(ids);
  world.highlightRows(HUMAN, app.selection.validRows, null, ids.length, pick.color);
  const label = app.tileSet.labels[pick.color];
  hud.setStatus(`${ids.length} × ${label} selected`, 'Click a pattern line, or the floor line. Esc cancels');
  hud.setCancelVisible(true);
  audio.select();
}

function cancelSelection() {
  if (!app.selection) return;
  app.selection = null;
  app.hoverRow = null;
  world.setSelection([]);
  world.clearHighlights();
  hud.setCancelVisible(false);
  if (humanTurn()) hud.setStatus('Your turn', 'Pick a colour from a factory or the centre');
}

async function commitSelection(row) {
  const sel = app.selection;
  if (!sel) return;
  if (row !== FLOOR_ROW && !sel.validRows.includes(row)) {
    audio.error();
    hud.setStatus('That line cannot take this colour', 'Lines hold one colour, and the wall slot must be free');
    return;
  }
  const gameId = app.gameId;
  app.busy = true;
  app.selection = null;
  hud.setCancelVisible(false);
  await performMove({ source: sel.source, index: sel.index, color: sel.color, row }, gameId);
  runTurn(gameId);
}

const canvas = world.renderer.domElement;
let downAt = null;

canvas.addEventListener('pointermove', (e) => {
  world.updatePointer(e);
  if (!humanTurn()) {
    canvas.style.cursor = '';
    return;
  }
  if (!app.selection) {
    const pick = world.pick(null);
    if (pick?.kind === 'tile') {
      world.setHover(world.tileIdsFor(pick.source, pick.index, pick.color));
      canvas.style.cursor = 'pointer';
    } else {
      world.setHover([]);
      canvas.style.cursor = '';
    }
    return;
  }
  const pick = world.pick(HUMAN);
  const row = pick?.kind === 'row' ? pick.row : null;
  if (row !== app.hoverRow) {
    app.hoverRow = row;
    world.highlightRows(HUMAN, app.selection.validRows, row, app.selection.ids.length, app.selection.color);
    if (row !== null) audio.slide();
  }
  if (pick?.kind === 'tile') {
    world.setHover(world.tileIdsFor(pick.source, pick.index, pick.color));
    canvas.style.cursor = 'pointer';
  } else {
    world.setHover([]);
    canvas.style.cursor = row !== null ? (row === FLOOR_ROW || app.selection.validRows.includes(row) ? 'pointer' : 'not-allowed') : '';
  }
});

canvas.addEventListener('pointerdown', (e) => {
  downAt = { x: e.clientX, y: e.clientY };
});

canvas.addEventListener('pointerup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  downAt = null;
  if (moved > 6 || !humanTurn()) return;
  world.updatePointer(e);
  if (!app.selection) {
    const pick = world.pick(null);
    if (pick?.kind === 'tile') selectSource(pick);
    return;
  }
  const pick = world.pick(HUMAN);
  if (pick?.kind === 'tile') {
    cancelSelection();
    selectSource(pick);
  } else if (pick?.kind === 'row') {
    commitSelection(pick.row);
  } else {
    cancelSelection();
  }
});

canvas.addEventListener('pointerleave', () => {
  if (!app.selection) world.setHover([]);
});

boot().catch((err) => {
  console.error(err);
  const loading = document.getElementById('loading');
  if (loading) loading.textContent = `Could not start: ${err.message}`;
});
