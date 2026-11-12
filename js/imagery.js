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
