import { CITIES, PROVINCES, REGIONS, LOCAL_CITIES } from './cities.js';
import { haversineKm, mulberry32, hashString, weightedPick, shuffle, provinceAt, formatKm } from './geo.js';
import { findCommonsRound, findMapillaryRound, showMapillary, clearMapillary, findStreetRound, showStreetEmbed, findGoogleRound, showGooglePano, resetGooglePano } from './imagery.js';

const $ = (id) => document.getElementById(id);
const MAX_ROUND = 5000;
const CANADA_BOUNDS = [[41.7, -141], [70.5, -52.5]];
// OpenStreetMap's own tiles: free, no key (CARTO started requiring a key in 2026)
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_OPTS = {
  maxZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};

const MODES = {
  daily: { icon: '📅', title: 'Daily Challenge', desc: 'The same 5 spots for everyone today, anywhere in Canada. One try per day.', kind: 'map' },
  classic: { icon: '🍁', title: 'Classic', desc: 'Drop a pin anywhere on the map. The closer you are, the more points.', kind: 'map' },
  city: { icon: '🏙️', title: 'City Guesser', desc: 'Which Canadian city or town are you standing in?', kind: 'city' },
  province: { icon: '🗺️', title: 'Province Pick', desc: 'Click the province or territory you think you are in.', kind: 'province' },
  local: { icon: '📍', title: 'City Streets', desc: 'Zoomed into one city (pick it in Settings). Find the exact neighbourhood.', kind: 'map' },
  streak: { icon: '🔥', title: 'Province Streak', desc: 'Name the province, again and again. One miss and it is over.', kind: 'province' },
  urban: { icon: '🌆', title: 'Cities Only', desc: 'Classic pin drop, but always on a real city street. No highways or bush.', kind: 'map' },
  duel: { icon: '⚔️', title: '2 Player Split Screen', desc: 'Same spot, two screens side by side. Closest guess wins the round.', kind: 'duel' },
};
// modes that follow the "Where to play" picker
const REGIONAL = ['classic', 'city', 'urban', 'duel'];

// distance (km) at which a classic guess drops to ~37% of max points
// how far off (km) drops you to ~37% of the points; smaller places get tighter scoring
function regionScale(region) {
  if (!region || region === 'all') return 600;
  const cs = regionCities(region);
  if (cs.length < 2) return 60;
  let d = 0;
  for (const a of cs) for (const b of cs) d = Math.max(d, haversineKm(a, b));
  return Math.min(600, Math.max(40, d / 6));
}

// ---------------- storage helpers ----------------
const store = {
  get(k, d = null) {
    try { const v = localStorage.getItem('tng-' + k); return v === null ? d : JSON.parse(v); } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('tng-' + k, JSON.stringify(v)); } catch { /* private mode etc. */ }
  },
};

// ---------------- settings ----------------
const settings = Object.assign(
  { rounds: 5, timer: 0, region: 'all', citydiff: 'easy', local: 'Toronto', source: 'streetview', token: '', gkey: '', move: true, urban: false, p1: 'Player 1', p2: 'Player 2' },
  store.get('settings', {})
);
// old region names now map to the single-province options
settings.region = { west: 'BC', ontario: 'ON', quebec: 'QC' }[settings.region] || settings.region;
if (!REGIONS[settings.region]) settings.region = 'all';
// older versions defaulted to still photos; move everyone over to Street View once
if (!settings.v2) {
  if (settings.source === 'commons') settings.source = 'streetview';
  settings.v2 = true;
  store.set('settings', settings);
}

function initSettings() {
  const opt = ([k, r]) => `<option value="${k}">${r.label}</option>`;
  const groups = Object.entries(REGIONS).filter(([k, r]) => !r.single && !['west', 'ontario', 'quebec'].includes(k));
  const singles = Object.entries(REGIONS).filter(([, r]) => r.single);
  $('set-region').innerHTML = groups.map(opt).join('') + '<optgroup label="One province or territory">' + singles.map(opt).join('') + '</optgroup>';
  $('set-local').innerHTML = LOCAL_CITIES.map((n) => {
    const c = CITIES.find((x) => x.name === n);
    return `<option value="${n}">${n}, ${c.prov}</option>`;
  }).join('');
  const bind = (id, key, parse = (v) => v) => {
    const el = $(id);
    if (el.type === 'checkbox') el.checked = settings[key];
    else el.value = String(settings[key]);
    el.addEventListener('change', () => {
      settings[key] = el.type === 'checkbox' ? el.checked : parse(el.value.trim());
      store.set('settings', settings);
      renderModes();
      updateTokenRow();
    });
  };
  bind('set-rounds', 'rounds', Number);
  bind('set-timer', 'timer', Number);
  bind('set-region', 'region');
  bind('set-citydiff', 'citydiff');
  bind('set-local', 'local');
  bind('set-source', 'source');
  bind('set-token', 'token');
  bind('set-gkey', 'gkey');
  bind('set-urban', 'urban');
  bind('set-p1', 'p1');
  bind('set-p2', 'p2');
  bind('set-move', 'move');
  updateTokenRow();
}
function updateTokenRow() {
  $('token-row').style.display = settings.source === 'mapillary' ? '' : 'none';
  $('gkey-row').style.display = settings.source === 'google' ? '' : 'none';
  $('set-move').closest('label').style.display = settings.source === 'commons' ? 'none' : '';
}

function bestKey(mode) {
  if (REGIONAL.includes(mode)) return `${mode}:${settings.region}:${settings.urban ? 'u' : ''}:${settings.rounds}`;
  if (mode === 'local') return `local:${settings.local}:${settings.rounds}`;
  if (mode === 'province') return `province:${settings.rounds}`;
  return mode;
}

function todayStr() {
  // Canadian date (Toronto) so the daily rolls over at midnight Eastern
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date());
}

