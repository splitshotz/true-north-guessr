import { CITIES, PROVINCES, REGIONS, LOCAL_CITIES } from './cities.js';
import { haversineKm, mulberry32, hashString, weightedPick, shuffle, provinceAt, formatKm } from './geo.js';
import { findCommonsRound, findMapillaryRound, showMapillary, clearMapillary } from './imagery.js';

const $ = (id) => document.getElementById(id);
const MAX_ROUND = 5000;
const CANADA_BOUNDS = [[41.7, -141], [70.5, -52.5]];
const TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILE_OPTS = {
  subdomains: 'abcd',
  maxZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>',
};

const MODES = {
  daily: { icon: '📅', title: 'Daily Challenge', desc: 'The same 5 spots for everyone today, anywhere in Canada. One try per day.', kind: 'map' },
  classic: { icon: '🍁', title: 'Classic', desc: 'Drop a pin anywhere on the map. The closer you are, the more points.', kind: 'map' },
  city: { icon: '🏙️', title: 'City Guesser', desc: 'Which Canadian city or town are you standing in?', kind: 'city' },
  province: { icon: '🗺️', title: 'Province Pick', desc: 'Click the province or territory the photo was taken in.', kind: 'province' },
  local: { icon: '📍', title: 'City Streets', desc: 'Zoomed into one city (pick it in Settings). Find the exact neighbourhood.', kind: 'map' },
  streak: { icon: '🔥', title: 'Province Streak', desc: 'Name the province, again and again. One miss and it is over.', kind: 'province' },
};

// distance (km) at which a classic guess drops to ~37% of max points
const REGION_SCALE = { all: 600, west: 220, prairies: 300, ontario: 230, quebec: 260, atlantic: 200, north: 500 };

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
  { rounds: 5, timer: 0, region: 'all', citydiff: 'easy', local: 'Toronto', source: 'commons', token: '', move: true },
  store.get('settings', {})
);

function initSettings() {
  $('set-region').innerHTML = Object.entries(REGIONS).map(([k, r]) => `<option value="${k}">${r.label}</option>`).join('');
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
  bind('set-move', 'move');
  updateTokenRow();
}
function updateTokenRow() {
  const on = settings.source === 'mapillary';
  $('token-row').style.display = on ? '' : 'none';
  $('set-move').closest('label').style.display = on ? '' : 'none';
}

function bestKey(mode) {
  if (mode === 'classic' || mode === 'city') return `${mode}:${settings.region}:${settings.rounds}`;
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
    if ((k === 'classic' || k === 'city') && settings.region !== 'all') extra = ` <b>(${REGIONS[settings.region].label})</b>`;
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

function spreadFor(mode, c) {
  if (mode === 'local') return c.pop > 1000000 ? 13 : c.pop > 400000 ? 9 : 6;
  const base = c.pop > 1000000 ? 14 : c.pop > 300000 ? 9 : c.pop > 100000 ? 6 : c.pop > 30000 ? 4 : 2.5;
  return mode === 'city' ? base * 0.55 : base;
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
  const pool = mode === 'daily' ? CITIES : regionCities(G.region);
  return (rng) => weightedPick(pool, cityWeight, rng);
}

async function findRound() {
  const opts = {
    pickCity: G.pickCity,
    rng: G.rng,
    spreadKm: (c) => spreadFor(G.mode, c),
    searchM: () => (G.mode === 'local' ? 1500 : G.mode === 'city' ? 2500 : 4000),
    used: G.used,
  };
  const r = G.useMapillary
    ? await findMapillaryRound({ ...opts, token: settings.token })
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
  if (mode !== 'daily' && settings.source === 'mapillary' && !settings.token) {
    $('settings').open = true;
    $('set-token').focus();
    return toast('Add your Mapillary token in Settings first, or switch Imagery back to Photos.');
  }
  const seed = mode === 'daily' ? hashString('true-north-' + date) : (Math.random() * 2 ** 32) >>> 0;
  G = {
    mode,
    date,
    region: mode === 'daily' ? 'all' : settings.region,
    localCity: settings.local,
    maxRounds: mode === 'streak' ? Infinity : mode === 'daily' ? 5 : settings.rounds,
    round: 0,
    total: 0,
    results: [],
    rng: mulberry32(seed),
    used: new Set(),
    useMapillary: mode !== 'daily' && settings.source === 'mapillary',
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
  if (!G.timerSecs) { box.style.display = 'none'; return; }
  box.style.display = 'flex';
  let left = G.timerSecs;
  const tick = () => {
    $('hud-timer').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    box.classList.toggle('low', left <= 10);
  };
  tick();
  timerHandle = setInterval(() => {
    left--;
    tick();
    if (left <= 0) {
      clearInterval(timerHandle);
      toast("Time's up!");
      if (MODES[G.mode].kind === 'city') submitCity(null);
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
    const scale = G.mode === 'local' ? 1.8 : G.mode === 'daily' ? REGION_SCALE.all : REGION_SCALE[G.region];
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
  $('res-bar').style.width = '0';
  requestAnimationFrame(() => setTimeout(() => ($('res-bar').style.width = (s.points / MAX_ROUND) * 100 + '%'), 30));

  // photo credit (shown after guessing because file names give the place away)
  if (a.source === 'commons') {
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
  clearMapillary();
  G = null;
  renderModes();
  show('home');
}

// ---------------- wiring ----------------
$('guess-btn').onclick = submitGuess;
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
