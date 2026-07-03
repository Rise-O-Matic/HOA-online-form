/* =========================================================
   Map wizard — the Site/Plot Plan 4-step flow (Method →
   Select → Orient → Draw): plan-mode choice, MapLibre map,
   county-GIS address/parcel lookups, drag-to-rotate
   orientation, the OSM nearest-street lookup (kept for the
   auto-align revival), and the Draw-step aerial-backdrop
   fetch handed to the plot editor.
   ========================================================= */
import {
  closestPointOnSegment, geoToLocalMeters, rotatePoints, computeBBox,
  FOOT_IN_METERS, GRID_MARGIN, GRID_MIN_PAD, MAX_GRID_DIM
} from "./geometry.js";
import { $, $$, esc } from "./utils.js";
import { rebuildGridForParcel, setPlotBackdrop, plotUsed, isPlotConfirmed, setPlotConfirmed } from "./plot-editor.js";
// Function-only imports from the entry module (a deliberate ESM cycle — see the
// note in plot-editor.js: call at event time only).
import { setFieldError, refreshPacketUI } from "./app.js";

export let selectedParcelGeoJSON = null;
let selectedParcelRoadDir = null;  // {dE,dN,dist} unit vector toward the nearest road (from OSM), or null
let roadDirReady = null;           // in-flight Promise for the above; auto-align waits on it briefly
let userAdjustedRotation = false;  // true once the user hand-rotates — suppresses the late auto-correction
export let parcelBearing = 0;
let parcelsData = null;       // raw GeoJSON from county query

// Public Overpass (OpenStreetMap) endpoints, tried in order — OSM is the only source that
// actually carries this subdivision's residential streets (the county centerline layer
// doesn't, and the basemap's own vector tiles aren't reliably queryable at align time).
const OVERPASS_ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter"
];
const OVERPASS_TIMEOUT = 7000; // per-endpoint; a busy instance can hang ~a minute before 504-ing

function overpassQuery(q, endpoints) {
  const eps = endpoints || OVERPASS_ENDPOINTS;
  const [ep, ...rest] = eps;
  // Abort a hung endpoint quickly and move on to the next mirror rather than waiting out a
  // full gateway timeout on the primary.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OVERPASS_TIMEOUT);
  return fetch(ep, { method: "POST", body: "data=" + encodeURIComponent(q), signal: ctrl.signal })
    .then(r => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
    .finally(() => clearTimeout(timer))
    .catch(err => {
      if (rest.length) return overpassQuery(q, rest);
      throw err;
    });
}

// Direction from [lng,lat] toward the nearest street, as a unit vector in local meters
// (east, north). Resolves to {dE,dN,dist} or null (no street found / lookup failed).
function fetchNearestRoadDir(center) {
  const [lng, lat] = center;
  const R = 250; // meters — a lot's frontage road is always well within this
  const kinds = "motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|road";
  const q = `[out:json][timeout:20];way(around:${R},${lat},${lng})["highway"~"^(${kinds})$"];out geom;`;
  return overpassQuery(q).then(data => {
    const toRad = Math.PI / 180, cosLat = Math.cos(lat * toRad);
    const toLocal = (lo, la) => ({ x: (lo - lng) * cosLat * 111320, y: (la - lat) * 111320 });
    let bestD2 = Infinity, bestPt = null;
    for (const w of (data.elements || [])) {
      const g = w.geometry;
      if (!g || g.length < 2) continue;
      for (let i = 0; i < g.length - 1; i++) {
        const p = closestPointOnSegment(toLocal(g[i].lon, g[i].lat), toLocal(g[i + 1].lon, g[i + 1].lat));
        const d2 = p.x * p.x + p.y * p.y;
        if (d2 < bestD2) { bestD2 = d2; bestPt = p; }
      }
    }
    if (!bestPt) return null;
    const len = Math.hypot(bestPt.x, bestPt.y);
    if (len < 1e-6) return null;
    return { dE: bestPt.x / len, dN: bestPt.y / len, dist: len };
  }).catch(err => {
    console.warn("[auto-orient] OSM road lookup failed:", err && err.message);
    return null;
  });
}

// Pre-baked neighborhood street centerlines (a one-time OSM/Overpass extract — see
// assets/streets.json, © OpenStreetMap contributors). Lets the nearest-street lookup run
// instantly in-memory for the common in-area case, so auto-align needs no live network call;
// live Overpass stays as a fallback only for addresses outside this baked box.
let streetData = null;
const streetDataReady = fetch("assets/streets.json")
  .then(r => (r.ok ? r.json() : null))
  .then(d => { streetData = d; if (d && d.streets) console.info("[auto-orient] loaded", d.streets.length, "local streets"); return d; })
  .catch(() => null);

// Same as fetchNearestRoadDir but computed synchronously from the baked extract. Returns null
// if the data isn't loaded yet or the point falls outside the baked bounding box.
function localNearestRoadDir(center) {
  if (!streetData || !streetData.streets) return null;
  const [lng, lat] = center, b = streetData.bbox;
  if (b && (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3])) return null; // outside baked area
  const toRad = Math.PI / 180, cosLat = Math.cos(lat * toRad);
  const toLocal = ([lo, la]) => ({ x: (lo - lng) * cosLat * 111320, y: (la - lat) * 111320 });
  let bestD2 = Infinity, bestPt = null;
  for (const s of streetData.streets) {
    const g = s.g;
    for (let i = 0; i < g.length - 1; i++) {
      const p = closestPointOnSegment(toLocal(g[i]), toLocal(g[i + 1]));
      const d2 = p.x * p.x + p.y * p.y;
      if (d2 < bestD2) { bestD2 = d2; bestPt = p; }
    }
  }
  if (!bestPt) return null;
  const len = Math.hypot(bestPt.x, bestPt.y);
  if (len < 1e-6) return null;
  return { dE: bestPt.x / len, dN: bestPt.y / len, dist: len };
}

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const ASSESSOR_TABLE_URL = "https://gis.countyofriverside.us/arcgis_mapping/rest/services/OpenData/Assessor/MapServer/50/query";
const PARCEL_URL = "https://gis.countyofriverside.us/arcgis_mapping/rest/services/OpenData/Assessor/MapServer/40/query";
// Note: the ~few-foot gap between the aerial and the parcel outline is NOT a datum issue —
// this layer is already served in WGS84, so a NAD83↔WGS84 datumTransformation on the query is
// a verified no-op (0.00 ft). The residual is the 2020 orthophoto's own ortho-rectification
// accuracy vs the cadastral vectors, which reprojection can't remove.
// County aerial imagery (2020 flight — resolution is plenty just to spot the roofline/driveway for orientation)
const AERIAL_URL = "https://gis.countyofriverside.us/arcgis_mapping/rest/services/Aerials_WGS/Riverside_County_2020_WM/ImageServer/exportImage";
const HOA_CENTER = [-116.9770, 33.9295]; // [lng, lat] — Beaumont, CA
const PROPERTY_ZOOM = 18;
const ORIENT_ZOOM_IN = Math.log2(1.25);    // Orient step frames the parcel ~25% closer than a plain bounds fit
const ORIENT_WHEEL_RANGE = Math.log2(1.5); // ...and the wheel can zoom ±50% scale around that framing
const ORIENT_WHEEL_STEP = 0.0015;          // zoom levels per wheel deltaY unit (~0.15 per notch)
const PARCEL_RADIUS = 0.003; // ~300m bounding box around the address