function renderModes() {
  const daily = store.get('daily-' + todayStr());
  $('modes').innerHTML = Object.entries(MODES).map(([k, m]) => {
    let best = '';
    if (k === 'daily') best = daily ? `Played today: ${daily.total.toLocaleString()} pts` : 'New challenge available';
    else if (k === 'streak') { const b = store.get('best-streak'); if (b) best = `Best streak: ${b}`; }
    else { const b = store.get('best-' + bestKey(k)); if (b) best = `Best: ${b.toLocaleString()} pts`; }
    let extra = '';
    if (k === 'local') extra = ` <b>(${settings.local})</b>`;
    if (REGIONAL.includes(k) && settings.region !== 'all') extra = ` <b>(${REGIONS[settings.region].label})</b>`;
    return `<button class="mode ${k === 'daily' ? 'daily' : ''}" data-mode="${k}">
      <span class="icon">${m.icon}</span><h3>${m.title}</h3><p>${m.desc}${extra}</p>
      <span class="best">${best}</span></button>`;
  }).join('');
  document.querySelectorAll('.mode').forEach((b) => (b.onclick = () => startGame(b.dataset.mode)));
}

// ---------------- screens + toast ----------------
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
}
let toastTimer;
function toast(msg, ms = 3500) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}

// ---------------- province shapes ----------------
let provinceGeo = null;
async function loadProvinces() {
  if (!provinceGeo) provinceGeo = await (await fetch('data/provinces.geojson')).json();
  return provinceGeo;
}

// ---------------- game state ----------------
let G = null; // current game
let guessMap, guessLayer, resultMap, summaryMap;

function regionCities(region) {
  const provs = REGIONS[region].provs;
  return CITIES.filter((c) => provs.includes(c.prov));
}

function cityWeight(c) {
  return Math.pow(c.pop, 0.45);
}

function spreadFor(mode, c, g = G) {
  if (mode === 'local') return c.pop > 1000000 ? 13 : c.pop > 400000 ? 9 : 6;
  const base = c.pop > 1000000 ? 14 : c.pop > 300000 ? 9 : c.pop > 100000 ? 6 : c.pop > 30000 ? 4 : 2.5;
  if (g && g.urban) return Math.min(7, base * 0.45); // stay in the built-up core
  return mode === 'city' ? base * 0.55 : base;
}

// cities only: real cities (50k+). Small provinces/territories fall back to their biggest towns.
function urbanPool(pool) {
  const big = pool.filter((c) => c.pop >= 50000);
  if (big.length) return big;
  return pool.slice().sort((a, b) => b.pop - a.pop).slice(0, 2);
}

function makePicker(mode) {
  if (mode === 'local') {
    const c = CITIES.find((x) => x.name === G.localCity);
    return () => c;
  }
  if (mode === 'province' || mode === 'streak') {
    // pick a province evenly first so PEI and the territories show up as often as Ontario
    const byProv = {};
    CITIES.forEach((c) => (byProv[c.prov] = byProv[c.prov] || []).push(c));
    const provs = Object.keys(byProv);
    return (rng) => {
      const p = provs[Math.floor(rng() * provs.length)];
      return weightedPick(byProv[p], cityWeight, rng);
    };
  }
  let pool = mode === 'daily' ? CITIES : regionCities(G.region);
  if (G.urban) pool = urbanPool(pool);
  return (rng) => weightedPick(pool, cityWeight, rng);
}

async function findRound() {
  const g = G; // keep a handle: the player can quit while a round is still loading
  const opts = {
    pickCity: g.pickCity,
    rng: g.rng,
    spreadKm: (c) => spreadFor(g.mode, c, g),
    searchM: () => (g.mode === 'local' ? 1500 : g.mode === 'city' ? 2500 : 4000),
    used: g.used,
    urban: g.urban,
  };
  const src = g.source;
  const r = src === 'mapillary' ? await findMapillaryRound({ ...opts, token: settings.token })
    : src === 'google' ? await findGoogleRound({ ...opts, key: settings.gkey })
    : src === 'streetview' ? await findStreetRound(opts)
    : await findCommonsRound(opts);
  // the real province comes from where the photo was taken (Ottawa photos can be in Gatineau, QC)
  r.prov = provinceAt(provinceGeo, r.lat, r.lon) || r.city.prov;
  return r;
}

async function startGame(mode) {
  const date = todayStr();
  if (mode === 'daily' && store.get('daily-' + date)) {
    const saved = store.get('daily-' + date);
    G = { mode, results: saved.results, total: saved.total, maxRounds: 5, region: 'all', date, finished: true };
    toast("You already played today's challenge. A new one unlocks at midnight Eastern.");
    return showSummary();
  }
  if (settings.source === 'mapillary' && !settings.token) {
    $('settings').open = true;
    $('set-token').focus();
    return toast('Add your Mapillary token in Settings first, or pick a different Imagery option.');
  }
  if (settings.source === 'google' && !settings.gkey) {
    $('settings').open = true;
    $('set-gkey').focus();
    return toast('Paste your Google Maps API key in Settings first, or pick "Google Street View (no key needed)".');
  }
  const seed = mode === 'daily' ? hashString('true-north-' + date) : (Math.random() * 2 ** 32) >>> 0;
  G = {
    mode,
    date,
    region: REGIONAL.includes(mode) ? settings.region : 'all',
    urban: mode === 'urban' || (settings.urban && REGIONAL.includes(mode)),
    localCity: settings.local,
    maxRounds: mode === 'streak' ? Infinity : mode === 'daily' ? 5 : settings.rounds,
    round: 0,
    total: 0,
    results: [],
    rng: mulberry32(seed),
    used: new Set(),
    // the Daily uses Street View (no key) unless you set up your own key, so everyone gets the same spots
    source: mode === 'daily' ? (settings.source === 'google' ? 'google' : 'streetview')
      // the 2 player mode needs one viewer per half, so Mapillary falls back to Street View
      : mode === 'duel' && settings.source === 'mapillary' ? 'streetview' : settings.source,
    timerSecs: settings.timer,
    next: null,
  };
  G.pickCity = makePicker(mode);
  show('game');
  setLoading(true, 'Loading the map...');
  try {
    await loadProvinces();
  } catch {
    setLoading(false);
    show('home');
    return toast('Could not load the map data. Check your connection.');
  }
  if (mode === 'duel') { setLoading(false); return startDuel(); }
  setupGuessUI();
  nextRound();
}

function setLoading(on, text = 'Finding a spot...') {
  $('loading').classList.toggle('on', on);
  $('loading-text').textContent = text;
}

