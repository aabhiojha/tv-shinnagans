// Drives the launcher in headless Chrome with remote-key presses and asserts where focus lands.
// node check.mjs [screenshot-dir]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const shots = process.argv[2];
const url = 'file://' + resolve(import.meta.dirname, 'launcher/index.html');
const chrome = spawn('google-chrome', ['--headless=new', '--disable-gpu', '--window-size=1920,1080', '--remote-debugging-port=9333',
  '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'chk-')), url], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try { target = (await (await fetch('http://127.0.0.1:9333/json')).json()).find(t => t.type === 'page'); } catch {}
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let n = 0; const waiting = {};
  ws.onmessage = m => { const d = JSON.parse(m.data); if (waiting[d.id]) waiting[d.id](d.result); };
  const send = (method, params = {}) => new Promise(r => { waiting[++n] = r; ws.send(JSON.stringify({ id: n, method, params })); });
  const evalJs = async js => (await send('Runtime.evaluate', { expression: js, returnByValue: true })).result.value;
  const codes = { left: 37, up: 38, right: 39, down: 40, ok: 13, back: 10009 };
  const key = async (k, holdMs = 0) => {
    const p = { windowsVirtualKeyCode: codes[k], nativeVirtualKeyCode: codes[k] };
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...p });
    await sleep(holdMs);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...p });
    await sleep(500);
  };
  const where = () => evalJs(`(f => f && (f.dataset.zone ? f.dataset.zone + ':' + f.dataset.id : f.textContent.trim()))(document.querySelector('.focused'))`);
  const shot = async name => {
    if (shots) writeFileSync(join(shots, name + '.png'), Buffer.from((await send('Page.captureScreenshot')).data, 'base64'));
  };

  await sleep(800);
  assert.equal(await where(), 'dock:@hdmi1', 'starts on the connected HDMI port');
  assert.deepEqual(await evalJs(`Array.from(document.querySelectorAll('#dock .label')).map(l => l.textContent)`),
    ['TV', 'Netflix', 'YouTube', 'Prime Video', 'Spotify'], 'dock defaults, TizenTube standing in for YouTube');
  assert.equal(await evalJs(`document.querySelectorAll('[data-id="youtube"]').length`), 0, 'stock YouTube is hidden');
  assert.deepEqual(await evalJs(`Array.from(document.querySelectorAll('#couch .label')).map(l => l.textContent)`),
    ['Severance', 'Arrival'], 'the Couch TV row lists what Couch TV published');
  await key('right'); assert.equal(await where(), 'dock:netflix');
  const tap = code => evalJs(`(function () {
      var event = new KeyboardEvent('keydown', { bubbles: true });
      Object.defineProperty(event, 'keyCode', { value: ${code} });
      document.dispatchEvent(event);
    return true;
  })()`);
  await tap(37);
  await sleep(70);
  await tap(39);
  await sleep(80);
  const highlightError = () => evalJs(`(function () {
    var a = document.querySelector('#dock .tile.focused').getBoundingClientRect();
    var b = document.querySelector('#hl').getBoundingClientRect();
    return Math.max(Math.abs(a.left - b.left), Math.abs(a.top - b.top),
      Math.abs(a.right - b.right), Math.abs(a.bottom - b.bottom));
  })()`);
  assert.ok(await highlightError() > 2, 'rapid focus changes animate from the current position');
  await sleep(750);
  assert.ok(await highlightError() <= 2, 'focus highlight settles on the focused tile');
  await evalJs(`Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); true`);
  await send('Page.reload'); await sleep(1200);
  assert.equal(await where(), 'dock:netflix', 'a restart resumes on the app that was focused');
  await key('up'); assert.match(await where(), /Inputs|Wi-Fi|Settings/, 'up from the dock reaches the top buttons');
  await key('down'); await key('down');
  assert.match(await where(), /^couch:/, 'below the dock is the Couch TV row');
  await key('left'); assert.equal(await where(), 'couch:couch:tmdb:tv:1');
  assert.deepEqual(await evalJs(`[document.body.classList.contains('couch'), document.getElementById('hero-title').textContent, document.getElementById('hero-meta').textContent]`),
    [true, 'Severance', 'S1 · E3 · In Perpetuity · 35 min left'], 'the hero shows the focused title');
  await shot('couch');
  await key('ok', 900); assert.equal(await where(), 'Play' + 'S1 · E3 · In Perpetuity · 35 min left', 'holding OK offers Play and Details');
  await key('back');
  await key('down'); assert.equal(await where(), 'sports:sport:streamed:m1', 'below Continue is My Sports, the next match first');
  assert.deepEqual(await evalJs(`[Array.from(document.querySelectorAll('#sports .label')).map(l => l.textContent),
    document.querySelector('#sports .badge').textContent, document.getElementById('shelf-sub').textContent,
    document.getElementById('alert').classList.contains('on'), document.getElementById('alert-title').textContent]`),
    [['Nepal vs India', 'Willow Cricket'], 'SOON', 'Cricket · Starts in 4 min', true, 'Nepal vs India starts in 4 min'],
    'a saved match about to start is flagged on its tile and in the banner');
  await shot('sports');
  await key('ok', 900); assert.equal(await where(), 'Watch' + 'Cricket · Starts in 4 min', 'holding OK offers Watch');
  await key('back');
  await key('down'); assert.match(await where(), /^grid:/, 'down slides into the grid');
  assert.equal(await evalJs(`document.body.classList.contains('couch')`), false, 'the hero leaves with the row');
  await shot('grid');
  const before = await where();
  await key('ok', 900); assert.equal(await where(), 'Move', 'holding OK opens the tile menu');
  await shot('menu');
  await key('down'); await key('down'); assert.match(await where(), /^Hide/);
  await key('ok'); assert.equal(await evalJs('JSON.parse(localStorage.getItem("home.v2")).hidden[0]'), before.split(':')[1], 'Hide records the app');
  await key('back'); assert.equal(await where(), 'dock:@hdmi1', 'Back returns to the dock');
  await key('up'); await key('left'); assert.equal(await where(), 'Inputs', 'left stops at the end of a row');
  await key('ok');
  assert.equal(await where(), 'HDMI 1Connected', 'Inputs lists connected sources first');
  await shot('inputs');
  await key('back'); await key('right'); await key('right'); await key('ok');
  assert.equal(await where(), 'Ambient glowOn', 'Settings starts with editable home controls');
  await shot('settings');
  await key('ok');
  assert.equal(await evalJs('JSON.parse(localStorage.getItem("home.v2")).preferences.glow'), false, 'glow preference is saved');
  await key('down'); await key('right');
  assert.equal(await evalJs('JSON.parse(localStorage.getItem("home.v2")).preferences.columns'), 7, 'grid setting changes with right');
  await key('down'); await key('right');
  assert.equal(await evalJs('JSON.parse(localStorage.getItem("home.v2")).preferences.screensaverMinutes'), 10, 'screensaver timeout is saved');
  await key('down'); await key('right');
  assert.equal(await evalJs('JSON.parse(localStorage.getItem("home.v2")).preferences.background'), '#101820', 'background colour is saved');
  await key('back');
  await send('Page.reload'); await sleep(1200);
  assert.equal(await evalJs('document.querySelector("#page").style.getPropertyValue("--cols")'), '7', 'grid setting survives restart');
  assert.equal(await evalJs('document.querySelector(".glow").style.display'), 'none', 'glow setting survives restart');
  assert.equal(await evalJs('document.body.style.getPropertyValue("--home-background")'), '#101820', 'background setting survives restart');
  console.log('ok: all checks passed');
} finally {
  chrome.kill();
}
