// DOM layer: title screen, in-game HUD (scoreboard, opponent mini boards,
// status banner, log), rules and game-over dialogs. Pure presentation.

import { COLORS, WALL_SIZE, FLOOR_PENALTIES, wallColorAt } from '../engine/constants.js';
import { isFirstPlayerToken, endGameBonus } from '../engine/game.js';
import { DIFFICULTIES } from '../engine/ai.js';
import { TILE_SETS, TILE_SET_ORDER, COLOR_SWATCH } from '../render/tilesets.js';
import { PLAYER_ACCENTS } from '../render/world.js';

const SETTINGS_KEY = 'azul-settings';

const $ = (sel) => document.querySelector(sel);

export class Hud {
  constructor(handlers) {
    this.handlers = handlers;
    this.el = {
      title: $('#title'),
      hud: $('#hud'),
      setCards: $('#set-cards'),
      diffCards: $('#diff-cards'),
      name: $('#player-name'),
      opponents: $('#opponents'),
      opponentCount: $('#opponent-count'),
      start: $('#start'),
      players: $('#players'),
      round: $('#round'),
      counts: $('#counts'),
      statusMain: $('#status-main'),
      statusSub: $('#status-sub'),
      log: $('#log'),
      logList: $('#log-list'),
      legend: $('#legend'),
      cancel: $('#cancel'),
      rules: $('#rules'),
      gameover: $('#gameover'),
      gameoverBody: $('#gameover-body'),
      sound: $('#sound'),
      seed: $('#seed'),
    };
    this.previews = {};
    this.bind();
    this.loadSettings();
  }

  // -------------------------------------------------------------------------
  // Title screen