async function nextRound() {
  G.round++;
  G.guess = null;
  G.answered = false;
  updateHud();
  $('guess-btn').disabled = true;
  setLoading(true, G.round === 1 ? 'Finding a spot somewhere in Canada...' : 'Finding the next spot...');
  try {
    G.current = await (G.next || findRound());
  } catch (e) {
    G.next = null;
    setLoading(false);
    show('home');
    return toast(e.message || 'Something went wrong loading that round.');
  }
  G.next = null;
  if (G.mode === 'city') buildCityChoices();
  await showImagery();
  resetGuessMap();
  setLoading(false);
  startTimer();
}

function updateHud() {
  $('hud-mode').textContent = MODES[G.mode].title;
  $('hud-round').textContent = G.maxRounds === Infinity ? G.round : `${G.round} / ${G.maxRounds}`;
  $('hud-score').textContent = G.mode === 'streak' ? `${G.results.length} streak` : G.total.toLocaleString();
}

// ---------------- photo viewer (zoom + pan) ----------------
const view = { scale: 1, x: 0, y: 0 };
function applyView() {
  $('photo').style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
}
function resetView() {
  view.scale = 1; view.x = 0; view.y = 0; applyView();
}
function zoomAt(clientX, clientY, factor) {
  const img = $('photo');
  const rect = img.getBoundingClientRect();
  const newScale = Math.min(6, Math.max(1, view.scale * factor));
  const f = newScale / view.scale;
  // keep the point under the cursor fixed
  view.x += (clientX - rect.left) * (1 - f);
  view.y += (clientY - rect.top) * (1 - f);
  view.scale = newScale;
  if (newScale === 1) { view.x = 0; view.y = 0; }
  applyView();
}
function initPhotoViewer() {
  const wrap = $('photo-wrap');
  wrap.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
  wrap.addEventListener('dblclick', (e) => zoomAt(e.clientX, e.clientY, view.scale > 1 ? 1 / view.scale : 2.5));
  const pts = new Map();
  let last = null, pinch = null;
  wrap.addEventListener('pointerdown', (e) => {
    wrap.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    wrap.classList.add('dragging');
    last = { x: e.clientX, y: e.clientY };
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch);
      pinch = d;
    } else if (pts.size === 1 && view.scale > 1) {
      view.x += e.clientX - last.x;
      view.y += e.clientY - last.y;
      applyView();
    }
    last = { x: e.clientX, y: e.clientY };
  });
  const end = (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (!pts.size) wrap.classList.remove('dragging');
    const rest = [...pts.values()][0];
    if (rest) last = rest;
  };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', end);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(src);
    im.onerror = reject;
    im.src = src;
  });
}

async function showImagery() {
  const r = G.current;
  const tabs = $('photo-tabs');
  tabs.innerHTML = '';
  const sv = $('sv');
  const streetMode = r.source === 'streetview' || r.source === 'google';
  sv.classList.toggle('on', streetMode);
  $('sv-tools').classList.toggle('on', streetMode);
  $('sv-skip').style.display = r.source === 'streetview' ? '' : 'none';
  $('sv-cover').style.display = 'none'; // the iframe is shifted up instead, which hides Google's address card
  if (!streetMode) sv.innerHTML = '';
  if (streetMode) {
    clearMapillary();
    $('mly').classList.remove('on');
    $('photo-wrap').style.display = 'none';
    $('zoom-hint').style.display = 'none';
    if (r.source === 'google') showGooglePano(sv, r, settings.move);
    else showStreetEmbed(sv, r.lat, r.lon, r.heading);
    return;
  }
  if (r.source === 'mapillary') {
    $('photo-wrap').style.display = 'none';
    $('mly').classList.add('on');
    $('zoom-hint').style.display = 'none';
    await showMapillary($('mly'), r.imageId, settings.token, settings.move);
    return;
  }
  clearMapillary();
  $('mly').classList.remove('on');
  $('photo-wrap').style.display = '';
  $('zoom-hint').style.display = '';
  // drop any photo that fails to load
  const ok = [];
  for (const p of r.photos) {
    try { await loadImage(p.url); ok.push(p); } catch { /* skip */ }
  }
  if (!ok.length) {
    // nothing loaded: grab a different spot instead
    G.current = await findRound();
    if (G.mode === 'city') buildCityChoices();
    return showImagery();
  }
  r.photos = ok;
  const pick = (i) => {
    $('photo').src = r.photos[i].url;
    resetView();
    [...tabs.children].forEach((b, j) => b.classList.toggle('on', j === i));
  };
  if (r.photos.length > 1) {
    r.photos.forEach((_, i) => {
      const b = document.createElement('button');
      b.textContent = i === 0 ? 'Main photo' : `Nearby ${i}`;
      b.onclick = () => pick(i);
      tabs.appendChild(b);
    });
  }
  pick(0);
}

// ---------------- guessing UI ----------------
function setupGuessUI() {
  const kind = MODES[G.mode].kind;
  const usesMap = kind === 'map' || kind === 'province';
  $('guess-panel').classList.toggle('on', usesMap);
  $('guess-panel').classList.remove('open');
  // provinces are easier to click on a big map
  $('guess-panel').classList.toggle('big', kind === 'province');
  $('map-toggle').classList.toggle('on', usesMap);
  $('map-toggle').classList.remove('raised');
  $('city-panel').classList.toggle('on', kind === 'city');
  $('city-choices').style.display = settings.citydiff === 'easy' ? '' : 'none';
  $('city-form').classList.toggle('on', settings.citydiff === 'hard');
  $('panel-label').textContent = kind === 'province' ? 'Click a province or territory' : 'Click the map to place your pin';

  if (usesMap && !guessMap) {
    guessMap = L.map('guess-map', { worldCopyJump: true, zoomControl: true, attributionControl: true });
    L.tileLayer(TILE_URL, TILE_OPTS).addTo(guessMap);
    guessMap.on('click', onMapClick);
  }
  if (kind === 'city') {
    $('city-list').innerHTML = regionCities(G.region).map((c) => `<option value="${c.name}, ${c.prov}">`).join('');
  }
}

