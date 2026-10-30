'use strict';
// Opens Home when the TV powers up, and again when it wakes from standby.
var http = require('http');
var fs = require('fs');
var os = require('os');
var tls = require('tls');
var crypto = require('crypto');

var HOME = tizen.application.getAppInfo().packageId + '.Home';
var POLL = 3000;          // ms between checks
var ASLEEP = 30000;       // a gap this long between checks means deep standby froze us
var BOOTED = 180;         // s of uptime under which a service start counts as a boot, not a restart
var SETTLE = 6000;        // ms to let Smart Hub finish starting before Home goes on top

function openHome() {
  setTimeout(function () { tizen.application.launch(HOME, null, function () {}); }, SETTLE);
}

// The TV's own API says "standby" while the screen is off but the system is still up.
function powerState(done) {
  http.get('http://127.0.0.1:8001/api/v2/', function (res) {
    var body = '';
    res.on('data', function (c) { body += c; });
    res.on('end', function () {
      try { done(JSON.parse(body).device.PowerState); } catch (e) { done(null); }
    });
  }).on('error', function () { done(null); });
}

if (os.uptime() < BOOTED) openHome();

// Remote keys through Samsung's remote-control channel (port 8002), the way a phone remote does it.
// It's the only way an app here can change the TV's input: tvwindow.setSource only feeds the app's own
// picture window. The first connection asks the viewer to Allow "Home launcher"; the token skips that after.
function wsFrame(obj) {
  var p = Buffer.from(JSON.stringify(obj)), mask = crypto.randomBytes(4), head;
  if (p.length < 126) head = Buffer.from([0x81, 0x80 | p.length]);
  else { head = Buffer.from([0x81, 0xFE, 0, 0]); head.writeUInt16BE(p.length, 2); }
  for (var i = 0; i < p.length; i++) p[i] ^= mask[i % 4];
  return Buffer.concat([head, mask, p]);
}

