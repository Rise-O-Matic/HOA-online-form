// Regenerates assets/parcels.json — a one-time Riverside County parcel extract for the
// Fairway Canyon (Beaumont, CA) service area: every parcel polygon in BBOX plus its situs
// address fields, baked in so the wizard's address→APN geocode, parcel boundaries, and
// parcel labels all resolve instantly in-memory instead of hitting the county ArcGIS
// server live per lookup. The live endpoints stay as a runtime fallback for addresses
// outside this box (see locateByAddress / loadParcels / fetchParcelGeometryByAPN in
// assets/map-wizard.js).
//
// Usage:  node tools/fetch-parcels.mjs
//
// Source: OpenData/Assessor/MapServer layer 50 (PARCELS_CREST) — the same parcel fabric as
// layer 40 (verified vertex-identical), with the assessor situs columns already joined, so
// one paged query yields both geometry and addresses. Public county records.
//
// The output's `center` is the community's center of mass — the mean of all parcel
// centroids, each parcel weighted equally (one property, one vote — area-weighting would
// let a few big vacant parcels drag the point away from the homes). initMap() uses it as
// the map's starting view; HOA_CENTER in map-wizard.js is the hardcoded fallback for the
// rare case the extract hasn't loaded yet — keep it in sync with the value printed below.

import { writeFileSync } from "node:fs";

// [west, south, east, north] — keep identical to tools/fetch-streets.mjs so the baked
// streets and parcels cover the same ground.
const BBOX = [-117.085, 33.925, -117.010, 33.985];

const QUERY_URL = "https://gis.countyofriverside.us/arcgis_mapping/rest/services/OpenData/Assessor/MapServer/50/query";
const PAGE = 2000; // the server's maxRecordCount

const round6 = (v) => +v.toFixed(6);
// Round every [lng,lat] in a Polygon/MultiPolygon coordinates array (~0.1 m precision —
// an order of magnitude finer than the parcel fabric's own accuracy, and it halves the file).
function roundCoords(node) {
  if (typeof node[0] === "number") return [round6(node[0]), round6(node[1])];
  return node.map(roundCoords);
}

// Mean of a parcel's outer-ring vertices (GeoJSON rings repeat the first vertex at the
// end — drop it so it doesn't count twice). Same centroid style the app itself uses.
function ringCentroid(geometry) {
  let ring = geometry.type === "MultiPolygon" ? geometry.coordinates[0][0] : geometry.coordinates[0];
  if (ring.length > 1) {
    const [f, l] = [ring[0], ring[ring.length - 1]];
    if (f[0] === l[0] && f[1] === l[1]) ring = ring.slice(0, -1);
  }
  const n = ring.length;
  return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
}

async function fetchPage(offset) {
  const params = new URLSearchParams({
    geometry: BBOX.join(","),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    outSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    where: "1=1",
    outFields: "APN,STREET_NUMBER,STREET_NAME,CITY,SITUS_STREET",
    orderByFields: "OBJECTID",
    resultOffset: String(offset),
    resultRecordCount: String(PAGE),
    returnGeometry: "true",
    f: "geojson"
  });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60000);
  const res = await fetch(QUERY_URL + "?" + params, { signal: ctl.signal });
  clearTimeout(timer);
  if (!res.ok) throw new Error(`HTTP ${res.status} at offset ${offset}`);
  const data = await res.json();
  if (!data.features) throw new Error(`No features array at offset ${offset}: ${JSON.stringify(data).slice(0, 200)}`);
  return data.features;
}

const byAPN = new Map();
let skippedNoAPN = 0, multiPolygons = 0;
for (let offset = 0; ; offset += PAGE) {
  const batch = await fetchPage(offset);
  console.log(`  offset ${offset}: ${batch.length} features`);
  for (const f of batch) {
    const p = f.properties || {};
    if (!p.APN) { skippedNoAPN++; continue; }
    if (byAPN.has(p.APN)) continue; // condo stacks can repeat an APN — first row wins
    const rec = { a: p.APN };
    if (p.STREET_NUMBER != null) rec.n = p.STREET_NUMBER;
    if (p.STREET_NAME) rec.s = p.STREET_NAME;
    if (p.CITY) rec.c = p.CITY;
    if (p.SITUS_STREET) rec.t = p.SITUS_STREET;
    if (f.geometry.type === "MultiPolygon") { rec.m = 1; multiPolygons++; }
    else if (f.geometry.type !== "Polygon") { skippedNoAPN++; continue; } // no point/line surprises
    rec.g = roundCoords(f.geometry.coordinates);
    byAPN.set(p.APN, rec);
  }
  if (batch.length < PAGE) break;
}

const parcels = [...byAPN.values()].sort((x, y) => (x.a < y.a ? -1 : 1)); // stable diffs across re-bakes

// Community center of mass: mean of parcel centroids, equal mass per parcel.
let sx = 0, sy = 0;
for (const rec of parcels) {
  const [cx, cy] = ringCentroid({ type: rec.m ? "MultiPolygon" : "Polygon", coordinates: rec.g });
  sx += cx; sy += cy;
}
const center = [round6(sx / parcels.length), round6(sy / parcels.length)];

const out = {
  generated: new Date().toISOString().slice(0, 10),
  attribution: "Parcel boundaries & situs addresses: Riverside County GIS (Assessor, public records)",
  bbox: BBOX,
  center,
  parcels
};
const json = JSON.stringify(out);
writeFileSync(new URL("../assets/parcels.json", import.meta.url), json);
console.log(`Wrote assets/parcels.json: ${parcels.length} parcels (${multiPolygons} multipolygon, ${skippedNoAPN} skipped), ${(json.length / 1048576).toFixed(2)} MB.`);
console.log(`Community center of mass: [${center[0]}, ${center[1]}] — keep HOA_CENTER in assets/map-wizard.js in sync.`);