function regionBounds() {
  if (G.mode === 'local') {
    const c = CITIES.find((x) => x.name === G.localCity);
    const d = 0.18;
    return [[c.lat - d, c.lon - d * 1.4], [c.lat + d, c.lon + d * 1.4]];
  }
  if (G.mode === 'daily' || G.region === 'all' || MODES[G.mode].kind === 'province') return CANADA_BOUNDS;
  if (REGIONS[G.region].single && provinceGeo) {
    const f = provinceGeo.features.find((x) => x.properties.code === G.region);
    if (f) return L.geoJSON(f).getBounds().pad(0.05);
  }
  const cs = regionCities(G.region);
  const lats = cs.map((c) => c.lat), lons = cs.map((c) => c.lon);
  return [[Math.min(...lats) - 1.5, Math.min(...lons) - 2], [Math.max(...lats) + 1.5, Math.max(...lons) + 2]];
}

function resetGuessMap() {
  if (!guessMap) return;
  if (guessLayer) guessMap.removeLayer(guessLayer);
  guessLayer = L.layerGroup().addTo(guessMap);
  if (MODES[G.mode].kind === 'province') {
    const geo = L.geoJSON(provinceGeo, {
      style: () => ({ color: '#555', weight: 1, fillColor: '#ffffff', fillOpacity: 0.05 }),
      onEachFeature: (f, layer) => {
        layer.on('mouseover', () => { if (G.guess?.prov !== f.properties.code) layer.setStyle({ fillOpacity: 0.25, fillColor: '#d52b1e' }); });
        layer.on('mouseout', () => { if (G.guess?.prov !== f.properties.code) layer.setStyle({ fillOpacity: 0.05, fillColor: '#ffffff' }); });
        layer.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          if (G.answered) return;
          geo.eachLayer((l) => l.setStyle({ fillOpacity: 0.05, fillColor: '#ffffff' }));
          layer.setStyle({ fillOpacity: 0.5, fillColor: '#d52b1e' });
          G.guess = { prov: f.properties.code };
          $('panel-label').textContent = PROVINCES[f.properties.code];
          $('guess-btn').disabled = false;
        });
      },
    }).addTo(guessLayer);
  }
  setTimeout(() => {
    guessMap.invalidateSize();
    guessMap.fitBounds(regionBounds());
  }, 250);
}

function pinIcon(kind) {
  return L.divIcon({ className: '', html: `<div class="pin ${kind}"></div>`, iconSize: [22, 22], iconAnchor: [11, 22] });
}

let guessMarker = null;
function onMapClick(e) {
  if (!G || G.answered || MODES[G.mode].kind !== 'map') return;
  const ll = e.latlng.wrap();
  G.guess = { lat: ll.lat, lon: ll.lng };
  if (guessMarker) guessLayer.removeLayer(guessMarker);
  guessMarker = L.marker(ll, { icon: pinIcon('guess') }).addTo(guessLayer);
  $('guess-btn').disabled = false;
}

function buildCityChoices() {
  const answer = G.current.city;
  const pool = regionCities(G.region).filter((c) => c.name !== answer.name);
  const picks = [];
  const sameProv = pool.filter((c) => c.prov === answer.prov);
  if (sameProv.length) picks.push(weightedPick(sameProv, cityWeight, G.rng));
  while (picks.length < 3 && picks.length < pool.length) {
    const c = weightedPick(pool, cityWeight, G.rng);
    if (!picks.includes(c)) picks.push(c);
  }
  const options = shuffle([answer, ...picks], G.rng);
  const box = $('city-choices');
  box.innerHTML = '';
  options.forEach((c) => {
    const b = document.createElement('button');
    b.innerHTML = `${c.name} <small style="color:var(--muted)">${c.prov}</small>`;
    b.onclick = () => submitCity(c);
    box.appendChild(b);
  });
  $('city-input').value = '';
}

