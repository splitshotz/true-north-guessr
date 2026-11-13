// Where the pictures come from.
//  - Wikimedia Commons geotagged photos (default, no key needed)
//  - Mapillary street-level imagery (optional, needs a free client token in Settings)

import { haversineKm, offsetPoint } from './geo.js';

const COMMONS = 'https://commons.wikimedia.org/w/api.php';

// categories that are almost never useful outdoor clues
const BAD_CATEGORY =
  /aquarium|museum|interior|portrait|people of|food|dishes|insects|birds of|plants|flowers|fungi|paintings|logos|maps of|flags|coats of arms|documents|screenshots|animals|close-up|collections of|exhibits|artifacts|signatures|from space|astronaut|satellite|microscop|specimens|taxidermy/i;
const BAD_TITLE = /\b(map|logo|flag|diagram|plan|scan|iss\d|seal|crest|chart|graph|poster)\b/i;

function stripHtml(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent || '').trim().replace(/\s+/g, ' ');
}

export async function commonsPhotos(lat, lon, radiusM) {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'geosearch',
    ggscoord: `${lat}|${lon}`,
    ggsradius: String(Math.min(10000, Math.max(10, Math.round(radiusM)))),
    ggsnamespace: '6',
    ggslimit: '50',
    prop: 'imageinfo|coordinates',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '1600',
    iiextmetadatafilter: 'Artist|LicenseShortName|Categories',
    colimit: 'max',
    format: 'json',
    origin: '*',
  });
  const res = await fetch(`${COMMONS}?${params}`);
  if (!res.ok) throw new Error('Commons request failed');
  const data = await res.json();
  const pages = Object.values(data.query?.pages || {}).filter((p) => p.coordinates && p.imageinfo);

  // lots of old uploads are pinned to the same "city centre" coordinate; those geotags are useless
  const key = (p) => p.coordinates[0].lat.toFixed(4) + ',' + p.coordinates[0].lon.toFixed(4);
  const counts = {};
  pages.forEach((p) => (counts[key(p)] = (counts[key(p)] || 0) + 1));

  return pages
    .filter((p) => {
      const ii = p.imageinfo[0];
      const cats = ii.extmetadata?.Categories?.value || '';
      return (
        ii.mime === 'image/jpeg' &&
        ii.width >= 1000 &&
        ii.width > ii.height * 1.1 && // landscape shots look like street views
        counts[key(p)] < 3 &&
        !BAD_CATEGORY.test(cats) &&
        !BAD_TITLE.test(p.title)
      );
    })
    .sort((a, b) => a.pageid - b.pageid) // stable order so the daily challenge matches for everyone
    .map((p) => {
      const ii = p.imageinfo[0];
      return {
        id: p.title,
        lat: p.coordinates[0].lat,
        lon: p.coordinates[0].lon,
        url: ii.thumburl || ii.url,
        page: ii.descriptionurl,
        artist: stripHtml(ii.extmetadata?.Artist?.value) || 'Unknown',
        license: ii.extmetadata?.LicenseShortName?.value || '',
      };
    });
}

// Pick a city, jitter into it, and find a photo there. Retries different cities if a spot is empty.
export async function findCommonsRound({ pickCity, rng, spreadKm, searchM, used }) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const city = pickCity(rng);
    const spot = offsetPoint(city, spreadKm(city), rng);
    let photos;
    try {
      photos = await commonsPhotos(spot.lat, spot.lon, searchM(city));
    } catch {
      continue;
    }
    photos = photos.filter((p) => !used.has(p.id));
    if (!photos.length) continue;
    const main = photos[Math.floor(rng() * photos.length)];
    const extras = photos
      .filter((p) => p !== main && haversineKm(p, main) < 1.5)
      .sort((a, b) => haversineKm(a, main) - haversineKm(b, main))
      .slice(0, 2);
    [main, ...extras].forEach((p) => used.add(p.id));
    return { city, lat: main.lat, lon: main.lon, source: 'commons', photos: [main, ...extras] };
  }
  throw new Error('Could not find photos. Check your connection and try again.');
}

// ---------- Mapillary (optional) ----------

let mapillaryLoad = null;
function loadMapillary() {
  if (window.mapillary) return Promise.resolve();
  if (mapillaryLoad) return mapillaryLoad;
  mapillaryLoad = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://unpkg.com/mapillary-js@4.1.2/dist/mapillary.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/mapillary-js@4.1.2/dist/mapillary.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the Mapillary viewer'));
    document.head.appendChild(s);
  });
  return mapillaryLoad;
}

export async function findMapillaryRound({ pickCity, rng, spreadKm, token, used }) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const city = pickCity(rng);
    const spot = offsetPoint(city, spreadKm(city), rng);
    const d = 0.01; // about 1 km box
    const bbox = [spot.lon - d, spot.lat - d, spot.lon + d, spot.lat + d].map((n) => n.toFixed(5)).join(',');
    const url = `https://graph.mapillary.com/images?access_token=${encodeURIComponent(token)}&fields=id,computed_geometry,geometry,is_pano&bbox=${bbox}&limit=60`;
    let list;
    try {
      const res = await fetch(url);
      if (res.status === 401 || res.status === 403) throw new Error('bad-token');
      list = (await res.json()).data || [];
    } catch (e) {
      if (e.message === 'bad-token') throw new Error('Your Mapillary token was rejected. Check it in Settings.');
      continue;
    }
    list = list.filter((im) => !used.has(im.id) && (im.computed_geometry || im.geometry));
    if (!list.length) continue;
    const panos = list.filter((im) => im.is_pano);
    const pool = panos.length ? panos : list;
    const im = pool[Math.floor(rng() * pool.length)];
    used.add(im.id);
    const [lon, lat] = (im.computed_geometry || im.geometry).coordinates;
    return { city, lat, lon, source: 'mapillary', imageId: im.id };
  }
  throw new Error('No Mapillary imagery found nearby. Try again or switch back to photos.');
}

