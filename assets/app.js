/* =========================================================
   Fairway Canyon HOA — ARC Application (front-end mockup)
   No backend. Drafts persist to localStorage.
   ========================================================= */
(function () {
  "use strict";

  const $  = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const DRAFT_KEY = "fairwayCanyonArcDraft.v4";        // fixed-scale grid painter + Konva annotations
  const LEGACY_DRAFT_KEYS = ["fairwayCanyonArcDraft.v3", "fairwayCanyonArcDraft.v2"]; // pre-grid-painter formats — read once for a one-time non-destructive migration (all non-plot fields carry over; the drawing itself is left to be redrawn)

  /* ------------------------------------------------------
     DATA: acknowledgments, palette, review dates
  ------------------------------------------------------ */
  const ACKS = [
    'Compliance with the <a href="https://www.fsresidential.com/california/communities/fairway-canyon/" target="_blank" rel="noopener">Guidelines</a>, <a href="https://www.fsresidential.com/california/communities/fairway-canyon/" target="_blank" rel="noopener">Protective Covenants</a> and ARC approval does <strong>not</strong> necessarily constitute compliance with building and zoning codes of <a href="https://www.rivcocob.org/building-and-safety/" target="_blank" rel="noopener">Riverside County</a>. A building permit may still be required.',
    "No exterior alteration shall commence until <strong>written ARC approval</strong> has been returned to the homeowner. Unapproved or out-of-scope work may require restoration to the former condition at the homeowner's expense, plus legal costs.",
    "I am responsible to provide all required details on attached sheets (plot, sketches, scale drawings, photos, illustrations, plans, contracts, etc.), with the location of the change indicated on a color-coded plot.",
    "For changes in <strong>paint color</strong>, I will attach a manufacturer's sample indicating the color/code and the proposed vendor's name.",
    "ARC members may enter the property at a reasonable, pre-arranged time to inspect the project site(s) during and upon completion of the work. Such entry does not constitute trespass.",
    "Any approval is contingent upon construction or alterations being completed in a <strong>workmanlike manner</strong>.",
    "Authority granted may be revoked automatically if the alteration has not commenced within <strong>180 days</strong> of the approval date and completed by the date specified by the ARC.",
    "If I disagree with the decision, I may appeal: a verbal request within 48 hours of receipt of the decision, followed by a written request within five (5) business days."
  ];

  const PALETTE = [
    { id: "turf",      label: "Turf",            color: "#7cb342" },
    { id: "grass",     label: "Grass",           color: "#a5d36a" },
    { id: "concrete",  label: "Concrete",        color: "#c2bdb2" },
    { id: "patio",     label: "Patio Cover",     color: "#d98a6a" },
    { id: "mulch",     label: "Mulch / Planter", color: "#b07a4e" },
    { id: "retaining", label: "Retaining Wall",  color: "#7a5c46" },
    { id: "shed",      label: "Shed",            color: "#e2473b" },
    { id: "tree",      label: "Tree",            color: "#2e6b35" },
    { id: "light",     label: "Yard Light",      color: "#f4c430" },
    { id: "camera",    label: "Camera",          color: "#6a4bb0" }
  ];
  const PALETTE_MAP = Object.fromEntries(PALETTE.map(p => [p.id, p]));

  // Inline stroke icons (18px, currentColor) — one per tool.
  const ICON = {
    paint: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 14.5 4 20c-.7.7-.2 2 .8 2 1.6 0 3.2-.6 4.4-1.8L14 15.5"/><path d="m12 12 6.5-6.5a2.1 2.1 0 0 1 3 3L15 15"/></svg>',
    rect: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/></svg>',
    erase: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21h16"/><path d="M15.5 5.5 20 10l-7.5 7.5H8.5L4 13a2 2 0 0 1 0-2.8l6.7-6.7a2 2 0 0 1 2.8 0z"/></svg>',
    fill: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m11 3 8 8-7.3 7.3a2 2 0 0 1-2.8 0L4 13.8a2 2 0 0 1 0-2.8z"/><path d="M8 6 5 9"/><path d="M20 15c0 1.5 1.2 2.6 1.2 4a1.2 1.2 0 0 1-2.4 0c0-1.4 1.2-2.5 1.2-4z"/></svg>',
    callout: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v11H10l-4 4v-4H4z"/></svg>',
    measure: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="8" width="20" height="8" rx="1.2"/><path d="M6.5 8v3M10 8v4M13.5 8v3M17 8v4"/></svg>',
    select: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3l5.5 15 2-6.4 6.4-2z"/><path d="m13.5 13.5 5 5"/></svg>',
    pan: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0V11m0-3a1.5 1.5 0 0 1 3 0v5.5c0 3-2.2 5.5-5.2 5.5H12c-1.6 0-2.6-.6-3.6-1.7l-3-3.3a1.5 1.5 0 0 1 2.2-2z"/></svg>',
    line: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20 20 4"/><circle cx="4" cy="20" r="1.7" fill="currentColor" stroke="none"/><circle cx="20" cy="4" r="1.7" fill="currentColor" stroke="none"/></svg>'
  };

  const TOOL_MODES = [
    { id: "paint",    label: "Paint",    icon: ICON.paint },
    { id: "rect",     label: "Rectangle", icon: ICON.rect },
    { id: "erase",    label: "Erase",    icon: ICON.erase },
    { id: "fill",     label: "Fill",     icon: ICON.fill },
    { id: "line",     label: "Line",     icon: ICON.line },
    { id: "callout",  label: "Callout",  icon: ICON.callout },
    { id: "measure",  label: "Measure",  icon: ICON.measure },
    { id: "select",   label: "Select",   icon: ICON.select },
    { id: "pan",      label: "Pan",      icon: ICON.pan }
  ];

  const DATES = [
    ["January 29", "January 20"], ["February 26", "February 17"],
    ["March 26", "March 17"], ["April 30", "April 21"],
    ["May 28", "May 19"], ["June 25", "June 16"],
    ["July 30", "July 21"], ["August 27", "August 18"],
    ["September 24", "September 15"],
    ["October 29 (tentative)", "October 20 (tentative)"],
    ["November 19 (tentative)", "November 10 (tentative)"],
    ["December 17 (tentative)", "December 8 (tentative)"]
  ];

  // Fixed real-world scale: 1 grid tile = 1 square foot, drawn CELL_SIZE px on a side at 100% zoom.
  // The grid is NOT scaled to fit the viewport — a big lot simply produces a bigger grid you pan/zoom
  // around, so a foot is always the same size on screen regardless of lot size.
  const CELL_SIZE = 8;          // px per 1-ft tile at 100% zoom
  const FEET_PER_CELL = 1;      // 1 tile = 1 sq ft
  const LINE_WIDTH_FEET = 2 / 12; // Line tool stroke = 2 inches, expressed in feet (real-world scale)
  const FOOT_IN_METERS = 0.3048;
  const GRID_MARGIN = 0.10;     // total captured area ≈ 10% bigger than the parcel (5% each side)
  const GRID_MIN_PAD = 2;       // …but always at least this many tiles of border, even for a tiny lot
  const MAX_GRID_DIM = 800;     // safety clamp (feet) so a pathological parcel can't allocate a huge canvas
  const MAX_ZOOM_ABS = 6;       // hard zoom-in cap (relative to 100%)
  const SAFE_CANVAS_PX = 3200;  // cap on the backing canvas's longest side (content × zoom) to bound memory
  // Baked aerial alignment correction. The county's 2020 orthophoto sits a few feet off the parcel
  // vectors — verified NOT a datum issue (a NAD83↔WGS84 datumTransformation on the query moves the
  // parcels 0.00 ft), so it's the orthophoto's own rectification accuracy and can't be reprojected
  // away. Instead we shift the aerial backdrop by a fixed GROUND vector (feet, +E/+N) that
  // rebuildBgLayer() rotates by the parcel bearing into stage space, so it's correct at any
  // orientation. Observed (tuned by eye over two passes): the aerial sat ≈ +1 ft E, +3.6 ft N of
  // the outline, so we push it back the other way. This is a by-eye constant — tune it here.
  const AERIAL_NUDGE_FT = { east: -1.0, north: -3.6 };
  let gridCols = 80;            // grid width in tiles (= feet); recomputed per parcel
  let gridRows = 60;            // grid height in tiles (= feet)
  let parcelPolygonPx = null;   // polygon vertices in pixel coords, traced as a Konva.Line overlay
  let selectedParcelGeoJSON = null;
  let selectedParcelRoadDir = null;  // {dE,dN,dist} unit vector toward the nearest road (from OSM), or null
  let roadDirReady = null;           // in-flight Promise for the above; auto-align waits on it briefly
  let userAdjustedRotation = false;  // true once the user hand-rotates — suppresses the late auto-correction
  let parcelBearing = 0;
  let parcelsData = null;       // raw GeoJSON from county query
  let scaleFeetPerPixel = FEET_PER_CELL / CELL_SIZE; // real-world scale for the Measure tool (content px → feet); refined once a parcel is selected

  /* --- Geometry: parcel polygon → grid projection --- */
  function geoToLocalMeters(ring, center) {
    const toRad = Math.PI / 180;
    const cosLat = Math.cos(center[1] * toRad);
    return ring.map(([lng, lat]) => ({
      x: (lng - center[0]) * cosLat * 111320,
      y: (lat - center[1]) * 111320
    }));
  }

  function rotatePoints(pts, angleDeg) {
    const a = angleDeg * Math.PI / 180;
    const cos = Math.cos(a), sin = Math.sin(a);
    return pts.map(p => ({ x: p.x * cos + p.y * sin, y: -p.x * sin + p.y * cos }));
  }

  function computeBBox(pts) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    return { minX, maxX, minY, maxY };
  }

  // Least-squares 2D similarity (uniform scale + rotation + translation) mapping
  // src[i] -> dst[i]. Used to register the aerial snapshot onto the drawn parcel
  // outline: both point sets are the SAME parcel vertices in the same order, so the
  // correspondence is exact and fitting all of them recovers the true scale AND
  // rotation. This is strictly better than matching bounding boxes, which only pins
  // the four extreme coordinates and silently bakes any small rotation residual
  // (Mercator-vs-equirectangular skew, or a fractional-degree gap between the map's
  // capture bearing and the grid's bearing) in as a visible few-foot drift.
  // Returns coefficients of the map  p -> ([[a,-b],[b,a]]·p) + (tx,ty)  (a proper
  // rotation+scale, det = a²+b² > 0, never a reflection), or null if degenerate.
  function fitSimilarity(src, dst) {
    const n = Math.min(src.length, dst.length);
    if (n < 2) return null;
    let sxc = 0, syc = 0, dxc = 0, dyc = 0;
    for (let i = 0; i < n; i++) { sxc += src[i].x; syc += src[i].y; dxc += dst[i].x; dyc += dst[i].y; }
    sxc /= n; syc /= n; dxc /= n; dyc /= n;
    let num1 = 0, num2 = 0, den = 0;
    for (let i = 0; i < n; i++) {
      const sx = src[i].x - sxc, sy = src[i].y - syc;
      const dx = dst[i].x - dxc, dy = dst[i].y - dyc;
      num1 += sx * dx + sy * dy;   // Σ s'·d'  → scale·cosθ
      num2 += sx * dy - sy * dx;   // Σ s'×d'  → scale·sinθ
      den  += sx * sx + sy * sy;
    }
    if (den < 1e-9) return null;
    const a = num1 / den, b = num2 / den;
    return { a, b, tx: dxc - (a * sxc - b * syc), ty: dyc - (b * sxc + a * syc) };
  }

  function pointInPolygon(px, py, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  function buildParcelGrid(coordRing, bearing) {
    // Centroid
    const cx = coordRing.reduce((s, p) => s + p[0], 0) / coordRing.length;
    const cy = coordRing.reduce((s, p) => s + p[1], 0) / coordRing.length;
    // To local meters, then rotate to match the map view
    // MapLibre bearing rotates the view CW, so we rotate coordinates by -bearing
    // to align them with what the user sees on screen
    const local = geoToLocalMeters(coordRing, [cx, cy]);
    const rotated = rotatePoints(local, -bearing);
    // Flip Y: geographic Y increases northward (up), but grid rows increase
    // downward. Negating Y makes the grid match the map's screen orientation.
    const screen = rotated.map(p => ({ x: p.x, y: -p.y }));
    const bb = computeBBox(screen);
    const wFt = (bb.maxX - bb.minX) / FOOT_IN_METERS;   // parcel bbox width in feet
    const hFt = (bb.maxY - bb.minY) / FOOT_IN_METERS;   // parcel bbox height in feet
    // Fixed scale: exactly one tile per foot. The captured area is a SQUARE whose side is the
    // parcel's longest dimension plus a ~10% buffer (≥ GRID_MIN_PAD tiles), with the parcel
    // centered — so the shorter dimension simply gets more surrounding margin. No fit-to-viewport
    // shrinking; a big lot just yields a bigger square.
    const metersPerCell = FOOT_IN_METERS;
    const longestFt = Math.max(wFt, hFt);
    const pad = Math.max(GRID_MIN_PAD, Math.ceil(longestFt * GRID_MARGIN / 2));
    const side = Math.min(MAX_GRID_DIM, Math.ceil(longestFt) + pad * 2);
    const cols = side, rows = side;
    // Center the parcel in the square (offsets in tiles), then project the outline into pixels.
    const offX = (side - wFt) / 2, offY = (side - hFt) / 2;
    const polyPx = screen.map(p => ({
      x: ((p.x - bb.minX) / metersPerCell + offX) * CELL_SIZE,
      y: ((p.y - bb.minY) / metersPerCell + offY) * CELL_SIZE
    }));
    return { cols, rows, polygonPx: polyPx, metersPerCell };
  }

  function computeAutoAlignBearing(ring) {
    if (!ring || ring.length < 3) return 0;
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const local = geoToLocalMeters(ring, [cx, cy]);
    // The longest boundary edge is usually a *side* lot line — lots are typically
    // deeper (front-to-back) than they are wide — so square the view to make that
    // edge vertical, not horizontal: a quarter turn from the "make it horizontal" angle.
    // This leaves two candidate bearings 180° apart; the block below picks which end
    // of the lot faces down.
    let best = { len: -1, angle: 0 };
    for (let i = 0; i < local.length - 1; i++) {
      const a = local[i], b = local[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len > best.len) best = { len, angle: Math.atan2(dy, dx) * 180 / Math.PI };
    }
    const base = (((90 - best.angle) % 360) + 360) % 360;

    // Front-yard-down disambiguation. The parcel polygon is symmetric, so geometry
    // alone can't tell the street side from the back — collapsing to [0,180) (the old
    // behavior) effectively assumed the street is south/east, which is exactly backwards
    // for lots on the far side of their street. Instead, look up the nearest road from
    // the map's own vector tiles and pick whichever of {base, base+180} rotates that side
    // to the screen bottom. Screen-down (+y) of a local direction (dE,dN) under bearing b
    // is -(dE·sin b + dN·cos b) — the rotate-by-(-bearing)-then-flip-Y that buildParcelGrid
    // uses — so "road side down" means that value is > 0.
    // Front-yard-down flip. selectedParcelRoadDir is a unit vector (local meters, east/north)
    // pointing from the parcel centroid toward the nearest street, fetched from OSM at select
    // time (see fetchNearestRoadDir). Screen-down (+y) of a direction (dE,dN) under bearing b
    // is -(dE·sin b + dN·cos b) — the rotate-by-(-bearing)-then-flip-Y buildParcelGrid uses —
    // so "street side down" means that value is > 0.
    const road = selectedParcelRoadDir;
    if (road) {
      const r = Math.PI / 180;
      const isDown = deg => -(road.dE * Math.sin(deg * r) + road.dN * Math.cos(deg * r)) > 0;
      const chosen = isDown(base) ? base : (base + 180) % 360;
      console.info("[auto-orient] nearest street %sm away, base=%s° → %s°",
        Math.round(road.dist), Math.round(base), chosen);
      return chosen;
    }
    // No street direction available (lookup still pending, failed, or none nearby) — fall back
    // to the legacy [0,180) tie-break rather than guessing a flip.
    console.warn("[auto-orient] no street direction — using legacy fallback");
    return ((base % 180) + 180) % 180;
  }

  // Closest point on segment a→b to the origin (the parcel centroid), in local meters.
  function closestPointOnSegment(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return { x: a.x, y: a.y };
    let t = -(a.x * dx + a.y * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return { x: a.x + t * dx, y: a.y + t * dy };
  }

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

  /* ------------------------------------------------------
     SIGNATURE PAD
  ------------------------------------------------------ */
  class SignaturePad {
    constructor(wrap) {
      this.wrap = wrap;
      this.canvas = $("canvas", wrap);
      this.ctx = this.canvas.getContext("2d");
      this.drawing = false;
      this.hasInk = false;
      this.resize();
      this._bind();
      $(".sigpad__clear", wrap).addEventListener("click", () => this.clear());
      window.addEventListener("resize", () => this.resize(true));
    }
    resize(preserve) {
      const data = preserve && this.hasInk ? this.canvas.toDataURL() : null;
      const r = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.max(1, r.width * dpr);
      this.canvas.height = Math.max(1, r.height * dpr);
      this.ctx.scale(dpr, dpr);
      this.ctx.lineWidth = 2.2;
      this.ctx.lineCap = "round";
      this.ctx.lineJoin = "round";
      this.ctx.strokeStyle = "#1a2740";
      if (data) {
        const img = new Image();
        img.onload = () => this.ctx.drawImage(img, 0, 0, r.width, r.height);
        img.src = data;
      }
    }
    _pos(e) {
      const r = this.canvas.getBoundingClientRect();
      const p = e.touches ? e.touches[0] : e;
      return { x: p.clientX - r.left, y: p.clientY - r.top };
    }
    _bind() {
      const start = (e) => { e.preventDefault(); this.drawing = true; const { x, y } = this._pos(e); this.ctx.beginPath(); this.ctx.moveTo(x, y); };
      const move = (e) => { if (!this.drawing) return; e.preventDefault(); const { x, y } = this._pos(e); this.ctx.lineTo(x, y); this.ctx.stroke(); this._ink(); };
      const end = () => { this.drawing = false; };
      this.canvas.addEventListener("pointerdown", start);
      this.canvas.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
    }
    _ink() { if (!this.hasInk) { this.hasInk = true; this.wrap.classList.add("has-ink"); this.wrap.classList.remove("invalid"); } }
    clear() {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.hasInk = false;
      this.wrap.classList.remove("has-ink");
    }
    isEmpty() { return !this.hasInk; }
    toDataURL() { return this.hasInk ? this.canvas.toDataURL("image/png") : null; }
    fromDataURL(url) {
      if (!url) return;
      const img = new Image();
      img.onload = () => {
        const r = this.canvas.getBoundingClientRect();
        this.ctx.drawImage(img, 0, 0, r.width, r.height);
        this._ink();
      };
      img.src = url;
    }
  }

  const sigPads = {};
  $$(".sigpad").forEach(w => { sigPads[w.dataset.sigpad] = new SignaturePad(w); });

  /* ------------------------------------------------------
     PLOT / DRAWING SURFACE (Konva.js)
  ------------------------------------------------------ */
  const KONVA_AVAILABLE = typeof Konva !== "undefined";
  const plotHost = $("#plot-konva-host");
  let plotBgDataUrl = null; // aerial snapshot from the Orient step, shown behind the drawing as a tracing aid
  let plotBgParcelPx = null; // the parcel ring projected into the snapshot's own pixel space, so the
                             // aerial can be registered 1:1 to parcelPolygonPx instead of blindly cover-fit

  let stage = null, bgLayer = null, gridLayer = null, drawLayer = null, overlayLayer = null;
  let gridLinesCanvas = null, paintCanvas = null, gridCtx = null; // offscreen 2D canvases behind the grid
  let gridLinesNode = null, gridImageNode = null;                 // Konva.Images wrapping the two canvases
  let paintClipGroup = null;                                      // clips painted material to the parcel footprint
  let cellState = new Map();     // "c,r" -> material id (sparse; big lots are mostly empty)
  let stageReady = false;
  let activeMaterial = "turf";
  let activeMode = "paint";
  let brushSize = 3;             // square paint brush, in tiles (= feet)
  let painting = false, lastCell = null; // in-progress freehand paint/erase stroke
  let eraseGesture = false;              // right-click / Ctrl(⌘)+click forces erase regardless of tool
  let lineDraft = null, lineGhost = null; // shift-held straight-line paint stroke
  let gridLineDraft = null, gridLineGhost = null; // Line tool: grid-snapped vector line annotation
  let rectDraft = null, rectGhost = null; // Rectangle tool: drag-to-fill a block of cells
  let lastPlotAPN, lastPlotBearing; // guards the confirm-before-clear check in rebuildGridForParcel

  let dragOrigin = null, ghostNode = null;         // measure drag
  let calloutDraft = null, calloutGhost = null;    // callout
  let selectedNode = null, selectionRect = null;   // Select/move tool

  let undoStack = [], redoStack = [], restoringHistory = false;

  // View model: the stage is sized to content × viewZoom and lives inside the scrollable host,
  // so panning is native scroll (scrollbars / middle-mouse / hand tool) and zoom is a resize.
  let viewZoom = 1;
  let panActive = false, panStartX = 0, panStartY = 0, panScrollL = 0, panScrollT = 0;

  function formatFeet(feet) {
    return `${feet.toFixed(1)} ft`;
  }

  /* --- Stage setup: stage sized to content × zoom inside a scrollable host --- */
  function initPlotStage() {
    if (!KONVA_AVAILABLE) {
      const msg = $("#plot-fallback-msg");
      if (msg) msg.hidden = false;
      return;
    }
    stage = new Konva.Stage({ container: "plot-konva-host", width: gridCols * CELL_SIZE, height: gridRows * CELL_SIZE });
    bgLayer = new Konva.Layer({ listening: false });   // aerial + parcel outline
    gridLayer = new Konva.Layer({ listening: false }); // graph-paper lines + painted cells
    drawLayer = new Konva.Layer();                     // callouts + measurements
    overlayLayer = new Konva.Layer();                  // in-progress ghosts
    stage.add(bgLayer, gridLayer, drawLayer, overlayLayer);
    makeGridCanvases(gridCols, gridRows);
    gridLinesNode = new Konva.Image({ image: gridLinesCanvas, x: 0, y: 0, listening: false });
    gridImageNode = new Konva.Image({ image: paintCanvas, x: 0, y: 0, listening: false });
    // Occlude painted material outside the dashed parcel outline: the paint image lives in a
    // clip group tracing the footprint, while the graph-paper lines stay full-square for context.
    paintClipGroup = new Konva.Group({ listening: false, clipFunc: clipToParcel });
    paintClipGroup.add(gridImageNode);
    gridLayer.add(gridLinesNode, paintClipGroup);
    // Blend the painted materials into the aerial beneath (multiply) so the ground texture
    // reads through your plan. It's a CSS blend on the layer's own DOM canvas, compositing
    // live against bgLayer; toDataURL() ignores it, so print/preview keeps solid opaque colors.
    const gridCanvasEl = (typeof gridLayer.getNativeCanvasElement === "function")
      ? gridLayer.getNativeCanvasElement()
      : gridLayer.getCanvas() && gridLayer.getCanvas()._canvas;
    if (gridCanvasEl) gridCanvasEl.style.mixBlendMode = "multiply";
    if (plotHost) plotHost.style.touchAction = "none";
    stage.on("pointerdown", onStagePointerDown);
    stage.on("pointermove", onStagePointerMove);
    stage.on("pointerup", onStagePointerUp);
    stage.on("wheel", onWheel);
    stage.on("click tap", e => { if (activeMode === "select" && e.target === stage) clearSelection(); });
    // A gesture that RELEASES past the canvas edge never fires the stage's own pointerup
    // (native events only reach elements the pointer is still over) — without this, an
    // in-progress paint stroke / measurement / callout is silently abandoned. onStagePointerUp
    // is idempotent, so double-binding alongside the stage's own listener is safe.
    window.addEventListener("pointerup", onStagePointerUp);
    // Native scroll panning: middle-mouse anywhere, or left-drag while the Pan tool is active.
    plotHost.addEventListener("pointerdown", onHostPointerDown);
    window.addEventListener("pointermove", onHostPointerMove);
    window.addEventListener("pointerup", onHostPointerUp);
    plotHost.addEventListener("mousedown", e => { if (e.button === 1) e.preventDefault(); }); // suppress MMB autoscroll
    plotHost.addEventListener("contextmenu", e => e.preventDefault()); // right-click erases instead of opening the menu
    stageReady = true;
    applyStageSize();
    fitView();
    window.addEventListener("resize", onViewportResize);
  }

  /* --- Middle-mouse / hand-tool panning (adjusts native scroll) --- */
  function onHostPointerDown(e) {
    if (e.button === 1 || (activeMode === "pan" && e.button === 0)) {
      panActive = true;
      panStartX = e.clientX; panStartY = e.clientY;
      panScrollL = plotHost.scrollLeft; panScrollT = plotHost.scrollTop;
      try { plotHost.setPointerCapture(e.pointerId); } catch (_) {}
      plotHost.style.cursor = "grabbing";
      e.preventDefault();
    }
  }
  function onHostPointerMove(e) {
    if (!panActive) return;
    plotHost.scrollLeft = panScrollL - (e.clientX - panStartX);
    plotHost.scrollTop = panScrollT - (e.clientY - panStartY);
  }
  function onHostPointerUp(e) {
    if (!panActive) return;
    panActive = false;
    try { plotHost.releasePointerCapture(e.pointerId); } catch (_) {}
    plotHost.style.cursor = activeMode === "pan" ? "grab" : "";
  }

  // Clip path (content-pixel space) tracing the parcel footprint, used as the clipFunc for the
  // painted-material group so paint is occluded outside the dashed red outline. Reads the live
  // parcelPolygonPx each draw, so it tracks parcel/orientation changes automatically. Before a
  // parcel resolves, it falls back to the full content rect (nothing hidden).
  function clipToParcel(ctx) {
    const poly = parcelPolygonPx;
    if (!poly || poly.length < 3) {
      ctx.rect(0, 0, gridCols * CELL_SIZE, gridRows * CELL_SIZE);
      return;
    }
    ctx.beginPath();
    poly.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
  }

  /* --- Grid canvases (graph paper + painted cells) --- */
  function makeGridCanvases(cols, rows) {
    const w = cols * CELL_SIZE, h = rows * CELL_SIZE;
    gridLinesCanvas = document.createElement("canvas");
    gridLinesCanvas.width = w; gridLinesCanvas.height = h;
    drawGraphPaper(gridLinesCanvas.getContext("2d"), cols, rows);
    paintCanvas = document.createElement("canvas");
    paintCanvas.width = w; paintCanvas.height = h;
    gridCtx = paintCanvas.getContext("2d");
  }

  // Transparent graph paper (aerial backdrop shows through unpainted tiles): light 1-ft lines,
  // heavier every 10 ft for a rough ruler feel.
  function drawGraphPaper(ctx, cols, rows) {
    const w = cols * CELL_SIZE, h = rows * CELL_SIZE;
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 1;
    for (let c = 0; c <= cols; c++) {
      const x = Math.round(c * CELL_SIZE) + 0.5;
      ctx.strokeStyle = (c % 10 === 0) ? "rgba(60,50,40,.32)" : "rgba(60,50,40,.10)";
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let r = 0; r <= rows; r++) {
      const y = Math.round(r * CELL_SIZE) + 0.5;
      ctx.strokeStyle = (r % 10 === 0) ? "rgba(60,50,40,.32)" : "rgba(60,50,40,.10)";
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
  }

  function paintCellRaw(c, r, id) {
    if (c < 0 || r < 0 || c >= gridCols || r >= gridRows || !gridCtx) return;
    const key = c + "," + r;
    if (id) {
      cellState.set(key, id);
      gridCtx.fillStyle = PALETTE_MAP[id]?.color || "#7cb342";
      gridCtx.fillRect(c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    } else {
      cellState.delete(key);
      gridCtx.clearRect(c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    }
  }

  // Square brush of side `brushSize`, roughly centered on (c, r).
  function paintBrush(c, r, id) {
    const off = Math.floor(brushSize / 2);
    for (let dy = 0; dy < brushSize; dy++)
      for (let dx = 0; dx < brushSize; dx++)
        paintCellRaw(c - off + dx, r - off + dy, id);
  }

  // Stamp the brush along the line between two cells so a fast drag leaves no gaps.
  function paintStroke(c0, r0, c1, r1, id) {
    const steps = Math.max(Math.abs(c1 - c0), Math.abs(r1 - r0));
    if (steps === 0) { paintBrush(c1, r1, id); return; }
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      paintBrush(Math.round(c0 + (c1 - c0) * t), Math.round(r0 + (r1 - r0) * t), id);
    }
  }

  function cellFromPointer() {
    const p = stage.getRelativePointerPosition();
    if (!p) return null;
    return { c: Math.floor(p.x / CELL_SIZE), r: Math.floor(p.y / CELL_SIZE) };
  }

  // Fill the axis-aligned block of cells between two corners with `id` (null = erase).
  function fillRect(c0, r0, c1, r1, id) {
    const cMin = Math.min(c0, c1), cMax = Math.max(c0, c1);
    const rMin = Math.min(r0, r1), rMax = Math.max(r0, r1);
    for (let r = rMin; r <= rMax; r++)
      for (let c = cMin; c <= cMax; c++) paintCellRaw(c, r, id);
  }

  // --- Line-tool walls as flood-fill barriers (any angle, including triangles) ---
  // Lines are thin geometric walls. The paint-bucket floods at SUB-tile resolution: a step between
  // two adjacent subcell centres is blocked when the connector crosses any line. Because a straight
  // connector crosses a straight segment iff its endpoints are on opposite sides of it, this is
  // watertight for lines at ANY angle — a closed triangle whose corners share snapped vertices fully
  // contains the fill. A whole tile is then painted iff MORE THAN HALF of its subcells were reached,
  // i.e. the ">50% of the tile is within bounds" rule (which also subsumes axis-aligned walls and
  // fully-interior tiles at 100%). All coords here are in TILE units (1 unit = CELL_SIZE px).
  const FILL_SUBSAMPLE = 4;   // subcells per tile per axis → 16 samples/tile (6.25% coverage steps)

  function collectLineSegments() {
    const segs = [];
    if (!drawLayer) return segs;
    drawLayer.getChildren().forEach(node => {
      if (node.getAttr("kind") !== "line") return;
      const pts = node.points ? node.points() : null;
      if (!pts || pts.length < 4) return;
      const ox = node.x() || 0, oy = node.y() || 0;   // include any Select-tool drag offset
      segs.push({
        x0: (pts[0] + ox) / CELL_SIZE, y0: (pts[1] + oy) / CELL_SIZE,
        x1: (pts[2] + ox) / CELL_SIZE, y1: (pts[3] + oy) / CELL_SIZE
      });
    });
    return segs;
  }

  // Do segments A(a→b) and B(p→q) intersect? Touching counts as a hit, so a connector grazing a
  // shared triangle vertex still blocks — we bias toward blocking so the fill can never leak out.
  function segmentsIntersect(ax, ay, bx, by, px, py, qx, qy) {
    const EPS = 1e-9;
    const cross = (ux, uy, vx, vy) => ux * vy - uy * vx;
    const onSeg = (x1, y1, x2, y2, x, y) =>
      Math.min(x1, x2) - EPS <= x && x <= Math.max(x1, x2) + EPS &&
      Math.min(y1, y2) - EPS <= y && y <= Math.max(y1, y2) + EPS;
    const d1 = cross(qx - px, qy - py, ax - px, ay - py);
    const d2 = cross(qx - px, qy - py, bx - px, by - py);
    const d3 = cross(bx - ax, by - ay, px - ax, py - ay);
    const d4 = cross(bx - ax, by - ay, qx - ax, qy - ay);
    if (((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) &&
        ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))) return true;
    if (Math.abs(d1) <= EPS && onSeg(px, py, qx, qy, ax, ay)) return true;
    if (Math.abs(d2) <= EPS && onSeg(px, py, qx, qy, bx, by)) return true;
    if (Math.abs(d3) <= EPS && onSeg(ax, ay, bx, by, px, py)) return true;
    if (Math.abs(d4) <= EPS && onSeg(ax, ay, bx, by, qx, qy)) return true;
    return false;
  }

  function connectorBlocked(ax, ay, bx, by, segs) {
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (segmentsIntersect(ax, ay, bx, by, s.x0, s.y0, s.x1, s.y1)) return true;
    }
    return false;
  }

  // Is point (x,y) essentially ON wall segment s? Used to recover the thin on-wall strip of
  // subcells the conservative connector-block erodes (see floodFill coverage pass).
  function pointOnSegment(x, y, s) {
    const dx = s.x1 - s.x0, dy = s.y1 - s.y0, L2 = dx * dx + dy * dy;
    if (L2 < 1e-12) return Math.hypot(x - s.x0, y - s.y0) < 1e-6;
    let t = ((x - s.x0) * dx + (y - s.y0) * dy) / L2;
    if (t < -1e-9 || t > 1 + 1e-9) return false;
    return Math.hypot(x - (s.x0 + t * dx), y - (s.y0 + t * dy)) < 1e-6;
  }

  function pointOnAnyWall(x, y, segs) {
    for (let i = 0; i < segs.length; i++) if (pointOnSegment(x, y, segs[i])) return true;
    return false;
  }

  // Paint-bucket. Floods the contiguous region of same-value tiles (empty or one material),
  // bounded by the grid edges, by material colour, AND by Line-tool walls at any angle. `seed` is
  // the click point in content px (falls back to the tile centre) so a fill against a wall starts
  // on the side the user actually clicked. A tile is painted only if MORE THAN HALF of it ends up
  // inside the flooded region.
  //
  // Ties/edges: because the connectivity flood treats "touching a wall" as blocked (so a fill can
  // never leak through a shared vertex), a diagonal wall would otherwise erode the thin strip of
  // on-wall subcells and leave that tile empty — a visible gap along the diagonal. The coverage
  // pass adds those on-wall subcells back, so a triangle fills solidly up to its edge. When you
  // then fill the OTHER side, the material-region check stops that flood from entering an already-
  // painted tile, so the FIRST fill keeps the shared edge tiles (no overwrite, no gap).
  function floodFill(c0, r0, id, seed) {
    if (c0 < 0 || r0 < 0 || c0 >= gridCols || r0 >= gridRows) return;
    const target = cellState.get(c0 + "," + r0) || null;
    if (target === (id || null)) return; // already that colour — nothing to do
    const segs = collectLineSegments();
    const SUB = FILL_SUBSAMPLE;
    const FC = gridCols * SUB, FR = gridRows * SUB, HALF = (SUB * SUB) / 2;
    const key = (i, j) => j * FC + i;
    const subCenter = (i) => (i + 0.5) / SUB;           // tile-unit centre of a subcell index
    const targetOf = (c, r) => (cellState.get(c + "," + r) || null);
    const NB = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    // Seed subcell = the one under the click, clamped to stay inside the clicked tile.
    let si = c0 * SUB + (SUB >> 1), sj = r0 * SUB + (SUB >> 1);
    if (seed) {
      const gi = Math.floor((seed.x / CELL_SIZE) * SUB), gj = Math.floor((seed.y / CELL_SIZE) * SUB);
      if (Math.floor(gi / SUB) === c0) si = Math.min(FC - 1, Math.max(0, gi));
      if (Math.floor(gj / SUB) === r0) sj = Math.min(FR - 1, Math.max(0, gj));
    }

    // 1) Connectivity flood at sub-tile resolution (watertight against walls at any angle).
    const seen = new Set();       // subcells already decided (entered or rejected)
    const reached = new Set();    // subcells that are part of the flooded region
    const stack = [[si, sj]];
    seen.add(key(si, sj)); reached.add(key(si, sj));
    while (stack.length) {
      const [i, j] = stack.pop();
      const cx = subCenter(i), cy = subCenter(j);
      const c = (i / SUB) | 0, r = (j / SUB) | 0;
      for (let n = 0; n < 4; n++) {
        const ni = i + NB[n][0], nj = j + NB[n][1];
        if (ni < 0 || nj < 0 || ni >= FC || nj >= FR) continue;
        const kk = key(ni, nj);
        if (seen.has(kk)) continue;
        const nc = (ni / SUB) | 0, nr = (nj / SUB) | 0;
        // Stepping into a different tile only continues through same-material tiles (as before).
        if ((nc !== c || nr !== r) && targetOf(nc, nr) !== target) { seen.add(kk); continue; }
        // Blocked by a Line wall between the two subcell centres? (don't mark seen — it may be
        // reachable from another direction around the wall's end)
        if (connectorBlocked(cx, cy, subCenter(ni), subCenter(nj), segs)) continue;
        seen.add(kk); reached.add(kk); stack.push([ni, nj]);
      }
    }

    // 2) Coverage per tile = reached subcells, plus on-wall subcells bordering the reached region
    //    within the same tile (the eroded strip, added back so diagonal edges fill solidly).
    const counts = new Map();
    const counted = new Set();
    const bump = (i, j) => { const t = ((i / SUB) | 0) + "," + ((j / SUB) | 0); counts.set(t, (counts.get(t) || 0) + 1); };
    reached.forEach(kk => {
      const i = kk % FC, j = (kk / FC) | 0;
      if (!counted.has(kk)) { counted.add(kk); bump(i, j); }
      const c = (i / SUB) | 0, r = (j / SUB) | 0;
      for (let n = 0; n < 4; n++) {
        const ni = i + NB[n][0], nj = j + NB[n][1];
        if (ni < 0 || nj < 0 || ni >= FC || nj >= FR) continue;
        if (((ni / SUB) | 0) !== c || ((nj / SUB) | 0) !== r) continue;   // stay within the tile
        const nk = key(ni, nj);
        if (reached.has(nk) || counted.has(nk)) continue;
        if (pointOnAnyWall(subCenter(ni), subCenter(nj), segs)) { counted.add(nk); bump(ni, nj); }
      }
    });

    // 3) Paint each tile that came out more than half inside.
    counts.forEach((count, tkey) => {
      if (count <= HALF) return;
      const i = tkey.indexOf(","), c = +tkey.slice(0, i), r = +tkey.slice(i + 1);
      paintCellRaw(c, r, id);
    });
  }

  function repaintAllCells() {
    if (!gridCtx) return;
    gridCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
    cellState.forEach((id, key) => {
      const i = key.indexOf(","), c = +key.slice(0, i), r = +key.slice(i + 1);
      gridCtx.fillStyle = PALETTE_MAP[id]?.color || "#7cb342";
      gridCtx.fillRect(c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    });
  }

  function loadCells(pairs) {
    cellState = new Map(Array.isArray(pairs) ? pairs : []);
    repaintAllCells();
  }

  /* --- Zoom (resize the stage; the host scrolls). Content/measurement coords never change. --- */
  function contentSize() { return { w: gridCols * CELL_SIZE, h: gridRows * CELL_SIZE }; }

  // Smallest zoom that still fully covers the viewport — you can't zoom out into whitespace.
  function minZoom() {
    const { w, h } = contentSize();
    const vw = plotHost.clientWidth || 0, vh = plotHost.clientHeight || 0;
    if (!w || !h || !vw || !vh) return 1;
    return Math.max(vw / w, vh / h);
  }
  // Largest zoom whose backing canvas (content × zoom) stays within a safe pixel budget, so
  // zooming into a big lot can't allocate a browser-crashing canvas.
  function maxZoom() {
    const { w, h } = contentSize();
    return Math.min(MAX_ZOOM_ABS, SAFE_CANVAS_PX / Math.max(w, h, 1));
  }
  function clampZoom(z) { return Math.max(minZoom(), Math.min(Math.max(minZoom(), maxZoom()), z)); }

  function applyStageSize() {
    if (!stageReady) return;
    const { w, h } = contentSize();
    stage.width(w * viewZoom);
    stage.height(h * viewZoom);
    stage.scale({ x: viewZoom, y: viewZoom });
    stage.batchDraw();
    updateZoomReadout();
  }

  function updateZoomReadout() {
    const el = $("#plot-zoom-level");
    if (el) el.textContent = Math.round(viewZoom * 100) + "%";
  }

  // Zoom toward a viewport point (cx, cy relative to the host's top-left), keeping it fixed.
  function zoomAt(rawZoom, cx, cy) {
    if (!stageReady) return;
    const nz = clampZoom(rawZoom);
    if (nz === viewZoom) return;
    const contentX = (plotHost.scrollLeft + cx) / viewZoom;
    const contentY = (plotHost.scrollTop + cy) / viewZoom;
    viewZoom = nz;
    applyStageSize();
    plotHost.scrollLeft = contentX * nz - cx;
    plotHost.scrollTop = contentY * nz - cy;
  }

  function onWheel(e) {
    e.evt.preventDefault();
    const rect = plotHost.getBoundingClientRect();
    zoomAt(viewZoom * (e.evt.deltaY < 0 ? 1.15 : 1 / 1.15), e.evt.clientX - rect.left, e.evt.clientY - rect.top);
  }

  function zoomButton(factor) {
    zoomAt(viewZoom * factor, plotHost.clientWidth / 2, plotHost.clientHeight / 2);
  }

  // "Fit": zoom all the way out (to the no-whitespace floor) and center on the parcel.
  function fitView() {
    if (!stageReady) return;
    viewZoom = clampZoom(minZoom());
    applyStageSize();
    centerOnParcel();
    updateZoomReadout();
  }

  function centerOnParcel() {
    const bb = (parcelPolygonPx && parcelPolygonPx.length)
      ? computeBBox(parcelPolygonPx)
      : { minX: 0, minY: 0, maxX: gridCols * CELL_SIZE, maxY: gridRows * CELL_SIZE };
    const cx = ((bb.minX + bb.maxX) / 2) * viewZoom, cy = ((bb.minY + bb.maxY) / 2) * viewZoom;
    plotHost.scrollLeft = cx - plotHost.clientWidth / 2;
    plotHost.scrollTop = cy - plotHost.clientHeight / 2;
  }

  // On container resize the no-whitespace floor changes; re-clamp and re-apply.
  function onViewportResize() {
    if (!stageReady) return;
    viewZoom = clampZoom(viewZoom);
    applyStageSize();
  }

  function rebuildBgLayer() {
    if (!stageReady) return;
    bgLayer.destroyChildren();
    if (plotBgDataUrl) {
      const img = new Image();
      img.onload = () => {
        if (!stageReady) return;
        const w = gridCols * CELL_SIZE, h = gridRows * CELL_SIZE;
        let node;
        const fit = (plotBgParcelPx && plotBgParcelPx.length && parcelPolygonPx && parcelPolygonPx.length)
          ? fitSimilarity(plotBgParcelPx, parcelPolygonPx) : null;
        if (fit) {
          // Register the aerial to the drawn parcel outline by a least-squares similarity
          // fit over every corresponding parcel vertex (see fitSimilarity). This lines the
          // lot/house up 1:1 with the dashed outline at the correct scale AND angle, fixing
          // the small drift the old bounding-box registration left behind (it ignored any
          // rotation between the snapshot's and the grid's projections of the ring).
          const scale = Math.hypot(fit.a, fit.b);
          node = new Konva.Image({
            image: img,
            width: img.width, height: img.height,
            x: fit.tx, y: fit.ty,
            scaleX: scale, scaleY: scale,
            rotation: Math.atan2(fit.b, fit.a) * 180 / Math.PI,
            opacity: 0.33, listening: false
          });
        } else {
          // Fallback (e.g. a restored draft with no fresh capture): cover-fit + center.
          const scale = Math.max(w / img.width, h / img.height);
          node = new Konva.Image({
            image: img,
            width: img.width * scale, height: img.height * scale,
            x: (w - img.width * scale) / 2, y: (h - img.height * scale) / 2,
            opacity: 0.33, listening: false
          });
        }
        // Apply the baked ortho correction (see AERIAL_NUDGE_FT). It's a ground vector in feet;
        // rotate it by the parcel bearing and flip Y to land in stage pixels, then translate the
        // whole aerial by it. At bearing 0 this is just (+E → +x, +N → −y). A pure translation of
        // the node origin is unaffected by the node's own rotation, so this composes cleanly.
        if (node && (AERIAL_NUDGE_FT.east || AERIAL_NUDGE_FT.north)) {
          const b = (parcelBearing || 0) * Math.PI / 180;
          const e = AERIAL_NUDGE_FT.east, nth = AERIAL_NUDGE_FT.north;
          node.x(node.x() + (e * Math.cos(b) - nth * Math.sin(b)) * CELL_SIZE);
          node.y(node.y() - (e * Math.sin(b) + nth * Math.cos(b)) * CELL_SIZE);
        }
        bgLayer.add(node);
        node.moveToBottom();
        bgLayer.batchDraw();
      };
      img.src = plotBgDataUrl;
    }
    if (parcelPolygonPx && parcelPolygonPx.length) {
      bgLayer.add(new Konva.Line({
        points: parcelPolygonPx.flatMap(p => [p.x, p.y]),
        closed: true, stroke: "#a4111f", strokeWidth: 2, dash: [6, 3], listening: false
      }));
    }
    bgLayer.batchDraw();
  }

  /* --- Toolbars --- */
  function buildPalette() {
    const pal = $("#palette");
    PALETTE.forEach(p => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.material = p.id;
      if (p.id === activeMaterial) b.classList.add("is-active");
      const sw = document.createElement("span");
      sw.className = "swatch";
      sw.style.background = p.color;
      b.append(sw, document.createTextNode(p.label));
      b.addEventListener("click", () => {
        activeMaterial = p.id;
        $$("#palette button").forEach(x => x.classList.toggle("is-active", x === b));
      });
      pal.appendChild(b);
    });
  }

  function buildToolbar() {
    const pal = $("#tool-palette");
    TOOL_MODES.forEach(t => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.mode = t.id;
      if (t.id === activeMode) b.classList.add("is-active");
      b.innerHTML = (t.icon || "") + '<span>' + t.label + '</span>';
      b.title = t.label;
      b.addEventListener("click", () => setActiveMode(t.id));
      pal.appendChild(b);
    });
  }

  function setActiveMode(mode) {
    if (calloutDraft && mode !== "callout") {
      calloutDraft = null;
      if (calloutGhost) { calloutGhost.destroy(); calloutGhost = null; overlayLayer?.batchDraw(); }
    }
    if (dragOrigin && mode !== "measure") {
      if (ghostNode) { ghostNode.destroy(); ghostNode = null; }
      dragOrigin = null; overlayLayer?.batchDraw();
    }
    if (lineDraft) { lineDraft = null; if (lineGhost) { lineGhost.destroy(); lineGhost = null; overlayLayer?.batchDraw(); } }
    if (gridLineDraft) { gridLineDraft = null; if (gridLineGhost) { gridLineGhost.destroy(); gridLineGhost = null; overlayLayer?.batchDraw(); } }
    if (rectDraft) { rectDraft = null; if (rectGhost) { rectGhost.destroy(); rectGhost = null; overlayLayer?.batchDraw(); } }
    if (mode !== "select") clearSelection();
    activeMode = mode;
    $$("#tool-palette button").forEach(x => x.classList.toggle("is-active", x.dataset.mode === mode));
    // Annotations intercept pointer events in Erase (click removes) and Select (click/drag to
    // move) modes, and are draggable only in Select; otherwise they're inert so a paint stroke
    // passes straight through to the grid underneath.
    if (drawLayer) drawLayer.getChildren().forEach(n => {
      n.listening(mode === "erase" || mode === "select");
      n.draggable(mode === "select");
    });
    if (plotHost) plotHost.style.cursor =
      mode === "pan" ? "grab" : (mode === "erase" ? "cell" : (mode === "select" ? "move" : (mode === "fill" ? "pointer" : "crosshair")));
  }

  /* --- Annotation interactions: Erase click-to-delete, Select click/drag-to-move --- */
  function attachShapeInteractions(node) {
    node.listening(activeMode === "erase" || activeMode === "select");
    node.draggable(activeMode === "select");
    node.on("click tap", () => {
      if (activeMode === "erase") {
        recordUndoPoint();
        if (node === selectedNode) clearSelection();
        node.destroy();
        drawLayer.batchDraw();
        scheduleAutosave();
      } else if (activeMode === "select") {
        selectShape(node);
      }
    });
    node.on("dragstart", () => { recordUndoPoint(); selectShape(node); });
    node.on("dragmove", updateSelectionRect);
    node.on("dragend", () => { updateSelectionRect(); scheduleAutosave(); });
  }

  /* --- Select / move: highlight a callout or measurement and drag it to reposition --- */
  function selectShape(node) {
    selectedNode = node;
    updateSelectionRect();
  }

  function updateSelectionRect() {
    if (!selectedNode) return;
    const box = selectedNode.getClientRect({ relativeTo: drawLayer }); // content coords
    if (!selectionRect) {
      selectionRect = new Konva.Rect({ stroke: "#2b6cb0", strokeWidth: 1.5, dash: [5, 3], listening: false });
      overlayLayer.add(selectionRect);
    }
    const pad = 5;
    selectionRect.setAttrs({ x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 });
    overlayLayer.batchDraw();
  }

  function clearSelection() {
    selectedNode = null;
    if (selectionRect) { selectionRect.destroy(); selectionRect = null; overlayLayer?.batchDraw(); }
  }

  /* --- Undo / redo (snapshots BOTH the painted grid and the annotations) --- */
  function snapshotState() {
    return JSON.stringify({
      cells: cellState ? [...cellState] : [],
      ann: (drawLayer ? drawLayer.toObject().children : []) || []
    });
  }

  function recordUndoPoint() {
    if (restoringHistory || !stageReady) return;
    undoStack.push(snapshotState());
    if (undoStack.length > 50) undoStack.shift();
    redoStack = [];
    updateUndoRedoButtons();
  }

  function updateUndoRedoButtons() {
    const undoBtn = $("#plot-undo"), redoBtn = $("#plot-redo");
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
  }

  function applyHistorySnapshot(json) {
    restoringHistory = true;
    clearSelection();
    const s = JSON.parse(json);
    loadCells(s.cells);
    drawLayer.destroyChildren();
    hydrateShapesInto(drawLayer, s.ann);
    drawLayer.batchDraw();
    gridLayer.batchDraw();
    restoringHistory = false;
  }

  function undo() {
    if (!undoStack.length || !stageReady) return;
    redoStack.push(snapshotState());
    applyHistorySnapshot(undoStack.pop());
    updateUndoRedoButtons();
    scheduleAutosave();
  }

  function redo() {
    if (!redoStack.length || !stageReady) return;
    undoStack.push(snapshotState());
    applyHistorySnapshot(redoStack.pop());
    updateUndoRedoButtons();
    scheduleAutosave();
  }

  // Rebuilds annotations from serialized JSON (draft restore, undo/redo) and re-wires
  // interactions — Konva's serialized JSON carries no event listeners.
  function hydrateShapesInto(layer, shapes) {
    (shapes || []).forEach(obj => {
      try {
        const node = Konva.Node.create(obj);
        layer.add(node);
        attachShapeInteractions(node);
      } catch (e) { /* skip a shape that fails to reconstruct rather than aborting the whole restore */ }
    });
  }

  /* --- Measure (drag-to-draw dimension arrow with a feet label) --- */
  function makeMeasureGhost(a) {
    return new Konva.Arrow({ points: [a.x, a.y, a.x, a.y], stroke: "#2b6cb0", fill: "#2b6cb0", strokeWidth: 2, pointerAtBeginning: true, pointerAtEnding: true, listening: false });
  }

  function buildMeasurementGroup(a, b) {
    const group = new Konva.Group();
    group.setAttr("kind", "measurement");
    const arrow = new Konva.Arrow({
      points: [a.x, a.y, b.x, b.y],
      stroke: "#2b6cb0", fill: "#2b6cb0", strokeWidth: 2,
      pointerAtBeginning: true, pointerAtEnding: true, pointerLength: 7, pointerWidth: 7
    });
    const feet = Math.hypot(b.x - a.x, b.y - a.y) * scaleFeetPerPixel;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const label = new Konva.Text({
      x: mid.x, y: mid.y - 16, text: formatFeet(feet),
      fontFamily: "sans-serif", fontSize: 12, fontStyle: "bold", fill: "#2b6cb0", padding: 2
    });
    label.offsetX(label.width() / 2);
    group.add(arrow, label);
    return group;
  }

  /* --- Callout (leader line + text box, free-angle) ---
     The label box anchors where you PRESS; you drag toward the thing you're pointing at,
     and the arrowhead lands where you RELEASE. This keeps the committed arrow pointing the
     same way as the drag ghost (both arrowhead-at-release), so the callout no longer
     "deploys backwards" from the direction it was drawn. */
  function startCallout(pos) {
    calloutDraft = { anchor: pos };  // label box anchor = first press point
    calloutGhost = new Konva.Arrow({
      points: [pos.x, pos.y, pos.x, pos.y],
      stroke: "#2b6cb0", fill: "#2b6cb0", strokeWidth: 2, pointerAtEnding: true, listening: false
    });
    overlayLayer.add(calloutGhost);
  }

  function updateCalloutGhost(pos) {
    if (!calloutGhost || !calloutDraft) return;
    calloutGhost.points([calloutDraft.anchor.x, calloutDraft.anchor.y, pos.x, pos.y]);
    overlayLayer.batchDraw();
  }

  function commitCallout(pos) {
    if (!calloutDraft) return;
    const anchor = calloutDraft.anchor;
    calloutDraft = null;
    if (calloutGhost) { calloutGhost.destroy(); calloutGhost = null; }
    overlayLayer.batchDraw();
    // Where the arrow points (the "tip"): the release point, or a small default offset for a click.
    const tip = (pos && Math.hypot(pos.x - anchor.x, pos.y - anchor.y) > 10) ? pos : { x: anchor.x + 60, y: anchor.y + 40 };
    const text = window.prompt("Callout text:");
    if (!text || !text.trim()) return;
    const group = buildCalloutGroup(tip, anchor, text.trim());
    recordUndoPoint();
    drawLayer.add(group);
    attachShapeInteractions(group);
    drawLayer.batchDraw();
    scheduleAutosave();
  }

  function buildCalloutGroup(tip, labelPos, text) {
    const group = new Konva.Group();
    group.setAttr("kind", "callout");
    const arrow = new Konva.Arrow({
      points: [labelPos.x, labelPos.y, tip.x, tip.y],
      stroke: "#a4111f", fill: "#a4111f", strokeWidth: 1.5,
      pointerLength: 8, pointerWidth: 8, pointerAtEnding: true
    });
    const label = new Konva.Label({ x: labelPos.x, y: labelPos.y });
    label.add(new Konva.Tag({ fill: "#fff9f2", stroke: "#a4111f", strokeWidth: 1.5, cornerRadius: 4, shadowColor: "#000", shadowOpacity: .15, shadowBlur: 4, shadowOffset: { x: 0, y: 2 } }));
    label.add(new Konva.Text({ text, fontFamily: "sans-serif", fontSize: 13, padding: 6, fill: "#1e1a14" }));
    group.add(arrow, label);
    return group;
  }

  /* --- Stage-level pointer dispatch ---
     Everything works in CONTENT coordinates (getRelativePointerPosition), so painting,
     callouts and measurements stay put under the pointer at any pan/zoom. --- */
  function contentPos() { return stage.getRelativePointerPosition(); }

  function cellCenter(c, r) { return { x: (c + 0.5) * CELL_SIZE, y: (r + 0.5) * CELL_SIZE }; }

  /* --- Line tool: a grid-snapped black vector line (~2 in wide at real-world scale) ---
     Endpoints snap to the nearest grid-line intersection so the line rides the graph paper
     instead of filling squares. It's a plain Konva.Line on drawLayer, so it selects, erases,
     undoes, persists and prints exactly like a callout/measurement. */
  function snapToGrid(pos) {
    return { x: Math.round(pos.x / CELL_SIZE) * CELL_SIZE, y: Math.round(pos.y / CELL_SIZE) * CELL_SIZE };
  }

  // 2 inches expressed in content pixels via the real-world scale, so the line stays 2 in
  // regardless of zoom (Konva scales the stroke with the stage's viewZoom).
  function gridLineWidth() { return LINE_WIDTH_FEET / scaleFeetPerPixel; }

  function buildLineNode(a, b) {
    const line = new Konva.Line({
      points: [a.x, a.y, b.x, b.y],
      stroke: "#1e1a14", strokeWidth: gridLineWidth(),
      lineCap: "round", lineJoin: "round",
      hitStrokeWidth: 12   // fat invisible hit area so a hairline-thin line is still easy to select/erase
    });
    line.setAttr("kind", "line");
    return line;
  }

  function onStagePointerDown(e) {
    if (!stageReady || activeMode === "pan") return;          // pan is handled by the host scroll pan
    const evt = e && e.evt;
    // Right-click or Ctrl(⌘)+click is a quick eraser on the painted grid, available from any tool.
    eraseGesture = !!(evt && (evt.button === 2 || evt.ctrlKey || evt.metaKey));
    if (evt && evt.button !== 0 && !eraseGesture) return;     // left button (or the erase gesture) draws; MMB pans
    if (activeMode === "rect") {
      // Rectangle tool: rubber-band a filled block of cells. Right-click/Ctrl erases the block instead.
      const cell = cellFromPointer();
      if (!cell) return;
      const id = eraseGesture ? null : activeMaterial;
      rectDraft = { c0: cell.c, r0: cell.r, id };
      const color = id ? (PALETTE_MAP[id]?.color || "#7cb342") : "#a4111f";
      rectGhost = new Konva.Rect({
        x: cell.c * CELL_SIZE, y: cell.r * CELL_SIZE, width: CELL_SIZE, height: CELL_SIZE,
        fill: color, opacity: id ? 0.5 : 0.18, stroke: color, strokeWidth: 1.5,
        dash: id ? null : [6, 4], listening: false
      });
      overlayLayer.add(rectGhost);
      overlayLayer.batchDraw();
      return;
    }
    if (eraseGesture || activeMode === "paint" || activeMode === "erase") {
      const cell = cellFromPointer();
      if (!cell) return;
      const id = (eraseGesture || activeMode === "erase") ? null : activeMaterial;
      recordUndoPoint();
      if (evt && evt.shiftKey && !eraseGesture) {
        // Shift: rubber-band a straight line, committed on release.
        lineDraft = { c0: cell.c, r0: cell.r, id };
        const a = cellCenter(cell.c, cell.r);
        lineGhost = new Konva.Line({
          points: [a.x, a.y, a.x, a.y],
          stroke: id ? (PALETTE_MAP[id]?.color || "#7cb342") : "#a4111f",
          strokeWidth: Math.max(2, brushSize * CELL_SIZE), opacity: 0.5,
          lineCap: "round", dash: id ? null : [6, 4], listening: false
        });
        overlayLayer.add(lineGhost);
        return;
      }
      painting = true; lastCell = cell;
      paintBrush(cell.c, cell.r, id);
      gridLayer.batchDraw();
      return;
    }
    if (activeMode === "fill") {
      const cell = cellFromPointer();
      if (!cell) return;
      recordUndoPoint();
      floodFill(cell.c, cell.r, activeMaterial, contentPos());
      gridLayer.batchDraw();
      scheduleAutosave();
      return;
    }
    const pos = contentPos();
    if (!pos) return;
    if (activeMode === "line") {
      const a = snapToGrid(pos);
      gridLineDraft = { x: a.x, y: a.y };
      gridLineGhost = new Konva.Line({
        points: [a.x, a.y, a.x, a.y],
        stroke: "#1e1a14", strokeWidth: gridLineWidth(),
        lineCap: "round", opacity: 0.55, listening: false
      });
      overlayLayer.add(gridLineGhost);
      overlayLayer.batchDraw();
      return;
    }
    if (activeMode === "callout") { startCallout(pos); return; }
    if (activeMode === "measure") {
      dragOrigin = pos;
      ghostNode = makeMeasureGhost(pos);
      overlayLayer.add(ghostNode);
    }
  }

  function onStagePointerMove() {
    if (!stageReady) return;
    if (rectDraft && rectGhost) {
      const cell = cellFromPointer();
      if (cell) {
        const cMin = Math.min(rectDraft.c0, cell.c), cMax = Math.max(rectDraft.c0, cell.c);
        const rMin = Math.min(rectDraft.r0, cell.r), rMax = Math.max(rectDraft.r0, cell.r);
        rectGhost.setAttrs({
          x: cMin * CELL_SIZE, y: rMin * CELL_SIZE,
          width: (cMax - cMin + 1) * CELL_SIZE, height: (rMax - rMin + 1) * CELL_SIZE
        });
        overlayLayer.batchDraw();
      }
      return;
    }
    if (lineDraft && lineGhost) {
      const cell = cellFromPointer();
      if (cell) {
        const a = cellCenter(lineDraft.c0, lineDraft.r0), b = cellCenter(cell.c, cell.r);
        lineGhost.points([a.x, a.y, b.x, b.y]);
        overlayLayer.batchDraw();
      }
      return;
    }
    if (gridLineDraft && gridLineGhost) {
      const p = contentPos();
      if (p) {
        const b = snapToGrid(p);
        gridLineGhost.points([gridLineDraft.x, gridLineDraft.y, b.x, b.y]);
        overlayLayer.batchDraw();
      }
      return;
    }
    if (painting) {
      const cell = cellFromPointer();
      if (cell && (!lastCell || cell.c !== lastCell.c || cell.r !== lastCell.r)) {
        const id = (eraseGesture || activeMode === "erase") ? null : activeMaterial;
        paintStroke(lastCell.c, lastCell.r, cell.c, cell.r, id);
        lastCell = cell;
        gridLayer.batchDraw();
      }
      return;
    }
    const pos = contentPos();
    if (!pos) return;
    if (dragOrigin && ghostNode) { ghostNode.points([dragOrigin.x, dragOrigin.y, pos.x, pos.y]); overlayLayer.batchDraw(); return; }
    if (calloutDraft) { updateCalloutGhost(pos); }
  }

  function onStagePointerUp() {
    if (!stageReady) return;
    if (rectDraft) {
      const cell = cellFromPointer();
      if (cell) {
        recordUndoPoint();
        fillRect(rectDraft.c0, rectDraft.r0, cell.c, cell.r, rectDraft.id);
        gridLayer.batchDraw();
        scheduleAutosave();
      }
      if (rectGhost) { rectGhost.destroy(); rectGhost = null; }
      rectDraft = null; eraseGesture = false;
      overlayLayer.batchDraw();
      return;
    }
    if (lineDraft) {
      const cell = cellFromPointer();
      if (cell) paintStroke(lineDraft.c0, lineDraft.r0, cell.c, cell.r, lineDraft.id);
      if (lineGhost) { lineGhost.destroy(); lineGhost = null; }
      lineDraft = null;
      gridLayer.batchDraw(); overlayLayer.batchDraw();
      scheduleAutosave();
      return;
    }
    if (gridLineDraft) {
      const p = contentPos();
      const b = p ? snapToGrid(p) : { x: gridLineDraft.x, y: gridLineDraft.y };
      const a = gridLineDraft; gridLineDraft = null;
      if (gridLineGhost) { gridLineGhost.destroy(); gridLineGhost = null; }
      overlayLayer.batchDraw();
      if (Math.hypot(b.x - a.x, b.y - a.y) >= CELL_SIZE / 2) { // ignore a click that never dragged to a new intersection
        const node = buildLineNode(a, b);
        recordUndoPoint();
        drawLayer.add(node);
        attachShapeInteractions(node);
        drawLayer.batchDraw();
        scheduleAutosave();
      }
      return;
    }
    if (painting) { painting = false; lastCell = null; eraseGesture = false; scheduleAutosave(); return; }
    if (dragOrigin && ghostNode) {
      const b = contentPos() || dragOrigin;
      ghostNode.destroy(); ghostNode = null;
      const a = dragOrigin; dragOrigin = null;
      overlayLayer.batchDraw();
      if (Math.hypot(b.x - a.x, b.y - a.y) >= CELL_SIZE) {
        const group = buildMeasurementGroup(a, b);
        recordUndoPoint();
        drawLayer.add(group);
        attachShapeInteractions(group);
        drawLayer.batchDraw();
        scheduleAutosave();
      }
      return;
    }
    if (calloutDraft) commitCallout(contentPos());
  }

  /* --- Clear / parcel rebuild / print export --- */
  function clearPlot() {
    if (!plotUsed()) return;
    if (!confirm("Clear your drawn site plan? This can't be undone.")) return;
    recordUndoPoint();
    clearSelection();
    cellState = new Map();
    repaintAllCells();
    gridLayer.batchDraw();
    drawLayer.destroyChildren();
    drawLayer.batchDraw();
    scheduleAutosave();
  }

  function plotUsed() {
    return !!((cellState && cellState.size > 0) || (drawLayer && drawLayer.getChildren().length > 0));
  }

  function rebuildGridForParcel(feature, bearing) {
    const ring = feature.geometry.coordinates[0];
    const parcelChanged = selectedAPN !== lastPlotAPN || bearing !== lastPlotBearing;
    // Re-entering the Draw step with the same parcel/orientation must NOT wipe the drawing —
    // just make the stage match the (now-visible) host and recenter.
    if (!parcelChanged && stageReady && paintCanvas) {
      fitView();
      return;
    }
    const result = buildParcelGrid(ring, bearing);
    if (plotUsed() && parcelChanged) {
      if (!confirm("Changing the parcel or orientation will clear your drawn site plan. Continue?")) return;
    }
    gridCols = result.cols;
    gridRows = result.rows;
    parcelPolygonPx = result.polygonPx;
    scaleFeetPerPixel = (result.metersPerCell * 3.28084) / CELL_SIZE;
    lastPlotAPN = selectedAPN;
    lastPlotBearing = bearing;
    if (!stageReady) initPlotStage();
    if (stageReady) {
      makeGridCanvases(gridCols, gridRows);
      gridLinesNode.image(gridLinesCanvas); gridLinesNode.position({ x: 0, y: 0 });
      gridImageNode.image(paintCanvas); gridImageNode.position({ x: 0, y: 0 });
      cellState = new Map();
      clearSelection();
      rebuildBgLayer();
      drawLayer.destroyChildren();
      drawLayer.batchDraw();
      gridLayer.batchDraw();
      fitView();
      undoStack = []; redoStack = [];
      updateUndoRedoButtons();
    }
    updateProgress();
  }

  // Renders the plan (painted grid + parcel outline + callouts/measurements) to a PNG for
  // the preview modal / print output. Built on a throwaway offscreen Stage at full content
  // resolution (never the live, pan/zoomed one), so the current view and any in-progress
  // ghost shapes on overlayLayer can't affect the output.
  function renderPlotImage() {
    if (!KONVA_AVAILABLE) return "";
    const w = gridCols * CELL_SIZE, h = gridRows * CELL_SIZE;
    const exportStage = new Konva.Stage({ container: document.createElement("div"), width: w, height: h });
    const layer = new Konva.Layer();
    exportStage.add(layer);
    layer.add(new Konva.Rect({ x: 0, y: 0, width: w, height: h, fill: "#fff" }));
    if (gridLinesCanvas) layer.add(new Konva.Image({ image: gridLinesCanvas, x: 0, y: 0 }));
    if (paintCanvas) {
      // Occlude paint outside the footprint in print/preview too (same clip as the live stage).
      const clip = new Konva.Group({ clipFunc: clipToParcel });
      clip.add(new Konva.Image({ image: paintCanvas, x: 0, y: 0 }));
      layer.add(clip);
    }
    if (parcelPolygonPx && parcelPolygonPx.length) {
      layer.add(new Konva.Line({
        points: parcelPolygonPx.flatMap(p => [p.x, p.y]),
        closed: true, stroke: "#a4111f", strokeWidth: 2, dash: [6, 3]
      }));
    }
    const shapes = drawLayer ? (JSON.parse(drawLayer.toJSON()).children || []) : [];
    shapes.forEach(obj => {
      try { layer.add(Konva.Node.create(obj)); } catch (e) { /* skip a shape that fails to reconstruct */ }
    });
    layer.draw();
    const dataUrl = exportStage.toDataURL({ pixelRatio: 2, mimeType: "image/png" });
    exportStage.destroy();
    return dataUrl;
  }

  buildPalette();
  buildToolbar();
  initPlotStage();
  setActiveMode("paint");
  $("#plot-clear").addEventListener("click", clearPlot);
  $("#plot-undo").addEventListener("click", undo);
  $("#plot-redo").addEventListener("click", redo);
  $("#plot-use-upload")?.addEventListener("click", () => setPlanMode("upload"));
  const brushInput = $("#brush-size");
  if (brushInput) {
    const brushOut = $("#brush-size-val");
    const syncBrush = () => {
      brushSize = Math.max(1, parseInt(brushInput.value, 10) || 1);
      if (brushOut) brushOut.textContent = brushSize + " ft";
    };
    brushInput.addEventListener("input", syncBrush);
    syncBrush();
  }
  $("#plot-zoom-in")?.addEventListener("click", () => zoomButton(1.25));
  $("#plot-zoom-out")?.addEventListener("click", () => zoomButton(1 / 1.25));
  $("#plot-zoom-reset")?.addEventListener("click", fitView);
  updateUndoRedoButtons();

  /* ------------------------------------------------------
     MAP REFERENCE (MapLibre GL JS + OpenFreeMap + County Parcels)
  ------------------------------------------------------ */
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
  const PARCEL_RADIUS = 0.003; // ~300m bounding box around the address

  let mapInstance = null;
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
      attributionControl: true,
      // maplibre-gl 5.x nests this under canvasContextAttributes (not a top-level option) —
      // needed so map.getCanvas().toDataURL() (the Draw step's backdrop snapshot) isn't blank.
      canvasContextAttributes: { preserveDrawingBuffer: true }
    });

    mapInstance.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }), "top-right");

    // Drag-to-rotate (Orient step only). Native dragPan/dragRotate are turned off in step 3,
    // so this is the sole drag gesture there: press on the map and move left/right to spin the
    // view around its center. Bound once; guarded on currentStep so it stays inert in step 2.
    const ROTATE_DEG_PER_PX = 0.5;
    const dragCanvas = mapInstance.getCanvasContainer();
    let dragRotating = false, dragStartX = 0, dragStartBearing = 0;
    dragCanvas.addEventListener("mousedown", (e) => {
      if (currentStep !== 3 || e.button !== 0) return;
      dragRotating = true;
      dragStartX = e.clientX;
      dragStartBearing = mapInstance.getBearing();
      dragCanvas.style.cursor = "grabbing";
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragRotating) return;
      const dx = e.clientX - dragStartX;
      setRotation(dragStartBearing + dx * ROTATE_DEG_PER_PX);
    });
    window.addEventListener("mouseup", () => {
      if (!dragRotating) return;
      dragRotating = false;
      dragCanvas.style.cursor = "";
    });

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
            return;
          }
          selectedParcelGeoJSON = feature;
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

  let selectedAPN = null;
  let selectedPopup = null; // the "Selected parcel" map callout, dismissed on Orient
  let pendingParcels = null; // queued GeoJSON if map isn't loaded yet
  let mapStyleLoaded = false;
  let autoAlignedForParcel = false; // true once auto-align has run for the currently selected parcel
  let step2ViewInitialized = false; // true once Select has been shown once (locks in its one-time default view)
  let step3ViewInitialized = false; // true once Orient has been shown once (locks in its one-time default view)

  async function fetchParcelGeometryByAPN(apn) {
    try {
      const params = new URLSearchParams({
        where: "APN='" + apn + "'",
        outSR: "4326",
        outFields: "APN",
        f: "geojson",
        returnGeometry: "true"
      });
      const res = await fetch(PARCEL_URL + "?" + params);
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
      const res = await fetch(PARCEL_URL + "?" + params);
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
          const addrRes = await fetch(ASSESSOR_TABLE_URL + "?" + addrParams);
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
      const addrRes = await fetch(ASSESSOR_TABLE_URL + "?" + addrParams);
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
        mapStatus.textContent = "Found APN " + apn + " but could not load its parcel geometry.";
        mapStatus.className = "map-reference__status err";
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
    }
  }

  /* --- WIZARD STEP NAVIGATION --- */
  let currentStep = 1;
  const stepDots = $$(".plot-steps-nav__dot");
  const mapContainer = $("#map-container");

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

  function showStep(n) {
    // Snapshot the oriented map BEFORE its pane goes display:none below — a hidden
    // canvas can't be captured (toDataURL comes back solid black once painting stops).
    if (n === 4 && currentStep === 3 && mapInstance && selectedParcelGeoJSON) {
      try {
        // Force a synchronous render so the captured framebuffer matches the exact camera
        // transform project() reads below — otherwise a pending (rAF-deferred) repaint can
        // leave the JPEG a frame behind the transform, offsetting the aerial from the ring.
        if (typeof mapInstance.redraw === "function") mapInstance.redraw();
        const canvas = mapInstance.getCanvas();
        plotBgDataUrl = canvas.toDataURL("image/jpeg", 0.9);
        // Record where the parcel's corners land in the SNAPSHOT's own pixel grid.
        // project() returns CSS pixels; the toDataURL bitmap is device pixels, so
        // scale by the canvas's device-pixel ratio. rebuildBgLayer uses this to place
        // the aerial so its parcel lines up exactly with the drawn outline — otherwise
        // a blind cover-fit renders the lot/house at the wrong (roughly half) scale.
        const dpr = canvas.width / canvas.clientWidth;
        const ring = selectedParcelGeoJSON.geometry.coordinates[0];
        plotBgParcelPx = ring.map(([lng, lat]) => {
          const p = mapInstance.project([lng, lat]);
          return { x: p.x * dpr, y: p.y * dpr };
        });
      } catch (e) { plotBgDataUrl = null; plotBgParcelPx = null; }
    }
    currentStep = n;
    $$(".plot-step").forEach(el => el.classList.toggle("is-active", +el.dataset.step === n));
    stepDots.forEach(dot => {
      const s = +dot.dataset.goto;
      dot.classList.toggle("is-active", s === n);
      dot.classList.toggle("is-done", s < n);
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

    // Step 2→3: just frame the selected parcel. Auto-align / front-yard-down logic is
    // removed — the user orients by dragging the map to rotate (see the drag-to-rotate
    // handler in initMap). The current bearing is preserved across the fit, so returning
    // to Orient keeps whatever rotation the user already dialed in.
    if (n === 3 && selectedParcelGeoJSON && mapInstance) {
      const ring = selectedParcelGeoJSON.geometry.coordinates[0];
      const bounds = ring.reduce(
        (b, [lng, lat]) => { b[0][0] = Math.min(b[0][0], lng); b[0][1] = Math.min(b[0][1], lat); b[1][0] = Math.max(b[1][0], lng); b[1][1] = Math.max(b[1][1], lat); return b; },
        [[Infinity, Infinity], [-Infinity, -Infinity]]
      );
      setTimeout(() => {
        mapInstance.resize();
        mapInstance.fitBounds(bounds, { padding: 40, duration: 600 });
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
    }

    // Step 3→4 transition: rebuild grid from parcel (backdrop was already snapshotted above)
    if (n === 4 && selectedParcelGeoJSON) {
      rebuildGridForParcel(selectedParcelGeoJSON, parcelBearing);
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
  let planMode = null; // "build" | "upload"
  const planChoiceCards = $$(".plan-choice__card");
  const planUploadPanel = $("#plan-upload");
  const planChoiceMsg = $("#plan-choice-msg");
  const plotUploadInput = $("#plot-upload");
  const plotUploadList = $("#plot-upload-list");
  const buildOnlyDots = stepDots.filter(d => +d.dataset.goto > 1);

  function setPlanMode(mode) {
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
    const address = $("#property-address").value.trim();
    if (!address) {
      planChoiceMsg.textContent = "Enter your property address in Applicant Information above so we can locate your parcel.";
      planChoiceMsg.className = "plot-choice-msg err";
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

  function setRotation(deg, opts) {
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
  //   const apply = () => setRotation(computeAutoAlignBearing(selectedParcelGeoJSON.geometry.coordinates[0]), { animate: true });
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

  // Street/satellite imagery toggle — lets the user spot the roofline/driveway to judge orientation
  function setSatelliteView(on) {
    if (!mapInstance || !mapReady) return;
    mapInstance.getStyle().layers.forEach(({ id }) => {
      if (id === "satellite-layer" || id.startsWith("parcel-")) return;
      mapInstance.setLayoutProperty(id, "visibility", on ? "none" : "visible");
    });
    mapInstance.setLayoutProperty("satellite-layer", "visibility", on ? "visible" : "none");
    $("#view-street").classList.toggle("is-active", !on);
    $("#view-satellite").classList.toggle("is-active", on);
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

  /* ------------------------------------------------------
     NEIGHBORS
  ------------------------------------------------------ */
  const neighborList = $("#neighbor-list");
  let neighborCount = 0;

  function neighborTemplate(n) {
    const idx = n;
    return `
      <div class="neighbor" data-neighbor="${idx}">
        <button type="button" class="neighbor__remove" aria-label="Remove neighbor" title="Remove">&times;</button>
        <div class="neighbor__num">Adjacent owner ${idx}</div>
        <div class="grid-2">
          <div class="field">
            <label>Name</label>
            <input type="text" name="nb_name_${idx}" />
          </div>
          <div class="field">
            <label>Address</label>
            <input type="text" name="nb_addr_${idx}" />
          </div>
        </div>
      </div>`;
  }

  function addNeighbor() {
    neighborCount++;
    const wrap = document.createElement("div");
    wrap.innerHTML = neighborTemplate(neighborCount).trim();
    const node = wrap.firstChild;
    neighborList.appendChild(node);
    $(".neighbor__remove", node).addEventListener("click", () => node.remove());
    return node;
  }
  $("#add-neighbor").addEventListener("click", () => addNeighbor());
  // start with two neighbor blocks
  addNeighbor(); addNeighbor();

  // Signature form: print a physical form, then re-attach the signed copy
  const neighborFormInput = $("#neighbor-form-file");
  const neighborFileList = $("#neighbor-filelist");
  $("#print-neighbor-form").addEventListener("click", () => printNeighborForm());
  neighborFormInput.addEventListener("change", () => {
    neighborFileList.innerHTML = "";
    if (!neighborFormInput.files.length) { neighborFileList.hidden = true; return; }
    neighborFileList.hidden = false;
    Array.from(neighborFormInput.files).forEach(f => {
      const li = document.createElement("li");
      li.textContent = `${f.name} (${Math.round(f.size / 1024)} KB)`;
      neighborFileList.appendChild(li);
    });
  });

  /* ------------------------------------------------------
     ACKNOWLEDGMENTS
  ------------------------------------------------------ */
  const acksEl = $("#acks");
  ACKS.forEach((text, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<label>
        <input type="checkbox" name="ack_${i + 1}" required />
        <span class="ack-text">${text}</span>
      </label>`;
    acksEl.appendChild(li);
  });

  /* ------------------------------------------------------
     REVIEW DATES TABLE
  ------------------------------------------------------ */
  const datesBody = $("#dates-body");
  DATES.forEach(([meeting, deadline]) => {
    const tr = document.createElement("tr");
    if (meeting.includes("tentative")) tr.className = "tentative";
    tr.innerHTML = `<td>${meeting}</td><td>${deadline}</td>`;
    datesBody.appendChild(tr);
  });

  /* ------------------------------------------------------
     SCROLL-SPY NAV  +  REVEAL
  ------------------------------------------------------ */
  const navLinks = $$(".sidenav nav a");
  const sections = navLinks.map(a => $(a.getAttribute("href"))).filter(Boolean);
  const spy = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        navLinks.forEach(a => a.classList.toggle("is-active", a.getAttribute("href") === "#" + en.target.id));
      }
    });
  }, { rootMargin: "-30% 0px -60% 0px" });
  sections.forEach(s => spy.observe(s));

  const revealer = new IntersectionObserver((entries, obs) => {
    entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add("in"); obs.unobserve(en.target); } });
  }, { threshold: 0.08 });
  $$(".reveal").forEach(el => revealer.observe(el));

  /* ------------------------------------------------------
     CHAR COUNTER
  ------------------------------------------------------ */
  const proposal = $("#proposal");
  const proposalCount = $("#proposal-count");
  proposal.addEventListener("input", () => { proposalCount.textContent = proposal.value.length; });

  /* ------------------------------------------------------
     PHOTOS — questionnaire-driven, per-photo requests
  ------------------------------------------------------ */
  // Each selected area unlocks a group of specific photo requests.
  const PHOTO_SPECS = {
    front: {
      label: "Front yard",
      shots: [
        { id: "front_street", title: "From the center of the street",
          instr: "Stand safely in the middle of the street and capture the full front of your property, property line to property line. No vehicles or people in the frame.",
          good: "Whole front yard, taken straight on from the street.",
          bad: "Too close, sharply angled, or with a car blocking the yard." },
        { id: "front_left", title: "From the left curb",
          instr: "From the curb at the left edge of your yard, capture the home and yard looking across the front.",
          good: "Yard and house visible from the left corner.",
          bad: "Only a slice of the yard, or shot from the porch." },
        { id: "front_right", title: "From the right curb",
          instr: "From the curb at the right edge of your yard, capture the home and yard looking across the front.",
          good: "Yard and house visible from the right corner.",
          bad: "Only a slice of the yard, or shot from the porch." }
      ]
    },
    back: {
      label: "Back yard",
      shots: [
        { id: "back_full", title: "Full yard from the farthest point",
          instr: "Stand at the point farthest from the house and capture the entire back yard in one frame.",
          good: "Entire back yard, fence to fence, in one shot.",
          bad: "Standing near the house so half the yard is cut off." },
        { id: "back_left", title: "From the left side",
          instr: "From the left side of the yard, capture the entire space, property line to property line.",
          good: "Full left-to-right view of the yard.",
          bad: "Zoomed in on a single corner." },
        { id: "back_right", title: "From the right side",
          instr: "From the right side of the yard, capture the entire space, property line to property line.",
          good: "Full right-to-left view of the yard.",
          bad: "Zoomed in on a single corner." },
        { id: "back_closeup", title: "Close-up of the work area",
          instr: "A closer photo of the exact spot where the change will go, so existing conditions are clear.",
          good: "Clear view of precisely where the change will be made.",
          bad: "A wide shot where the spot can't be identified." }
      ]
    },
    side: {
      label: "Side yard",
      shots: [
        { id: "side_full", title: "Full length of the side yard",
          instr: "Capture the full length of the affected side yard, fence line to fence line. Take one for each side if both are affected.",
          good: "Whole side-yard run, visible end to end.",
          bad: "A single fence panel or a cropped section." }
      ]
    },
    exterior: {
      label: "Home exterior",
      shots: [
        { id: "ext_elevation", title: "Affected wall or elevation",
          instr: "Photograph the wall, roof section, or elevation of the home that the change affects, straight on and evenly lit.",
          good: "The full affected face of the home, evenly lit.",
          bad: "Sharp angle, deep shadow, or only part of the wall." }
      ]
    }
  };
  const PHOTO_MATERIAL = {
    id: "material_sample", title: "Paint color / material sample",
    instr: "Photograph the manufacturer's color chip or material sample, clearly showing the printed name and code.",
    good: "Sample with the name/code legible.",
    bad: "Blurry chip, or a screen photo without the code."
  };
  // id -> human label, for preview/print summaries
  const PHOTO_TITLE = {};
  Object.values(PHOTO_SPECS).forEach(spec => spec.shots.forEach(s => { PHOTO_TITLE[s.id] = spec.label + " — " + s.title; }));
  PHOTO_TITLE[PHOTO_MATERIAL.id] = PHOTO_MATERIAL.title;
  function photoTitle(id) { return PHOTO_TITLE[id] || id; }

  const photoRequestsEl = $("#photo-requests");
  const photoEmptyEl = $("#photo-empty");

  function photoRequestBlock(shot) {
    const block = document.createElement("div");
    block.className = "photo-request";
    block.dataset.photoId = shot.id;
    block.innerHTML = `
      <div class="photo-request__head">
        <h4 class="photo-request__title">${shot.title}</h4>
        <p class="photo-request__instr">${shot.instr}</p>
      </div>
      <div class="photo-examples" aria-hidden="true">
        <figure class="photo-example photo-example--good">
          <div class="photo-example__frame"><span class="photo-example__ph">Example image</span></div>
          <figcaption><span class="photo-example__tag photo-example__tag--good">&#10003; Do this</span>${shot.good}</figcaption>
        </figure>
        <figure class="photo-example photo-example--bad">
          <div class="photo-example__frame"><span class="photo-example__ph">Example image</span></div>
          <figcaption><span class="photo-example__tag photo-example__tag--bad">&#10007; Not this</span>${shot.bad}</figcaption>
        </figure>
      </div>
      <div class="photo-request__upload">
        <label class="btn btn--ghost btn--sm" for="photo-${shot.id}">Attach this photo</label>
        <input type="file" id="photo-${shot.id}" name="photo_${shot.id}" data-photo-input="${shot.id}" accept="image/*" hidden />
        <span class="photo-request__status" data-photo-status="${shot.id}">No photo attached yet.</span>
      </div>`;
    return block;
  }

  function photoGroup(area, title, shots) {
    const group = document.createElement("div");
    group.className = "photo-group";
    group.dataset.area = area;
    group.hidden = true;
    const h = document.createElement("h3");
    h.className = "photo-group__title";
    h.textContent = title;
    group.appendChild(h);
    shots.forEach(shot => group.appendChild(photoRequestBlock(shot)));
    return group;
  }

  function buildPhotoRequests() {
    photoRequestsEl.innerHTML = "";
    Object.entries(PHOTO_SPECS).forEach(([area, spec]) => {
      photoRequestsEl.appendChild(photoGroup(area, spec.label + " photos", spec.shots));
    });
    photoRequestsEl.appendChild(photoGroup("material", "Color / material sample", [PHOTO_MATERIAL]));
    $$("[data-photo-input]", photoRequestsEl).forEach(input => {
      input.addEventListener("change", () => updatePhotoStatus(input.dataset.photoInput));
    });
  }

  function updatePhotoStatus(id) {
    const input = $(`[data-photo-input="${id}"]`, photoRequestsEl);
    const statusEl = $(`[data-photo-status="${id}"]`, photoRequestsEl);
    if (!input || !statusEl) return;
    const block = input.closest(".photo-request");
    statusEl.classList.remove("is-prior");
    if (input.files && input.files.length) {
      const f = input.files[0];
      statusEl.textContent = `Attached: ${f.name} (${Math.round(f.size / 1024)} KB)`;
      statusEl.classList.add("is-attached");
      block && block.classList.add("is-attached");
    } else {
      statusEl.textContent = "No photo attached yet.";
      statusEl.classList.remove("is-attached");
      block && block.classList.remove("is-attached");
    }
  }

  function selectedPhotoAreas() {
    return $$(".photo-quiz [data-area]").filter(c => c.checked).map(c => c.dataset.area);
  }
  function selectedPhotoMaterial() {
    const r = $(".photo-quiz [name=photoMaterial]:checked");
    return r ? r.value : null;
  }

  function refreshPhotoGroups() {
    const areas = selectedPhotoAreas();
    const wantsMaterial = selectedPhotoMaterial() === "yes";
    let anyShown = false;
    $$(".photo-group", photoRequestsEl).forEach(group => {
      const a = group.dataset.area;
      const show = a === "material" ? wantsMaterial : areas.includes(a);
      group.hidden = !show;
      if (show) anyShown = true;
    });
    photoRequestsEl.hidden = !anyShown;
    photoEmptyEl.hidden = anyShown;
  }

  buildPhotoRequests();
  $$(".photo-quiz input").forEach(inp => inp.addEventListener("change", refreshPhotoGroups));
  refreshPhotoGroups();

  /* ------------------------------------------------------
     PROGRESS METER
  ------------------------------------------------------ */
  const form = $("#arc-form");
  function updateProgress() {
    const required = $$("#arc-form [required]");
    let done = 0;
    required.forEach(el => {
      if (el.type === "checkbox") { if (el.checked) done++; }
      else if (el.value && el.value.trim()) done++;
    });
    // count the ack signature as required-ish
    let total = required.length + 1;
    if (!sigPads.ownerAckSignature.isEmpty()) done++;
    const pct = Math.round((done / total) * 100);
    $("#progress-fill").style.width = pct + "%";
    $("#progress-text").textContent = pct + "% complete";
    refreshPacketUI();
  }
  form.addEventListener("input", updateProgress);
  form.addEventListener("change", updateProgress);
  // also refresh after signing
  ["pointerup"].forEach(ev => document.addEventListener(ev, () => setTimeout(updateProgress, 50)));

  /* ------------------------------------------------------
     PACKET STATUS
     One source of truth for "what's in the packet": the plot
     plan, every requested photo, the signed neighbor form, and
     the sketches attestation. Feeds the Section 06 live rows,
     the Review & Submit packet list, the email soft-gate, and
     the mailto attachment manifest.
  ------------------------------------------------------ */
  let pdfSaved = false; // flips once the print/save-PDF view is opened this session

  function plotProvided() {
    const names = plotUploadInput.files ? Array.from(plotUploadInput.files).map(f => f.name) : [];
    if (planMode === "upload") return { mode: "upload", ok: names.length > 0, names };
    return { mode: "build", ok: plotUsed(), names: [] };
  }

  // Every photo the questionnaire currently requests, with the attached filename (or null)
  function photoChecklist() {
    const rows = [];
    selectedPhotoAreas().forEach(area => {
      const spec = PHOTO_SPECS[area];
      if (spec) spec.shots.forEach(s => rows.push({ id: s.id, title: spec.label + " — " + s.title }));
    });
    if (selectedPhotoMaterial() === "yes") rows.push({ id: PHOTO_MATERIAL.id, title: PHOTO_MATERIAL.title });
    rows.forEach(r => {
      const input = $(`[data-photo-input="${r.id}"]`, photoRequestsEl);
      r.file = (input && input.files && input.files.length) ? input.files[0].name : null;
    });
    return rows;
  }

  function neighborFormFiles() {
    return neighborFormInput.files ? Array.from(neighborFormInput.files).map(f => f.name) : [];
  }

  function sketchesConfirmed() {
    const c = $("#submissions [name=req_sketches]");
    return !!(c && c.checked);
  }

  // Human-readable list of what's still missing, for the soft-gate modal and
  // the mailto manifest. includePdf: whether the not-yet-saved form PDF counts
  // (the gate cares; the email body lists the PDF in the attach checklist anyway).
  function packetMissingList(includePdf) {
    const missing = [];
    if (includePdf && !pdfSaved) missing.push("The application form PDF — save it in Step 1 first");
    const plot = plotProvided();
    if (!plot.ok) missing.push(plot.mode === "upload"
      ? "Plot plan file (upload chosen, but nothing attached in Section 02)"
      : "Plot plan (nothing drawn yet in Section 02)");
    const photos = photoChecklist();
    if (!photos.length) missing.push("Property photos — the questionnaire in Section 05 hasn't been answered");
    else photos.filter(p => !p.file).forEach(p => missing.push("Photo — " + p.title));
    if (!neighborFormFiles().length) missing.push("Signed neighbor signature form (Section 04)");
    if (!sketchesConfirmed()) missing.push("Sketches, dimensions & material examples (confirm in Section 06)");
    return missing;
  }

  /* ----- packet list rendering (Review & Submit card) ----- */
  const packetListEl = $("#packet-list");

  function packetItemNode(item) {
    const li = document.createElement("li");
    li.className = "packet-item" + (item.ok ? " is-ok" : "");
    const icon = document.createElement("span");
    icon.className = "packet-item__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = item.ok ? "✓" : "✗";
    li.appendChild(icon);
    const body = document.createElement("div");
    body.className = "packet-item__body";
    const label = document.createElement("strong");
    label.textContent = item.label;
    body.appendChild(label);
    if (item.note) {
      const note = document.createElement("span");
      note.className = "packet-item__note";
      note.textContent = item.note;
      body.appendChild(note);
    }
    if (item.subs) {
      const ul = document.createElement("ul");
      ul.className = "packet-sublist";
      item.subs.forEach(s => {
        const sli = document.createElement("li");
        sli.className = "packet-sub" + (s.ok ? " is-ok" : "");
        const si = document.createElement("span");
        si.className = "packet-sub__icon";
        si.setAttribute("aria-hidden", "true");
        si.textContent = s.ok ? "✓" : "✗";
        sli.appendChild(si);
        const st = document.createElement("span");
        st.textContent = s.label + (s.note ? " — " + s.note : "");
        sli.appendChild(st);
        ul.appendChild(sli);
      });
      body.appendChild(ul);
    }
    li.appendChild(body);
    if (item.href && !item.ok) {
      const a = document.createElement("a");
      a.className = "packet-item__link";
      a.href = item.href;
      a.textContent = "Open section";
      li.appendChild(a);
    }
    return li;
  }

  function renderPacket() {
    if (!packetListEl) return;
    const plot = plotProvided();
    const photos = photoChecklist();
    const nf = neighborFormFiles();
    const items = [];
    items.push({
      label: "Application form (PDF)",
      ok: pdfSaved,
      note: pdfSaved
        ? "Saved this session — attach the PDF file to your email."
        : "Not saved yet — Step 1 below creates it."
    });
    if (plot.mode === "upload") {
      items.push({
        label: "Plot plan (uploaded)",
        ok: plot.ok,
        note: plot.ok
          ? plot.names.join(", ") + " — attach this file to your email."
          : "Upload chosen, but no file attached yet.",
        href: "#siteplan"
      });
    } else {
      items.push({
        label: "Plot plan (drawn)",
        ok: plot.ok,
        note: plot.ok
          ? "Included automatically in the form PDF — nothing extra to attach."
          : "Nothing drawn yet.",
        href: "#siteplan"
      });
    }
    if (!photos.length) {
      items.push({
        label: "Property photos",
        ok: false,
        note: "Answer the questionnaire in Section 05 to see which photos are needed.",
        href: "#photos-section"
      });
    } else {
      const attached = photos.filter(p => p.file).length;
      items.push({
        label: `Property photos — ${attached} of ${photos.length} attached`,
        ok: attached === photos.length,
        note: "Attach each photo file to your email.",
        href: "#photos-section",
        subs: photos.map(p => ({ label: p.title, ok: !!p.file, note: p.file }))
      });
    }
    items.push({
      label: "Signed neighbor signature form",
      ok: nf.length > 0,
      note: nf.length
        ? nf.join(", ") + " — attach to your email."
        : "Print it in Section 04, collect signatures, then attach the scan.",
      href: "#neighbors"
    });
    items.push({
      label: "Sketches, dimensions & materials",
      ok: sketchesConfirmed(),
      note: sketchesConfirmed()
        ? "Confirmed — attach your files to the email."
        : "Gather your files, then confirm in Section 06.",
      href: "#submissions"
    });
    packetListEl.textContent = "";
    items.forEach(item => packetListEl.appendChild(packetItemNode(item)));
  }

  /* ----- Section 06 live rows ----- */
  function setReqRow(key, ok, note) {
    const row = $(`.reqstat[data-req="${key}"]`);
    if (!row) return;
    row.classList.toggle("is-ok", ok);
    const noteEl = $("[data-req-note]", row);
    if (noteEl) noteEl.textContent = note;
  }

  function refreshRequirementRows() {
    const plot = plotProvided();
    setReqRow("plot", plot.ok, plot.mode === "upload"
      ? (plot.ok ? "Uploaded: " + plot.names.join(", ") : "Upload chosen — no file attached yet.")
      : (plot.ok ? "Drawn with the plot tool — included in your application PDF." : "Not provided yet — build or upload it in Section 02."));
    const photos = photoChecklist();
    setReqRow("photos",
      photos.length > 0 && photos.every(p => p.file),
      photos.length
        ? `${photos.filter(p => p.file).length} of ${photos.length} requested photos attached.`
        : "Answer the questionnaire in Section 05 to see which photos are needed.");
    const nf = neighborFormFiles();
    setReqRow("neighbors", nf.length > 0,
      nf.length ? "Signed form attached: " + nf.join(", ") : "Not attached yet.");
  }

  function refreshFinishSteps() {
    const s1 = $("#finish-step-1");
    if (s1) s1.classList.toggle("is-done", pdfSaved);
  }

  function refreshPacketUI() {
    renderPacket();
    refreshRequirementRows();
    refreshFinishSteps();
  }

  /* ------------------------------------------------------
     COLLECT DATA
  ------------------------------------------------------ */
  function collect() {
    const data = {
      ownerName: $("#owner-name").value.trim(),
      propertyAddress: $("#property-address").value.trim(),
      ownerPhone: $("#owner-phone").value.trim(),
      ownerEmail: $("#owner-email").value.trim(),
      submissions: {},
      proposal: proposal.value.trim(),
      neighbors: [],
      acks: {},
      ackDate: $("#ack-date").value,
      ownerAckSignature: sigPads.ownerAckSignature.toDataURL(),
      planMode: planMode,
      plot: {
        version: 3,
        cell: CELL_SIZE,
        cols: gridCols, rows: gridRows,
        cells: cellState ? [...cellState] : [],
        annotations: (drawLayer ? JSON.parse(drawLayer.toJSON()).children : []) || []
      },
      plotMeta: {
        cols: gridCols, rows: gridRows,
        apn: selectedAPN, bearing: parcelBearing,
        parcelCoords: selectedParcelGeoJSON?.geometry?.coordinates || null
      },
      plotUpload: plotUploadInput.files ? Array.from(plotUploadInput.files).map(f => f.name) : [],
      photoAreas: {},
      photoMaterial: selectedPhotoMaterial(),
      photos: {},
      files: [],
      neighborForm: neighborFormInput.files ? Array.from(neighborFormInput.files).map(f => f.name) : []
    };
    $$(".photo-quiz [data-area]").forEach(c => { data.photoAreas[c.dataset.area] = c.checked; });
    $$("[data-photo-input]", photoRequestsEl).forEach(input => {
      if (input.files && input.files.length) {
        data.photos[input.dataset.photoInput] = input.files[0].name;
        data.files.push(input.files[0].name);
      }
    });
    $$("#submissions input[type=checkbox]").forEach(c => data.submissions[c.name] = c.checked);
    // req_plot / req_photos / req_neighbors are derived from real app state,
    // not self-attestation checkboxes (those rows are live status in Section 06).
    data.submissions.req_plot = plotProvided().ok;
    const reqPhotos = photoChecklist();
    data.submissions.req_photos = reqPhotos.length > 0 && reqPhotos.every(p => p.file);
    data.submissions.req_neighbors = neighborFormFiles().length > 0;
    $$(".neighbor").forEach(node => {
      const idx = node.dataset.neighbor;
      data.neighbors.push({
        name: $(`[name=nb_name_${idx}]`, node)?.value.trim() || "",
        address: $(`[name=nb_addr_${idx}]`, node)?.value.trim() || ""
      });
    });
    $$("#acks input[type=checkbox]").forEach(c => data.acks[c.name] = c.checked);
    return data;
  }

  /* ------------------------------------------------------
     DRAFT PERSISTENCE
  ------------------------------------------------------ */
  function saveDraft(silent) {
    const d = collect();
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
      if (!silent) status("Draft saved in this browser.", "ok");
    } catch (e) {
      if (!silent) status("Could not save draft (storage full or blocked).", "err");
    }
  }

  function restoreDraft() {
    let raw, migratedFromLegacy = false;
    try { raw = localStorage.getItem(DRAFT_KEY); } catch (e) { return false; }
    if (!raw) {
      // No current draft yet — fall back to a pre-grid-painter draft once. Every field except
      // the plot drawing itself carries over losslessly; neither the old cell-grid nor the
      // Konva-vector drawing maps onto the new fixed-scale grid, so it's left to be redrawn
      // with a one-time notice instead of guessed at.
      for (const key of LEGACY_DRAFT_KEYS) {
        try { raw = localStorage.getItem(key); } catch (e) { raw = null; }
        if (raw) { migratedFromLegacy = true; break; }
      }
      if (!raw) return false;
    }
    let d;
    try { d = JSON.parse(raw); } catch (e) { return false; }
    if (migratedFromLegacy) d.plot = null; // old format — not convertible, don't try
    $("#owner-name").value = d.ownerName || "";
    $("#property-address").value = d.propertyAddress || "";
    $("#owner-phone").value = d.ownerPhone || "";
    $("#owner-email").value = d.ownerEmail || "";
    proposal.value = d.proposal || ""; proposalCount.textContent = proposal.value.length;
    $("#ack-date").value = d.ackDate || "";
    if (d.submissions) Object.entries(d.submissions).forEach(([k, v]) => { const el = $(`#submissions [name="${k}"]`); if (el) el.checked = v; });
    if (d.acks) Object.entries(d.acks).forEach(([k, v]) => { const el = $(`#acks [name="${k}"]`); if (el) el.checked = v; });
    // neighbors
    if (Array.isArray(d.neighbors) && d.neighbors.length) {
      neighborList.innerHTML = ""; neighborCount = 0;
      d.neighbors.forEach(nb => {
        const node = addNeighbor();
        const idx = node.dataset.neighbor;
        $(`[name=nb_name_${idx}]`, node).value = nb.name || "";
        $(`[name=nb_addr_${idx}]`, node).value = nb.address || "";
      });
    }
    // signatures
    setTimeout(() => {
      if (d.ownerAckSignature) sigPads.ownerAckSignature.fromDataURL(d.ownerAckSignature);
    }, 60);
    // Restore parcel-shaped grid if saved
    if (d.plotMeta && d.plotMeta.parcelCoords) {
      const fakeFeature = { geometry: { coordinates: d.plotMeta.parcelCoords } };
      parcelBearing = d.plotMeta.bearing || 0;
      selectedAPN = d.plotMeta.apn || null;
      rebuildGridForParcel(fakeFeature, parcelBearing);
      // Restore rotation panel
      setRotation(parcelBearing);
    }
    if (!migratedFromLegacy && d.plot && d.plot.version === 3 && stageReady) {
      loadCells(d.plot.cells);
      gridLayer.batchDraw();
      if (Array.isArray(d.plot.annotations)) {
        hydrateShapesInto(drawLayer, d.plot.annotations);
        drawLayer.batchDraw();
      }
      undoStack = []; redoStack = []; updateUndoRedoButtons();
    }
    if (d.planMode) setPlanMode(d.planMode);
    // photos questionnaire + prior attachments
    if (d.photoAreas) {
      Object.entries(d.photoAreas).forEach(([area, on]) => {
        const c = $(`.photo-quiz [data-area="${area}"]`);
        if (c) c.checked = !!on;
      });
    }
    if (d.photoMaterial) {
      const r = $(`.photo-quiz [name=photoMaterial][value="${d.photoMaterial}"]`);
      if (r) r.checked = true;
    }
    refreshPhotoGroups();
    if (d.photos) {
      Object.entries(d.photos).forEach(([id, name]) => {
        const statusEl = $(`[data-photo-status="${id}"]`, photoRequestsEl);
        if (statusEl && name) {
          statusEl.textContent = `Previously attached: ${name} — re-attach to include it again.`;
          statusEl.classList.add("is-prior");
          statusEl.classList.remove("is-attached");
        }
      });
    }
    if (migratedFromLegacy) {
      const notice = $("#plot-migration-notice");
      if (notice) notice.hidden = false;
      saveDraft(true); // persist the migrated fields under the new key so this only runs once
    }
    setTimeout(updateProgress, 200);
    status("Draft restored from your last session.", "ok");
    return true;
  }

  $("#save-draft").addEventListener("click", () => saveDraft(false));
  $("#clear-draft").addEventListener("click", () => {
    if (!confirm("Clear all fields and delete the saved draft?")) return;
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
    location.reload();
  });
  // autosave — also called directly from the Konva drawing tools' commit handlers,
  // since canvas gestures never fire the native "input" event this was originally
  // built around (form.addEventListener("input", ...) alone would silently miss
  // every shape drawn/edited/erased on the plot).
  let saveTimer;
  function scheduleAutosave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveDraft(true), 1200); }
  form.addEventListener("input", scheduleAutosave);

  /* ------------------------------------------------------
     VALIDATION + STATUS
  ------------------------------------------------------ */
  const statusEl = $("#form-status");
  function status(msg, kind) {
    statusEl.textContent = msg;
    statusEl.className = "form-status" + (kind ? " " + kind : "");
  }

  function clearFieldError(el) {
    el.classList.remove("invalid");
    const msg = el.parentElement.querySelector(".field__error");
    if (msg) msg.remove();
  }

  function setFieldError(el, message) {
    el.classList.add("invalid");
    let msg = el.parentElement.querySelector(".field__error");
    if (!msg) {
      msg = document.createElement("span");
      msg.className = "field__error";
      el.parentElement.appendChild(msg);
    }
    msg.textContent = message;
  }

  // US phone: at least 10 digits, with optional formatting
  const PHONE_RE = /^[\d\s().+-]{10,}$/;
  const PHONE_DIGITS_RE = /\d/g;
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$/;

  function validate() {
    let firstBad = null;
    $$("#arc-form [required]").forEach(el => {
      clearFieldError(el);
      let bad = false;
      let errorMsg = "This field is required.";

      if (el.type === "checkbox") {
        bad = !el.checked;
      } else {
        bad = !el.value || !el.value.trim();
      }

      // Email format check
      if (el.type === "email" && el.value && el.value.trim()) {
        if (!EMAIL_RE.test(el.value.trim())) {
          bad = true;
          errorMsg = "Please enter a valid email address.";
        }
      }

      // Phone format check
      if (el.type === "tel" && el.value && el.value.trim()) {
        const digits = (el.value.match(PHONE_DIGITS_RE) || []).length;
        if (digits < 10 || !PHONE_RE.test(el.value.trim())) {
          bad = true;
          errorMsg = "Please enter a valid phone number (at least 10 digits).";
        }
      }

      if (bad) {
        if (el.type !== "checkbox") setFieldError(el, errorMsg);
        else el.classList.add("invalid");
        if (!firstBad) firstBad = el;
      }
    });
    // signatures
    [["ownerAckSignature", "#acknowledgments"]].forEach(([k]) => {
      const empty = sigPads[k].isEmpty();
      sigPads[k].wrap.classList.toggle("invalid", empty);
      if (empty && !firstBad) firstBad = sigPads[k].wrap;
    });
    return firstBad;
  }

  // Validate and, on failure, paint the status line and scroll to the first bad
  // field. Shared by the preview, save-PDF, and email paths so they can't drift.
  function validateOrFocus() {
    const bad = validate();
    if (!bad) return true;
    status("Please complete the highlighted required fields and signatures.", "err");
    bad.scrollIntoView({ behavior: "smooth", block: "center" });
    if (bad.focus) bad.focus({ preventScroll: true });
    return false;
  }

  // Clear inline errors on input
  form.addEventListener("input", e => {
    if (e.target.matches("[required]")) clearFieldError(e.target);
  });

  /* ------------------------------------------------------
     PREVIEW + PRINT
  ------------------------------------------------------ */
  const modal = $("#preview-modal");
  const previewContent = $("#preview-content");

  const esc = s => (s == null ? "" : String(s)).replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
  const yn = b => b ? '<span class="yes">✓ Included</span>' : '<span class="no">— not checked</span>';
  const sigImg = url => url ? `<img class="sig-img" src="${url}" alt="signature" />` : '<span class="no">— not signed</span>';

  const SUB_LABELS = {
    req_plot: "Plot design with modification marked",
    req_sketches: "Sketches, dimensions, photos & materials",

    req_photos: "Property photos (Section 05)",
    req_neighbors: "Impacted neighbor signatures",
    req_fee: "Application fee"
  };

  function photoPreviewHTML(d) {
    const areas = Object.entries(d.photoAreas || {})
      .filter(([, v]) => v)
      .map(([k]) => PHOTO_SPECS[k] ? PHOTO_SPECS[k].label : k);
    const areaLine = areas.length
      ? `<p><strong>Areas affected:</strong> ${areas.map(esc).join(", ")}${d.photoMaterial === "yes" ? ", plus a new color/material sample" : ""}</p>`
      : '<p class="no">No areas selected — no photos requested.</p>';
    const attached = Object.entries(d.photos || {});
    const list = attached.length
      ? `<ul class="doc-list">${attached.map(([id, name]) => `<li>${esc(photoTitle(id))} — <span class="yes">✓ ${esc(name)}</span></li>`).join("")}</ul>`
      : (areas.length ? '<p class="no">No photos attached yet.</p>' : "");
    return areaLine + list;
  }

  function buildPreview(d) {
    // Submission items are derived/attested state, not checkboxes — "missing" reads better than "not checked"
    const subYn = b => b ? '<span class="yes">✓ Included</span>' : '<span class="no">— missing</span>';
    const subs = Object.entries(SUB_LABELS).map(([k, label]) =>
      `<li>${esc(label)} — ${subYn(d.submissions[k])}</li>`).join("");
    const acks = ACKS.map((_, i) => {
      const k = "ack_" + (i + 1);
      return `<li>Item ${i + 1} — ${yn(d.acks[k])}</li>`;
    }).join("");
    const neighbors = d.neighbors.map((nb, i) => `
      <div style="margin:.6rem 0; padding:.6rem .8rem; border:1px solid #e0d9cd; border-radius:8px;">
        <strong>Adjacent owner ${i + 1}</strong>
        <dl>
          <dt>Name</dt><dd>${esc(nb.name) || '<span class="no">—</span>'}</dd>
          <dt>Address</dt><dd>${esc(nb.address) || '<span class="no">—</span>'}</dd>
        </dl>
      </div>`).join("") || '<p class="no">No neighbors added.</p>';
    const neighborForm = d.neighborForm && d.neighborForm.length
      ? `<span class="yes">✓ Attached</span> — ${d.neighborForm.map(esc).join(", ")}`
      : '<span class="no">— signed form not attached</span>';

    return `
      <div class="doc">
        <h3>Applicant Information</h3>
        <dl>
          <dt>Homeowner(s)</dt><dd>${esc(d.ownerName) || '<span class="no">—</span>'}</dd>
          <dt>Property Address</dt><dd>${esc(d.propertyAddress) || '<span class="no">—</span>'}</dd>
          <dt>Phone</dt><dd>${esc(d.ownerPhone) || '<span class="no">—</span>'}</dd>
          <dt>E-Mail</dt><dd>${esc(d.ownerEmail) || '<span class="no">—</span>'}</dd>
        </dl>

        <h3>Required Submissions</h3>
        <ul class="doc-list">${subs}</ul>

        <h3>Site / Plot Plan</h3>
        ${d.planMode === "upload"
          ? (d.plotUpload && d.plotUpload.length
              ? `<p><span class="yes">✓ Uploaded</span> — ${d.plotUpload.map(esc).join(", ")}</p>`
              : '<p class="no">Upload selected — no file attached yet.</p>')
          : (plotUsed() ? `<img class="plot-img" src="${renderPlotImage()}" alt="Site plan" />` : '<p class="no">No site plan drawn.</p>')}

        <h3>Photos</h3>
        ${photoPreviewHTML(d)}

        <h3>Description of Proposed Change</h3>
        <div class="doc-block">${esc(d.proposal) || "—"}</div>

        <h3>Adjacent Property Owners</h3>
        ${neighbors}
        <p style="margin-top:.6rem"><strong>Signed signature form:</strong> ${neighborForm}</p>

        <h3>Owner Acknowledgments</h3>
        <ul class="doc-list">${acks}</ul>
        <dl style="margin-top:.6rem">
          <dt>Owner Signature</dt><dd>${sigImg(d.ownerAckSignature)}</dd>
          <dt>Date</dt><dd>${esc(d.ackDate) || '<span class="no">—</span>'}</dd>
        </dl>
      </div>`;
  }

  /* Build a compact, single-page print layout */
  function buildPrintHTML(d) {
    const subs = Object.entries(SUB_LABELS).map(([k, label]) =>
      `<tr><td style="width:18px;text-align:center;">${d.submissions[k] ? "&#9745;" : "&#9744;"}</td><td>${esc(label)}</td></tr>`).join("");

    const neighborsRows = d.neighbors.map((nb, i) =>
      `<tr>
        <td>${esc(nb.name) || "—"}</td>
        <td>${esc(nb.address) || "—"}</td>
      </tr>`).join("") || '<tr><td colspan="2">No neighbors added.</td></tr>';

    const neighborFormNote = d.neighborForm && d.neighborForm.length
      ? "Signed adjacent-owner signature form attached: " + d.neighborForm.map(esc).join(", ")
      : "⚠ Signed adjacent-owner signature form not yet attached.";

    const acksChecked = ACKS.every((_, i) => d.acks["ack_" + (i + 1)]);

    const photoAreasList = Object.entries(d.photoAreas || {})
      .filter(([, v]) => v)
      .map(([k]) => PHOTO_SPECS[k] ? PHOTO_SPECS[k].label : k);
    const photoCount = Object.keys(d.photos || {}).length;
    const photoNote = photoAreasList.length
      ? `Areas: ${photoAreasList.join(", ")}${d.photoMaterial === "yes" ? ", color/material sample" : ""} — ${photoCount} photo${photoCount === 1 ? "" : "s"} attached.`
      : "No photo areas indicated.";

    return `
      <div class="print-doc">
        <!-- Header -->
        <div class="print-header">
          <div>
            <div class="print-eyebrow">Fairway Canyon Homeowners Association</div>
            <div class="print-title">Architectural Review Committee Application</div>
          </div>
          <div class="print-contact">
            CarolMarie Taylor — Sr. Architectural Specialist<br>
            951-801-4246 · carolmarie.taylor@fsresidential.com
          </div>
        </div>

        <!-- Applicant row -->
        <table class="print-table">
          <tr>
            <td class="print-label">Homeowner(s)</td>
            <td>${esc(d.ownerName) || "—"}</td>
            <td class="print-label">Property Address</td>
            <td>${esc(d.propertyAddress) || "—"}</td>
          </tr>
          <tr>
            <td class="print-label">Phone</td>
            <td>${esc(d.ownerPhone) || "—"}</td>
            <td class="print-label">Email</td>
            <td>${esc(d.ownerEmail) || "—"}</td>
          </tr>
        </table>

        <!-- Two-column middle -->
        <div class="print-columns">
          <div class="print-col">
            <h4>Required Submissions</h4>
            <table class="print-checklist">${subs}</table>

            <h4>Description of Proposed Change</h4>
            <div class="print-proposal">${esc(d.proposal) || "—"}</div>
          </div>
          <div class="print-col">
            <h4>Site / Plot Plan</h4>
            ${d.planMode === "upload"
              ? `<p style="font-size:11px;">${d.plotUpload && d.plotUpload.length ? "Plot plan uploaded separately: " + d.plotUpload.map(esc).join(", ") : "⚠ No plot plan attached."}</p>`
              : (plotUsed() ? `<img class="print-plot" src="${renderPlotImage()}" />` : '<p style="color:#999;font-size:11px;">No site plan drawn.</p>')}
          </div>
        </div>

        <!-- Photos -->
        <h4>Photos</h4>
        <p class="print-ack-summary">${esc(photoNote)}</p>

        <!-- Neighbors -->
        <h4>Adjacent Property Owners</h4>
        <table class="print-table print-neighbors">
          <thead><tr><th>Name</th><th>Address</th></tr></thead>
          <tbody>${neighborsRows}</tbody>
        </table>
        <p class="print-ack-summary">${neighborFormNote}</p>

        <!-- Acknowledgments -->
        <h4>Owner Acknowledgments</h4>
        <p class="print-ack-summary">${acksChecked
          ? "All 8 acknowledgment items have been read and accepted."
          : "⚠ Not all acknowledgment items were checked."}</p>

        <!-- Signature block — printable lines -->
        <div class="print-sig-block">
          <div class="print-sig-row">
            <div class="print-sig-field">
              <div class="print-sig-ink">${d.ownerAckSignature ? `<img src="${d.ownerAckSignature}" style="height:36px;" />` : ""}</div>
              <div class="print-sig-line"></div>
              <div class="print-sig-label">Homeowner(s) Signature</div>
            </div>
            <div class="print-sig-field print-sig-field--narrow">
              <div class="print-sig-ink">${esc(d.ackDate)}</div>
              <div class="print-sig-line"></div>
              <div class="print-sig-label">Date</div>
            </div>
          </div>
        </div>

        <p class="print-footer-note">This application was generated from the Fairway Canyon HOA online form. The review process will not begin until both the full application and the fee are received.</p>
      </div>`;
  }

  function openModal() { modal.hidden = false; document.body.style.overflow = "hidden"; }
  function closeModal() { modal.hidden = true; document.body.style.overflow = ""; }
  $$("[data-close]", modal).forEach(el => el.addEventListener("click", closeModal));
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (!gateModal.hidden) closeGateModal();
    else if (!modal.hidden) closeModal();
  });

  form.addEventListener("submit", e => {
    e.preventDefault();
    if (!validateOrFocus()) return;
    status("");
    const d = collect();
    saveDraft(true);
    previewContent.innerHTML = buildPreview(d);
    openModal();
  });

  /* ----- SHARED: open a print window with compact 1-page layout ----- */
  function printPreview() {
    const d = collect();
    const html = buildPrintHTML(d);
    // The finish flow treats "opened the print/save view" as Step 1 done —
    // we can't observe whether the user actually saved the PDF from here.
    pdfSaved = true;
    refreshPacketUI();
    const w = window.open("", "_blank");
    if (!w) { window.print(); return; }
    w.document.write(`<!DOCTYPE html><html><head><title>Fairway Canyon HOA — ARC Application</title>
      <meta charset="utf-8">
      <style>
        @page { margin: 12mm 14mm; size: letter; }
        * { box-sizing: border-box; }
        body { font-family: 'Segoe UI', -apple-system, Arial, sans-serif; color: #1d1a17; line-height: 1.35; font-size: 11px; margin: 0; }
        .print-doc { max-width: 100%; }
        .print-header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #a4111f; padding-bottom: 6px; margin-bottom: 8px; }
        .print-eyebrow { font-size: 8px; letter-spacing: .2em; text-transform: uppercase; color: #a4111f; font-weight: 600; }
        .print-title { font-family: Georgia, serif; font-size: 16px; font-weight: 600; line-height: 1.1; }
        .print-contact { font-size: 9px; color: #555; text-align: right; }
        h4 { font-size: 11px; color: #7d0d18; border-bottom: 1.5px solid #a4111f; padding-bottom: 2px; margin: 10px 0 4px; }
        .print-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 4px; }
        .print-table td, .print-table th { padding: 3px 6px; border: 1px solid #ddd; vertical-align: top; }
        .print-label { font-weight: 600; color: #555; width: 100px; white-space: nowrap; background: #faf8f4; }
        .print-checklist { border-collapse: collapse; font-size: 10px; }
        .print-checklist td { padding: 1px 4px; border: none; vertical-align: top; }
        .print-columns { display: flex; gap: 14px; }
        .print-col { flex: 1; min-width: 0; }
        .print-proposal { font-size: 10px; white-space: pre-wrap; background: #faf8f4; padding: 4px 6px; border: 1px solid #ddd; border-radius: 3px; max-height: 120px; overflow: hidden; }
        .print-plot { width: 100%; border: 1px solid #ccc; }
        .print-neighbors th { font-size: 9px; text-transform: uppercase; letter-spacing: .05em; color: #a4111f; background: #faf8f4; text-align: left; }
        .print-ack-summary { font-size: 10px; margin: 2px 0 6px; }
        .print-sig-block { margin-top: 10px; }
        .print-sig-row { display: flex; gap: 20px; }
        .print-sig-field { flex: 1; }
        .print-sig-field--narrow { flex: 0 0 160px; }
        .print-sig-ink { min-height: 28px; display: flex; align-items: flex-end; }
        .print-sig-line { border-bottom: 1px solid #333; margin-top: 2px; }
        .print-sig-label { font-size: 9px; color: #777; margin-top: 2px; }
        .print-footer-note { font-size: 8px; color: #999; margin-top: 12px; border-top: 1px solid #ddd; padding-top: 4px; }
      </style></head><body>
      ${html}
      </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 350);
  }

  $("#do-print").addEventListener("click", () => printPreview());

  // Finish Step 1 — validate, then open the print/save-PDF view directly
  $("#finish-pdf-btn")?.addEventListener("click", () => {
    if (!validateOrFocus()) return;
    saveDraft(true);
    printPreview();
    status("Print view opened — choose “Save as PDF” and note where the file is saved.", "ok");
  });

  /* ----- ADJACENT-OWNER SIGNATURE FORM (physical, print → sign → re-attach) ----- */
  function buildNeighborFormHTML(d) {
    const entered = d.neighbors.filter(nb => nb.name || nb.address);
    const totalRows = Math.max(6, entered.length + 2);
    let rows = "";
    for (let i = 0; i < totalRows; i++) {
      const nb = entered[i];
      rows += `<tr>
        <td class="nf-num">${i + 1}</td>
        <td>${nb ? esc(nb.name) : ""}</td>
        <td>${nb ? esc(nb.address) : ""}</td>
        <td class="nf-sig"></td>
        <td class="nf-date"></td>
      </tr>`;
    }
    return `
      <div class="nf-doc">
        <div class="nf-header">
          <div>
            <div class="nf-eyebrow">Fairway Canyon Homeowners Association</div>
            <div class="nf-title">Adjacent Property Owner Signature Form</div>
          </div>
          <div class="nf-contact">Architectural Review Committee<br>carolmarie.taylor@fsresidential.com</div>
        </div>

        <table class="nf-info">
          <tr>
            <td class="nf-label">Applicant</td><td>${esc(d.ownerName) || "&nbsp;"}</td>
            <td class="nf-label">Property</td><td>${esc(d.propertyAddress) || "&nbsp;"}</td>
          </tr>
        </table>

        <div class="nf-section">Proposed Change</div>
        <div class="nf-proposal">${esc(d.proposal) || "&nbsp;"}</div>

        <p class="nf-note">By signing below, I confirm that I am an adjacent property owner and that I have been made aware of the proposed change described above. <strong>My signature does not constitute approval or disapproval</strong> of the project &mdash; it confirms only that I was notified.</p>

        <table class="nf-table">
          <thead><tr><th class="nf-num">#</th><th>Adjacent Owner Name</th><th>Property Address</th><th>Signature</th><th>Date</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>

        <p class="nf-footer">Scan or photograph this completed form and attach it to your Architectural Review Committee application packet.</p>
      </div>`;
  }

  function printNeighborForm() {
    const d = collect();
    const html = buildNeighborFormHTML(d);
    const w = window.open("", "_blank");
    if (!w) { window.print(); return; }
    w.document.write(`<!DOCTYPE html><html><head><title>Adjacent Property Owner Signature Form</title>
      <meta charset="utf-8">
      <style>
        @page { margin: 16mm; size: letter; }
        * { box-sizing: border-box; }
        body { font-family: 'Segoe UI', -apple-system, Arial, sans-serif; color: #1d1a17; font-size: 12px; line-height: 1.4; margin: 0; }
        .nf-header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #a4111f; padding-bottom: 8px; margin-bottom: 14px; }
        .nf-eyebrow { font-size: 9px; letter-spacing: .2em; text-transform: uppercase; color: #a4111f; font-weight: 600; }
        .nf-title { font-family: Georgia, serif; font-size: 19px; font-weight: 600; line-height: 1.1; }
        .nf-contact { font-size: 10px; color: #555; text-align: right; }
        .nf-info { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
        .nf-info td { padding: 4px 8px; border: 1px solid #ddd; }
        .nf-label { font-weight: 600; color: #555; background: #faf8f4; width: 88px; white-space: nowrap; }
        .nf-section { font-size: 12px; color: #7d0d18; font-weight: 600; border-bottom: 1.5px solid #a4111f; padding-bottom: 2px; margin: 14px 0 4px; }
        .nf-proposal { font-size: 11px; white-space: pre-wrap; background: #faf8f4; border: 1px solid #ddd; border-radius: 3px; padding: 6px 8px; min-height: 44px; }
        .nf-note { font-size: 10.5px; margin: 12px 0; }
        .nf-table { width: 100%; border-collapse: collapse; margin-top: 4px; }
        .nf-table th { font-size: 9px; text-transform: uppercase; letter-spacing: .05em; color: #a4111f; background: #faf8f4; text-align: left; padding: 5px 6px; border: 1px solid #ccc; }
        .nf-table td { border: 1px solid #ccc; padding: 0 6px; height: 44px; vertical-align: bottom; }
        .nf-num { width: 24px; text-align: center; color: #999; }
        .nf-sig { width: 32%; }
        .nf-date { width: 92px; }
        .nf-footer { font-size: 9px; color: #999; margin-top: 16px; border-top: 1px solid #ddd; padding-top: 6px; }
      </style></head><body>
      ${html}
      </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 350);
  }

  /* ----- EMAIL TO COMMITTEE ----- */
  const EMAIL_TO = "carolmarie.taylor@fsresidential.com,steven@stevenbrown.design";

  function openMailto(d) {
    const subject = encodeURIComponent(
      "ARC Application \u2013 " + (d.ownerName || "Applicant") + " \u2013 " + (d.propertyAddress || "")
    );
    // Attachment manifest \u2014 enumerate exactly which files belong on this email,
    // so both the applicant and the reviewer can verify the packet is complete.
    const plot = plotProvided();
    const photos = photoChecklist();
    const nf = neighborFormFiles();
    const attach = [
      "ARC application form PDF (saved from the online form" +
      (plot.mode !== "upload" && plot.ok ? "; includes the drawn plot plan" : "") + ")"
    ];
    if (plot.mode === "upload" && plot.names.length) attach.push("Plot plan: " + plot.names.join(", "));
    photos.filter(p => p.file).forEach(p => attach.push("Photo \u2014 " + p.title + ": " + p.file));
    if (nf.length) attach.push("Signed neighbor signature form: " + nf.join(", "));
    if (sketchesConfirmed()) attach.push("Sketches, dimensions & material examples for the proposed change");
    const missing = packetMissingList(false);
    let bodyText =
      "Please find attached my Architectural Review Committee application packet.\r\n\r\n" +
      "Applicant: " + d.ownerName + "\r\n" +
      "Property: " + d.propertyAddress + "\r\n" +
      "Phone: " + d.ownerPhone + "\r\n" +
      "Email: " + d.ownerEmail + "\r\n\r\n" +
      "Attachment checklist \u2014 each of these should be attached to this email:\r\n" +
      attach.map((a, i) => "  " + (i + 1) + ". " + a).join("\r\n") + "\r\n";
    if (missing.length) {
      bodyText +=
        "\r\nStill outstanding (to follow separately):\r\n" +
        missing.map(m => "  - " + m).join("\r\n") + "\r\n";
    }
    bodyText += "\r\n\u2014 Submitted via the Fairway Canyon HOA online form";
    window.location.href = "mailto:" + EMAIL_TO + "?subject=" + subject + "&body=" + encodeURIComponent(bodyText);
  }

  /* ----- soft-gate: warn about missing packet items, allow explicit override ----- */
  const gateModal = $("#packet-gate-modal");
  const gateMissingEl = $("#gate-missing");

  function openGateModal(missing) {
    gateMissingEl.textContent = "";
    missing.forEach(m => {
      const li = document.createElement("li");
      li.textContent = m;
      gateMissingEl.appendChild(li);
    });
    gateModal.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeGateModal() {
    gateModal.hidden = true;
    document.body.style.overflow = "";
  }
  $$("[data-close]", gateModal).forEach(el => el.addEventListener("click", closeGateModal));

  // Shared email flow — both email buttons validate (they used to disagree),
  // then soft-gate on packet completeness before opening the mailto.
  function startEmailFlow() {
    if (!modal.hidden) closeModal();
    if (!validateOrFocus()) return;
    status("");
    const missing = packetMissingList(true);
    if (missing.length) { openGateModal(missing); return; }
    finishEmail();
  }

  function finishEmail() {
    const d = collect();
    saveDraft(true);
    openMailto(d);
    status("A pre-addressed email has been opened — attach each file in its checklist before sending.", "ok");
  }

  $("#email-btn").addEventListener("click", startEmailFlow);
  $("#do-email").addEventListener("click", startEmailFlow);
  $("#gate-send-anyway").addEventListener("click", () => { closeGateModal(); finishEmail(); });

  /* ------------------------------------------------------
     DOWNLOAD JSON
  ------------------------------------------------------ */
  $("#download-json").addEventListener("click", () => {
    const d = collect();
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const name = (d.ownerName || "arc-application").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    a.download = `${name || "arc-application"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    status("Application data downloaded as JSON.", "ok");
  });

  /* ------------------------------------------------------
     LANDING / FORM REVEAL
  ------------------------------------------------------ */
  const landingEl = $("#landing");
  const layoutEl = $("#form-layout");

  function enterForm() {
    if (!landingEl || !layoutEl) return;
    landingEl.hidden = true;
    layoutEl.hidden = false;
    window.scrollTo({ top: 0, behavior: "auto" });
    if (mapInstance) setTimeout(() => mapInstance.resize(), 60);
  }
  function showLanding() {
    if (!landingEl || !layoutEl) return;
    layoutEl.hidden = true;
    landingEl.hidden = false;
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  $("#start-application")?.addEventListener("click", enterForm);
  $("#view-landing")?.addEventListener("click", e => { e.preventDefault(); showLanding(); });

  /* ------------------------------------------------------
     INIT
  ------------------------------------------------------ */
  // Returning users with a saved draft skip the landing and go straight to the form.
  const hadDraft = restoreDraft();
  if (hadDraft) enterForm();
  updateProgress();
})();
