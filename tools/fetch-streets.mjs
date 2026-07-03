// Regenerates assets/streets.json — a one-time OpenStreetMap street-centerline extract for the
// Fairway Canyon (Beaumont, CA) service area, baked in so the plot-wizard's auto-orient can find
// the nearest street to a parcel instantly in-memory instead of hitting Overpass live per parcel.
//
// Usage:  node tools/fetch-streets.mjs
//
// Data © OpenStreetMap contributors, licensed ODbL. Keep that attribution on the map (the
// MapLibre/OpenFreeMap basemap already shows it). Widen BBOX if the service area grows; addresses
// outside the box fall back to a live Overpass query at runtime (see fetchNearestRoadDir in app.js).

import { writeFileSync } from "node:fs";

// [west, south, east, north] — generous box around the Fairway Canyon community.
const BBOX = [-117.085, 33.925, -117.010, 33.985];
const KINDS = "motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|road";

// Overpass wants (south,west,north,east).
const [W, S, E, N] = BBOX;
const query = `[out:json][timeout:90];way["highway"~"^(${KINDS})$"](${S},${W},${N},${E});out geom;`;

// Public Overpass mirrors, tried in order. maps.mail.ru has been the most reliable from CI-like
// environments; overpass-api.de is picky about headers and can rate-limit shared IPs.
const ENDPOINTS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter"
];
const HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  "Accept": "application/json",
  "User-Agent": "FairwayCanyonHOA/1.0 (street extract; contact steven@stevenbrown.design)"
};

for (const ep of ENDPOINTS) {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 90000);
    const res = await fetch(ep, { method: "POST", headers: HEADERS, body: "data=" + encodeURIComponent(query), signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) { console.log(`${ep} -> HTTP ${res.status}`); continue; }
    const data = await res.json();
    const streets = data.elements
      .filter(w => w.geometry && w.geometry.length >= 2)
      .map(w => ({
        n: (w.tags && w.tags.name) || null,                         // street name (for future name-matching)
        g: w.geometry.map(p => [+p.lon.toFixed(6), +p.lat.toFixed(6)]) // [lng,lat] rounded to ~0.1m
      }));
    const out = {
      generated: new Date().toISOString().slice(0, 10),
      attribution: "© OpenStreetMap contributors (ODbL)",
      bbox: BBOX,
      streets
    };
    writeFileSync(new URL("../assets/streets.json", import.meta.url), JSON.stringify(out));
    console.log(`Wrote assets/streets.json via ${ep}: ${streets.length} streets (${streets.filter(s => s.n).length} named).`);
    process.exit(0);
  } catch (err) {
    console.log(`${ep} -> ${err.message}`);
  }
}
console.error("All Overpass mirrors failed — try again later.");
process.exit(1);