let viewer = null;
export async function showMapillary(container, imageId, token, allowMove) {
  await loadMapillary();
  if (viewer) {
    viewer.remove();
    viewer = null;
  }
  container.innerHTML = '';
  viewer = new window.mapillary.Viewer({
    accessToken: token,
    container,
    imageId,
    component: { cover: false, sequence: allowMove, direction: allowMove, keyboard: allowMove, zoom: true },
  });
}

export function clearMapillary() {
  if (viewer) {
    viewer.remove();
    viewer = null;
  }
}

// ---------- Google Street View ----------

// Find a real road near the spot (OpenStreetMap via Overpass) so Street View has something to show.
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const ROAD_TYPES = 'primary|secondary|tertiary|residential|unclassified|trunk|living_street';

export async function roadPointNear(lat, lon, radiusM, rng) {
  const q = `[out:json][timeout:15];way(around:${Math.round(radiusM)},${lat.toFixed(5)},${lon.toFixed(5)})[highway~"^(${ROAD_TYPES})$"];out geom 80;`;
  for (const base of OVERPASS) {
    try {
      const res = await fetch(base, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (!res.ok) continue;
      const ways = ((await res.json()).elements || []).filter((w) => w.geometry && w.geometry.length).sort((a, b) => a.id - b.id);
      if (!ways.length) return null;
      const way = ways[Math.floor(rng() * ways.length)];
      const pt = way.geometry[Math.floor(rng() * way.geometry.length)];
      return { lat: pt.lat, lon: pt.lon };
    } catch {
      /* try the next server */
    }
  }
  return null;
}

// Mode 1: no key. Google's public Street View embed, pointed at a road.
export async function findStreetRound({ pickCity, rng, spreadKm, used }) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const city = pickCity(rng);
    const spot = offsetPoint(city, spreadKm(city), rng);
    const road = await roadPointNear(spot.lat, spot.lon, 1500, rng);
    if (!road) continue;
    const id = road.lat.toFixed(4) + ',' + road.lon.toFixed(4);
    if (used.has(id)) continue;
    used.add(id);
    return { city, lat: road.lat, lon: road.lon, source: 'streetview', heading: Math.floor(rng() * 360) };
  }
  throw new Error('Could not find a road to drop you on. Check your connection and try again.');
}

export function showStreetEmbed(container, lat, lon, heading) {
  container.innerHTML = '';
  const f = document.createElement('iframe');
  f.src = `https://maps.google.com/maps?q=&layer=c&cbll=${lat},${lon}&cbp=11,${heading || 0},0,0,0&output=svembed`;
  f.setAttribute('allow', 'fullscreen; accelerometer; gyroscope');
  f.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
  f.title = 'Street View';
  container.appendChild(f);
}

// Mode 2: your own Google Maps API key. Real Street View with a coverage check, no address shown.
let gmapsLoad = null;
function loadGoogleMaps(key) {
  if (window.google && window.google.maps && window.google.maps.StreetViewService) return Promise.resolve();
  if (gmapsLoad) return gmapsLoad;
  gmapsLoad = new Promise((resolve, reject) => {
    window.__tngMapsReady = resolve;
    window.gm_authFailure = () => reject(new Error('Google rejected your API key. Check it in Settings.'));
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&callback=__tngMapsReady`;
    s.async = true;
    s.onerror = () => reject(new Error('Could not load Google Maps.'));
    document.head.appendChild(s);
  });
  gmapsLoad.catch(() => (gmapsLoad = null));
  return gmapsLoad;
}

export async function findGoogleRound({ pickCity, rng, spreadKm, used, key }) {
  await loadGoogleMaps(key);
  const svc = new google.maps.StreetViewService();
  for (let attempt = 0; attempt < 10; attempt++) {
    const city = pickCity(rng);
    const spot = offsetPoint(city, spreadKm(city), rng);
    try {
      const { data } = await svc.getPanorama({
        location: { lat: spot.lat, lng: spot.lon },
        radius: 2000,
        source: google.maps.StreetViewSource.OUTDOOR,
        preference: google.maps.StreetViewPreference.NEAREST,
      });
      const id = data.location.pano;
      // official Google car imagery only (user photo spheres often have the place name on them)
      if (used.has(id) || !/google/i.test(data.copyright || '')) continue;
      used.add(id);
      const ll = data.location.latLng;
      return { city, lat: ll.lat(), lon: ll.lng(), source: 'google', panoId: id, heading: Math.floor(rng() * 360) };
    } catch {
      /* no coverage here, pick another spot */
    }
  }
  throw new Error('No Street View found nearby after several tries. Try again.');
}

let pano = null;
export function showGooglePano(container, round, allowMove) {
  container.innerHTML = '';
  pano = new google.maps.StreetViewPanorama(container, {
    pano: round.panoId,
    pov: { heading: round.heading || 0, pitch: 0 },
    zoom: 0,
    addressControl: false,
    showRoadLabels: false,
    fullscreenControl: false,
    motionTracking: false,
    motionTrackingControl: false,
    enableCloseButton: false,
    linksControl: allowMove,
    clickToGo: allowMove,
    scrollwheel: true,
    keyboardShortcuts: allowMove,
  });
}
export function resetGooglePano(round) {
  if (pano) {
    pano.setPano(round.panoId);
    pano.setPov({ heading: round.heading || 0, pitch: 0 });
  }
}
