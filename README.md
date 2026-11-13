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
| 🌆 **Cities Only** | Classic, but always on a real city street (cities of 50k+), never highways or bush. | Same as Classic |
| ⚔️ **2 Player Split Screen** | Both players get the same spot side by side, each with their own Street View and map. Lock in, then see who was closer. | Closest guess wins the round; highest total wins |

**Where to play:** pick All of Canada, a region, or any single province or territory on the home screen. The "Cities only" box applies the city-streets rule to Classic, City Guesser and 2 Player too. Scoring gets tighter for smaller areas.

Other features: round timer, 3/5/10 rounds, zoom and pan on photos (scroll, pinch, double-click), extra nearby photos as clues, personal bests, shareable emoji results, and a phone layout.

## Where the imagery comes from

- **Default: Google Street View, no key needed.** The game finds a real road near a random spot in Canada (OpenStreetMap data via the Overpass API) and opens Google's public Street View embed there, so you can look around and click to move. It can't check coverage first, so if a spot is blank, hit "Blank? New spot" (no penalty).
- **Best: Google Street View with your own API key.** Paste a Google Maps JavaScript API key in Settings. The game then checks that official Street View exists before dropping you in, and hides the address and road labels.

## Older imagery options

- **Default: [Wikimedia Commons](https://commons.wikimedia.org)** geotagged photos, pulled live from the public API. No account or key needed. Photos with fake "city centre" geotags, maps, logos, indoor shots, museum pieces and so on are filtered out. Every photo is credited (author and license) after you guess, since the file names would give the answer away.
- **Optional: [Mapillary](https://www.mapillary.com)** street-level 360° imagery that you can move around in, like real GeoGuessr. Get a free client token at mapillary.com/dashboard/developers and paste it in Settings. It's only saved in your browser.

## How it works

Plain HTML, CSS and JavaScript (ES modules), no build step, hosted on GitHub Pages.

- `js/cities.js`: 131 Canadian cities and towns with coordinates, province and population. Spots are picked weighted by population, then jittered randomly inside the city.
- `js/imagery.js`: Commons geosearch and filtering, plus the optional Mapillary viewer.
- `js/geo.js`: distance math, seeded random numbers (for the daily challenge), point-in-polygon.
- `data/provinces.geojson`: simplified province and territory borders, used to check which province a photo was really taken in (an "Ottawa" photo can actually be in Gatineau, QC).
- Map: [Leaflet](https://leafletjs.com) with © OpenStreetMap tiles.