export let mapInstance = null;
let mapMarker = null;
let mapReady = false;

function initMap() {
  if (mapReady) return;
  const placeholder = $("#map-placeholder");
  if (placeholder) placeholder.remove();

  mapInstance = new maplibregl.Map({
    container: "map-container",
    style: MAP_STYLE,
    center: HOA_CENTER,
    zoom: 15,
    scrollZoom: false,
    maxZoom: 20,
    attributionControl: true
  });

  mapInstance.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }), "top-right");

  // Drag-to-rotate (Orient step only). Native dragPan/dragRotate are turned off in step 3,
  // so this is the sole drag gesture there: press on the map and move left/right to spin the
  // view around its center. Bound once; guarded on currentStep so it stays inert in step 2.
  const ROTATE_DEG_PER_PX = 0.5;
  const dragCanvas = mapInstance.getCanvasContainer();
  // Pointer events (not mouse events) so a finger or pen rotates too — on touch, a drag
  // never fires the mouse-event fallbacks. Capture keeps the gesture alive when the
  // pointer leaves the map mid-drag; extra fingers are ignored (first pointer wins).
  let rotatePointerId = null, dragStartX = 0, dragStartBearing = 0;
  dragCanvas.addEventListener("pointerdown", (e) => {
    if (currentStep !== 3 || rotatePointerId !== null) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    rotatePointerId = e.pointerId;
    dragStartX = e.clientX;
    dragStartBearing = mapInstance.getBearing();
    dragCanvas.style.cursor = "grabbing";
    try { dragCanvas.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });
  dragCanvas.addEventListener("pointermove", (e) => {
    if (e.pointerId !== rotatePointerId) return;
    const dx = e.clientX - dragStartX;
    setRotation(dragStartBearing + dx * ROTATE_DEG_PER_PX);
  });
  const endRotateDrag = (e) => {
    if (e.pointerId !== rotatePointerId) return;
    rotatePointerId = null;
    dragCanvas.style.cursor = "";
    try { dragCanvas.releasePointerCapture(e.pointerId); } catch (_) {}
  };
  dragCanvas.addEventListener("pointerup", endRotateDrag);
  dragCanvas.addEventListener("pointercancel", endRotateDrag);

  // Wheel zoom (Orient step only — scroll-zoom stays off globally): nudge the camera within
  // ±ORIENT_WHEEL_RANGE of the framed parcel view (orientCamera, set by showStep's step-3
  // framing). jumpTo carries center + bearing so a wheel event mid-flight through the entry
  // easeTo can't strand the camera at a half-animated bearing/center (the one-animation-at-a-
  // time gotcha). Non-passive so it can keep the page from scrolling over the dial.
  dragCanvas.addEventListener("wheel", (e) => {
    if (currentStep !== 3 || !orientCamera) return;
    e.preventDefault();
    // deltaMode 1/2 = lines/pages (e.g. Firefox) — normalize to pixel-ish units
    const dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 300 : 1);
    const zoom = Math.min(orientCamera.zoom + ORIENT_WHEEL_RANGE,
                 Math.max(orientCamera.zoom - ORIENT_WHEEL_RANGE,
                   mapInstance.getZoom() - dy * ORIENT_WHEEL_STEP));
    mapInstance.jumpTo({ center: orientCamera.center, zoom, bearing: parcelBearing });
  }, { passive: false });

  // Satellite-tile streaming → loading overlay: sourcedataloading fires as satellite
  // tiles start downloading, sourcedata as each lands, idle once everything visible has
  // rendered. Each just recomputes "satellite on + tiles still loading" — cheap, and the
  // overlay's CSS appear-delay keeps fast loads from flashing it.
  mapInstance.on("sourcedataloading", (e) => { if (e.sourceId === "satellite") updateMapLoadingOverlay(); });
  mapInstance.on("sourcedata", (e) => { if (e.sourceId === "satellite") updateMapLoadingOverlay(); });
  mapInstance.on("idle", updateMapLoadingOverlay);

  mapInstance.on("load", () => {
    // Hide building footprints from the base style
    ["building", "building-3d"].forEach(id => {
      if (mapInstance.getLayer(id)) mapInstance.setLayoutProperty(id, "visibility", "none");
    });

    // Aerial imagery, toggled on in the Orient step to help spot the front/back of the lot.
    // Inserted below every other style layer so parcel outlines/labels still draw on top of it.
    mapInstance.addSource("satellite", {
      type: "raster",
      tiles: [AERIAL_URL + "?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=jpg&f=image"],
      tileSize: 256
    });
    mapInstance.addLayer(
      { id: "satellite-layer", type: "raster", source: "satellite", layout: { visibility: "none" } },
      mapInstance.getStyle().layers[0].id
    );

    // Add empty parcel source — populated after geocoding
    mapInstance.addSource("parcels", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    mapInstance.addLayer({
      id: "parcel-fills",
      type: "fill",
      source: "parcels",
      paint: { "fill-color": "rgba(247,244,238,0.15)", "fill-opacity": 0.3 }
    });
    mapInstance.addLayer({
      id: "parcel-highlight",
      type: "fill",
      source: "parcels",
      paint: { "fill-color": "rgba(164,17,31,0.25)", "fill-opacity": 0.6 },
      filter: ["==", "APN", ""]
    });
    mapInstance.addLayer({
      id: "parcel-lines",
      type: "line",
      source: "parcels",
      paint: { "line-color": "#a4111f", "line-width": 1.5, "line-opacity": 0.7 }
    });
    mapInstance.addLayer({
      id: "parcel-highlight-line",
      type: "line",
      source: "parcels",
      paint: { "line-color": "#fff", "line-width": 3, "line-opacity": 1 },
      filter: ["==", "APN", ""]
    });
    mapInstance.addLayer({
      id: "parcel-labels",
      type: "symbol",
      source: "parcels",
      layout: {
        "text-field": ["coalesce", ["to-string", ["get", "STREET_NUMBER"]], ["get", "APN"]],
        "text-size": 11,
        "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
        "text-allow-overlap": false,
        "text-ignore-placement": false
      },
      paint: { "text-color": "#7d0d18", "text-halo-color": "#fff", "text-halo-width": 1.5 },
      minzoom: 17
    });

    // Click on a parcel to select it
    mapInstance.on("click", "parcel-fills", (e) => {
      if (!e.features || !e.features.length) return;
      const apn = e.features[0].properties.APN;
      selectedAPN = apn;
      autoAlignedForParcel = false; // (re)selecting a parcel earns a fresh auto-align on next Orient entry
      selectedParcelRoadDir = null; // recomputed below once the boundary resolves
      roadDirReady = null;
      userAdjustedRotation = false;
      mapInstance.setFilter("parcel-highlight", ["==", "APN", apn]);
      mapInstance.setFilter("parcel-highlight-line", ["==", "APN", apn]);

      // Show popup with APN (removed once we advance to the Orient step)
      if (selectedPopup) selectedPopup.remove();
      selectedPopup = new maplibregl.Popup({ offset: 4 })
        .setLngLat(e.lngLat)
        .setHTML("<strong>Selected parcel</strong><br>APN: " + esc(apn) + "<br><span style='font-size:.8em;color:#666;'>Click Apply to Plot Plan to shape your grid.</span>")
        .addTo(mapInstance);

      $("#map-status").textContent = "Parcel " + apn + " selected — loading boundary…";
      $("#map-status").className = "map-reference__status";

      // Full-precision geometry only ever comes from parcelsData (the raw GeoJSON the app
      // fetched from the county); e.features[0].geometry is geojson-vt-simplified for
      // rendering and can meaningfully undercount the parcel's true footprint, which was
      // shrinking the Draw-step grid — never build the plot grid from it. Re-fetch by APN
      // when it's missing from parcelsData instead of silently falling back.
      const cached = parcelsData?.features?.find(f => f.properties.APN === apn);
      const resolveFeature = cached ? Promise.resolve(cached) : fetchParcelGeometryByAPN(apn);
      resolveFeature.then(feature => {
        if (selectedAPN !== apn) return; // a different parcel was selected while this was in flight
        if (!feature) {
          $("#map-status").textContent = "Could not load the full parcel boundary for " + apn + ". Try selecting it again.";
          $("#map-status").className = "map-reference__status err";
          showGisFallback();
          return;
        }
        selectedParcelGeoJSON = feature;
        hideGisFallback(); // a retry after a failed attempt succeeded — clear the outage notice
        // Auto-align disabled — orientation is now a manual drag-to-rotate. The nearest-street
        // lookup that fed the front-yard-down flip is commented out (kept for easy revival).
        // const ring = feature.geometry?.coordinates?.[0];
        // if (ring && ring.length >= 3) {
        //   const rcx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
        //   const rcy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
        //   // In-area parcels resolve instantly from the baked extract (no network); only
        //   // addresses outside the baked box fall through to a live Overpass query.
        //   roadDirReady = streetDataReady.then(() => {
        //     if (selectedAPN !== apn) return; // a newer selection superseded this one
        //     const local = localNearestRoadDir([rcx, rcy]);
        //     if (local) { selectedParcelRoadDir = local; console.info("[auto-orient] street dir (local):", local); return; }
        //     return fetchNearestRoadDir([rcx, rcy]).then(dir => {
        //       if (selectedAPN !== apn) return;
        //       selectedParcelRoadDir = dir;
        //       console.info("[auto-orient] street dir (live overpass):", dir);
        //     });
        //   });
        // }
        const step2Next = $("#step2-next");
        if (step2Next) step2Next.disabled = false;
        $("#map-status").textContent = "Parcel " + apn + " selected — click Next to orient.";
        $("#map-status").className = "map-reference__status ok";
      });
    });

    // Cursor change on parcel hover
    mapInstance.on("mouseenter", "parcel-fills", () => { mapInstance.getCanvas().style.cursor = "pointer"; });
    mapInstance.on("mouseleave", "parcel-fills", () => { mapInstance.getCanvas().style.cursor = ""; });

    // Flush any parcels that arrived before the style loaded
    mapStyleLoaded = true;
    if (pendingParcels) {
      mapInstance.getSource("parcels").setData(pendingParcels);
      pendingParcels = null;
    }

    applyDefaultViewIfFirstVisit(currentStep);
  });

  mapReady = true;
}

