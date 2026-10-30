(function () {
  'use strict';
  // Chromium 76 on 2021 sets: no ?. or ??.
  var C = Object.assign({ name: '', columns: 6, dockSize: 5, dockDefaults: [], inputNames: {}, prefer: {}, background: '#000', glow: true, screensaverMinutes: 5 }, window.CONFIG || {});
  var T = window.tizen;
  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 10009 };
  var STORE = 'home.v2';
  var COUCH = 'CouchTV001.CouchTV'; // its Continue Watching row; see service.js /continue
  var $ = function (s) { return document.querySelector(s); };
  var page = $('#page'), hl = $('#hl'), menu = $('#menu'), saver = $('#saver');
  var SELF = T ? T.application.getCurrentApplication().appInfo.id : '';

  var apps = {};        // id -> {id, name, icon, rgb}
  var allApps = [];     // everything getAppsInfo returns, for finding Samsung's Settings
  var state = load();   // {dock, order, hidden, init, focus, couch, preferences}
  var focused = null, returnTo = null, popupOpen = false, moving = null;

  var choices = { columns: [4, 5, 6, 7], screensaverMinutes: [0, 2, 5, 10, 20], background: ['#000000', '#101820', '#211a24'] };
  Object.keys(state.preferences).forEach(function (key) {
    var value = state.preferences[key];
    if (key === 'glow' && typeof value === 'boolean' || choices[key] && choices[key].indexOf(value) >= 0) C[key] = value;
  });
  var ARROWS = ' ◀ ▶'; // an em space: plain spaces collapse in HTML
  function applyAppearance() {
    document.body.style.setProperty('--home-background', C.background);
    page.style.setProperty('--cols', C.columns);
    // Tiles shrink to fit wider grids inside the 96 px margins: 7 columns of 240 px ran off both edges.
    var tile = Math.min(240, Math.floor((1920 - 2 * 96 - (C.columns - 1) * 44) / C.columns));
    page.style.setProperty('--tile', tile + 'px');
    page.style.setProperty('--tile-h', Math.round(tile * 9 / 16) + 'px');
    Array.prototype.forEach.call(glows, function (g) { g.style.display = C.glow ? '' : 'none'; });
    if (!C.glow) glowColor = '';
  }
  var glows = document.querySelectorAll('.glow'), glowColor = '';
  applyAppearance();

  function load() {
    var s = {};
    try { s = JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) {}
    // focus is where the viewer left off, so a restart after the TV closed us picks up there.
    return { dock: s.dock || [], order: s.order || [], hidden: s.hidden || [], init: !!s.init, focus: s.focus || null, couch: s.couch || s.cont || null, preferences: s.preferences || {} };
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) {} }
  function without(list, id) { return list.filter(function (x) { return x !== id; }); }
  function byName(a, b) { return apps[a].name.localeCompare(apps[b].name); }

  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2600);
  }

  // ---- apps ----

  var MOCK = ['Couch TV', 'Netflix', 'YouTube', 'TizenTube', 'Prime Video', 'Disney+', 'Spotify', 'Plex', 'Apple TV', 'Twitch', 'Gallery', 'Internet', 'SmartThings', 'Samsung Health', 'Media Player', 'Steam Link']
    .map(function (n) { return { id: n === 'Couch TV' ? COUCH : n.toLowerCase().replace(/\W/g, ''), name: n, show: true }; });
  // Samsung marks ~200 internal services as shown (hotel mode, factory tests, ad agents). Real apps are
  // store packages, whose ids start with a 10-character package id, plus these built-ins.
  var BUILT_IN = ['org.tizen.netflix-app', 'org.tizen.primevideo', 'org.tizen.browser', 'com.samsung.tv.store', 'com.samsung.tv.gallery'];
  var NOT_APPS = /\.(emanual|SecurityCenter)$/;
  function isApp(a) {
    return a.show && a.name && a.id !== SELF && !NOT_APPS.test(a.id) && (/^[A-Za-z0-9]{10}\./.test(a.id) || BUILT_IN.indexOf(a.id) >= 0);
  }

  function loadApps(done) {
    if (!T) { allApps = MOCK; return done(MOCK); }
    T.application.getAppsInfo(function (list) {
      allApps = list;
      done(list.filter(isApp));
    }, function (e) { toast('Could not list apps: ' + e.message); done([]); });
  }

  function setApps(list) {
    var next = {};
    list.forEach(function (a) {
      var old = apps[a.id] || {};
      // Store names carry taglines: "Spotify - Music and Podcasts" -> "Spotify".
      next[a.id] = { id: a.id, name: a.name.split(/ [-–—:|] /)[0], icon: a.iconPath, rgb: old.rgb };
    });
    var byAppName = function (n) { return Object.keys(next).filter(function (id) { return next[id].name === n; })[0]; };
    Object.keys(C.prefer).forEach(function (stock) {
      var a = byAppName(stock), b = byAppName(C.prefer[stock]);
      if (!b) return;
      next[b].name = stock;
      if (!a) return;
      delete next[a];
      state.dock = state.dock.map(function (id) { return id === a ? b : id; })
        .filter(function (id, i, list) { return list.indexOf(id) === i; });
    });
    apps = next;
    syncCouch();
    syncInputs();
    if (!state.init) {
      var ids = Object.keys(apps);
      C.dockDefaults.forEach(function (want) {
        var hit = ids.filter(function (id) { return apps[id].name.toLowerCase().indexOf(want.toLowerCase()) === 0; })[0];
        if (hit && state.dock.indexOf(hit) < 0) state.dock.push(hit);
      });
      state.dock = state.dock.slice(0, C.dockSize);
      state.init = true;
      save();
    }
  }

  function launch(id) {
    if (!T) return toast('Open ' + apps[id].name);
    T.application.launch(id, null, function (e) { toast('Could not open ' + (apps[id] ? apps[id].name : id) + ': ' + e.message); });
  }

  // Ambient colour: the saturation-weighted average of the icon, or a stable hue from the id.
  function colorOf(app) {
    if (app.rgb) return app.rgb;
    var h = 0;
    for (var i = 0; i < app.id.length; i++) h = (h * 31 + app.id.charCodeAt(i)) % 360;
    return 'hsl(' + h + ',55%,48%)';
  }
  function sampleColor(app, img) {
    try {
      var c = document.createElement('canvas'); c.width = c.height = 24;
      var g = c.getContext('2d'); g.drawImage(img, 0, 0, 24, 24);
      var d = g.getImageData(0, 0, 24, 24).data, r = 0, gr = 0, b = 0, w = 0;
      for (var i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue;
        var mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
        var k = (mx - mn) / 255 + 0.03;
        r += d[i] * k; gr += d[i + 1] * k; b += d[i + 2] * k; w += k;
      }
      if (w) app.rgb = 'rgb(' + Math.round(r / w) + ',' + Math.round(gr / w) + ',' + Math.round(b / w) + ')';
    } catch (e) {} // a tainted canvas keeps the hue fallback
  }
  function tint(el, app) {
    var c = colorOf(app);
    el.style.backgroundImage = 'linear-gradient(' + c.replace(/^(rgb|hsl)\((.*)\)$/, '$1a($2,.32)') + ',' + c.replace(/^(rgb|hsl)\((.*)\)$/, '$1a($2,.32)') + ')';
  }

  // ---- Couch TV: a "Continue in Couch TV" row under the dock, and a hero above it while it's focused ----
  // Couch TV posts {version: 2, continue: [up to 5 titles]} to the service; v1 posted one bare title.

  var TITLE = /^tmdb:(movie|tv):\d+$/, TMDB = /^https:\/\/image\.tmdb\.org\//;
  function couchTitles() {
    var snap = state.couch, list = !snap ? [] : snap.version === 2 ? snap.continue : [snap];
    var img = function (url) { return typeof url === 'string' && TMDB.test(url) ? url : ''; };
    return (Array.isArray(list) ? list : []).filter(function (c) { return c && TITLE.test(c.id) && typeof c.title === 'string'; })
      .slice(0, 5).map(function (c) {
        return { id: c.id, title: c.title, description: String(c.description || ''), thumb: img(c.thumb), backdrop: img(c.backdrop),
          logo: img(c.logo), episode: String(c.episode || ''), positionSec: +c.positionSec || 0, durationSec: +c.durationSec || 0 };
      });
  }
  function couchId(c) { return 'couch:' + c.id; }

  function syncCouch() {
    Object.keys(apps).forEach(function (id) { if (apps[id].cont || apps[id].sport) delete apps[id]; });
    if (!apps[COUCH]) return;
    couchTitles().forEach(function (c) {
      apps[couchId(c)] = { id: couchId(c), name: c.title, icon: c.thumb, rgb: colorOf(apps[COUCH]), cont: c };
    });
    sportsItems(Date.now()).forEach(function (s) {
      apps['sport:' + s.id] = { id: 'sport:' + s.id, name: s.title, icon: s.thumb, rgb: colorOf(apps[COUCH]), sport: s };
    });
  }

  // ---- My Sports: channels and matches saved on Couch TV's Sports screen (snapshot.sports). A match leaves
  // 12 h after it starts; a banner shows from 10 min before it to 15 min after. ----

  var HOURS = { Cricket: 8, Football: 2.5 }; // how long a match usually runs; the schedule has no end times
  function sportsItems(now) {
    var list = state.couch && Array.isArray(state.couch.sports) ? state.couch.sports : [];
    return list.filter(function (s) {
      return s && typeof s.id === 'string' && s.id.length < 400 && typeof s.title === 'string' &&
        (s.kind === 'channel' || (s.kind === 'event' && +s.startsAt > 0 && now - s.startsAt < 12 * 3600000));
    }).slice(0, 20).map(function (s) {
      return { id: s.id, title: s.title, kind: s.kind, sport: String(s.sport || ''), startsAt: +s.startsAt || 0,
        thumb: typeof s.thumb === 'string' && /^https?:\/\//.test(s.thumb) ? s.thumb : '' };
    }).sort(function (a, b) { return (a.kind === 'channel') - (b.kind === 'channel') || a.startsAt - b.startsAt; });
  }
  function sportBadge(s, now) {
    if (s.kind !== 'event') return '';
    if (s.startsAt <= now) return now - s.startsAt < (HOURS[s.sport] || 3) * 3600000 ? 'LIVE' : '';
    return s.startsAt - now <= 10 * 60000 ? 'SOON' : '';
  }
  function sportLine(s, now) {
    if (s.kind === 'channel') return [s.sport, 'Channel'].filter(Boolean).join(' · ');
    var start = new Date(s.startsAt), mins = Math.round((s.startsAt - now) / 60000);
    var time = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    var when = mins <= 0 ? 'Started ' + time : mins < 60 ? 'Starts in ' + mins + ' min' :
      (start.toDateString() === new Date(now).toDateString() ? 'Today ' : start.toLocaleDateString([], { weekday: 'short' }) + ' ') + time;
    return [s.sport, when].filter(Boolean).join(' · ');
  }
  var badges = '';
  function updateSports() {
    var now = Date.now(), list = sportsItems(now);
    var soon = list.filter(function (s) { return s.kind === 'event' && s.startsAt - now <= 10 * 60000 && now - s.startsAt < 15 * 60000; })[0];
    if (soon) $('#alert-title').textContent = soon.title + (soon.startsAt > now ? ' starts in ' + Math.max(1, Math.ceil((soon.startsAt - now) / 60000)) + ' min' : ' has started');
    $('#alert').classList.toggle('on', !!soon);
    // Badges and the row's contents change with the clock: redraw only when they do.
    var next = list.map(function (s) { return s.id + sportBadge(s, now); }).join();
    if (next === badges) return;
    badges = next;
    var id = focused && focused.dataset.id;
    syncCouch(); render();
    if (focused) focusId(id) || focusFirst();
  }
  setInterval(updateSports, 30000);

  // 204 means the service has heard nothing since boot, so the saved copy stands.
  function loadCouch() {
    if (!T) return setCouch({ version: 2, continue: [
      { id: 'tmdb:tv:1', title: 'Severance', description: 'Mark leads a team of office workers whose memories have been surgically divided between their work and personal lives.', episode: 'S1 · E3 · In Perpetuity', positionSec: 1200, durationSec: 3300 },
      { id: 'tmdb:movie:2', title: 'Arrival', description: 'Taking charge of the world’s mightiest defence, a linguist works to talk with visitors.', positionSec: 2400, durationSec: 6960 }],
      sports: [{ id: 'streamed:m1', title: 'Nepal vs India', kind: 'event', sport: 'Cricket', startsAt: Date.now() + 4 * 60000 },
        { id: 'streamed:willow', title: 'Willow Cricket', kind: 'channel', sport: 'Cricket' }] });
    fetch('http://127.0.0.1:8737/continue').then(function (r) {
      if (r.status === 200) return r.json().then(setCouch);
    }).catch(function () {});
  }

  function setCouch(snap) {
    if (JSON.stringify(snap) === JSON.stringify(state.couch)) return updateSports();
    var id = focused && focused.dataset.id;
    state.couch = snap; save();
    syncCouch(); render(); focusId(id || state.focus) || focusFirst();
    badges = '';
    updateSports();
  }

  function continueLine(c) {
    var left = Math.round((c.durationSec - c.positionSec) / 60);
    return [c.episode, c.positionSec ? left + ' min left' : 'Up next'].filter(Boolean).join(' · ');
  }

  // key: resume (play from where it was), details (its page), section ('mylist'), sport (a saved channel or match id).
  function openCouch(key, value) {
    if (!T) return toast('Couch TV: ' + key + ' ' + value);
    var ask = new T.ApplicationControl('http://tizen.org/appcontrol/operation/default', null, null, null,
      [new T.ApplicationControlData(key, [value])]);
    T.application.launchAppControl(ask, COUCH, null, function (e) { toast('Could not open Couch TV: ' + e.message); });
  }

  // The hero's text changes at once; its backdrop (w780) loads after focus settles, decodes off screen,
  // then crossfades by opacity in its own layer: repainting a big layer here costs ~1.3 s (measured).
  var heroArt = document.querySelectorAll('.hero-art'), heroUrl = null, heroTimer;
  function hero(c) {
    var logo = $('#hero-logo'), title = $('#hero-title');
    title.textContent = c.title;
    logo.style.display = 'none';
    if (c.logo) {
      // Decoded before it shows: first visits to a title cost up to 153 ms when the paint decoded it (measured).
      var showLogo = function () { if (logo.src === c.logo) { logo.style.display = ''; title.textContent = ''; } };
      logo.onload = function () { if (logo.decode) logo.decode().then(showLogo, showLogo); else showLogo(); };
      logo.src = c.logo;
    }
    $('#hero-meta').textContent = continueLine(c);
    $('#hero-desc').textContent = c.description;
    $('#hero-track div').style.width = (c.durationSec ? Math.min(100, 100 * c.positionSec / c.durationSec) : 0) + '%';
    clearTimeout(heroTimer);
    heroTimer = setTimeout(function () { heroBackdrop(c.backdrop); }, 300);
  }
  function heroBackdrop(url) {
    if (url === heroUrl) return;
    heroUrl = url;
    var next = heroArt[0].classList.contains('on') ? 1 : 0, img = heroArt[next], old = heroArt[1 - next];
    var reveal = function () {
      if (heroUrl !== url) return;
      img.classList.add('on'); old.classList.remove('on');
      setTimeout(function () { if (!old.classList.contains('on')) old.removeAttribute('src'); }, 600); // free its decode
    };
    if (!url) { old.classList.remove('on'); return; }
    img.onload = function () { if (img.decode) img.decode().then(reveal, reveal); else reveal(); };
    img.src = url;
  }

  // ---- HDMI tiles: one per connected port, first in the dock; not part of the saved order ----

  var inputs = [];
  function inputId(s) { return '@' + s.type.toLowerCase() + s.number; }

  function syncInputs() {
    Object.keys(apps).forEach(function (id) { if (apps[id].source) delete apps[id]; });
    inputs.forEach(function (s) {
      apps[inputId(s)] = { id: inputId(s), name: C.inputNames[sourceName(s)] || sourceName(s), icon: 'tv.svg', rgb: 'rgb(70,110,170)', source: s };
    });
  }

  function loadInputs() {
    var set = function (vs) {
      var next = vs.connected.filter(function (s) { return s.type === 'HDMI'; });
      if (next.map(sourceName).join() === inputs.map(sourceName).join()) return;
      var id = focused && focused.dataset.id;
      inputs = next;
      if (!focused) return; // the first draw hasn't happened; it will include these
      syncInputs(); render(); focusId(id || state.focus) || focusFirst();
    };
    if (!T) return set({ connected: [{ type: 'HDMI', number: 1 }], disconnected: [] });
    try { T.systeminfo.getPropertyValue('VIDEOSOURCE', set, function () {}); } catch (e) {}
  }

  // ---- render ----

  function tile(app, zone) {
    var d = document.createElement('div');
    d.className = app.cont || (app.sport && app.icon) ? 'tile cover' : 'tile';
    d.setAttribute('data-f', '');
    d.dataset.id = app.id;
    d.dataset.zone = zone;
    tint(d, app);
    var initial = function () {
      var s = document.createElement('span');
      s.className = 'initial'; s.textContent = app.name.charAt(0);
      d.insertBefore(s, d.firstChild);
    };
    if (app.icon) {
      var img = new Image();
      img.onload = function () {
        if (!app.rgb) { sampleColor(app, img); tint(d, app); if (focused === d) glow(app); }
      };
      img.onerror = function () { img.remove(); initial(); };
      img.src = app.icon.charAt(0) === '/' ? 'file://' + app.icon : app.icon;
      d.appendChild(img);
    } else initial();
    if (app.cont && app.cont.positionSec) {
      var track = document.createElement('div'), bar = document.createElement('div');
      track.className = 'track';
      bar.style.width = Math.min(100, 100 * app.cont.positionSec / app.cont.durationSec) + '%';
      track.appendChild(bar);
      d.appendChild(track);
    }
    var flag = app.sport && sportBadge(app.sport, Date.now());
    if (flag) {
      var b = document.createElement('div');
      b.className = flag === 'LIVE' ? 'badge live' : 'badge'; b.textContent = flag;
      d.appendChild(b);
    }
    var label = document.createElement('div');
    label.className = 'label'; label.textContent = app.name;
    d.appendChild(label);
    return d;
  }

  function fill(el, ids, zone) {
    el.innerHTML = '';
    ids.forEach(function (id) { el.appendChild(tile(apps[id], zone)); });
  }

  function render() {
    state.dock = state.dock.filter(function (id) { return apps[id]; });
    var hidden = state.hidden.filter(function (id) { return apps[id]; });
    var rest = Object.keys(apps).filter(function (id) { return !apps[id].cont && !apps[id].sport && !apps[id].source && state.dock.indexOf(id) < 0 && hidden.indexOf(id) < 0; });
    state.order = state.order.filter(function (id) { return rest.indexOf(id) >= 0; })
      .concat(rest.filter(function (id) { return state.order.indexOf(id) < 0; }).sort(byName));
    var ports = inputs.map(inputId).filter(function (id) { return hidden.indexOf(id) < 0; });
    var dock = ports.concat(state.dock);
    fill($('#dock'), dock, 'dock');
    // HDMI tiles come on top of dockSize apps; shrink evenly rather than overflow the band
    // (1744 px inside its margins, 44 px between tiles), keeping 300 × 170's shape.
    var w = Math.min(300, Math.floor(1744 / Math.max(dock.length, 1)) - 44);
    $('#dock').style.setProperty('--dock-tile', w + 'px');
    $('#dock').style.setProperty('--dock-tile-h', Math.round(w * 170 / 300) + 'px');
    fill($('#grid'), state.order, 'grid');
    var row = couchTitles().map(couchId).filter(function (id) { return apps[id]; });
    fill($('#couch'), row, 'couch');
    $('#couch-wrap').style.display = row.length ? '' : 'none';
    var saved = sportsItems(Date.now()).map(function (s) { return 'sport:' + s.id; }).filter(function (id) { return apps[id]; });
    fill($('#sports'), saved, 'sports');
    $('#sports-wrap').style.display = saved.length ? '' : 'none';
    fill($('#hidden'), hidden, 'hidden');
    $('#grid-title').style.display = state.order.length ? '' : 'none';
    $('#hidden-wrap').style.display = hidden.length ? '' : 'none';
  }

  // getAppsInfo takes ~4.7 s on this TV (measured), so start from the last list and redraw only on change.
  var APPS = 'home.apps.v1', lastApps = null;
  try { lastApps = localStorage.getItem(APPS); } catch (e) {}

  function show(list) {
    var id = focused && focused.dataset.id;
    setApps(list); render(); focusId(id || state.focus) || focusFirst();
  }

  function refresh() {
    loadApps(function (list) {
      var json = JSON.stringify(list.map(function (a) { return { id: a.id, name: a.name, iconPath: a.iconPath }; }));
      if (json === lastApps) return;
      lastApps = json;
      try { localStorage.setItem(APPS, json); } catch (e) {}
      show(JSON.parse(json));
    });
  }

  // ---- focus and spatial navigation ----

  function pos(el) {
    var x = 0, y = 0;
    for (var e = el; e && e !== page; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; }
    return { x: x, y: y, w: el.offsetWidth, h: el.offsetHeight };
  }

  // Recolouring still costs ~100 ms here (measured), so wait until the highlight has stopped moving.
  var glowTimer;
  function glow(app) {
    clearTimeout(glowTimer);
    glowTimer = setTimeout(function () { paintGlow(colorOf(app)); }, 420);
  }

  function paintGlow(c) {
    if (c === glowColor) return;
    glowColor = c;
    var next = glows[0].classList.contains('on') ? 1 : 0;
    var s = glows[next].width, g = glows[next].getContext('2d'), r = g.createRadialGradient(s / 2, s * .34, 0, s / 2, s * .34, s * .53);
    r.addColorStop(0, c);
    r.addColorStop(1, 'rgba(0,0,0,0)');
    g.clearRect(0, 0, s, s);
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
    glows[next].classList.add('on');
    glows[1 - next].classList.remove('on');
  }

  function focus(el) {
    if (!el) return false;
    if (focused) focused.classList.remove('focused');
    focused = el;
    el.classList.add('focused');
    if (popupOpen) {
      hl.style.opacity = 0;
      var list = menu.querySelector('.settings-list') || menu;
      list.scrollTop = Math.max(0, el.offsetTop - 330);
      if (menu.classList.contains('settings')) {
        $('#setting-name').textContent = el.firstChild.textContent;
        $('#setting-help').textContent = el._help || 'Device information';
      }
      return true;
    }

    var p = pos(el), zone = el.dataset.zone;
    // In the Couch row the dock fades out and the row rises under the hero.
    var shift = zone === 'couch' ? Math.max(0, p.y - 760) : (zone === 'grid' || zone === 'hidden' || zone === 'sports') ? Math.max(0, p.y - 380) : 0;
    page.style.transform = 'translateY(' + -shift + 'px)';
    document.body.classList.toggle('down', shift > 0 && zone !== 'couch');
    document.body.classList.toggle('couch', zone === 'couch');

    if (el.classList.contains('tile')) {
      var w = p.w * 1.1, h = p.h * 1.1;
      var firstHighlight = !hl.style.transform;
      if (firstHighlight) hl.style.transition = 'none';
      hl.style.transform = 'translate(' + (p.x - (w - p.w) / 2) + 'px,' + (p.y - (h - p.h) / 2 - (moving ? 14 : 0)) + 'px) scale(' + w / 330 + ')';
      hl.style.opacity = 1;
      if (firstHighlight) { window.getComputedStyle(hl).transform; hl.style.transition = ''; }
      var app = apps[el.dataset.id];
      $('#shelf-title').textContent = app.name;
      $('#shelf-sub').textContent = app.cont ? continueLine(app.cont) : app.sport ? sportLine(app.sport, Date.now())
        : app.source ? sourceName(app.source) + ' · connected' : 'Hold OK for options';
      if (app.cont) hero(app.cont);
      glow(app);
    } else hl.style.opacity = 0;
    return true;
  }

  function focusId(id) { return !!id && focus(page.querySelector('[data-id="' + CSS.escape(id) + '"]')); }
  function focusFirst() { return focus(page.querySelector('#dock .tile') || page.querySelector('#grid .tile') || page.querySelector('.pill')); }

  // Left/Right: nearest on the same row. Up/Down: the next row first, then the nearest tile in it;
  // scoring by distance alone let a far-off but aligned grid tile beat a short row (the Couch TV row).
  function nav(dir) {
    var scope = popupOpen ? menu : page, side = dir === 'left' || dir === 'right';
    var a = pos(focused), ax = a.x + a.w / 2, ay = a.y + a.h / 2;
    var found = [];
    Array.prototype.forEach.call(scope.querySelectorAll('[data-f]'), function (e) {
      if (e === focused || !e.offsetParent) return;
      var b = pos(e), dx = b.x + b.w / 2 - ax, dy = b.y + b.h / 2 - ay;
      var main = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy;
      if (main <= 1) return;
      if (side && Math.abs(dy) > (a.h + b.h) / 2) return; // stay on the row
      found.push({ e: e, main: main, cross: side ? Math.abs(dy) : Math.abs(dx) });
    });
    if (!side && found.length) {
      var row = Math.min.apply(null, found.map(function (f) { return f.main; }));
      found = found.filter(function (f) { return f.main <= row + 60; });
    }
    var best = null, bestScore = Infinity;
    found.forEach(function (f) {
      var score = side ? f.main + f.cross * 3 : f.cross;
      if (score < bestScore) { bestScore = score; best = f.e; }
    });
    focus(best);
  }

  // ---- tile options: hold OK ----

  // items: {label, sub, off, pick(el), adjust(dir, el)} or {head} for a section heading.
  function popup(title, items, wide) {
    menu.innerHTML = '';
    menu.scrollTop = 0;
    menu.classList.toggle('settings', !!wide);
    var list = menu;
    if (wide) {
      list = document.createElement('div'); list.className = 'settings-list'; menu.appendChild(list);
      var detail = document.createElement('aside'); detail.className = 'settings-detail';
      detail.innerHTML = '<div class="settings-kicker">HOME / SETTINGS</div><h2 id="setting-name"></h2><p id="setting-help"></p><div class="settings-keys">↑ ↓ Browse <span>·</span> ◀ ▶ Change <span>·</span> OK Select <span>·</span> Back Close</div>';
      menu.appendChild(detail);
    }
    var h = document.createElement('h2'); h.textContent = title; list.appendChild(h);
    items.forEach(function (it) {
      if (it.head) {
        var h3 = document.createElement('h3'); h3.textContent = it.head; list.appendChild(h3);
        return;
      }
      var d = document.createElement('div');
      d.className = 'item' + (it.off ? ' off' : '');
      if (!it.off) d.setAttribute('data-f', '');
      d.textContent = it.label;
      if (it.sub) { var s = document.createElement('small'); s.textContent = it.sub; d.appendChild(s); }
      d._pick = it.pick;
      d._adjust = it.adjust;
      d._help = it.help;
      list.appendChild(d);
    });
    returnTo = focused;
    popupOpen = true;
    menu.classList.add('open');
    focus(menu.querySelector('[data-f]'));
  }

  function closePopup() {
    popupOpen = false;
    menu.classList.remove('open');
    menu.classList.remove('settings');
    focus(returnTo);
  }

  function after(fn, id) { return function () { closePopup(); fn(); save(); render(); focusId(id) || focusFirst(); }; }

  function tileMenu(el) {
    var id = el.dataset.id, zone = el.dataset.zone, full = state.dock.length >= C.dockSize;
    if (zone === 'hidden') return;
    if (zone === 'sports') {
      var s = apps[id].sport;
      return popup(s.title, [{ label: 'Watch', sub: sportLine(s, Date.now()), pick: function () { closePopup(); openCouch('sport', s.id); } }]);
    }
    if (zone === 'couch') {
      var c = apps[id].cont;
      return popup(c.title, [
        { label: 'Play', sub: continueLine(c), pick: function () { closePopup(); openCouch('resume', c.id); } },
        { label: 'Details', pick: function () { closePopup(); openCouch('details', c.id); } }
      ]);
    }
    if (apps[id].source) {
      return popup(apps[id].name, [{ label: 'Hide', sub: 'Shown again under Hidden', pick: after(function () { state.hidden.push(id); }, null) }]);
    }
    popup(apps[id].name, (id === COUCH ? [{ label: 'My List', pick: function () { closePopup(); openCouch('section', 'mylist'); } }] : []).concat([
      { label: 'Move', pick: function () { closePopup(); moving = id; document.body.classList.add('moving'); focus(focused); } },
      zone === 'dock'
        ? { label: 'Remove from Dock', pick: after(function () { state.dock = without(state.dock, id); }, id) }
        : { label: 'Add to Dock', sub: full ? 'Dock is full' : '', off: full, pick: after(function () { state.dock.push(id); }, id) },
      { label: 'Hide', sub: 'Shown again under Hidden', pick: after(function () { state.dock = without(state.dock, id); state.hidden.push(id); }, null) }
    ]));
  }

  function moveBy(dir) {
    var inDock = state.dock.indexOf(moving) >= 0, list = inDock ? state.dock : state.order;
    var step = { left: -1, right: 1, up: inDock ? 0 : -C.columns, down: inDock ? 0 : C.columns }[dir];
    var i = list.indexOf(moving), j = Math.max(0, Math.min(list.length - 1, i + step));
    if (!step || i === j) return;
    list.splice(i, 1);
    list.splice(j, 0, moving);
    save(); render(); focusId(moving);
  }

  function stopMoving() { moving = null; document.body.classList.remove('moving'); focus(focused); }

  // ---- buttons ----

  function activate(el) {
    if (popupOpen) return el._pick && el._pick(el);
    var id = el.dataset.id;
    if (el.dataset.zone === 'hidden') {
      state.hidden = without(state.hidden, id); save(); render(); return focusId(id);
    }
    if (apps[id] && apps[id].source) return showSource(apps[id].source);
    if (apps[id] && apps[id].cont) return openCouch('resume', apps[id].cont.id);
    if (apps[id] && apps[id].sport) return openCouch('sport', apps[id].sport.id);
    if (id) return launch(id);
    if (el.dataset.act === 'inputs') return openInputs();
    if (el.dataset.act === 'settings') return openSettings();
  }

  function openSamsungSettings() {
    if (!T) return toast('Open Samsung Settings');
    T.application.launch('com.samsung.tv.coba.setting', null, function () { toast('Press the Settings button on your remote'); });
  }

  // ---- Settings: everything Samsung's APIs expose on this TV (probed on the AU7700, Tizen 6).
  // Picture settings (brightness, contrast, …) answer SecurityError: partner-only, so they stay in Samsung's.

  function call(obj, name) {
    try { var v = obj[name](); return v === undefined || v === null || v === '' ? null : v; } catch (e) { return null; }
  }
  function prop(name) {
    return new Promise(function (done) {
      var t = setTimeout(function () { done(null); }, 3000); // some properties never call back here
      try { T.systeminfo.getPropertyValue(name, function (v) { clearTimeout(t); done(v); }, function () { clearTimeout(t); done(null); }); }
      catch (e) { clearTimeout(t); done(null); }
    });
  }
  function size(bytes) { return bytes >= 1073741824 ? (bytes / 1073741824).toFixed(1) + ' GB' : Math.round(bytes / 1048576) + ' MB'; }
  function yes(v) { return v === null ? null : v ? 'Yes' : 'No'; }
  function row(label, value) { return value === null || value === undefined ? null : { label: label, sub: String(value) }; }
  function setSub(el, text) { el.querySelector('small').textContent = text; }
  function preference(key, value) {
    C[key] = value;
    state.preferences[key] = value;
    save();
    applyAppearance();
    poke();
    if (key === 'glow' && value && returnTo && returnTo.dataset.id && apps[returnTo.dataset.id]) glow(apps[returnTo.dataset.id]);
  }
  function choice(label, key, values, names, help) {
    return { label: label, sub: names[values.indexOf(C[key])] + ARROWS, help: help,
      adjust: function (dir, el) {
        var next = values.indexOf(C[key]) + (dir === 'right' ? 1 : -1);
        if (next < 0 || next >= values.length) return;
        preference(key, values[next]);
        setSub(el, names[next] + ARROWS);
      }, pick: function (el) {
        var next = (values.indexOf(C[key]) + 1) % values.length;
        preference(key, values[next]);
        setSub(el, names[next] + ARROWS);
      } };
  }

  // Sleep timer, kept by the boot service (service.js /sleep) so it runs whichever app is open.
  var SLEEP = [0, 15, 30, 60, 90, 120];
  function sleepText(endsAt) { return endsAt ? 'Off in ' + Math.max(1, Math.round((endsAt - Date.now()) / 60000)) + ' min' : 'Off'; }
  function sleepItem() {
    var index = 0;
    var set = function (el, next) {
      if (next < 0 || next >= SLEEP.length) return;
      index = next;
      setSub(el, (SLEEP[index] ? 'Off in ' + SLEEP[index] + ' min' : 'Off') + ARROWS);
      fetch('http://127.0.0.1:8737/sleep?minutes=' + SLEEP[index], { method: 'POST' }).catch(function () { toast('The sleep timer isn’t available'); });
    };
    var item = { label: 'Sleep timer', sub: 'Off' + ARROWS, help: 'Turns the TV off after the time you pick, even while something is playing. The first time, the TV may ask you to Allow “Home launcher”.',
      adjust: function (dir, el) { set(el, index + (dir === 'right' ? 1 : -1)); },
      pick: function (el) { set(el, (index + 1) % SLEEP.length); } };
    fetch('http://127.0.0.1:8737/sleep').then(function (r) { return r.json(); }).then(function (s) {
      item.sub = sleepText(s.endsAt) + ARROWS;
      var row = Array.prototype.filter.call(menu.querySelectorAll('.item'), function (d) { return d._pick === item.pick; })[0];
      if (row) setSub(row, item.sub);
    }).catch(function () {});
    return item;
  }

  var settingsRequest = 0;
  function openSettings() {
    var request = ++settingsRequest;
    var first = { label: 'Samsung Settings', sub: 'Picture, network & more ›', help: 'Open the TV’s own controls for picture, network, and other system settings.', pick: function () { closePopup(); openSamsungSettings(); } };
    var home = [
      { head: 'Home screen' },
      { label: 'Ambient glow', sub: C.glow ? 'On' : 'Off', help: 'Show a soft colour from the selected app behind the home screen.', pick: function (el) {
        preference('glow', !C.glow); setSub(el, C.glow ? 'On' : 'Off');
      } },
      choice('App grid', 'columns', choices.columns, ['4 columns', '5 columns', '6 columns', '7 columns'], 'Set how many apps appear in each row.'),
      choice('Clock screensaver', 'screensaverMinutes', choices.screensaverMinutes, ['Off', 'After 2 min', 'After 5 min', 'After 10 min', 'After 20 min'], 'Show a moving clock when the launcher is idle.'),
      choice('Background', 'background', choices.background, ['Black', 'Midnight blue', 'Plum'], 'Choose the colour behind the home screen.'),
      sleepItem()
    ];
    if (!T) return popup('Settings', home.concat([{ head: 'TV controls' }, first, { head: 'Device' }, row('Model', 'Browser preview')]), true);
    popup('Settings', home.concat([{ head: 'TV controls' }, first, { head: 'Device' }, { label: 'Loading TV information', off: true }]), true);
    var origin = returnTo;
    var W = window.webapis || {}, P = W.productinfo || {}, N = W.network || {}, AV = W.avinfo || {}, A = T.tvaudiocontrol;
    // Not tizen.package.getPackagesInfo: it blocks this TV's UI thread for ~14 s (measured).
    Promise.all([prop('STORAGE'), prop('CPU'), prop('VIDEOSOURCE'), prop('ETHERNET_NETWORK'), prop('LOCALE'), prop('SERVICE_COUNTRY')]).then(function (r) {
      if (request !== settingsRequest || !popupOpen || !menu.classList.contains('settings')) return;
      var disk = r[0] && r[0].units && r[0].units[0], vs = r[2] || { connected: [], disconnected: [] }, wifi = call(N, 'getWiFiSsid');
      var freq = call(N, 'getWiFiFrequency'), max = call(W.systeminfo || {}, 'getMaxVideoResolution');
      var level = call(N, 'getWiFiSignalStrengthLevel');
      var dns = [call(N, 'getDns'), call(N, 'getSecondaryDns')].filter(Boolean).join(', ');
      var panel = call(P, 'is8KPanelSupported') ? '8K' : call(P, 'isUdPanelSupported') ? '4K UHD' : null;
      var volume = call(A, 'getVolume'), muted = call(A, 'isMute');
      var freeMemory = call(T.systeminfo, 'getAvailableMemory'), totalMemory = call(T.systeminfo, 'getTotalMemory');
      popup('Settings', home.concat([
        { head: 'TV controls' },
        volume === null ? null : { label: 'Volume', sub: volume + ARROWS, help: 'Adjust the TV speaker volume with left and right.', adjust: function (dir, el) {
          try { if (dir === 'right') A.setVolumeUp(); else A.setVolumeDown(); setSub(el, call(A, 'getVolume') + ARROWS); }
          catch (e) { toast('Volume is unavailable'); }
        } },
        muted === null ? null : { label: 'Mute', sub: muted ? 'On' : 'Off', help: 'Turn the TV sound on or off.', pick: function (el) {
          try { A.setMute(!A.isMute()); setSub(el, call(A, 'isMute') ? 'On' : 'Off'); }
          catch (e) { toast('Mute is unavailable'); }
        } },
        first,
        { head: 'Sound output' },
        row('Current output', call(A, 'getOutputMode')),
        { head: 'Inputs' }
      ].concat(vs.connected.filter(isHdmi).map(function (s) {
        var name = sourceName(s), label = C.inputNames[name] ? C.inputNames[name] + ' (' + name + ')' : name;
        return { label: label, sub: 'Connected', pick: function () { closePopup(); showSource(s); } };
      }), vs.disconnected.map(function (s) { return { label: sourceName(s), sub: 'Nothing connected', off: true }; }), [
        { head: 'Network' },
        row('Wi-Fi', wifi),
        row('Signal', wifi && level !== null ? level + ' of 5' : null),
        row('Band', freq ? (freq >= 5000 ? '5 GHz' : '2.4 GHz') + ' (' + freq + ' MHz)' : null),
        row('IP address', call(N, 'getIp')),
        row('Subnet mask', call(N, 'getSubnetMask')),
        row('Gateway', call(N, 'getGateway')),
        row('DNS', dns || null),
        row('MAC address', call(N, 'getMac')),
        row('Ethernet cable', r[3] ? (r[3].cable === 'ATTACHED' ? 'Connected' : 'Not connected') : null),
        { head: 'TV' },
        row('Name', call(N, 'getTVName')),
        row('Model', call(P, 'getRealModel')),
        row('Model code', call(P, 'getModelCode')),
        row('Firmware', call(P, 'getFirmware')),
        row('Tizen', safeCapability('http://tizen.org/feature/platform.version')),
        row('Panel', panel),
        row('HDR', yes(call(AV, 'isHdrTvSupport'))),
        row('Max video', max ? max.width + ' × ' + max.height + ' at ' + max.frameRate + ' fps' : null),
        row('Smart Hub server', call(P, 'getSmartTVServerVersion')),
        row('Country', r[5] && r[5].serviceCountry),
        row('Language', r[4] && r[4].language),
        row('Time zone', call(T.time, 'getLocalTimezone')),
        row('Device ID (DUID)', call(P, 'getDuid')),
        { head: 'System' },
        row('Storage', disk ? size(disk.availableCapacity) + ' free of ' + size(disk.capacity) : null),
        row('Memory', freeMemory !== null && totalMemory !== null ? size(freeMemory) + ' free of ' + size(totalMemory) : null),
        row('CPU load', r[1] ? Math.round(r[1].load * 100) + ' %' : null)
      ])).filter(Boolean), true);
      returnTo = origin;
    });
  }

  function safeCapability(key) { try { return T.systeminfo.getCapability(key); } catch (e) { return null; } }

  function sourceName(s) { return s.type + ' ' + s.number; }
  function isHdmi(s) { return s.type === 'HDMI'; } // only HDMI devices; the tuner (Live TV) isn't wanted

  function openInputs() {
    var show = function (vs) {
      var items = vs.connected.filter(isHdmi).map(function (s) {
        return { label: sourceName(s), sub: 'Connected', pick: function () { closePopup(); showSource(s); } };
      }).concat(vs.disconnected.map(function (s) { return { label: sourceName(s), sub: 'Nothing connected', off: true }; }));
      popup('Inputs', items.length ? items : [{ label: 'No inputs found', off: true }]);
    };
    if (!T) return show({ connected: [{ type: 'HDMI', number: 1 }], disconnected: [{ type: 'HDMI', number: 2 }] });
    try { T.systeminfo.getPropertyValue('VIDEOSOURCE', show, function (e) { toast(e.message); }); } catch (e) { toast(e.message); }
  }

  // Inputs play in Samsung's own TV viewer, so the remote drives the box as normal. Drawing them inside Home
  // (tvwindow) kept the remote talking to Home, and tvwindow.setSource doesn't steer the viewer (measured).
  function showSource(s) {
    if (!T) return toast('Switch to ' + sourceName(s));
    T.application.launch('org.tizen.tv-viewer', null, function (e) { toast('Could not open the TV: ' + e.message); });
  }

  function loadNet() {
    var set = function (t) { $('#net').textContent = t; };
    if (!T) return set('Home Wi-Fi');
    // NETWORK never calls back on this TV (measured); WIFI_NETWORK does.
    try {
      T.systeminfo.getPropertyValue('WIFI_NETWORK', function (w) { set(w.status === 'ON' && w.ssid ? w.ssid : 'Network'); }, function () {});
    } catch (e) {}
  }

  // ---- clock and screensaver ----

  function tick() {
    var d = new Date(), h = d.getHours();
    var time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    $('#clock').textContent = time;
    $('#saver-clock').textContent = time;
    $('#greeting').textContent = (h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Good night') + (C.name ? ', ' + C.name : '');
    $('#date').textContent = d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
    setTimeout(tick, 60000 - d.getSeconds() * 1000 - d.getMilliseconds() + 50);
  }

  var idleTimer, driftTimer;
  function poke() {
    clearTimeout(idleTimer);
    if (C.screensaverMinutes > 0) idleTimer = setTimeout(saverOn, C.screensaverMinutes * 60000);
  }
  function saverOn() {
    if (document.hidden) return poke();
    saver.classList.add('on');
    drift();
    driftTimer = setInterval(drift, 60000);
  }
  // A new spot every minute so nothing burns in.
  function drift() {
    var c = $('#saver-clock');
    c.style.left = Math.round(Math.random() * (1920 - c.offsetWidth - 200) + 100) + 'px';
    c.style.top = Math.round(Math.random() * (1080 - c.offsetHeight - 200) + 100) + 'px';
  }
  function saverOff() { saver.classList.remove('on'); clearInterval(driftTimer); }

  // ---- keys: OK on release, hold OK for options ----

  var okTimer = null, okHeld = false;
  var DIRS = {}; DIRS[KEY.LEFT] = 'left'; DIRS[KEY.UP] = 'up'; DIRS[KEY.RIGHT] = 'right'; DIRS[KEY.DOWN] = 'down';

  document.addEventListener('keydown', function (e) {
    poke();
    if (saver.classList.contains('on')) { saverOff(); e.preventDefault(); return; }
    var k = e.keyCode;
    if (DIRS[k]) {
      e.preventDefault();
      var side = DIRS[k] === 'left' || DIRS[k] === 'right';
      if (moving) moveBy(DIRS[k]);
      else if (popupOpen && side && focused._adjust) focused._adjust(DIRS[k], focused);
      else nav(DIRS[k]);
    } else if (k === KEY.OK) {
      e.preventDefault();
      if (okTimer || okHeld) return;
      okTimer = setTimeout(function () {
        okTimer = null; okHeld = true;
        if (!moving && !popupOpen && focused && focused.dataset.id) tileMenu(focused);
      }, 600);
    } else if (k === KEY.BACK) {
      e.preventDefault();
      if (moving) stopMoving();
      else if (popupOpen) closePopup();
      else if (focused && focused.dataset.zone !== 'dock') focusFirst();
    }
  });

  document.addEventListener('keyup', function (e) {
    if (e.keyCode !== KEY.OK) return;
    if (okTimer) {
      clearTimeout(okTimer); okTimer = null;
      if (moving) stopMoving(); else if (focused) activate(focused);
    }
    okHeld = false;
  });

  // Leaving: remember the spot. Coming back: the TV may have released the picture while we were away.
  document.addEventListener('visibilitychange', function () {
    // Hidden, the page's layers still held ~15 MB on this TV (measured); dropping them costs one redraw.
    if (document.hidden) {
      var at = popupOpen ? returnTo : focused;
      state.focus = (at && at.dataset.id) || null;
      document.body.classList.add('away');
      return save();
    }
    document.body.classList.remove('away');
    focus(focused); // positions measured while away are zeros
    refresh(); loadCouch(); loadInputs(); loadNet(); poke();
  });

  // The boot service (service.js) starts on boot; this starts it after an install too.
  if (T) try { T.application.launch(T.application.getAppInfo().packageId + '.Boot', null, function () {}); } catch (e) {}

  tick();
  loadNet();
  loadInputs();
  if (lastApps) show(JSON.parse(lastApps));
  refresh();
  loadCouch();
  // Plugging a device in or out, or switching one on, changes the HDMI tiles while Home is open.
  if (T) try { T.systeminfo.addPropertyValueChangeListener('VIDEOSOURCE', loadInputs); } catch (e) {}
  poke();
})();
