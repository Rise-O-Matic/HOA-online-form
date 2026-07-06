/* =========================================================
   Dev-time tool (not part of the app or its build — same category as
   fetch-streets.mjs / fetch-parcels.mjs): recommends real addresses to visit
   with the ?calibrate-aerial overlay (see plot-editor.js / CLAUDE.md), so the
   aerial-alignment control points get real geographic spread across Fairway
   Canyon instead of a cluster near wherever's convenient.

   FAIRWAY_CANYON_BBOX below is an evidence-derived proxy for the community's
   footprint, NOT an official HOA boundary (assets/parcels.json carries no such
   field — see Sprint 23 in ROADMAP.md for the full story of why a bare bbox or
   city==BEAUMONT check isn't enough on its own). Derivation: took the bbox of
   every parcel whose address matched one of the streets independently
   confirmed real-world as Fairway Canyon (Aaron, Champion(s), Faldo, Ouimet,
   Palmer, Trevino), then sanity-checked it by listing EVERY street name inside
   that bbox — the result is ~80 streets that are almost all PGA/LPGA golf
   legend surnames (Hogan, Nicklaus Nook, Sorenstam, Couples, Snead, Zoeller,
   ...) plus "Tukwet Canyon" itself (the community's own golf club name) — a
   strong, self-consistent signal this bbox is one coherent development, not a
   grab-bag of unrelated subdivisions. Streets independently ruled OUT as other
   communities (Gallery Ln/Tournament Hills, Brutus Way, Crenshaw St, Desert
   Lawn Dr) do NOT appear in it. Re-derive if parcels.json is ever regenerated
   with a materially different extract, or if an authoritative HOA boundary
   ever turns up.

   Run: node tools/find-calibration-addresses.mjs [interiorCount]
   ========================================================= */
import { readFileSync } from "node:fs";

const FOOT = 0.3048;
const FAIRWAY_CANYON_BBOX = { minLng: -117.054247, maxLng: -117.030243, minLat: 33.949346, maxLat: 33.963270 };
const interiorCount = Number(process.argv[2]) || 5;

const data = JSON.parse(readFileSync(new URL("../assets/parcels.json", import.meta.url), "utf8"));
const cosLat = Math.cos(data.center[1] * Math.PI / 180);
const localFt = (lng, lat) => ({
  e: (lng - data.center[0]) * cosLat * 111320 / FOOT,
  n: (lat - data.center[1]) * 111320 / FOOT
});

const candidates = data.parcels
  .filter(p => p.t && p.g.length === 1) // addressed, single-polygon (excludes multi-part common-area parcels)
  .filter(p => (p.c || "").startsWith("BEAUM")) // Fairway Canyon is Beaumont, not the neighboring city — the
                                                 // bbox above leaks ~41 Calimesa parcels at its north edge
                                                 // otherwise (e.g. 1017 Egret St, city: CALIMESA); startsWith
                                                 // also tolerates the county data's own "BEAUMONT1" typo
  .map(p => {
    const ring = p.g[0];
    const lng = ring.reduce((s, v) => s + v[0], 0) / ring.length;
    const lat = ring.reduce((s, v) => s + v[1], 0) / ring.length;
    return { apn: p.a, addr: p.t, lng, lat, ...localFt(lng, lat) };
  })
  .filter(p => p.lng >= FAIRWAY_CANYON_BBOX.minLng && p.lng <= FAIRWAY_CANYON_BBOX.maxLng &&
               p.lat >= FAIRWAY_CANYON_BBOX.minLat && p.lat <= FAIRWAY_CANYON_BBOX.maxLat);

if (!candidates.length) { console.error("No candidates found — check FAIRWAY_CANYON_BBOX / parcels.json."); process.exit(1); }

function fmt(p, role) {
  const distFt = Math.hypot(p.e, p.n);
  const bearing = ((Math.atan2(p.e, p.n) * 180 / Math.PI) + 360) % 360;
  const compass = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(bearing / 22.5) % 16];
  return `${role.padEnd(16)} ${p.addr.padEnd(28)} lng=${p.lng.toFixed(6)} lat=${p.lat.toFixed(6)}  (${Math.round(distFt)} ft ${compass} of community center)`;
}

/* --- 4 compass extremes --- */
const extremes = [
  ["North extreme", candidates.reduce((a, b) => b.n > a.n ? b : a)],
  ["South extreme", candidates.reduce((a, b) => b.n < a.n ? b : a)],
  ["East extreme",  candidates.reduce((a, b) => b.e > a.e ? b : a)],
  ["West extreme",  candidates.reduce((a, b) => b.e < a.e ? b : a)]
];
console.log(`Fairway Canyon candidate parcels: ${candidates.length}\n`);
console.log("--- Compass extremes ---");
extremes.forEach(([role, p]) => console.log(fmt(p, role)));

/* --- K interior points via greedy farthest-point sampling, seeded by the
   extremes already picked above, so interior picks spread AWAY from the
   edges instead of duplicating them. --- */
const chosen = extremes.map(([, p]) => p);
const dist2 = (a, b) => (a.e - b.e) ** 2 + (a.n - b.n) ** 2;
const interior = [];
for (let k = 0; k < interiorCount; k++) {
  let best = null, bestMinD = -1;
  for (const c of candidates) {
    if (chosen.includes(c) || interior.includes(c)) continue;
    let minD = Infinity;
    for (const s of chosen.concat(interior)) { const d = dist2(c, s); if (d < minD) minD = d; }
    if (minD > bestMinD) { bestMinD = minD; best = c; }
  }
  if (!best) break;
  interior.push(best);
}
console.log("\n--- Distributed interior sample ---");
interior.forEach((p, i) => console.log(fmt(p, `Interior #${i + 1}`)));

console.log("\nTip: type each address into \"Build a plan\" with ?calibrate-aerial on the URL, dial in the aerial, Copy point, repeat.");