export let selectedAPN = null;
let selectedPopup = null; // the "Selected parcel" map callout, dismissed on Orient
let pendingParcels = null; // queued GeoJSON if map isn't loaded yet
let mapStyleLoaded = false;
let autoAlignedForParcel = false; // true once auto-align has run for the currently selected parcel
let step2ViewInitialized = false; // true once Select has been shown once (locks in its one-time default view)
let step3ViewInitialized = false; // true once Orient has been shown once (locks in its one-time default view)

// County-GIS failure story: every ArcGIS request goes through a bounded fetch (a dead
// endpoint would otherwise hang the wizard on the browser's multi-minute default), and
// hard failures surface #gis-fallback-msg — a friendly notice with a route to the
// upload path — instead of leaving the user stuck at "Looking up address…".
const GIS_TIMEOUT_MS = 10000;
function gisFetch(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GIS_TIMEOUT_MS);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}
const gisFallbackEl = $("#gis-fallback-msg");
function showGisFallback() { if (gisFallbackEl) gisFallbackEl.hidden = false; }
function hideGisFallback() { if (gisFallbackEl) gisFallbackEl.hidden = true; }

async function fetchParcelGeometryByAPN(apn) {
  try {
    const params = new URLSearchParams({
      where: "APN='" + apn + "'",
      outSR: "4326",
      outFields: "APN",
      f: "geojson",
      returnGeometry: "true"
    });
    const res = await gisFetch(PARCEL_URL + "?" + params);
    if (!res.ok) return null;
    const data = await res.json();
    return data.features?.[0] || null;
  } catch (e) {
    return null;
  }
}

