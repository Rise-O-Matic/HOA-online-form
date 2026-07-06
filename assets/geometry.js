/* =========================================================
   Pure geometry for the Fairway Canyon ARC form.

   Everything in this module is deterministic and DOM-free:
   parcel projection (lng/lat ring -> fixed-scale pixel grid),
   the aerial-registration similarity fit, auto-align bearing,
   and the flood-fill core (walls at any angle, >50%-coverage
   tile rule). It runs both in the browser (imported by the
   plot editor / map wizard) and under `node --test`
   (tests/geometry.test.js) with no shims.
   ========================================================= */

// Fixed real-world scale: 1 grid tile = 1 square foot, drawn CELL_SIZE px on a side at 100% zoom.
// The grid is NOT scaled to fit the viewport — a big lot simply produces a bigger grid you pan/zoom
// around, so a foot is always the same size on screen regardless of lot size.
export const CELL_SIZE = 8;          // px per 1-ft tile at 100% zoom
export const FEET_PER_CELL = 1;      // 1 tile = 1 sq ft
export const LINE_WIDTH_FEET = 2 / 12; // Line tool stroke = 2 inches, expressed in feet (real-world scale)
export const FOOT_IN_METERS = 0.3048;
export const GRID_MARGIN = 0.10;     // total captured area ≈ 10% bigger than the parcel (5% each side)
export const GRID_MIN_PAD = 2;       // …but always at least this many tiles of border, even for a tiny lot
export const MAX_GRID_DIM = 800;     // safety clamp (feet) so a pathological parcel can't allocate a huge canvas

/* --- Parcel polygon → grid projection --- */
export function geoToLocalMeters(ring, center) {
  const toRad = Math.PI / 180;
  const cosLat = Math.cos(center[1] * toRad);
  return ring.map(([lng, lat]) => ({
    x: (lng - center[0]) * cosLat * 111320,
    y: (lat - center[1]) * 111320
  }));
}

export function rotatePoints(pts, angleDeg) {
  const a = angleDeg * Math.PI / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  return pts.map(p => ({ x: p.x * cos + p.y * sin, y: -p.x * sin + p.y * cos }));
}