function sendKeys(names, gap, token, done) {
  var path = '/api/v2/channels/samsung.remote.control?name=' + Buffer.from('Home launcher').toString('base64') +
    (token ? '&token=' + token : '');
  var buf = Buffer.alloc(0), upgraded = false, finished = false;
  var sock = tls.connect({ host: '127.0.0.1', port: 8002, rejectUnauthorized: false }, function () {
    sock.write('GET ' + path + ' HTTP/1.1\r\nHost: 127.0.0.1:8002\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      'Sec-WebSocket-Key: ' + crypto.randomBytes(16).toString('base64') + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
  });
  function finish(result) { if (finished) return; finished = true; sock.destroy(); done(result); }
  sock.setTimeout(45000, function () { finish({ ok: false, error: 'The TV did not answer (Allow prompt?)' }); });
  sock.on('error', function (e) { finish({ ok: false, error: e.message }); });
  sock.on('data', function (d) {
    if (finished) return;
    buf = Buffer.concat([buf, d]);
    if (!upgraded) {
      var end = buf.indexOf('\r\n\r\n');
      if (end < 0) return;
      upgraded = true; buf = buf.slice(end + 4);
    }
    if (buf.length < 2) return;
    var len = buf[1] & 127, off = 2;
    if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
    if (buf.length < off + len) return;
    var msg;
    try { msg = JSON.parse(buf.slice(off, off + len).toString()); } catch (e) { return finish({ ok: false, error: 'Bad reply' }); }
    if (msg.event !== 'ms.channel.connect') return finish({ ok: false, error: msg.event });
    var issued = msg.data && msg.data.token;
    finished = true; // ignore further frames; the keys below finish the job
    if (!names.length) { sock.destroy(); return done({ ok: true, token: issued || token }); } // just connecting
    names.forEach(function (name, i) {
      setTimeout(function () {
        sock.write(wsFrame({ method: 'ms.remote.control',
          params: { Cmd: 'Click', DataOfCmd: name, Option: 'false', TypeOfRemote: 'SendRemoteKey' } }));
        if (i === names.length - 1) setTimeout(function () { sock.destroy(); done({ ok: true, token: issued || token }); }, 500);
      }, i * gap);
    });
  });
}

function currentSource() {
  try { var s = tizen.tvwindow.getSource('MAIN'); return s.type + ' ' + s.number; } catch (e) { return null; }
}

// Sleep timer: when it's up and the TV is on, the remote's Power key puts it in standby. Setting it connects
// once, so the TV's one-time Allow prompt shows while someone is there; the token it issues is kept on disk.
var TOKEN_FILE = '/opt/usr/home/owner/apps_rw/' + tizen.application.getAppInfo().packageId + '/data/remote-token';
var token = '';
try { token = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch (e) {}
function keepToken(result) {
  if (!result.ok || !result.token || result.token === token) return;
  token = result.token;
  try { fs.writeFileSync(TOKEN_FILE, token); } catch (e) {}
}
var sleepAt = 0, sleepTimer = null;
function setSleep(minutes) {
  clearTimeout(sleepTimer);
  sleepAt = minutes > 0 ? Date.now() + minutes * 60000 : 0;
  if (!sleepAt) return;
  sendKeys([], 0, token, keepToken);
  sleepTimer = setTimeout(function () {
    sleepAt = 0;
    powerState(function (p) { if (p !== 'standby') sendKeys(['KEY_POWER'], 0, token, keepToken); });
  }, minutes * 60000);
}

// Couch TV POSTs what it's in the middle of; Home reads it for its Continue tile. 204 = nothing since boot,
// so Home keeps its own copy. Bound to 127.0.0.1: only apps on this TV can reach it.
var continuing;
http.createServer(function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Diagnostics, read from the laptop through `sdb forward tcp:8737 tcp:8737`.
  if (req.url === '/status') {
    return tizen.application.getAppsContext(function (list) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ availableMB: Math.round(tizen.systeminfo.getAvailableMemory() / 1048576),
        totalMB: Math.round(tizen.systeminfo.getTotalMemory() / 1048576), source: currentSource(),
        running: list.map(function (c) { return c.appId; }).sort() }));
    }, function (e) { res.statusCode = 500; res.end(e.message); });
  }
  // POST /keys?names=KEY_HDMI,KEY_HDMI&gap=4500&token=…  → {ok, token, source} once the last key is sent
  if (req.url.indexOf('/keys?') === 0 && req.method === 'POST') {
    var q = require('url').parse(req.url, true).query;
    var names = String(q.names || '').split(',').filter(function (n) { return /^KEY_[A-Z0-9_]+$/.test(n); });
    if (!names.length || names.length > 8) { res.statusCode = 400; return res.end(); }
    return sendKeys(names, Math.min(10000, Number(q.gap) || 4500), q.token || '', function (result) {
      result.source = currentSource();
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
    });
  }
  // GET /sleep → {endsAt} (0 = off); POST /sleep?minutes=N sets it, 0 cancels. Home and Couch TV both set it.
  if (req.url.indexOf('/sleep') === 0) {
    var minutes = Number(require('url').parse(req.url, true).query.minutes);
    if (req.method === 'POST' && minutes >= 0 && minutes <= 600) setSleep(minutes);
    else if (req.method === 'POST') res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ endsAt: sleepAt }));
  }
  if (req.url !== '/continue') { res.statusCode = 404; return res.end(); }
  if (req.method === 'GET') {
    if (continuing === undefined) res.statusCode = 204;
    return res.end(continuing === undefined ? '' : JSON.stringify(continuing));
  }
  if (req.method !== 'POST') return res.end();
  var body = '';
  // A v2 snapshot of 5 titles is ~3 KB.
  req.on('data', function (c) { body += c; if (body.length > 16384) req.destroy(); });
  req.on('end', function () {
    try { continuing = JSON.parse(body); res.statusCode = 204; } catch (e) { res.statusCode = 400; }
    res.end();
  });
}).listen(8737, '127.0.0.1');

var last = Date.now(), lastPower = 'on';
setInterval(function () {
  var now = Date.now(), slept = now - last > ASLEEP;
  last = now;
  powerState(function (p) {
    if (slept || (p === 'on' && lastPower === 'standby')) openHome();
    if (p) lastPower = p;
  });
}, POLL);

module.exports = { onStart: function () {}, onRequest: function () {}, onStop: function () {} };