async function loadParcels(lng, lat) {
  const bbox = [lng - PARCEL_RADIUS, lat - PARCEL_RADIUS, lng + PARCEL_RADIUS, lat + PARCEL_RADIUS].join(",");
  const params = new URLSearchParams({
    geometry: bbox,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    outSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "APN",
    f: "geojson",
    returnGeometry: "true"
  });
  try {
    const res = await gisFetch(PARCEL_URL + "?" + params);
    if (!res.ok) return;
    const geojson = await res.json();
    if (!geojson.features) return;

    // Fetch addresses for these parcels from the assessor table
    const apns = geojson.features.map(f => f.properties.APN).filter(Boolean);
    if (apns.length) {
      try {
        const whereClause = apns.map(a => "APN='" + a + "'").join(" OR ");
        const addrParams = new URLSearchParams({
          where: whereClause,
          outFields: "APN,STREET_NUMBER,SITUS_STREET",
          f: "json",
          returnGeometry: "false",
          resultRecordCount: "2000"
        });
        const addrRes = await gisFetch(ASSESSOR_TABLE_URL + "?" + addrParams);
        if (addrRes.ok) {
          const addrData = await addrRes.json();
          const addrMap = {};
          (addrData.features || []).forEach(f => { addrMap[f.attributes.APN] = f.attributes; });
          geojson.features.forEach(f => {
            const info = addrMap[f.properties.APN];
            if (info) {
              f.properties.STREET_NUMBER = info.STREET_NUMBER || "";
              f.properties.SITUS_STREET = info.SITUS_STREET || "";
            }
          });
        }
      } catch (e) { /* address lookup is best-effort */ }
    }

    parcelsData = geojson;
    if (mapStyleLoaded && mapInstance.getSource("parcels")) {
      mapInstance.getSource("parcels").setData(geojson);
    } else {
      pendingParcels = geojson;
    }
  } catch (e) {
    const s = $("#map-status");
    s.textContent = "Could not load parcel boundaries. Check your connection and try again.";
    s.className = "map-reference__status err";
    showGisFallback();
  }
}

// Parse a street address into number + name for the county assessor query
function parseAddress(address) {
  const m = address.trim().match(/^(\d+)\s+(.+?)(?:\s+(?:ave|avenue|st|street|dr|drive|ct|court|ln|lane|pl|place|way|blvd|boulevard|tr|trail|cir|circle|rd|road))?\.?\s*$/i);
  if (!m) return null;
  return { number: parseInt(m[1], 10), name: m[2].toUpperCase().replace(/\s+(AVE|AVENUE|ST|STREET|DR|DRIVE|CT|COURT|LN|LANE|PL|PLACE|WAY|BLVD|BOULEVARD|TR|TRAIL|CIR|CIRCLE|RD|ROAD)$/i, "").trim() };
}

async function locateByAddress(address) {
  const mapStatus = $("#map-status");
  mapStatus.textContent = "Looking up address\u2026";
  mapStatus.className = "map-reference__status";
  hideGisFallback(); // fresh attempt \u2014 don't leave a stale outage notice up
  step2Camera = null; // new lookup \u2014 the remembered selection view belongs to the old address

  const parsed = parseAddress(address);
  if (!parsed) {
    mapStatus.textContent = "Could not parse address. Enter a street number and name (e.g. 11506 Aaron Ave).";
    mapStatus.className = "map-reference__status err";
    return;
  }

  try {
    // Step 1: Query assessor table for this address → get APN
    const addrParams = new URLSearchParams({
      where: `STREET_NUMBER=${parsed.number} AND STREET_NAME='${parsed.name}' AND CITY='BEAUMONT'`,
      outFields: "APN,SITUS_STREET",
      f: "json",
      returnGeometry: "false",
      resultRecordCount: "1"
    });
    const addrRes = await gisFetch(ASSESSOR_TABLE_URL + "?" + addrParams);
    if (!addrRes.ok) throw new Error("Network error");
    const addrData = await addrRes.json();

    if (!addrData.features || !addrData.features.length) {
      mapStatus.textContent = "Address not found in county records. Check the street number and name.";
      mapStatus.className = "map-reference__status err";
      return;
    }

    const apn = addrData.features[0].attributes.APN;
    const situs = addrData.features[0].attributes.SITUS_STREET;

    // Step 2: Get the parcel polygon for this APN
    const parcelFeature = await fetchParcelGeometryByAPN(apn);

    if (!parcelFeature) {
      // The assessor answered but the parcel layer didn't — endpoint down or changed.
      mapStatus.textContent = "Found APN " + apn + " but could not load its parcel geometry.";
      mapStatus.className = "map-reference__status err";
      showGisFallback();
      return;
    }

    // Get centroid of the matched parcel
    const coords = parcelFeature.geometry.coordinates[0];
    const cLng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
    const cLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;

    // Step 3: Load surrounding parcels and fly to location
    mapInstance.flyTo({ center: [cLng, cLat], zoom: PROPERTY_ZOOM, duration: 1200 });
    loadParcels(cLng, cLat);

    mapStatus.textContent = "Found " + situs + " (APN: " + apn + ") — click on your parcel to select it.";
    mapStatus.className = "map-reference__status ok";
  } catch (err) {
    mapStatus.textContent = "Could not reach Riverside County records. Check your connection.";
    mapStatus.className = "map-reference__status err";
    showGisFallback();
  }
}

/* --- WIZARD STEP NAVIGATION --- */
let currentStep = 1;
const stepDots = $$(".plot-steps-nav__dot");
const mapContainer = $("#map-container");
let step2Camera = null; // Select-step center/zoom, captured on 2→3 so backing up restores the view as it was left
let orientCamera = null; // Orient-step framed view (center + base zoom incl. ORIENT_ZOOM_IN), the anchor the wheel zooms around