export function computeBBox(pts) {
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
export function fitSimilarity(src, dst) {
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

export function buildParcelGrid(coordRing, bearing) {
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

// `roadDir` is a {dE,dN,dist} unit vector (local meters, east/north) from the parcel
// centroid toward the nearest street, or null when the lookup failed / is pending —
// the caller owns fetching it (see the map wizard's nearest-street lookup).
export function computeAutoAlignBearing(ring, roadDir) {
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
  // for lots on the far side of their street. Instead, pick whichever of {base, base+180}
  // rotates the road side to the screen bottom. Screen-down (+y) of a local direction
  // (dE,dN) under bearing b is -(dE·sin b + dN·cos b) — the rotate-by-(-bearing)-then-
  // flip-Y that buildParcelGrid uses — so "street side down" means that value is > 0.
  if (roadDir) {
    const r = Math.PI / 180;
    const isDown = deg => -(roadDir.dE * Math.sin(deg * r) + roadDir.dN * Math.cos(deg * r)) > 0;
    const chosen = isDown(base) ? base : (base + 180) % 360;
    console.info("[auto-orient] nearest street %sm away, base=%s° → %s°",
      Math.round(roadDir.dist), Math.round(base), chosen);
    return chosen;
  }
  // No street direction available (lookup still pending, failed, or none nearby) — fall back
  // to the legacy [0,180) tie-break rather than guessing a flip.
  console.warn("[auto-orient] no street direction — using legacy fallback");
  return ((base % 180) + 180) % 180;
}

// Snap candidates for the Orient step: the bearings at which some parcel boundary edge
// runs exactly vertical or horizontal on screen — i.e. square to the plot grid. An edge
// aligns at four bearings 90° apart, so each contributes one value in [0, 90); near-
// duplicates are merged, and edges shorter than minFrac of the longest are skipped (a
// cul-de-sac arc is a chain of tiny segments at slightly different angles that would
// otherwise make everywhere a snap target). Expects a closed ring (last vertex repeats
// the first), same as computeAutoAlignBearing.
export function computeSnapAngles(ring, minFrac = 0.2) {
  if (!ring || ring.length < 3) return [];
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const local = geoToLocalMeters(ring, [cx, cy]);
  const edges = [];
  let longest = 0;
  for (let i = 0; i < local.length - 1; i++) {
    const dx = local[i + 1].x - local[i].x, dy = local[i + 1].y - local[i].y;
    const len = Math.hypot(dx, dy);
    if (len > longest) longest = len;
    edges.push({ len, angle: Math.atan2(dy, dx) * 180 / Math.PI });
  }
  const angles = [];
  for (const e of edges) {
    if (e.len < longest * minFrac) continue;
    const a = (((90 - e.angle) % 90) + 90) % 90; // same edge→bearing convention as computeAutoAlignBearing
    const dupe = angles.some(x => { const d = Math.abs(x - a); return Math.min(d, 90 - d) < 0.25; });
    if (!dupe) angles.push(a);
  }
  return angles.sort((a, b) => a - b);
}

// Snap a bearing to the nearest grid-aligning candidate from computeSnapAngles: returns
// the snapped bearing in [0, 360) when deg sits within tolerance° of a candidate
// (mod 90), else null — the caller keeps the raw value.
export function snapBearing(deg, snapAngles, tolerance) {
  if (!snapAngles || !snapAngles.length) return null;
  let best = null, bestAbs = Infinity;
  for (const a of snapAngles) {
    const delta = (((deg - a + 45) % 90) + 90) % 90 - 45; // signed offset to the nearest a + k·90
    if (Math.abs(delta) < bestAbs) { bestAbs = Math.abs(delta); best = deg - delta; }
  }
  return bestAbs <= tolerance ? ((best % 360) + 360) % 360 : null;
}

// Per-edge "is this boundary edge square to the screen grid at bearing `deg`" test — the
// Orient step draws the parcel outline solid on edges that read as aligned and dashed on
// the rest. Same edge→bearing convention as computeSnapAngles (each edge collapses to one
// candidate in [0, 90), short cul-de-sac-arc segments below minFrac of the longest edge
// never count as square regardless of bearing) and the same tolerance-band tie-break as
// snapBearing, just resolved per edge instead of against the ring's deduped candidate set.
// Expects a closed ring (last vertex repeats the first); returns one boolean per edge, in
// ring order.
export function computeEdgeSquareFlags(ring, bearing, tolerance, minFrac = 0.2) {
  if (!ring || ring.length < 3) return [];
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const local = geoToLocalMeters(ring, [cx, cy]);
  const edges = [];
  let longest = 0;
  for (let i = 0; i < local.length - 1; i++) {
    const dx = local[i + 1].x - local[i].x, dy = local[i + 1].y - local[i].y;
    const len = Math.hypot(dx, dy);
    if (len > longest) longest = len;
    edges.push({ len, angle: Math.atan2(dy, dx) * 180 / Math.PI });
  }
  return edges.map(e => {
    if (e.len < longest * minFrac) return false;
    const a = (((90 - e.angle) % 90) + 90) % 90; // same edge→bearing convention as computeSnapAngles
    const delta = (((bearing - a + 45) % 90) + 90) % 90 - 45;
    return Math.abs(delta) <= tolerance;
  });
}

// Closest point on segment a→b to the origin (the parcel centroid), in local meters.
export function closestPointOnSegment(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return { x: a.x, y: a.y };
  let t = -(a.x * dx + a.y * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/* --- Line-tool walls as flood-fill barriers (any angle, including triangles) ---
   Lines are thin geometric walls. The paint-bucket floods at SUB-tile resolution: a step between
   two adjacent subcell centres is blocked when the connector crosses any line. Because a straight
   connector crosses a straight segment iff its endpoints are on opposite sides of it, this is
   watertight for lines at ANY angle — a closed triangle whose corners share snapped vertices fully
   contains the fill. A whole tile is then painted iff MORE THAN HALF of its subcells were reached,
   i.e. the ">50% of the tile is within bounds" rule (which also subsumes axis-aligned walls and
   fully-interior tiles at 100%). All wall coords here are in TILE units (1 unit = CELL_SIZE px). */
export const FILL_SUBSAMPLE = 4;   // subcells per tile per axis → 16 samples/tile (6.25% coverage steps)

// Do segments A(a→b) and B(p→q) intersect? Touching counts as a hit, so a connector grazing a
// shared triangle vertex still blocks — we bias toward blocking so the fill can never leak out.
export function segmentsIntersect(ax, ay, bx, by, px, py, qx, qy) {
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

export function connectorBlocked(ax, ay, bx, by, segs) {
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (segmentsIntersect(ax, ay, bx, by, s.x0, s.y0, s.x1, s.y1)) return true;
  }
  return false;
}

// Is point (x,y) essentially ON wall segment s? Used to recover the thin on-wall strip of
// subcells the conservative connector-block erodes (see computeFloodFill coverage pass).
export function pointOnSegment(x, y, s) {
  const dx = s.x1 - s.x0, dy = s.y1 - s.y0, L2 = dx * dx + dy * dy;
  if (L2 < 1e-12) return Math.hypot(x - s.x0, y - s.y0) < 1e-6;
  let t = ((x - s.x0) * dx + (y - s.y0) * dy) / L2;
  if (t < -1e-9 || t > 1 + 1e-9) return false;
  return Math.hypot(x - (s.x0 + t * dx), y - (s.y0 + t * dy)) < 1e-6;
}

export function pointOnAnyWall(x, y, segs) {
  for (let i = 0; i < segs.length; i++) if (pointOnSegment(x, y, segs[i])) return true;
  return false;
}

// Inverse-distance-weighted interpolation of a ground-truth aerial alignment correction
// (feet, east/north) across a handful of manually-calibrated control points — see plot-editor's
// AERIAL_CONTROL_POINTS. Distance is real ground feet via geoToLocalMeters's flat-earth
// approximation, which is accurate at neighborhood scale (verified empirically: the residual
// between this approximation and true Web Mercator, after a similarity fit, is ~1e-4 ft even
// on a 250+ ft parcel — four orders of magnitude below the few-feet aerial/cadastre mismatch
// this interpolation exists to correct). Degrades gracefully with fewer than 2 points: 0 -> no
// correction, 1 -> that point's value everywhere (today's flat-constant behavior).
export function interpolateAerialNudge(lng, lat, points) {
  if (!points || !points.length) return { east: 0, north: 0 };
  if (points.length === 1) return { east: points[0].east, north: points[0].north };
  const cosLat = Math.cos(lat * Math.PI / 180);
  let sumW = 0, sumE = 0, sumN = 0;
  for (const p of points) {
    const dx = (p.lng - lng) * cosLat * 111320;
    const dy = (p.lat - lat) * 111320;
    const distFt = Math.hypot(dx, dy) / FOOT_IN_METERS;
    if (distFt < 1e-6) return { east: p.east, north: p.north }; // essentially exact match
    const w = 1 / (distFt * distFt);
    sumW += w; sumE += w * p.east; sumN += w * p.north;
  }
  return { east: sumE / sumW, north: sumN / sumW };
}

// Ray-cast point-in-polygon (even-odd rule). poly is a ring of {x, y} vertices — an
// explicitly repeated closing vertex is fine (the zero-length wrap edge is a no-op).
// Used by the plot editor to keep Stamp placement inside the parcel footprint.
export function pointInPolygon(x, y, poly) {
  if (!poly || poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Applies a sparse, index-matched array of {dx, dy} pixel offsets on top of a polygon,
// without mutating it. offsets[i] missing/undefined/null is treated as no offset — callers
// may pass a shorter or sparse array than polygon.length. Used to layer a manual, per-corner
// visual correction on top of the pristine county-parcel outline WITHOUT touching the polygon
// fitSimilarity() uses to register the aerial photo (see plot-editor.js's boundaryAdjust).
export function applyPolygonOffsets(polygon, offsets) {
  if (!polygon || !polygon.length) return [];
  return polygon.map((p, i) => {
    const o = offsets && offsets[i];
    return o ? { x: p.x + (o.dx || 0), y: p.y + (o.dy || 0) } : { x: p.x, y: p.y };
  });
}

// Paint-bucket core. Computes the tiles a flood from (c0, r0) should set to `id` (null = erase):
// the contiguous region of same-value tiles (empty or one material), bounded by the grid edges,
// by material colour, AND by wall segments at any angle. Returns an array of [c, r] tile pairs —
// the caller paints them (see the plot editor's floodFill wrapper).
//   cells    — Map of "c,r" -> material id (the live cellState)
//   segments — wall segments in TILE units ({x0,y0,x1,y1}, from collectLineSegments)
//   seed     — the click point in content px (falls back to the tile centre) so a fill against a
//              wall starts on the side the user actually clicked
// A tile is painted only if MORE THAN HALF of it ends up inside the flooded region.
//
// Ties/edges: because the connectivity flood treats "touching a wall" as blocked (so a fill can
// never leak through a shared vertex), a diagonal wall would otherwise erode the thin strip of
// on-wall subcells and leave that tile empty — a visible gap along the diagonal. The coverage
// pass adds those on-wall subcells back, so a triangle fills solidly up to its edge. When you
// then fill the OTHER side, the material-region check stops that flood from entering an already-
// painted tile, so the FIRST fill keeps the shared edge tiles (no overwrite, no gap).
export function computeFloodFill({ cols, rows, cells, c0, r0, id, seed, segments }) {
  if (c0 < 0 || r0 < 0 || c0 >= cols || r0 >= rows) return [];
  const target = cells.get(c0 + "," + r0) || null;
  if (target === (id || null)) return []; // already that colour — nothing to do
  const segs = segments || [];
  const SUB = FILL_SUBSAMPLE;
  const FC = cols * SUB, FR = rows * SUB, HALF = (SUB * SUB) / 2;
  const key = (i, j) => j * FC + i;
  const subCenter = (i) => (i + 0.5) / SUB;           // tile-unit centre of a subcell index
  const targetOf = (c, r) => (cells.get(c + "," + r) || null);
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

  // 3) Collect each tile that came out more than half inside.
  const out = [];
  counts.forEach((count, tkey) => {
    if (count <= HALF) return;
    const i = tkey.indexOf(","), c = +tkey.slice(0, i), r = +tkey.slice(i + 1);
    out.push([c, r]);
  });
  return out;
}
