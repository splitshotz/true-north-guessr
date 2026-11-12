# 🍁 True North Guessr

A GeoGuessr-style game that only uses Canada. You get real photos taken somewhere in the country and have to work out where you are.

**Play:** https://splitshotz.github.io/true-north-guessr/

## Modes

| Mode | How it works | Scoring |
|---|---|---|
| 📅 **Daily Challenge** | Same 5 spots for everyone each day (resets at midnight Eastern). One try. | Up to 5,000 per round by distance |
| 🍁 **Classic** | Drop a pin anywhere on the map. Can be limited to a region (BC, Prairies, Ontario, Quebec, Atlantic, the North). | Up to 5,000 per round, falls off with distance |
| 🏙️ **City Guesser** | Which city or town is this? Easy = 4 choices, Hard = type it. | 5,000 if right, partial credit if your pick is nearby |
| 🗺️ **Province Pick** | Click the province or territory on the map. | 5,000 if right |
| 📍 **City Streets** | Zoomed into one city (Toronto, Montreal, Vancouver, Calgary, and 11 more). Find the exact neighbourhood. | Very tight scoring, metres matter |
| 🔥 **Province Streak** | Keep naming provinces until you get one wrong. | Longest streak |

Other features: round timer, 3/5/10 rounds, zoom and pan on photos (scroll, pinch, double-click), extra nearby photos as clues, personal bests, shareable emoji results, and a phone layout.

## Where the pictures come from

- **Default: [Wikimedia Commons](https://commons.wikimedia.org)** geotagged photos, pulled live from the public API. No account or key needed. Photos with fake "city centre" geotags, maps, logos, indoor shots, museum pieces and so on are filtered out. Every photo is credited (author and license) after you guess, since the file names would give the answer away.
- **Optional: [Mapillary](https://www.mapillary.com)** street-level 360° imagery that you can move around in, like real GeoGuessr. Get a free client token at mapillary.com/dashboard/developers and paste it in Settings. It's only saved in your browser.

## How it works

Plain HTML, CSS and JavaScript (ES modules), no build step, hosted on GitHub Pages.

- `js/cities.js`: 131 Canadian cities and towns with coordinates, province and population. Spots are picked weighted by population, then jittered randomly inside the city.
- `js/imagery.js`: Commons geosearch and filtering, plus the optional Mapillary viewer.
- `js/geo.js`: distance math, seeded random numbers (for the daily challenge), point-in-polygon.
- `data/provinces.geojson`: simplified province and territory borders, used to check which province a photo was really taken in (an "Ottawa" photo can actually be in Gatineau, QC).
- Map: [Leaflet](https://leafletjs.com) with © OpenStreetMap / © CARTO tiles.