// Parcel outline/fill/label layers. Shown in Select (step 2) so the user can click their lot;
// hidden in Orient (step 3) so the map is a clean, non-interactive rotation dial — hiding them
// also drops them out of hit-testing, so clicks can't re-select a parcel there.
const PARCEL_LAYER_IDS = ["parcel-fills", "parcel-highlight", "parcel-lines", "parcel-highlight-line", "parcel-labels"];
function setParcelLayersVisible(visible) {
  if (!mapInstance) return;
  PARCEL_LAYER_IDS.forEach(id => {
    if (mapInstance.getLayer(id)) mapInstance.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  });
}

/* --- Draw-step aerial backdrop --- */
// Fetched straight from the county ImageServer with a ground bbox computed from the same
// math that sizes the plot grid (buildParcelGrid's square: longest bearing-rotated parcel
// dimension + margin), so coverage is guaranteed by construction — independent of the
// Orient viewport's size, zoom, or rotation (the old canvas-screenshot handoff clipped
// whenever the step-3 camera showed less ground than the grid square needs). The export
// is north-up; the parcel corners' pixel positions inside it are computed with the same
// linear bbox→pixel mapping the server renders with, so plot-editor's fitSimilarity
// registration is exact and supplies the bearing rotation.
const AERIAL_PX_PER_FT = 6;        // target export resolution (the 2020 county ortho is ~2 px/ft)
const AERIAL_EXPORT_MAX_PX = 2048; // stay well inside the ImageServer's per-request size cap
const AERIAL_COVER_PAD = 1.05;     // slack over the exact rotated-square cover

function lngLatToMercator(lng, lat) {
  const R = 6378137;
  return [R * lng * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
}

let aerialFetchSeq = 0;   // lets a newer fetch supersede one still in flight
let lastAerialKey = null; // "APN@bearing" of the backdrop currently delivered to the plot editor

// Loading overlay over the Konva host (#plot-aerial-loading) while the county aerial
// export is in flight — otherwise the Draw step sits on a bare grid with no hint that
// the backdrop is coming. Only the newest fetch may clear it (see the finally below).
const plotAerialLoadingEl = $("#plot-aerial-loading");
function setAerialLoading(on) {
  if (plotAerialLoadingEl) plotAerialLoadingEl.classList.toggle("is-visible", on);
}

async function fetchAerialBackdrop() {
  if (!selectedParcelGeoJSON) return;
  const ring = selectedParcelGeoJSON.geometry.coordinates[0];
  const bearing = parcelBearing;
  const apn = selectedAPN || "?";
  const key = apn + "@" + Math.round(bearing * 10) / 10;
  if (key === lastAerialKey) return; // this exact backdrop is already in place
  const seq = ++aerialFetchSeq;
  setAerialLoading(true);
  // A stale backdrop for the SAME parcel still registers correctly at a new bearing
  // (fitSimilarity maps the same vertices), so it can stay up while the replacement
  // loads; another lot's aerial cannot — drop it immediately.
  if (lastAerialKey && lastAerialKey.split("@")[0] !== apn) {
    lastAerialKey = null;
    setPlotBackdrop(null, null);
  }

  // The grid square, in the same terms buildParcelGrid uses (see geometry.js)
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const local = geoToLocalMeters(ring, [cx, cy]);
  const bb = computeBBox(rotatePoints(local, -bearing));
  const longestFt = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY) / FOOT_IN_METERS;
  const padTiles = Math.max(GRID_MIN_PAD, Math.ceil(longestFt * GRID_MARGIN / 2));
  const sideM = Math.min(MAX_GRID_DIM, Math.ceil(longestFt) + padTiles * 2) * FOOT_IN_METERS;
  // Grid centre back to lng/lat (undo the -bearing rotation; the grid's Y flip cancels
  // out for extents and centre points)
  const rc = rotatePoints([{ x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 }], bearing)[0];
  const cosLat = Math.cos(cy * Math.PI / 180);
  const cLng = cx + rc.x / (cosLat * 111320);
  const cLat = cy + rc.y / 111320;
  // North-up ground square that covers the bearing-rotated grid square
  const rad = bearing * Math.PI / 180;
  const coverM = sideM * (Math.abs(Math.cos(rad)) + Math.abs(Math.sin(rad))) * AERIAL_COVER_PAD;
  const dLng = coverM / 2 / (111320 * cosLat), dLat = coverM / 2 / 111320;
  const [xmin, ymin] = lngLatToMercator(cLng - dLng, cLat - dLat);
  const [xmax, ymax] = lngLatToMercator(cLng + dLng, cLat + dLat);
  const sizePx = Math.min(AERIAL_EXPORT_MAX_PX,
    Math.max(512, Math.round(coverM / FOOT_IN_METERS * AERIAL_PX_PER_FT)));

  try {
    const res = await gisFetch(AERIAL_URL + "?bbox=" + [xmin, ymin, xmax, ymax].join(",") +
      "&bboxSR=3857&imageSR=3857&size=" + sizePx + "," + sizePx + "&format=jpg&f=image");
    if (!res.ok) throw new Error("aerial export HTTP " + res.status);
    const blob = await res.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const rd = new FileReader();
      rd.onload = () => resolve(rd.result);
      rd.onerror = () => reject(rd.error);
      rd.readAsDataURL(blob);
    });
    if (seq !== aerialFetchSeq) return; // a newer fetch superseded this one
    const parcelPx = ring.map(([lng, lat]) => {
      const [mx, my] = lngLatToMercator(lng, lat);
      return { x: (mx - xmin) / (xmax - xmin) * sizePx, y: (ymax - my) / (ymax - ymin) * sizePx };
    });
    lastAerialKey = key;
    setPlotBackdrop(dataUrl, parcelPx);
  } catch (e) {
    // Keep whatever backdrop is up (none, or this parcel at a stale bearing — still
    // registered correctly); the plain grid + dashed outline is the existing fallback.
    if (seq === aerialFetchSeq && !lastAerialKey) setPlotBackdrop(null, null);
  } finally {
    // Only the newest fetch clears the overlay — a superseded one returning early must
    // leave it up for the replacement that's still in flight.
    if (seq === aerialFetchSeq) setAerialLoading(false);
  }
}