function normalize(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function findCityByText(text) {
  const t = normalize(text);
  if (!t) return null;
  const list = regionCities(G.region);
  return list.find((c) => normalize(`${c.name}, ${c.prov}`) === t) || list.find((c) => normalize(c.name) === t) || null;
}

// ---------------- timer ----------------
let timerHandle = null;
function startTimer() {
  clearInterval(timerHandle);
  const box = $('hud-timer-box');
  $('duel-timer').style.display = G.timerSecs ? '' : 'none';
  if (!G.timerSecs) { box.style.display = 'none'; return; }
  box.style.display = 'flex';
  let left = G.timerSecs;
  const tick = () => {
    $('hud-timer').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    $('duel-timer').textContent = '⏱ ' + $('hud-timer').textContent;
    box.classList.toggle('low', left <= 10);
  };
  tick();
  timerHandle = setInterval(() => {
    left--;
    tick();
    if (left <= 0) {
      clearInterval(timerHandle);
      toast("Time's up!");
      if (G.mode === 'duel') duelTimeUp();
      else if (MODES[G.mode].kind === 'city') submitCity(null);
      else submitGuess();
    }
  }, 1000);
}

// ---------------- scoring ----------------
function scoreRound() {
  const a = G.current;
  const kind = MODES[G.mode].kind;
  const g = G.guess;
  if (kind === 'map') {
    if (!g) return { points: 0, km: null };
    const km = haversineKm(g, a);
    const scale = G.mode === 'local' ? 1.8 : G.mode === 'daily' ? regionScale('all') : regionScale(G.region);
    let points = Math.round(MAX_ROUND * Math.exp(-km / scale));
    if (km < (G.mode === 'local' ? 0.05 : 0.15)) points = MAX_ROUND;
    return { points, km };
  }
  if (kind === 'province') {
    return { points: g && g.prov === a.prov ? MAX_ROUND : 0, correct: !!g && g.prov === a.prov };
  }
  // city
  if (!g) return { points: 0, km: null, correct: false };
  if (g.city.name === a.city.name) return { points: MAX_ROUND, km: 0, correct: true };
  const km = haversineKm(g.city, a.city);
  return { points: Math.round(2000 * Math.exp(-km / 400)), km, correct: false };
}

function submitCity(city) {
  if (G.answered) return;
  G.guess = city ? { city, lat: city.lat, lon: city.lon } : null;
  submitGuess();
}

function submitGuess() {
  if (!G || G.answered) return;
  G.answered = true;
  clearInterval(timerHandle);
  const s = scoreRound();
  G.total += s.points;
  G.results.push({
    points: s.points, km: s.km, correct: s.correct,
    answer: { lat: G.current.lat, lon: G.current.lon, city: G.current.city.name, prov: G.current.prov },
    guess: G.guess ? { lat: G.guess.lat, lon: G.guess.lon, prov: G.guess.prov, city: G.guess.city?.name } : null,
  });
  const streakOver = G.mode === 'streak' && !s.correct;
  if (streakOver) G.results[G.results.length - 1].miss = true;
  const isLast = streakOver || G.round >= G.maxRounds;
  // start loading the next round while the player looks at the result
  if (!isLast) G.next = findRound().catch((e) => { throw e; });
  if (G.next) G.next.catch(() => {}); // handled when awaited
  showResult(s, isLast);
}

// ---------------- result screen ----------------
function ensureMap(existing, id) {
  if (existing) return existing;
  const m = L.map(id, { worldCopyJump: true });
  L.tileLayer(TILE_URL, TILE_OPTS).addTo(m);
  return m;
}

let resultLayer = null;
function showResult(s, isLast) {
  show('result');
  resultMap = ensureMap(resultMap, 'result-map');
  if (resultLayer) resultMap.removeLayer(resultLayer);
  resultLayer = L.layerGroup().addTo(resultMap);
  const a = G.current;
  const kind = MODES[G.mode].kind;
  const ansLL = [a.lat, a.lon];
  L.marker(ansLL, { icon: pinIcon('answer') }).addTo(resultLayer).bindTooltip('Actual spot');
  const pts = [ansLL];

  if (kind === 'province') {
    L.geoJSON(provinceGeo, {
      filter: (f) => f.properties.code === a.prov || f.properties.code === G.guess?.prov,
      style: (f) => ({
        color: f.properties.code === a.prov ? '#2fb86a' : '#e5484d', weight: 2,
        fillColor: f.properties.code === a.prov ? '#2fb86a' : '#e5484d', fillOpacity: 0.3,
      }),
    }).addTo(resultLayer);
  } else if (G.guess) {
    const gLL = [G.guess.lat, G.guess.lon];
    L.marker(gLL, { icon: pinIcon('guess') }).addTo(resultLayer).bindTooltip('Your guess');
    L.polyline([gLL, ansLL], { color: '#222', weight: 2, dashArray: '6 6' }).addTo(resultLayer);
    pts.push(gLL);
  }

  // text
  const place = `${a.city.name}, ${PROVINCES[a.prov]}`;
  let text;
  if (kind === 'map') {
    text = s.km === null ? `No guess. It was near <b>${place}</b>.` : `You were <b>${formatKm(s.km)}</b> away. It was near <b>${place}</b>.`;
  } else if (kind === 'province') {
    const guessName = G.guess ? PROVINCES[G.guess.prov] : 'nothing';
    text = s.correct ? `Correct! <b>${PROVINCES[a.prov]}</b> (near ${a.city.name}).` : `You picked ${guessName}. It was <b>${PROVINCES[a.prov]}</b>, near ${a.city.name}.`;
    if (G.mode === 'streak') text += s.correct ? ` Streak: <b>${G.results.length}</b> 🔥` : ' Streak over.';
  } else {
    text = s.correct ? `Correct! It's <b>${place}</b>.` : `It was <b>${place}</b>${G.guess ? `. You said ${G.guess.city.name} (${formatKm(s.km)} away)` : ''}.`;
  }
  $('res-text').innerHTML = text;
  $('res-points').textContent = `${s.points.toLocaleString()} points`;
  $('res-bar').parentElement.style.display = '';
  $('res-bar').style.width = '0';
  requestAnimationFrame(() => setTimeout(() => ($('res-bar').style.width = (s.points / MAX_ROUND) * 100 + '%'), 30));

  // photo credit (shown after guessing because file names give the place away)
  if (a.source === 'streetview' || a.source === 'google') {
    $('res-credit').innerHTML = `Imagery: Google Street View · <a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${a.lat},${a.lon}" target="_blank" rel="noopener">Open this spot in Google Maps</a>`;
  } else if (a.source === 'commons') {
    $('res-credit').innerHTML = 'Photo: ' + a.photos.map((p) =>
      `<a href="${p.page}" target="_blank" rel="noopener">${escapeHtml(p.artist).slice(0, 60)}</a>${p.license ? ' (' + escapeHtml(p.license) + ')' : ''}`).join(', ') + ' via Wikimedia Commons';
  } else {
    $('res-credit').innerHTML = `Imagery: <a href="https://www.mapillary.com/app/?pKey=${a.imageId}" target="_blank" rel="noopener">Mapillary</a> contributors (CC BY-SA)`;
  }

  $('next-btn').textContent = isLast ? 'See results' : 'Next round';
  $('next-btn').onclick = () => (isLast ? finishGame() : (show('game'), setupGuessUI(), nextRound()));
  setTimeout(() => {
    resultMap.invalidateSize();
    if (pts.length > 1) resultMap.fitBounds(pts, { paddingTopLeft: [50, 80], paddingBottomRight: [50, cardSpace()], maxZoom: 14 });
    else resultMap.setView(ansLL, 11);
    if (kind === 'province') resultMap.fitBounds(CANADA_BOUNDS, { paddingBottomRight: [0, cardSpace()] });
  }, 30);
  updateHud();
}

// leave room at the bottom of result maps for the score card
function cardSpace() {
  const card = document.querySelector('.screen.active .result-card');
  return card ? Math.min(card.offsetHeight + 40, window.innerHeight * 0.6) : 60;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------- end of game ----------------
function finishGame() {
  G.finished = true;
  const key = bestKey(G.mode);
  if (G.mode === 'streak') {
    const streak = G.results.filter((r) => r.correct).length;
    G.newBest = streak > (store.get('best-streak') || 0);
    if (G.newBest) store.set('best-streak', streak);
  } else if (G.mode === 'daily') {
    store.set('daily-' + G.date, { total: G.total, results: G.results });
  } else {
    const prev = store.get('best-' + key) || 0;
    G.newBest = G.total > prev;
    if (G.newBest) store.set('best-' + key, G.total);
  }
  showSummary();
}

let summaryLayer = null;
function showSummary() {
  show('summary');
  const isStreak = G.mode === 'streak';
  const rounds = G.results.length;
  const max = rounds * MAX_ROUND;
  $('sum-title').textContent = MODES[G.mode].title + (G.mode === 'daily' ? ` · ${G.date}` : '');
  if (isStreak) {
    const streak = G.results.filter((r) => r.correct).length;
    $('sum-points').textContent = `${streak} in a row 🔥`;
    $('sum-best').textContent = G.newBest ? 'New best streak!' : `Best streak: ${store.get('best-streak') || streak}`;
  } else {
    $('sum-points').textContent = `${G.total.toLocaleString()} / ${max.toLocaleString()}`;
    $('sum-best').textContent = G.newBest ? 'New personal best!' : '';
  }
  $('sum-table').innerHTML = G.results.map((r, i) => {
    let detail = `${r.answer.city}, ${r.answer.prov}`;
    if (r.km != null && MODES[G.mode].kind === 'map') detail += ` · ${formatKm(r.km)} off`;
    return `<tr><td>${i + 1}. ${emojiFor(r.points)} ${detail}</td><td>${r.points.toLocaleString()}</td></tr>`;
  }).join('');

  summaryMap = ensureMap(summaryMap, 'summary-map');
  if (summaryLayer) summaryMap.removeLayer(summaryLayer);
  summaryLayer = L.layerGroup().addTo(summaryMap);
  const pts = [];
  G.results.forEach((r, i) => {
    const a = [r.answer.lat, r.answer.lon];
    L.marker(a, { icon: pinIcon('answer') }).addTo(summaryLayer).bindTooltip(`Round ${i + 1}: ${r.answer.city}`);
    pts.push(a);
    if (r.guess && r.guess.lat != null) {
      const g = [r.guess.lat, r.guess.lon];
      L.marker(g, { icon: pinIcon('guess') }).addTo(summaryLayer);
      L.polyline([g, a], { color: '#222', weight: 2, dashArray: '6 6' }).addTo(summaryLayer);
      pts.push(g);
    }
  });
  setTimeout(() => {
    summaryMap.invalidateSize();
    if (pts.length) summaryMap.fitBounds(pts, { paddingTopLeft: [50, 50], paddingBottomRight: [50, cardSpace()], maxZoom: 12 });
    else summaryMap.fitBounds(CANADA_BOUNDS);
  }, 30);

  $('share-msg').textContent = '';
  $('again-btn').style.display = G.mode === 'daily' ? 'none' : '';
  $('again-btn').onclick = () => startGame(G.mode);
  $('menu-btn').onclick = goHome;
  $('share-btn').onclick = share;
}

function emojiFor(p) {
  return p >= 4000 ? '🟩' : p >= 2000 ? '🟨' : p >= 500 ? '🟧' : '🟥';
}

async function share() {
  const url = location.href.split('#')[0].split('?')[0];
  const line = G.results.map((r) => emojiFor(r.points)).join('');
  const head = `🍁 True North Guessr: ${MODES[G.mode].title}${G.mode === 'daily' ? ' ' + G.date : ''}`;
  const score = G.mode === 'streak'
    ? `${G.results.filter((r) => r.correct).length} province streak 🔥`
    : `${G.total.toLocaleString()} / ${(G.results.length * MAX_ROUND).toLocaleString()}`;
  const text = `${head}\n${score}\n${line}\n${url}`;
  try {
    if (navigator.share) { await navigator.share({ text }); return; }
    await navigator.clipboard.writeText(text);
    $('share-msg').textContent = 'Copied to clipboard!';
  } catch {
    $('share-msg').textContent = text;
  }
}

function goHome() {
  clearInterval(timerHandle);
  ['sv', 'd0-view', 'd1-view'].forEach((id) => ($(id).innerHTML = ''));
  clearMapillary();
  G = null;
  renderModes();
  show('home');
}

// ---------------- wiring ----------------
$('guess-btn').onclick = submitGuess;
$('sv-reset').onclick = () => {
  if (!G || !G.current) return;
  if (G.current.source === 'google') resetGooglePano(G.current);
  else showStreetEmbed($('sv'), G.current.lat, G.current.lon, G.current.heading);
};
// the no-key embed can't check coverage first, so let the player skip a blank spot for free
$('sv-skip').onclick = async () => {
  if (!G || G.answered) return;
  setLoading(true, 'Finding a different spot...');
  try {
    G.current = await findRound();
    if (G.mode === 'city') buildCityChoices();
    await showImagery();
  } catch (e) {
    toast(e.message || 'Could not find another spot.');
  }
  setLoading(false);
};
$('quit').onclick = () => { if (confirmQuit()) goHome(); };
function confirmQuit() {
  // no blocking dialogs: a second tap within 3s confirms
  if (G && !G.finished && G.round > 0 && !confirmQuit.armed) {
    confirmQuit.armed = true;
    toast('Tap ✕ again to quit this game.');
    setTimeout(() => (confirmQuit.armed = false), 3000);
    return false;
  }
  confirmQuit.armed = false;
  return true;
}
$('panel-size').onclick = () => {
  $('guess-panel').classList.toggle('big');
  setTimeout(() => guessMap && guessMap.invalidateSize(), 220);
};
$('guess-panel').addEventListener('transitionend', () => guessMap && guessMap.invalidateSize());
$('map-toggle').onclick = () => {
  const open = $('guess-panel').classList.toggle('open');
  $('map-toggle').classList.toggle('raised', open);
  $('map-toggle').textContent = open ? '📷 Photo' : '🗺️ Map';
  setTimeout(() => {
    if (!guessMap) return;
    guessMap.invalidateSize();
    // the map was hidden when the round started, so frame it now
    if (open && G && !G.guess) guessMap.fitBounds(regionBounds());
  }, 50);
};
$('city-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const c = findCityByText($('city-input').value);
  if (!c) return toast('Pick a city from the list.');
  submitCity(c);
});
document.addEventListener('keydown', (e) => {
  if ($('game').classList.contains('active') && (e.key === ' ' || e.key === 'Enter') && !$('guess-btn').disabled && document.activeElement.tagName !== 'INPUT') {
    e.preventDefault();
    submitGuess();
  } else if ($('result').classList.contains('active') && (e.key === ' ' || e.key === 'Enter')) {
    e.preventDefault();
    $('next-btn').click();
  }
});

initSettings();
initPhotoViewer();
renderModes();

// ---------------- 2 player split screen ----------------
const duelMaps = [null, null];
const duelLayers = [null, null];
const duelPanos = [null, null];
const P_COLORS = ['#d52b1e', '#2f6fde'];

function playerName(i) {
  return ((i === 0 ? settings.p1 : settings.p2) || '').trim() || `Player ${i + 1}`;
}

function setDuelLoading(on, text = 'Finding a spot...') {
  $('duel-loading').classList.toggle('on', on);
  $('duel-loading-text').textContent = text;
}

function startDuel() {
  G.duel = { scores: [0, 0], wins: [0, 0] };
  show('duel');
  for (let i = 0; i < 2; i++) {
    $(`d${i}-name`).textContent = playerName(i);
    $(`d${i}-score-name`).textContent = playerName(i);
    if (!duelMaps[i]) {
      duelMaps[i] = L.map(`d${i}-map`, { worldCopyJump: true });
      L.tileLayer(TILE_URL, TILE_OPTS).addTo(duelMaps[i]);
      duelMaps[i].attributionControl.setPrefix(false);
      duelMaps[i].on('click', (e) => duelPin(i, e.latlng.wrap()));
      $(`d${i}-panel`).addEventListener('transitionend', () => duelMaps[i].invalidateSize());
    }
  }
  nextDuelRound();
}

function updateDuelHud() {
  $('duel-round').textContent = `Round ${G.round} / ${G.maxRounds}`;
  $('d0-score').textContent = G.duel.scores[0].toLocaleString();
  $('d1-score').textContent = G.duel.scores[1].toLocaleString();
}

async function nextDuelRound() {
  G.round++;
  G.answered = false;
  G.duel.guess = [null, null];
  G.duel.locked = [false, false];
  updateDuelHud();
  for (let i = 0; i < 2; i++) {
    $(`d${i}-lock`).disabled = true;
    $(`d${i}-locked`).classList.remove('on');
  }
  setDuelLoading(true, G.round === 1 ? 'Finding a spot for both of you...' : 'Finding the next spot...');
  try {
    G.current = await (G.next || findRound());
  } catch (e) {
    G.next = null;
    setDuelLoading(false);
    show('home');
    return toast(e.message || 'Something went wrong loading that round.');
  }
  G.next = null;
  showDuelImagery();
  for (let i = 0; i < 2; i++) {
    if (duelLayers[i]) duelMaps[i].removeLayer(duelLayers[i]);
    duelLayers[i] = L.layerGroup().addTo(duelMaps[i]);
  }
  setTimeout(() => duelMaps.forEach((m) => { m.invalidateSize(); m.fitBounds(regionBounds()); }), 250);
  setDuelLoading(false);
  startTimer();
}

function showDuelImagery() {
  const r = G.current;
  for (let i = 0; i < 2; i++) {
    const v = $(`d${i}-view`);
    v.innerHTML = '';
    $(`d${i}-cover`).style.display = 'none';
    if (r.source === 'google') duelPanos[i] = showGooglePano(v, r, settings.move);
    else if (r.source === 'streetview') showStreetEmbed(v, r.lat, r.lon, r.heading);
    else {
      const img = document.createElement('img');
      img.src = r.photos[0].url;
      img.className = 'duel-photo';
      img.alt = '';
      v.appendChild(img);
    }
  }
  $('duel-skip').style.display = r.source === 'streetview' ? '' : 'none';
}

function duelPin(i, ll) {
  if (!G || G.mode !== 'duel' || G.answered || G.duel.locked[i]) return;
  G.duel.guess[i] = { lat: ll.lat, lon: ll.lng };
  duelLayers[i].clearLayers();
  L.marker(ll, { icon: pinIcon(i === 0 ? 'guess' : 'guess2') }).addTo(duelLayers[i]);
  $(`d${i}-lock`).disabled = false;
}

function duelLock(i) {
  if (!G || G.answered || !G.duel.guess[i]) return;
  G.duel.locked[i] = true;
  $(`d${i}-locked`).classList.add('on');
  $(`d${i}-locked-text`).textContent = G.duel.locked[1 - i] ? 'Locked in!' : `Locked in! Waiting for ${playerName(1 - i)}...`;
  if (G.duel.locked[0] && G.duel.locked[1]) finishDuelRound();
}

function duelTimeUp() {
  finishDuelRound();
}

function finishDuelRound() {
  if (G.answered) return;
  G.answered = true;
  clearInterval(timerHandle);
  const a = G.current;
  const scale = regionScale(G.region);
  const res = G.duel.guess.map((g) => {
    if (!g) return { points: 0, km: null };
    const km = haversineKm(g, a);
    return { km, points: km < 0.15 ? MAX_ROUND : Math.round(MAX_ROUND * Math.exp(-km / scale)) };
  });
  res.forEach((r, i) => (G.duel.scores[i] += r.points));
  const winner = res[0].points === res[1].points ? -1 : res[0].points > res[1].points ? 0 : 1;
  if (winner >= 0) G.duel.wins[winner]++;
  G.results.push({
    points: Math.max(res[0].points, res[1].points),
    answer: { lat: a.lat, lon: a.lon, city: a.city.name, prov: a.prov },
    duel: { res, winner, guesses: G.duel.guess.slice() },
  });
  const isLast = G.round >= G.maxRounds;
  if (!isLast) { G.next = findRound(); G.next.catch(() => {}); }
  showDuelResult(res, winner, isLast);
}

function showDuelResult(res, winner, isLast) {
  show('result');
  resultMap = ensureMap(resultMap, 'result-map');
  if (resultLayer) resultMap.removeLayer(resultLayer);
  resultLayer = L.layerGroup().addTo(resultMap);
  const a = G.current;
  const ansLL = [a.lat, a.lon];
  L.marker(ansLL, { icon: pinIcon('answer') }).addTo(resultLayer).bindTooltip('Actual spot');
  const pts = [ansLL];
  G.duel.guess.forEach((g, i) => {
    if (!g) return;
    const gl = [g.lat, g.lon];
    L.marker(gl, { icon: pinIcon(i === 0 ? 'guess' : 'guess2') }).addTo(resultLayer).bindTooltip(playerName(i));
    L.polyline([gl, ansLL], { color: P_COLORS[i], weight: 3, dashArray: '6 6' }).addTo(resultLayer);
    pts.push(gl);
  });
  const line = (i) => `<span style="color:${P_COLORS[i]};font-weight:700">${escapeHtml(playerName(i))}</span>: ` +
    (res[i].km === null ? 'no guess' : `${formatKm(res[i].km)} away`) + ` → <b>${res[i].points.toLocaleString()}</b>`;
  $('res-points').textContent = winner < 0 ? "It's a tie!" : `${playerName(winner)} wins the round!`;
  $('res-bar').parentElement.style.display = 'none';
  $('res-text').innerHTML = `${line(0)}<br>${line(1)}<br>It was near <b>${a.city.name}, ${PROVINCES[a.prov]}</b>.`;
  $('res-credit').innerHTML = (a.source === 'streetview' || a.source === 'google')
    ? `Imagery: Google Street View · <a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${a.lat},${a.lon}" target="_blank" rel="noopener">Open this spot in Google Maps</a>`
    : a.photos ? 'Photo via Wikimedia Commons: ' + a.photos.slice(0, 1).map((p) => `<a href="${p.page}" target="_blank" rel="noopener">${escapeHtml(p.artist).slice(0, 60)}</a>`).join('') : '';
  $('next-btn').textContent = isLast ? 'See final score' : 'Next round';
  $('next-btn').onclick = () => (isLast ? showDuelSummary() : (show('duel'), nextDuelRound()));
  setTimeout(() => {
    resultMap.invalidateSize();
    if (pts.length > 1) resultMap.fitBounds(pts, { paddingTopLeft: [50, 80], paddingBottomRight: [50, cardSpace()], maxZoom: 14 });
    else resultMap.setView(ansLL, 11);
  }, 30);
}

function showDuelSummary() {
  G.finished = true;
  show('summary');
  const [s0, s1] = G.duel.scores;
  const w = s0 === s1 ? -1 : s0 > s1 ? 0 : 1;
  $('sum-title').textContent = '2 Player Split Screen';
  $('sum-points').innerHTML = `<span style="color:${P_COLORS[0]}">${s0.toLocaleString()}</span> vs <span style="color:${P_COLORS[1]}">${s1.toLocaleString()}</span>`;
  $('sum-best').textContent = w < 0 ? "🤝 It's a tie!" : `🏆 ${playerName(w)} wins! (${G.duel.wins[w]} of ${G.results.length} rounds)`;
  $('sum-table').innerHTML = `<tr><td><b>Round</b></td><td style="color:${P_COLORS[0]}">${escapeHtml(playerName(0))}</td><td style="color:${P_COLORS[1]}">${escapeHtml(playerName(1))}</td></tr>` +
    G.results.map((r, i) => `<tr><td>${i + 1}. ${r.answer.city}, ${r.answer.prov}</td><td>${r.duel.res[0].points.toLocaleString()}${r.duel.winner === 0 ? ' 🏆' : ''}</td><td>${r.duel.res[1].points.toLocaleString()}${r.duel.winner === 1 ? ' 🏆' : ''}</td></tr>`).join('');
  summaryMap = ensureMap(summaryMap, 'summary-map');
  if (summaryLayer) summaryMap.removeLayer(summaryLayer);
  summaryLayer = L.layerGroup().addTo(summaryMap);
  const pts = [];
  G.results.forEach((r, k) => {
    const a = [r.answer.lat, r.answer.lon];
    L.marker(a, { icon: pinIcon('answer') }).addTo(summaryLayer).bindTooltip(`Round ${k + 1}: ${r.answer.city}`);
    pts.push(a);
    r.duel.guesses.forEach((g, i) => {
      if (!g) return;
      L.marker([g.lat, g.lon], { icon: pinIcon(i === 0 ? 'guess' : 'guess2') }).addTo(summaryLayer);
      L.polyline([[g.lat, g.lon], a], { color: P_COLORS[i], weight: 2, dashArray: '6 6' }).addTo(summaryLayer);
      pts.push([g.lat, g.lon]);
    });
  });
  setTimeout(() => {
    summaryMap.invalidateSize();
    if (pts.length) summaryMap.fitBounds(pts, { paddingTopLeft: [50, 50], paddingBottomRight: [50, cardSpace()], maxZoom: 12 });
  }, 30);
  $('share-msg').textContent = '';
  $('again-btn').style.display = '';
  $('again-btn').onclick = () => startGame('duel');
  $('menu-btn').onclick = goHome;
  $('share-btn').onclick = async () => {
    const text = `🍁 True North Guessr: 2 Player\n${playerName(0)} ${s0.toLocaleString()} vs ${playerName(1)} ${s1.toLocaleString()}\n` +
      (w < 0 ? 'Tie!' : `${playerName(w)} wins 🏆`) + `\n${location.href.split('#')[0].split('?')[0]}`;
    try {
      if (navigator.share) { await navigator.share({ text }); return; }
      await navigator.clipboard.writeText(text);
      $('share-msg').textContent = 'Copied to clipboard!';
    } catch { $('share-msg').textContent = text; }
  };
}

for (let i = 0; i < 2; i++) {
  $(`d${i}-lock`).onclick = () => duelLock(i);
  $(`d${i}-reset`).onclick = () => {
    if (!G || !G.current) return;
    if (G.current.source === 'google') resetGooglePano(G.current, duelPanos[i]);
    else if (G.current.source === 'streetview') showStreetEmbed($(`d${i}-view`), G.current.lat, G.current.lon, G.current.heading);
  };
  $(`d${i}-size`).onclick = () => {
    $(`d${i}-panel`).classList.toggle('big');
    setTimeout(() => duelMaps[i] && duelMaps[i].invalidateSize(), 220);
  };
}
$('duel-quit').onclick = () => { if (confirmQuit()) goHome(); };
$('duel-skip').onclick = async () => {
  if (!G || G.answered) return;
  setDuelLoading(true, 'Finding a different spot...');
  try {
    G.current = await findRound();
    showDuelImagery();
  } catch (e) {
    toast(e.message || 'Could not find another spot.');
  }
  setDuelLoading(false);
};
