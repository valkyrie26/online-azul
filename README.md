# Online Azul

A complete, playable version of the tile-laying board game **Azul** that runs in the browser.
You play against one to three computer opponents on a WebGL table with procedurally generated tile sets.

- **Play:** open the deployed site (Vercel) or run it locally (below).
- **No build step.** Plain ES modules, three.js from a CDN, a static `index.html`.
- **Tested rules engine.** The game logic has no DOM dependency and is covered by unit tests.

![Table](project_pictures/board.png)

## Running it

```bash
npm start            # static dev server on http://localhost:5173
npm test             # rules + AI unit tests (node --test)
npm run simulate -- master artisan 50   # AI vs AI tournament, prints win rates
npm run check:browser                   # with the server running: plays a whole game in headless Chrome
```

Any static file server works (`python3 -m http.server`, VS Code Live Server…). The page needs to be served over
HTTP rather than opened as a `file://` URL because it uses ES module imports.

Requirements: Node 18+ for the scripts and tests; a WebGL2-capable browser for the game.

### Deploying

The repository is a static site. On Vercel, import the GitHub repo with the default settings
(framework: *Other*, no build command, output directory: root). `vercel.json` only adds clean URLs and
cache headers. Every push to `main` redeploys automatically.

### Handy URL parameters

| Parameter | Effect |
| --- | --- |
| `?play=1` | Skip the title screen and start immediately with saved/URL settings |
| `&set=glass` | Tile set: `classic`, `glass`, `chocolate`, `gem`, `talavera` |
| `&opponents=2` | Number of computer players (1–3) |
| `&difficulty=master` | `novice`, `artisan` or `master` |
| `&seed=42` | Deterministic shuffle; the seed is also shown in the HUD so a game can be replayed |
| `&auto=3` | Let the computer play your first three turns (useful for screenshots/testing) |
| `&select=1&hover=2` | Pre-select a colour and preview pattern line 3 (testing the highlight UI) |
| `&fast=20` | Speed up every animation and delay 20× (used by the browser smoke test) |

Example: `http://localhost:5173/?play=1&set=gem&opponents=3&difficulty=master&seed=7`

## How to play

1. **Draft.** On your turn, click a tile to choose a colour from a factory (you take every tile of that colour
   there; the rest slide to the centre) or from the centre pile. All matching tiles light up as you hover.
2. **Place.** Pattern lines that can accept the colour glow green, invalid ones red, and the wall slot the tiles
   will eventually fill is marked blue. Click a line or the floor. Overflow is previewed in amber on the floor.
3. **First player.** The first player to draft from the centre also takes the **1** marker: it occupies a floor
   slot (−1) but makes you start the next round.
4. **Wall tiling.** When the factories and the centre are empty, every complete pattern line moves its tile to the
   wall and scores. The score marker slides along the track and points pop up beside the tile.
5. **Game end.** After the round in which someone completes a horizontal row. Bonuses: +2 per row, +7 per column,
   +10 per colour.

Controls: drag to orbit, scroll to zoom, `Esc` cancels a selection. Use the **view board** buttons in the
scoreboard (or the map button) to fly the camera to an opponent's board; opponents' boards are also mirrored
in 2D in the left panel at all times.

## Computer opponents

| Difficulty | Strategy |
| --- | --- |
| **Novice** | Random legal move, with a mild preference for moves that waste at most one tile. |
| **Artisan** | Greedy: simulates every legal move and keeps the one with the best immediate board evaluation. |
| **Master** | Two-ply: takes its ten best candidate moves, then subtracts the best reply the next player can make. Also weighs end-game bonuses more heavily when a row is close to completion and values the first-player marker. |

The shared evaluation (`evaluatePlayer` in `src/engine/ai.js`) credits completed pattern lines with their
exact wall score, partially filled lines with discounted progress (less if the colour is running out this
round), subtracts floor penalties, and adds a structural term for near-complete rows, columns and colours.

`npm run simulate` lets you check the ladder. On 20 games: Master beats Artisan roughly 70%, and Artisan
beats Novice every time.

## Tile sets