function showStep(n) {
  // Entering Draw: (re)fetch the aerial backdrop for the grid area. This is a direct
  // county exportImage request sized to the plot grid itself — NOT a screenshot of the
  // Orient viewport, whose ground coverage depends on the step-3 camera and (since the
  // closer Orient framing + wheel zoom) no longer reliably spans the grid square, which
  // left bare strips along the grid's top/bottom edges at some orientations.
  if (n === 4 && currentStep === 3 && selectedParcelGeoJSON) {
    fetchAerialBackdrop();
  }
  // Leaving Select for Orient: remember the selection view (center/zoom) so backing up to
  // step 2 shows the map as the user left it, not step 3's tight parcel framing.
  if (n === 3 && currentStep === 2 && mapInstance) {
    step2Camera = { center: mapInstance.getCenter(), zoom: mapInstance.getZoom() };
  }
  currentStep = n;
  $$(".plot-step").forEach(el => el.classList.toggle("is-active", +el.dataset.step === n));
  stepDots.forEach(dot => {
    const s = +dot.dataset.goto;
    dot.classList.toggle("is-active", s === n);
    // The Draw dot (s=4) is never "behind" the current step — its done-state is the
    // explicit "Done — use this plan" confirmation, which navigating must not wipe.
    dot.classList.toggle("is-done", s < n || (s === 4 && isPlotConfirmed()));
  });

  // Move the map container into the current step's .map-reference (steps 2-3 share it)
  if (n >= 2 && n <= 3) {
    const target = n === 2 ? $(".plot-step[data-step='2'] .map-reference")
                 : $("#map-step3");
    if (target && mapContainer.parentElement !== target) {
      target.prepend(mapContainer);
    }
    if (mapInstance) setTimeout(() => mapInstance.resize(), 50);
  }

  // One-time default imagery per step: street map the first time we ever reach Select,
  // satellite the first time we ever reach Orient. Later visits leave the user's own
  // street/satellite toggle choice alone.
  applyDefaultViewIfFirstVisit(n);

  // Entering Orient: dismiss the "Selected parcel" callout
  if (n === 3 && selectedPopup) {
    selectedPopup.remove();
    selectedPopup = null;
  }

  // Step 2→3: frame the selected parcel, ~25% closer than a plain bounds fit. Auto-align /
  // front-yard-down logic is removed — the user orients by dragging the map to rotate (see
  // the drag-to-rotate handler in initMap). The bearing MUST ride in the same camera call:
  // fitBounds/easeTo animate to bearing 0 by default, which silently un-did the dialed
  // rotation a moment after re-entering Orient — and it has to be ONE animation (center +
  // zoom + bearing together), since MapLibre cancels an in-flight camera animation when a
  // second one starts. The framed view is kept in orientCamera as the anchor for the
  // Orient-step wheel zoom (see the wheel handler in initMap).
  if (n === 3 && selectedParcelGeoJSON && mapInstance) {
    const ring = selectedParcelGeoJSON.geometry.coordinates[0];
    const bounds = ring.reduce(
      (b, [lng, lat]) => { b[0][0] = Math.min(b[0][0], lng); b[0][1] = Math.min(b[0][1], lat); b[1][0] = Math.max(b[1][0], lng); b[1][1] = Math.max(b[1][1], lat); return b; },
      [[Infinity, Infinity], [-Infinity, -Infinity]]
    );
    setTimeout(() => {
      mapInstance.resize();
      const cam = mapInstance.cameraForBounds(bounds, { padding: 40, bearing: parcelBearing });
      if (cam) {
        orientCamera = { center: cam.center, zoom: cam.zoom + ORIENT_ZOOM_IN };
        mapInstance.easeTo({ center: orientCamera.center, zoom: orientCamera.zoom, bearing: parcelBearing, duration: 600 });
      } else {
        mapInstance.fitBounds(bounds, { padding: 40, duration: 600, bearing: parcelBearing });
      }
    }, 100);
  }

  // Step 2: parcel selection. Panning + zoom (buttons/pinch/double-click/box) on, rotation off,
  // parcel layers shown so the user can click their lot.
  if (n === 2 && mapInstance) {
    mapInstance.dragRotate.disable();
    mapInstance.touchZoomRotate.enable();
    mapInstance.touchZoomRotate.disableRotation();
    mapInstance.dragPan.enable();
    mapInstance.doubleClickZoom.enable();
    mapInstance.boxZoom.enable();
    setParcelLayersVisible(true);
    // Undo the Orient-step overrides: give touch back to MapLibre's own pan/pinch handlers
    // and drop the keyboard-rotation focus stop (selection is pointer-driven here).
    mapInstance.getCanvas().style.touchAction = "";
    mapContainer.removeAttribute("tabindex");
    mapContainer.removeAttribute("role");
    mapContainer.removeAttribute("aria-label");
    // Backing up from Orient: restore the selection view captured on the way out (step 3's
    // fitBounds left the camera zoomed tight on the parcel) and square it north-up for
    // selection. parcelBearing still holds the dialed rotation — the step-3 fitBounds above
    // re-applies it when the user goes forward again. 100ms keeps this behind the reparent
    // resize (50ms); nothing else animates the camera on step-2 entry, so no collision.
    if (step2Camera) {
      const cam = step2Camera;
      setTimeout(() => mapInstance.easeTo({ center: cam.center, zoom: cam.zoom, bearing: 0, duration: 600 }), 100);
    }
  }
  // Step 3: a pure rotation dial. Every built-in mouse/touch gesture is disabled — the only
  // interaction is our custom drag-to-rotate — and the parcel layers are hidden so they can't
  // be seen or clicked. (Scroll-zoom is already off globally; the zoom buttons are hidden via CSS.)
  if (n === 3 && mapInstance) {
    mapInstance.dragRotate.disable();
    mapInstance.dragPan.disable();
    mapInstance.touchZoomRotate.disable();
    mapInstance.doubleClickZoom.disable();
    mapInstance.boxZoom.disable();
    setParcelLayersVisible(false);
    // Touch drag-to-rotate: with MapLibre's handlers off, its stylesheet may still leave
    // touch-action allowing native pan/zoom on the canvas, which would swallow the drag
    // (pointercancel) before our rotate handler sees it. Force it off for this step.
    mapInstance.getCanvas().style.touchAction = "none";
    // Keyboard rotation: focus the map and use arrow keys (see the keydown handler below).
    mapContainer.setAttribute("tabindex", "0");
    mapContainer.setAttribute("role", "application");
    mapContainer.setAttribute("aria-label",
      "Property orientation map. Press Left or Right arrow to rotate one degree; hold Shift for 15 degrees.");
  }

  // Step 3→4 transition: rebuild grid from parcel. The aerial fetch kicked off at the top
  // of this function lands asynchronously — setPlotBackdrop refreshes the bg layer then.
  if (n === 4 && selectedParcelGeoJSON) {
    rebuildGridForParcel(selectedParcelGeoJSON, parcelBearing, selectedAPN);
  }
}

