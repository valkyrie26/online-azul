// Headless browser smoke test with zero dependencies. Drives Chrome through the
// DevTools protocol over a pipe, so no puppeteer/playwright install is needed.
//
//   node scripts/browser-check.js "http://localhost:5173/?play=1&auto=99&fast=20" \
//        --until "window.azul.app.state.phase === 'gameOver'" --timeout 180 --out game-over.png
//
// Options:
//   --width N --height N   viewport (default 1280x800)
//   --mobile               emulate a phone (touch, mobile viewport)
//   --until <js>           expression polled every 500 ms; screenshot when truthy
//   --timeout <seconds>    give up waiting (default 60)
//   --out <file.png>       screenshot path (default scratch/browser-check.png)
//   --chrome <path>        Chrome binary (default: macOS Google Chrome)
//
// Exit code is 1 if the page threw an uncaught exception or the condition timed out.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const url = argv.find((a) => !a.startsWith('--')) || 'http://localhost:5173/';
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const width = Number(opt('width', 1280));
const height = Number(opt('height', 800));
const mobile = flag('mobile');
const until = opt('until', null);
const timeoutMs = Number(opt('timeout', 60)) * 1000;
const out = opt('out', 'browser-check.png');
const chromePath =
  opt('chrome', null) ||
  process.env.CHROME ||
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : 'google-chrome');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'azul-chrome-'));
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--no-sandbox',
    '--no-first-run',
    '--hide-scrollbars',
    '--remote-debugging-pipe',
    `--window-size=${width},${height}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
);

const toChrome = chrome.stdio[3];
const fromChrome = chrome.stdio[4];
let nextId = 1;
const pending = new Map();
const listeners = [];
let buffer = '';

fromChrome.on('data', (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf('\0')) >= 0) {
    const raw = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    const msg = JSON.parse(raw);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg);
    }
  }
});

function send(method, params = {}, sessionId) {
  const id = nextId++;
  const payload = { id, method, params };
  if (sessionId) payload.sessionId = sessionId;
  toChrome.write(JSON.stringify(payload) + '\0');
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);

  let errors = 0;
  listeners.push((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
      if (!/AudioContext/.test(text)) console.log(`[console.${msg.params.type}] ${text}`);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errors++;
      const d = msg.params.exceptionDetails;
      console.log(`[exception] ${d.exception?.description || d.text}`);
    }
  });

  await call('Runtime.enable');
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  if (mobile) await call('Emulation.setTouchEmulationEnabled', { enabled: true });
  await call('Page.navigate', { url });

  const started = Date.now();
  let satisfied = !until;
  let lastStatus = '';
  while (until && Date.now() - started < timeoutMs) {
    await sleep(500);
    const res = await call('Runtime.evaluate', { expression: `Boolean(${until})`, returnByValue: true });
    if (res.result?.value) {
      satisfied = true;
      break;
    }
    const status = await call('Runtime.evaluate', {
      expression:
        "(()=>{const a=window.azul?.app; if(!a||!a.state) return 'loading'; const s=a.state; return `round ${s.round} ${s.phase} move ${s.moveCount} scores ${s.players.map(p=>p.score).join('/')}`})()",
      returnByValue: true,
    });
    if (status.result?.value && status.result.value !== lastStatus) {
      lastStatus = status.result.value;
      console.log(`[state] ${lastStatus}`);
    }
  }
  if (!until) await sleep(4000);

  const shot = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`[screenshot] ${path.resolve(out)} (${width}x${height}${mobile ? ', mobile' : ''})`);

  const summary = await call('Runtime.evaluate', {
    expression:
      "(()=>{const a=window.azul?.app; if(!a||!a.state) return 'no game'; const s=a.state; return JSON.stringify({round:s.round, phase:s.phase, moves:s.moveCount, scores:s.players.map(p=>`${p.name}:${p.score}`), winner:s.winner})})()",
    returnByValue: true,
  });
  console.log(`[summary] ${summary.result?.value}`);
  if (!satisfied) console.log(`[timeout] condition not met within ${timeoutMs / 1000}s: ${until}`);
  console.log(`[errors] ${errors} uncaught exception(s)`);
  await shutdown();
  process.exit(errors || !satisfied ? 1 : 0);
}

function shutdown() {
  return new Promise((resolve) => {
    chrome.once('exit', () => {
      try {
        fs.rmSync(profile, { recursive: true, force: true });
      } catch {
        /* temp profile; ignore */
      }
      resolve();
    });
    chrome.kill();
  });
}

main().catch(async (err) => {
  console.error(err);
  await shutdown();
  process.exit(1);
});