All sets except Talavera are painted at runtime onto canvases (`src/render/tilesets.js`) and used as
textures, so no image downloads are needed:

| Set | Look |
| --- | --- |
| Classic Mosaic | Glazed azulejo patterns: star, floral, lattice, diamond, snowflake. Ceramic clearcoat. |
| Stained Glass | Jittered-grid triangle mosaic with lead lines, emissive glow, light transparency. |
| Chocolate | Five flavours with swirl strokes and an embossed bar segment on rounded blocks. |
| Gemstone | Faceted stones (table + crown facets) with high gloss and reflections. |
| Talavera | The five hand-painted tile photographs in `assets/`. |

The player boards are also painted procedurally (`src/render/boardTexture.js`): one canvas per player with the
score track, pattern lines, wall (with faint markers taken from the chosen tile set), floor line and bonus legend.
The same layout module provides cell positions to the 3D scene, so tiles and highlights always line up with
the artwork.

## Project structure

```
index.html                 game page (title screen + HUD markup)
about.html                 original project write-up
styles.css
src/
  main.js                  controller: turn loop, input, AI scheduling, animations sequencing
  audio.js                 synthesised sound effects (Web Audio)
  engine/
    constants.js           colours, penalties, wall pattern
    rng.js                 seedable PRNG (mulberry32)
    game.js                rules: setup, legal moves, drafting, wall tiling, scoring, game end
    ai.js                  evaluation + novice / artisan / master strategies
  render/
    tilesets.js            procedural tile artwork + material styles
    boardTexture.js        board layout (cell coordinates) + board painter
    world.js               three.js scene, picking, highlights, tile flights, score marker, popups
    tween.js               tiny tween helper
  ui/
    hud.js                 title screen, scoreboard, mini boards, log, dialogs
scripts/
  serve.js                 zero-dependency static server (npm start)
  simulate.js              AI tournament runner
  browser-check.js         headless Chrome smoke test / screenshot tool
tests/
  engine.test.js           rules unit tests
  ai.test.js               AI legality, determinism, self-play and strength tests
assets/                    factory disk art and the Talavera tile photos
```

### Engine API (for tests and tooling)

```js
import { createGame, legalMoves, applyMove, endRound } from './src/engine/game.js';
import { chooseMove } from './src/engine/ai.js';

const state = createGame({ players: [{ name: 'You', type: 'human' }, { name: 'Bot', difficulty: 'master' }], seed: 42 });
const move = legalMoves(state)[0];        // { source: 'factory'|'center', index, color: 0..4, row: 0..4 | -1 (floor) }
const result = applyMove(state, move);    // what was taken, placed, overflowed; mutates state
if (state.phase === 'roundEnd') endRound(state); // wall tiling, scoring, next round or game over
```

State is plain JSON (tiles are `{ id, color }`), so it can be cloned, saved or inspected freely.
`countTiles(state)` always returns 100, which the self-play tests assert after every move.

## Testing

```bash
npm test
```

The unit suite covers: wall pattern mapping, dealing, deterministic seeds, legal move generation, factory/centre
drafting, the first-player marker, overflow to floor and lid, placement rules, adjacency scoring, floor
penalties, end-of-game bonuses, round transitions, bag refills from the lid, tie-breaks, and for the AI:
legality of every strategy, determinism, preference for sensible moves, full self-play games for 2/3/4
players with tile conservation, and the Master > Novice strength check.

### Browser smoke test

`scripts/browser-check.js` drives Google Chrome headlessly over the DevTools protocol (no npm dependencies).
With `npm start` running in another terminal, `npm run check:browser` opens the game, lets the computer play
every turn at 25× speed, waits for the game-over dialog, reports any uncaught exception and saves a screenshot.
The script is general purpose:

```bash
node scripts/browser-check.js "http://localhost:5173/?play=1&opponents=3&select=1" \
  --mobile --width 390 --height 844 --until "window.azul.app.selection" --out phone.png
```

## Credits

Azul was designed by Michael Kiesling and published by Plan B Games. This is a fan-made, non-commercial
implementation for learning purposes. Factory disk art and Talavera photographs are in `assets/`.