// Step dot clicks (allow jumping to completed steps)
stepDots.forEach(dot => {
  dot.addEventListener("click", () => {
    const target = +dot.dataset.goto;
    if (target <= currentStep) showStep(target);
  });
});

// Back buttons
$$("#siteplan [data-back]").forEach(btn => {
  btn.addEventListener("click", () => { if (currentStep > 1) showStep(currentStep - 1); });
});

// Step 1 — choose between the interactive builder or uploading an existing plan
export let planMode = null; // "build" | "upload"
const planChoiceCards = $$(".plan-choice__card");
const planUploadPanel = $("#plan-upload");
const planChoiceMsg = $("#plan-choice-msg");
export const plotUploadInput = $("#plot-upload");
const plotUploadList = $("#plot-upload-list");
const buildOnlyDots = stepDots.filter(d => +d.dataset.goto > 1);

export function setPlanMode(mode) {
  planMode = mode;
  const isUpload = mode === "upload";
  planChoiceCards.forEach(c => {
    const on = c.dataset.planMode === mode;
    c.classList.toggle("is-selected", on);
    c.setAttribute("aria-pressed", on ? "true" : "false");
  });
  planUploadPanel.hidden = !isUpload;
  // The Select/Orient/Draw steps only apply to the builder.
  // (Use inline display, not [hidden], because .plot-steps-nav__dot sets display:flex.)
  buildOnlyDots.forEach(d => { d.style.display = isUpload ? "none" : ""; });
  $("#step1-next").hidden = mode !== "build";
  refreshPacketUI(); // switching build/upload changes what the packet expects
}

function startBuilder() {
  if (typeof maplibregl === "undefined") {
    // The vendored MapLibre script failed to load (or was blocked) — the builder can't
    // run at all, so route straight to the upload path like [data-switch-upload] does.
    setPlanMode("upload");
    planChoiceMsg.textContent = "The map tools failed to load, so the plan builder isn't available. Attach a plan file below instead — or reload the page to try the builder again.";
    planChoiceMsg.className = "plot-choice-msg err";
    planUploadPanel.scrollIntoView({ behavior: "smooth", block: "center" });
    plotUploadInput.focus({ preventScroll: true });
    return;
  }
  const addressEl = $("#property-address");
  const address = addressEl.value.trim();
  if (!address) {
    planChoiceMsg.textContent = "Enter your property address in Applicant Information above so we can locate your parcel.";
    planChoiceMsg.className = "plot-choice-msg err";
    // Take the user to the field that needs filling, not just tell them about it.
    setFieldError(addressEl, "Enter your address here first — the plot builder uses it to find your parcel.");
    addressEl.scrollIntoView({ behavior: "smooth", block: "center" });
    addressEl.focus({ preventScroll: true });
    return;
  }
  planChoiceMsg.textContent = "";
  planChoiceMsg.className = "plot-choice-msg";
  showStep(2);
  if (!mapReady) initMap();
  locateByAddress(address);
}

planChoiceCards.forEach(card => {
  card.addEventListener("click", () => {
    const mode = card.dataset.planMode;
    setPlanMode(mode);
    if (mode === "build") startBuilder();
    else planChoiceMsg.textContent = "";
  });
});

// Next button on step 1 (visible once "Build a plan" is chosen)
$("#step1-next").addEventListener("click", startBuilder);

// Mid-wizard bail-out: a user who abandons the builder on any of steps 2–4 (or hits the
// Konva-load failure notice) lands back on step 1 with the upload panel open — without
// losing their parcel selection or anything already drawn, in case they switch back.
$$("#siteplan [data-switch-upload]").forEach(btn => {
  btn.addEventListener("click", () => {
    setPlanMode("upload");
    showStep(1);
    planChoiceMsg.textContent = "No problem — attach your plan file below. Your parcel selection and anything you've drawn are kept in case you switch back to the builder.";
    planChoiceMsg.className = "plot-choice-msg";
    planUploadPanel.scrollIntoView({ behavior: "smooth", block: "center" });
    plotUploadInput.focus({ preventScroll: true });
  });
});

// Uploaded plan file list
plotUploadInput.addEventListener("change", () => {
  plotUploadList.innerHTML = "";
  if (!plotUploadInput.files.length) { plotUploadList.hidden = true; return; }
  plotUploadList.hidden = false;
  Array.from(plotUploadInput.files).forEach(f => {
    const li = document.createElement("li");
    li.textContent = `${f.name} (${Math.round(f.size / 1024)} KB)`;
    plotUploadList.appendChild(li);
  });
});

// Step 2 Next — Select → Orient (enabled after parcel selected)
$("#step2-next").addEventListener("click", () => showStep(3));

// Step 3 Next — Orient → Draw (always enabled, triggers grid rebuild)
$("#step3-next").addEventListener("click", () => showStep(4));