  bind() {
    this.el.start.addEventListener('click', () => {
      this.saveSettings();
      this.handlers.onStart(this.readSettings());
    });
    this.el.opponents.addEventListener('input', () => {
      this.el.opponentCount.textContent = this.el.opponents.value;
    });
    document.querySelectorAll('[data-open-rules]').forEach((b) => b.addEventListener('click', () => this.toggle(this.el.rules, true)));
    document.querySelectorAll('[data-close]').forEach((b) =>
      b.addEventListener('click', () => this.toggle(b.closest('.modal'), false)),
    );
    $('#menu').addEventListener('click', () => this.handlers.onMenu());
    $('#overview').addEventListener('click', () => this.handlers.onOverview());
    this.el.cancel.addEventListener('click', () => this.handlers.onCancel());
    this.el.sound.addEventListener('click', () => this.handlers.onToggleSound());
    $('#log-toggle').addEventListener('click', () => this.el.log.classList.toggle('collapsed'));
    $('#play-again').addEventListener('click', () => {
      this.toggle(this.el.gameover, false);
      this.handlers.onStart(this.readSettings());
    });
    $('#back-to-menu').addEventListener('click', () => {
      this.toggle(this.el.gameover, false);
      this.handlers.onMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!this.el.rules.hidden) this.toggle(this.el.rules, false);
        else this.handlers.onCancel();
      }
    });
  }

  renderChoiceCards() {
    this.el.setCards.innerHTML = TILE_SET_ORDER.map((id) => {
      const def = TILE_SETS[id];
      const urls = this.previews[id] || [];
      return `<label class="card set-card">
        <input type="radio" name="tileset" value="${id}">
        <div class="card-body">
          <div class="swatches">${urls.map((u) => `<img src="${u}" alt="">`).join('')}</div>
          <strong>${def.name}</strong>
          <span>${def.tagline}</span>
        </div>
      </label>`;
    }).join('');
    this.el.diffCards.innerHTML = Object.values(DIFFICULTIES)
      .map(
        (d) => `<label class="card diff-card">
        <input type="radio" name="difficulty" value="${d.id}">
        <div class="card-body"><strong>${d.name}</strong><span>${d.tagline}</span></div>
      </label>`,
      )
      .join('');
    this.applySettings(this.settings);
  }

  setPreviews(previews) {
    this.previews = previews;
    this.renderChoiceCards();
  }

  readSettings() {
    return {
      name: this.el.name.value.trim() || 'You',
      opponents: Number(this.el.opponents.value),
      difficulty: document.querySelector('input[name=difficulty]:checked')?.value || 'artisan',
      tileSet: document.querySelector('input[name=tileset]:checked')?.value || 'classic',
    };
  }

  loadSettings() {
    try {
      this.settings = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    } catch {
      this.settings = {};
    }
    this.applySettings(this.settings);
  }

  applySettings(s = {}) {
    this.el.name.value = s.name || '';
    this.el.opponents.value = s.opponents || 1;
    this.el.opponentCount.textContent = this.el.opponents.value;
    const pick = (name, value) => {
      const input = document.querySelector(`input[name=${name}][value="${value}"]`) || document.querySelector(`input[name=${name}]`);
      if (input) input.checked = true;
    };
    pick('difficulty', s.difficulty || 'artisan');
    pick('tileset', s.tileSet || 'classic');
  }

  saveSettings() {
    this.settings = this.readSettings();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
  }

  showTitle() {
    this.el.title.hidden = false;
    this.el.hud.hidden = true;
    this.toggle(this.el.gameover, false);
  }

  showGame() {
    this.el.title.hidden = true;
    this.el.hud.hidden = false;
    this.el.logList.innerHTML = '';
  }

  toggle(modal, open) {
    if (!modal) return;
    modal.hidden = !open;
  }

  setSoundIcon(on) {
    this.el.sound.textContent = on ? '🔊' : '🔇';
    this.el.sound.title = on ? 'Mute sounds' : 'Unmute sounds';
  }

  setSeed(seed) {
    this.el.seed.textContent = `seed ${seed}`;
  }

  // -------------------------------------------------------------------------
  // In-game

  setStatus(main, sub = '') {
    this.el.statusMain.textContent = main;
    this.el.statusSub.textContent = sub;
  }

  setCancelVisible(visible) {
    this.el.cancel.hidden = !visible;
  }

  log(text, cls = '') {
    const li = document.createElement('li');
    li.textContent = text;
    if (cls) li.className = cls;
    this.el.logList.appendChild(li);
    this.el.logList.scrollTop = this.el.logList.scrollHeight;
    while (this.el.logList.children.length > 80) this.el.logList.firstChild.remove();
  }

  renderLegend(tileSet) {
    this.el.legend.innerHTML = tileSet.dataUrls
      .map((u, i) => `<div class="legend-item"><img src="${u}" alt=""><span>${tileSet.labels[i]}</span></div>`)
      .join('');
  }

  tileCell(tile, tileSet, extra = '') {
    if (!tile) return `<i class="cell ${extra}"></i>`;
    if (isFirstPlayerToken(tile)) return `<i class="cell token ${extra}">1</i>`;
    return `<i class="cell filled ${extra}" style="background-image:url(${tileSet.dataUrls[tile.color]})"></i>`;
  }

  miniBoard(player, tileSet) {
    const lines = player.lines
      .map((line, row) => {
        const cells = [];
        for (let k = row; k >= 0; k--) cells.push(this.tileCell(line[k], tileSet));
        return `<div class="mini-row" style="grid-template-columns:repeat(${row + 1},1fr)">${cells.join('')}</div>`;
      })
      .join('');
    const wall = player.wall
      .map((rowTiles, row) =>
        rowTiles
          .map((t, col) =>
            t
              ? this.tileCell(t, tileSet)
              : `<i class="cell ghost" style="background:${COLOR_SWATCH[wallColorAt(row, col)]}"></i>`,
          )
          .join(''),
      )
      .join('');
    const floor = Array.from({ length: FLOOR_PENALTIES.length }, (_, i) => this.tileCell(player.floor[i], tileSet)).join('');
    return `<div class="mini">
      <div class="mini-lines">${lines}</div>
      <div class="mini-wall" style="grid-template-columns:repeat(${WALL_SIZE},1fr)">${wall}</div>
      <div class="mini-floor" style="grid-template-columns:repeat(${FLOOR_PENALTIES.length},1fr)">${floor}</div>
    </div>`;
  }

  update(state, tileSet, { humanIndex = 0 } = {}) {
    this.el.round.textContent = `Round ${state.round}`;
    const centerCount = state.center.length;
    this.el.counts.textContent = `Bag ${state.bag.length} · Lid ${state.lid.length} · Center ${centerCount}`;
    this.el.players.innerHTML = state.players
      .map((p, i) => {
        const diff = p.type === 'ai' ? DIFFICULTIES[p.difficulty]?.name || p.difficulty : 'You';
        const active = state.phase === 'draft' && state.current === i ? 'active' : '';
        const token = p.floor.some(isFirstPlayerToken) ? '<span class="chip">starts next</span>' : '';
        return `<div class="player ${active}" data-player="${i}" style="--accent:${PLAYER_ACCENTS[i % PLAYER_ACCENTS.length]}">
          <div class="player-head">
            <span class="dot"></span>
            <strong>${escapeHtml(p.name)}</strong>
            <em>${diff}</em>
            <b class="score">${p.score}</b>
          </div>
          ${token}
          ${i === humanIndex ? '' : this.miniBoard(p, tileSet)}
          <button class="focus" data-focus="${i}" title="Look at this board">👁 view board</button>
        </div>`;
      })
      .join('');
    this.el.players.querySelectorAll('[data-focus]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handlers.onFocusPlayer(Number(b.dataset.focus));
      }),
    );
  }

  showGameOver(state, humanIndex) {
    const rows = state.ranking
      .map((idx, place) => {
        const p = state.players[idx];
        const bonus = p.bonus || endGameBonus(p.wall);
        const medal = ['🥇', '🥈', '🥉', '4th'][place];
        return `<tr class="${idx === humanIndex ? 'me' : ''}">
          <td>${medal}</td>
          <td>${escapeHtml(p.name)}</td>
          <td>${bonus.rows}</td><td>${bonus.cols}</td><td>${bonus.colors}</td>
          <td><strong>${p.score}</strong></td>
        </tr>`;
      })
      .join('');
    const winner = state.players[state.winner];
    const headline = state.winner === humanIndex ? 'You win!' : `${escapeHtml(winner.name)} wins`;
    this.el.gameoverBody.innerHTML = `<h2>${headline}</h2>
      <p>Finished after ${state.round} rounds.</p>
      <table>
        <thead><tr><th></th><th>Player</th><th>Rows</th><th>Cols</th><th>Colours</th><th>Score</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    this.toggle(this.el.gameover, true);
  }
}

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export { COLORS };