// Step 4 Done — the builder's terminal CTA, restoring the wizard's Next-button rhythm:
// declare the plan finished (build-mode plotProvided() requires it), then move on to
// Section 03. setPlotConfirmed itself refreshes the button/dot/packet UI and autosaves.
$("#plot-done").addEventListener("click", () => {
  if (!plotUsed()) return; // disabled anyway while nothing is drawn
  setPlotConfirmed(true);
  $("#description")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

// Rotation panel — slider + quick-adjust buttons, all drive parcelBearing
const mapRotate = $("#map-rotate");
const mapRotateValue = $("#map-rotate-value");
const mapRotateFine = $("#map-rotate-fine");  // live ±0.1° readout in the Orient step

function syncRotationReadout(deg) {
  const norm = ((deg % 360) + 360) % 360;
  if (mapRotateFine) mapRotateFine.textContent = norm.toFixed(1); // show tenths of a degree
  if (!mapRotate) return; // legacy slider panel is commented out — nothing else to sync
  const d = Math.round(norm);
  mapRotate.value = d;
  mapRotate.style.setProperty("--pct", (d / 360 * 100) + "%");
  mapRotateValue.textContent = d;
}

export function setRotation(deg, opts) {
  // Keep fractional degrees (don't round to whole) so drag-to-rotate and the ±0.1° nudge
  // buttons can fine-tune the orientation.
  deg = ((deg % 360) + 360) % 360;
  parcelBearing = deg;
  if (mapInstance && opts && opts.animate) {
    // Smoothly ease to the target bearing (used for auto-align) instead of snapping,
    // and keep the slider/readout in sync with the map as it turns.
    const onRotate = () => syncRotationReadout(mapInstance.getBearing());
    mapInstance.on("rotate", onRotate);
    mapInstance.once("moveend", () => mapInstance.off("rotate", onRotate));
    mapInstance.easeTo({ bearing: deg, duration: 900 });
  } else {
    if (mapInstance) mapInstance.setBearing(deg);
    syncRotationReadout(deg);
  }
}

// Rotation-panel controls removed — orientation is now drag-to-rotate on the map itself.
// mapRotate.addEventListener("input", () => { userAdjustedRotation = true; setRotation(parseInt(mapRotate.value, 10)); });
// $("#rotate-minus15").addEventListener("click", () => { userAdjustedRotation = true; setRotation(parcelBearing - 15); });
// $("#rotate-plus15").addEventListener("click", () => { userAdjustedRotation = true; setRotation(parcelBearing + 15); });
// $("#rotate-reset").addEventListener("click", () => { userAdjustedRotation = true; setRotation(0); });
// $("#rotate-auto").addEventListener("click", () => {
//   if (!selectedParcelGeoJSON) return;
//   const apply = () => setRotation(computeAutoAlignBearing(selectedParcelGeoJSON.geometry.coordinates[0], selectedParcelRoadDir), { animate: true });
//   // If the street lookup is still in flight, wait for it so the flip is correct on first click.
//   if (selectedParcelRoadDir == null && roadDirReady) roadDirReady.then(apply); else apply();
// });

// Fine rotation nudge (±0.1°) — the only live rotation control now that the slider/±15° panel
// is gone. Drag-to-rotate is coarse (0.5°/px); these let the user precisely square the parcel.
// Snaps to the nearest 0.1° so the readout and the persisted bearing stay tidy.
function nudgeRotation(delta) {
  userAdjustedRotation = true; // suppress the late auto-align correction from the road-dir lookup
  setRotation(Math.round((parcelBearing + delta) * 10) / 10);
}
$("#rotate-fine-minus")?.addEventListener("click", () => nudgeRotation(-0.1));
$("#rotate-fine-plus")?.addEventListener("click", () => nudgeRotation(0.1));

// Keyboard rotation — the Orient step's drag gesture has no keyboard equivalent, so the
// map container becomes a focus stop in step 3 (tabindex is set in showStep) and arrow
// keys rotate: 1° per press, 15° with Shift. The ±0.1° buttons remain for fine tuning,
// and the aria-live readout announces the new bearing.
mapContainer?.addEventListener("keydown", (e) => {
  if (currentStep !== 3) return;
  const dir = (e.key === "ArrowRight" || e.key === "ArrowUp") ? 1
            : (e.key === "ArrowLeft" || e.key === "ArrowDown") ? -1 : 0;
  if (!dir) return;
  e.preventDefault();
  nudgeRotation(dir * (e.shiftKey ? 15 : 1));
});

// Loading overlay for the map's satellite raster tiles (#map-loading, inside
// #map-container so it rides along on reparent): shown whenever the satellite layer is
// visible and its tiles are still streaming — the first toggle to satellite, the Orient
// step's default view, and any camera move that pulls fresh tiles. Recomputed from the
// sourcedataloading/sourcedata/idle events wired in initMap and on every view toggle.
let satelliteViewOn = false;
const mapLoadingEl = $("#map-loading");
function updateMapLoadingOverlay() {
  const waiting = satelliteViewOn && mapInstance && mapStyleLoaded &&
    !!mapInstance.getSource("satellite") && !mapInstance.isSourceLoaded("satellite");
  if (mapLoadingEl) mapLoadingEl.classList.toggle("is-visible", waiting);
}

// Street/satellite imagery toggle — lets the user spot the roofline/driveway to judge orientation
function setSatelliteView(on) {
  if (!mapInstance || !mapReady) return;
  satelliteViewOn = on;
  mapInstance.getStyle().layers.forEach(({ id }) => {
    if (id === "satellite-layer" || id.startsWith("parcel-")) return;
    mapInstance.setLayoutProperty(id, "visibility", on ? "none" : "visible");
  });
  mapInstance.setLayoutProperty("satellite-layer", "visibility", on ? "visible" : "none");
  $("#view-street").classList.toggle("is-active", !on);
  $("#view-satellite").classList.toggle("is-active", on);
  updateMapLoadingOverlay(); // toggling on with cold tiles shows it now; toggling off hides it
}
$("#view-street").addEventListener("click", () => setSatelliteView(false));
$("#view-satellite").addEventListener("click", () => setSatelliteView(true));

// One-time-per-step default imagery (see showStep and the map "load" handler for call
// sites — both are needed since the map may finish loading before or after the step
// transition that first requests it).
function applyDefaultViewIfFirstVisit(step) {
  if (!mapStyleLoaded) return;
  if (step === 2 && !step2ViewInitialized) {
    step2ViewInitialized = true;
    setSatelliteView(false);
  } else if (step === 3 && !step3ViewInitialized) {
    step3ViewInitialized = true;
    setSatelliteView(true);
  }
}

// Draft-restore hook: re-adopt a saved parcel without a map interaction. This also
// re-points selectedParcelGeoJSON at the saved ring — restore used to leave it null,
// so the first autosave after a restore silently dropped parcelCoords from the draft
// and the grid failed to rebuild on the NEXT reload.
export function restoreParcelFromDraft(feature, apn, bearing) {
  selectedParcelGeoJSON = feature;
  selectedAPN = apn;
  setRotation(bearing);
  // Restored drafts get their aerial back too — the old screenshot pipeline couldn't
  // (it only ever captured during a live 3→4 walk), so a reload lost the backdrop.
  fetchAerialBackdrop();
}
