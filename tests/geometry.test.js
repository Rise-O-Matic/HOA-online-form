/* Unit tests for assets/geometry.js — the pure computational core under the
   plot editor and map wizard. Run with `node --test` (Node 18+; no deps).

   These functions are the riskiest code in the app (fixed-scale parcel grids,
   flood-fill walls, aerial registration) and the only verification they had
   before this suite was eyeballing the canvas. Expected values below are
   derived by hand from the documented rules — see the comments in geometry.js. */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CELL_SIZE, FOOT_IN_METERS, GRID_MIN_PAD, MAX_GRID_DIM, FILL_SUBSAMPLE,
  geoToLocalMeters, rotatePoints, computeBBox, fitSimilarity,
  buildParcelGrid, computeAutoAlignBearing, computeSnapAngles, snapBearing,
  computeEdgeSquareFlags,
  closestPointOnSegment,
  segmentsIntersect, connectorBlocked, pointOnSegment, pointOnAnyWall,
  pointInPolygon, computeFloodFill, interpolateAerialNudge, applyPolygonOffsets
} from "../assets/geometry.js";

const approx = (actual, expected, eps = 1e-6, msg) =>
  assert.ok(Math.abs(actual - expected) <= eps,
    (msg ? msg + ": " : "") + `expected ${expected} ± ${eps}, got ${actual}`);

/* ---------- helpers ---------- */

// Closed lng/lat rectangle ring, W meters east-west by H meters north-south,
// centered on [lng0, lat0], counterclockwise from the SW corner.
function rectRing(lng0, lat0, W, H) {
  const cosLat = Math.cos(lat0 * Math.PI / 180);
  const dLng = (W / 2) / (cosLat * 111320);
  const dLat = (H / 2) / 111320;
  return [
    [lng0 - dLng, lat0 - dLat],
    [lng0 + dLng, lat0 - dLat],
    [lng0 + dLng, lat0 + dLat],
    [lng0 - dLng, lat0 + dLat],
    [lng0 - dLng, lat0 - dLat]
  ];
}

// Content-px point at the centre of tile (c, r) — the default flood seed.
const tileCenterPx = (c, r) => ({ x: (c + 0.5) * CELL_SIZE, y: (r + 0.5) * CELL_SIZE });

// Sorted "c,r" strings for order-independent comparison of flood results.
const tileSet = pairs => pairs.map(([c, r]) => c + "," + r).sort();

/* ---------- geoToLocalMeters / rotatePoints / computeBBox ---------- */

test("geoToLocalMeters projects lng/lat offsets to local meters", () => {
  const center = [-117, 33];
  const cosLat = Math.cos(33 * Math.PI / 180);
  const pts = geoToLocalMeters([[-117, 33], [-116.99, 33], [-117, 33.01]], center);
  approx(pts[0].x, 0); approx(pts[0].y, 0);
  approx(pts[1].x, 0.01 * cosLat * 111320, 1e-6);
  approx(pts[1].y, 0);
  approx(pts[2].x, 0);
  approx(pts[2].y, 0.01 * 111320, 1e-6);
});

test("rotatePoints rotates the way the map bearing expects", () => {
  // +90° sends +x to -y (screen-style clockwise in this convention)
  const [p] = rotatePoints([{ x: 1, y: 0 }], 90);
  approx(p.x, 0, 1e-12); approx(p.y, -1, 1e-12);
  // full turn is identity
  const [q] = rotatePoints([{ x: 3, y: -2 }], 360);
  approx(q.x, 3, 1e-9); approx(q.y, -2, 1e-9);
});

test("computeBBox finds the extremes", () => {
  const bb = computeBBox([{ x: -1, y: 4 }, { x: 5, y: -2 }, { x: 2, y: 2 }]);
  assert.deepEqual(bb, { minX: -1, maxX: 5, minY: -2, maxY: 4 });
});

/* ---------- fitSimilarity ---------- */

test("fitSimilarity recovers a known scale+rotation+translation", () => {
  const theta = 30 * Math.PI / 180, s = 2, tx = 5, ty = -3;
  const a = s * Math.cos(theta), b = s * Math.sin(theta);
  const src = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 2, y: 3 }];
  const dst = src.map(p => ({ x: a * p.x - b * p.y + tx, y: b * p.x + a * p.y + ty }));
  const fit = fitSimilarity(src, dst);
  approx(fit.a, a, 1e-9); approx(fit.b, b, 1e-9);
  approx(fit.tx, tx, 1e-9); approx(fit.ty, ty, 1e-9);
});

test("fitSimilarity returns null on degenerate input", () => {
  assert.equal(fitSimilarity([{ x: 1, y: 1 }], [{ x: 2, y: 2 }]), null); // < 2 points
  assert.equal(fitSimilarity(
    [{ x: 1, y: 1 }, { x: 1, y: 1 }],       // zero spread → den ~ 0
    [{ x: 2, y: 2 }, { x: 3, y: 3 }]), null);
});

/* ---------- buildParcelGrid ---------- */

test("buildParcelGrid sizes a fixed-scale square grid around the parcel", () => {
  // 30 m × 15 m parcel = 98.43 ft × 49.21 ft. Longest 98.43 ft → pad = max(2, ceil(4.92)) = 5,
  // side = ceil(98.43) + 2·5 = 109 tiles.
  const ring = rectRing(-117, 33.93, 30, 15);
  const g = buildParcelGrid(ring, 0);
  assert.equal(g.cols, 109);
  assert.equal(g.rows, 109);
  assert.equal(g.metersPerCell, FOOT_IN_METERS);
  const bb = computeBBox(g.polygonPx);
  const wFt = 30 / FOOT_IN_METERS, hFt = 15 / FOOT_IN_METERS;
  approx(bb.maxX - bb.minX, wFt * CELL_SIZE, 0.05, "outline width in px");
  approx(bb.maxY - bb.minY, hFt * CELL_SIZE, 0.05, "outline height in px");
  // parcel centered in the square
  approx((bb.minX + bb.maxX) / 2, (109 * CELL_SIZE) / 2, 0.05, "centered X");
  approx((bb.minY + bb.maxY) / 2, (109 * CELL_SIZE) / 2, 0.05, "centered Y");
});

test("buildParcelGrid at bearing 90 swaps the outline's screen dimensions", () => {
  const ring = rectRing(-117, 33.93, 30, 15);
  const g = buildParcelGrid(ring, 90);
  assert.equal(g.cols, 109); // longest dimension unchanged → same square
  const bb = computeBBox(g.polygonPx);
  approx(bb.maxX - bb.minX, (15 / FOOT_IN_METERS) * CELL_SIZE, 0.05);
  approx(bb.maxY - bb.minY, (30 / FOOT_IN_METERS) * CELL_SIZE, 0.05);
});

test("buildParcelGrid enforces the minimum pad and the safety clamp", () => {
  // Tiny 5 m lot: pad floors at GRID_MIN_PAD → side = ceil(16.4) + 2·2 = 21
  const tiny = buildParcelGrid(rectRing(-117, 33.93, 5, 5), 0);
  assert.equal(tiny.cols, 17 + 2 * GRID_MIN_PAD);
  // Pathological 1 km lot: clamped to MAX_GRID_DIM
  const huge = buildParcelGrid(rectRing(-117, 33.93, 1000, 1000), 0);
  assert.equal(huge.cols, MAX_GRID_DIM);
});

/* ---------- computeAutoAlignBearing ---------- */

// 10 m wide × 40 m deep lot: longest edges run north-south, so squaring the
// view to them gives base bearing 0 (long edge vertical, no rotation needed).
const DEEP_LOT = rectRing(-117, 33.93, 10, 40);

test("computeAutoAlignBearing squares the longest edge vertical (legacy fallback)", () => {
  assert.equal(computeAutoAlignBearing(DEEP_LOT, null), 0);
});

test("computeAutoAlignBearing flips so the street side faces screen-down", () => {
  // Street south of the lot → base 0 already puts it down.
  assert.equal(computeAutoAlignBearing(DEEP_LOT, { dE: 0, dN: -1, dist: 20 }), 0);
  // Street north of the lot → flip 180 so the front yard is at the bottom.
  assert.equal(computeAutoAlignBearing(DEEP_LOT, { dE: 0, dN: 1, dist: 20 }), 180);
  // Street exactly perpendicular to the flip axis: screen-down component is 0,
  // which does not count as "down", so the flip candidate wins.
  assert.equal(computeAutoAlignBearing(DEEP_LOT, { dE: 1, dN: 0, dist: 20 }), 180);
});

test("computeAutoAlignBearing degenerate ring returns 0", () => {
  assert.equal(computeAutoAlignBearing(null, null), 0);
  assert.equal(computeAutoAlignBearing([[-117, 33.93]], null), 0);
});

/* ---------- computeSnapAngles / snapBearing ---------- */

// Closed lng/lat ring from local-meter offsets around [lng0, lat0]
// (the inverse of geoToLocalMeters, for rings that aren't plain rectangles).
function ringFromMeters(lng0, lat0, pts) {
  const cosLat = Math.cos(lat0 * Math.PI / 180);
  const ring = pts.map(([x, y]) => [lng0 + x / (cosLat * 111320), lat0 + y / 111320]);
  ring.push(ring[0]);
  return ring;
}

test("computeSnapAngles: axis-aligned rectangle collapses to the single angle 0", () => {
  const angles = computeSnapAngles(rectRing(-117, 33.93, 10, 40));
  assert.equal(angles.length, 1);
  approx(angles[0], 0, 0.01);
});

test("computeSnapAngles: rotated rectangle yields its one squaring bearing", () => {
  // 10×40 rect rotated 30° CCW (math): all four edges align at bearing 60 (mod 90).
  const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
  const corners = [[-5, -20], [5, -20], [5, 20], [-5, 20]]
    .map(([x, y]) => [x * c - y * s, x * s + y * c]);
  const angles = computeSnapAngles(ringFromMeters(-117, 33.93, corners));
  assert.equal(angles.length, 1);
  approx(angles[0], 60, 0.1);
});

test("computeSnapAngles: short edges are skipped unless minFrac allows them", () => {
  // 40×15 rectangle with one ~2.8 m clipped corner at 45° — well under 20% of the
  // longest (40 m) edge, so the default drops it and only 0 remains a candidate.
  const clipped = ringFromMeters(-117, 33.93,
    [[-20, -7.5], [20, -7.5], [20, 5.5], [18, 7.5], [-20, 7.5]]);
  const dflt = computeSnapAngles(clipped);
  assert.equal(dflt.length, 1);
  approx(dflt[0], 0, 0.05);
  // minFrac 0 keeps every edge: the 45° clip shows up too.
  const all = computeSnapAngles(clipped, 0);
  assert.equal(all.length, 2);
  approx(all[0], 0, 0.05);
  approx(all[1], 45, 0.1);
});

test("computeSnapAngles: degenerate ring returns no candidates", () => {
  assert.deepEqual(computeSnapAngles(null), []);
  assert.deepEqual(computeSnapAngles([[-117, 33.93]]), []);
});

test("snapBearing snaps within tolerance, in every 90° image of a candidate", () => {
  approx(snapBearing(58.3, [60], 4), 60, 1e-9);
  approx(snapBearing(178, [0], 4), 180, 1e-9);     // horizontal counts, not just vertical
  approx(snapBearing(359.2, [0], 4), 0, 1e-9);     // wraps back into [0, 360)
  approx(snapBearing(272.5, [0, 45], 4), 270, 1e-9); // nearest candidate wins
});

test("snapBearing returns null beyond tolerance or with no candidates", () => {
  assert.equal(snapBearing(50, [60], 4), null);
  assert.equal(snapBearing(10, [], 4), null);
  assert.equal(snapBearing(10, null, 4), null);
});

/* ---------- computeEdgeSquareFlags ---------- */

test("computeEdgeSquareFlags: axis-aligned rectangle is square at 0/90 and not at 45", () => {
  const ring = rectRing(-117, 33.93, 10, 40);
  assert.deepEqual(computeEdgeSquareFlags(ring, 0, 4), [true, true, true, true]);
  assert.deepEqual(computeEdgeSquareFlags(ring, 90, 4), [true, true, true, true]);
  assert.deepEqual(computeEdgeSquareFlags(ring, 45, 4), [false, false, false, false]);
});

test("computeEdgeSquareFlags: within tolerance of a candidate still reads square", () => {
  const ring = rectRing(-117, 33.93, 10, 40);
  assert.deepEqual(computeEdgeSquareFlags(ring, 3.5, 4), [true, true, true, true]);
  assert.deepEqual(computeEdgeSquareFlags(ring, 4.5, 4), [false, false, false, false]);
});

test("computeEdgeSquareFlags: rotated rectangle squares at its own 60° candidate", () => {
  const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
  const corners = [[-5, -20], [5, -20], [5, 20], [-5, 20]]
    .map(([x, y]) => [x * c - y * s, x * s + y * c]);
  const ring = ringFromMeters(-117, 33.93, corners);
  assert.deepEqual(computeEdgeSquareFlags(ring, 60, 4), [true, true, true, true]);
  assert.deepEqual(computeEdgeSquareFlags(ring, 0, 4), [false, false, false, false]);
});

test("computeEdgeSquareFlags: a short clipped-corner edge never reads square, even at its own angle", () => {
  const clipped = ringFromMeters(-117, 33.93,
    [[-20, -7.5], [20, -7.5], [20, 5.5], [18, 7.5], [-20, 7.5]]);
  // e2 (the ~2.8m 45°-clipped corner) is index 2; at bearing 45 it would otherwise square.
  const dflt = computeEdgeSquareFlags(clipped, 45, 4);
  assert.equal(dflt[2], false);
  assert.ok(dflt.every(v => v === false)); // none of the long edges are near 45 either
  // minFrac 0 keeps every edge in play, so the same short edge now reads square at 45°.
  const all = computeEdgeSquareFlags(clipped, 45, 4, 0);
  assert.equal(all[2], true);
});

test("computeEdgeSquareFlags: degenerate ring returns no flags", () => {
  assert.deepEqual(computeEdgeSquareFlags(null, 0, 4), []);
  assert.deepEqual(computeEdgeSquareFlags([[-117, 33.93]], 0, 4), []);
});

/* ---------- closestPointOnSegment ---------- */

test("closestPointOnSegment finds the foot of the perpendicular (to the origin)", () => {
  const p = closestPointOnSegment({ x: -10, y: 3 }, { x: 10, y: 3 });
  approx(p.x, 0); approx(p.y, 3);
});

test("closestPointOnSegment clamps to the endpoints", () => {
  const p = closestPointOnSegment({ x: 5, y: 5 }, { x: 10, y: 5 });
  approx(p.x, 5); approx(p.y, 5);
});

test("closestPointOnSegment handles a zero-length segment", () => {
  const p = closestPointOnSegment({ x: 2, y: -1 }, { x: 2, y: -1 });
  approx(p.x, 2); approx(p.y, -1);
});

/* ---------- segmentsIntersect / connectorBlocked / pointOnSegment ---------- */

test("segmentsIntersect: proper crossing", () => {
  assert.equal(segmentsIntersect(0, 0, 2, 2, 0, 2, 2, 0), true);
});

test("segmentsIntersect: parallel and apart", () => {
  assert.equal(segmentsIntersect(0, 0, 1, 0, 0, 1, 1, 1), false);
});

test("segmentsIntersect: touching at a shared endpoint counts (bias toward blocking)", () => {
  assert.equal(segmentsIntersect(0, 0, 1, 1, 1, 1, 2, 0), true);
});

test("segmentsIntersect: collinear overlap vs collinear disjoint", () => {
  assert.equal(segmentsIntersect(0, 0, 2, 0, 1, 0, 3, 0), true);
  assert.equal(segmentsIntersect(0, 0, 1, 0, 2, 0, 3, 0), false);
});

test("segmentsIntersect: near miss stays a miss", () => {
  assert.equal(segmentsIntersect(0, 0, 1, 0, 0.5, 0.0001, 0.5, 1), false);
});

test("connectorBlocked scans the wall list", () => {
  const segs = [{ x0: 5, y0: 0, x1: 5, y1: 10 }];
  assert.equal(connectorBlocked(4.9, 5, 5.1, 5, segs), true);
  assert.equal(connectorBlocked(4.0, 5, 4.8, 5, segs), false);
  assert.equal(connectorBlocked(4.9, 5, 5.1, 5, []), false);
});

test("pointOnSegment / pointOnAnyWall", () => {
  const s = { x0: 0, y0: 0, x1: 8, y1: 8 };
  assert.equal(pointOnSegment(4, 4, s), true);       // midpoint
  assert.equal(pointOnSegment(4, 4.001, s), false);  // just off the line
  assert.equal(pointOnSegment(9, 9, s), false);      // past the end
  assert.equal(pointOnAnyWall(4, 4, [s]), true);
  assert.equal(pointOnAnyWall(4, 5, [s]), false);
});

/* ---------- pointInPolygon ---------- */

test("pointInPolygon: convex ring, with and without repeated closing vertex", () => {
  const open = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const closed = [...open, { x: 0, y: 0 }]; // county rings repeat the first vertex
  for (const poly of [open, closed]) {
    assert.equal(pointInPolygon(5, 5, poly), true);      // dead center
    assert.equal(pointInPolygon(11, 5, poly), false);    // right of the box
    assert.equal(pointInPolygon(5, -0.1, poly), false);  // just above
    assert.equal(pointInPolygon(9.99, 9.99, poly), true); // near a corner, inside
  }
});

test("pointInPolygon: concave ring (L-shape) and degenerate input", () => {
  // L-shape: 10×10 square with the top-right 5×5 quadrant notched out.
  const L = [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 },
    { x: 5, y: 5 }, { x: 5, y: 10 }, { x: 0, y: 10 }
  ];
  assert.equal(pointInPolygon(2, 8, L), true);    // lower arm of the L
  assert.equal(pointInPolygon(8, 2, L), true);    // upper arm of the L
  assert.equal(pointInPolygon(8, 8, L), false);   // the notch
  assert.equal(pointInPolygon(5, 5, []), false);                // no ring
  assert.equal(pointInPolygon(5, 5, [{ x: 0, y: 0 }, { x: 10, y: 0 }]), false); // not a polygon
});

/* ---------- applyPolygonOffsets ---------- */

test("applyPolygonOffsets: no offsets returns an equal-valued copy, not the same references", () => {
  const poly = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const result = applyPolygonOffsets(poly, []);
  assert.notEqual(result, poly);
  assert.notEqual(result[0], poly[0]);
  assert.deepEqual(result, poly);
});

test("applyPolygonOffsets: applies a dx/dy to only the indices given, others pass through unchanged", () => {
  const poly = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const result = applyPolygonOffsets(poly, [undefined, { dx: 2, dy: -1 }]);
  assert.deepEqual(result[0], { x: 0, y: 0 });
  assert.deepEqual(result[1], { x: 12, y: -1 });
  assert.deepEqual(result[2], { x: 10, y: 10 });
  assert.deepEqual(result[3], { x: 0, y: 10 });
});

test("applyPolygonOffsets: sparse/undefined offsets entries default to zero", () => {
  const poly = [{ x: 1, y: 1 }, { x: 2, y: 2 }];
  const result = applyPolygonOffsets(poly, [null, { dx: 5 }]); // dy omitted -> 0
  assert.deepEqual(result[0], { x: 1, y: 1 });
  assert.deepEqual(result[1], { x: 7, y: 2 });
});

test("applyPolygonOffsets: empty polygon returns []", () => {
  assert.deepEqual(applyPolygonOffsets([], [{ dx: 1, dy: 1 }]), []);
  assert.deepEqual(applyPolygonOffsets(null, []), []);
});

/* ---------- computeFloodFill ---------- */

const flood = (opts) => computeFloodFill({
  cols: 10, rows: 10, cells: new Map(), id: "turf",
  seed: tileCenterPx(opts.c0, opts.r0), segments: [], ...opts
});

test("flood fill: empty unwalled grid fills completely", () => {
  const tiles = flood({ c0: 0, r0: 0 });
  assert.equal(tiles.length, 100);
});

test("flood fill: no-ops (same colour, erase on empty, out of bounds)", () => {
  const cells = new Map([["4,4", "turf"]]);
  assert.equal(flood({ c0: 4, r0: 4, cells }).length, 0);      // already turf
  assert.equal(flood({ c0: 0, r0: 0, id: null }).length, 0);   // erasing empty
  assert.equal(flood({ c0: -1, r0: 0, seed: null }).length, 0);
  assert.equal(flood({ c0: 0, r0: 10, seed: null }).length, 0);
});

test("flood fill: painted material bounds the region", () => {
  // Columns 5–9 already turf; flooding concrete from (0,0) stops at the colour edge.
  const cells = new Map();
  for (let c = 5; c < 10; c++) for (let r = 0; r < 10; r++) cells.set(c + "," + r, "turf");
  const tiles = flood({ c0: 0, r0: 0, id: "concrete", cells });
  assert.equal(tiles.length, 50);
  assert.ok(tiles.every(([c]) => c < 5));
});

// Axis-aligned wall box on grid lines: (2,2)→(7,2)→(7,7)→(2,7)→(2,2), tile units.
const BOX = [
  { x0: 2, y0: 2, x1: 7, y1: 2 },
  { x0: 7, y0: 2, x1: 7, y1: 7 },
  { x0: 7, y0: 7, x1: 2, y1: 7 },
  { x0: 2, y0: 7, x1: 2, y1: 2 }
];

test("flood fill: axis-aligned walls contain the fill exactly", () => {
  const inside = flood({ c0: 4, r0: 4, segments: BOX });
  assert.equal(inside.length, 25); // tiles (2..6, 2..6)
  assert.ok(inside.every(([c, r]) => c >= 2 && c <= 6 && r >= 2 && r <= 6));
  const outside = flood({ c0: 0, r0: 0, segments: BOX });
  assert.equal(outside.length, 75); // everything else; no leak, no overlap
  const overlap = new Set(tileSet(inside));
  assert.ok(tileSet(outside).every(k => !overlap.has(k)));
});

// Right triangle with legs on the grid edges and a diagonal hypotenuse x+y=8.
const TRIANGLE = [
  { x0: 0, y0: 0, x1: 8, y1: 0 },
  { x0: 8, y0: 0, x1: 0, y1: 8 },
  { x0: 0, y0: 8, x1: 0, y1: 0 }
];

test("flood fill: diagonal walls fill to the edge via the on-wall coverage rule", () => {
  const tiles = flood({ c0: 1, r0: 1, segments: TRIANGLE });
  // Cut tiles on the hypotenuse (c+r = 7) are exactly half inside: 6 reached
  // subcells + 4 recovered on-wall subcells = 10 of 16 > 50% → painted. So the
  // triangle fills solidly: every tile with c+r ≤ 7.
  assert.equal(tiles.length, 36);
  assert.ok(tiles.every(([c, r]) => c + r <= 7));
});

test("flood fill: the first fill keeps the shared diagonal edge", () => {
  const cells = new Map();
  flood({ c0: 1, r0: 1, segments: TRIANGLE }).forEach(([c, r]) => cells.set(c + "," + r, "turf"));
  const second = flood({ c0: 9, r0: 9, id: "concrete", cells, segments: TRIANGLE });
  // The other side gets everything EXCEPT the 36 turf tiles — the material-region
  // check keeps the second flood out of the already-painted diagonal tiles.
  assert.equal(second.length, 64);
  assert.ok(second.every(([c, r]) => cells.get(c + "," + r) === undefined));
});

test("flood fill: the seed picks the clicked side of a wall through the tile", () => {
  // Single diagonal wall (0,8)→(8,0) crossing tile (3,4). Same tile, two seeds:
  const diag = [{ x0: 0, y0: 8, x1: 8, y1: 0 }];
  const below = flood({ c0: 3, r0: 4, segments: diag, seed: { x: 3.125 * CELL_SIZE, y: 4.125 * CELL_SIZE } });
  const above = flood({ c0: 3, r0: 4, segments: diag, seed: { x: 3.875 * CELL_SIZE, y: 4.875 * CELL_SIZE } });
  // Left/lower side of x+y=8: tiles with c+r ≤ 7 (36). Right/upper side: c+r ≥ 7 (72) —
  // both include the split diagonal tiles (>50% by the on-wall rule); on an empty grid
  // whichever fill runs FIRST claims them (see the shared-edge test above).
  assert.equal(below.length, 36);
  assert.ok(below.every(([c, r]) => c + r <= 7));
  assert.equal(above.length, 72);
  assert.ok(above.every(([c, r]) => c + r >= 7));
});

test("flood fill: subsample resolution matches the documented constant", () => {
  assert.equal(FILL_SUBSAMPLE, 4); // >50% rule comments assume 16 subcells/tile
});

/* ---------- interpolateAerialNudge ---------- */

test("interpolateAerialNudge: no points -> no correction", () => {
  const r = interpolateAerialNudge(-117, 33, []);
  assert.equal(r.east, 0); assert.equal(r.north, 0);
});

test("interpolateAerialNudge: one point -> that value everywhere (flat-constant behavior)", () => {
  const pts = [{ lng: -117.05, lat: 33.95, east: -1.0, north: -3.6 }];
  approx(interpolateAerialNudge(-117.05, 33.95, pts).east, -1.0);
  approx(interpolateAerialNudge(-116.9, 33.8, pts).north, -3.6); // far away — still the same
});

test("interpolateAerialNudge: exact match at a control point returns its exact value", () => {
  const pts = [
    { lng: -117.05, lat: 33.95, east: -1.0, north: -3.6 },
    { lng: -117.02, lat: 33.90, east: 2.0, north: 0.5 }
  ];
  approx(interpolateAerialNudge(-117.05, 33.95, pts).east, -1.0);
  approx(interpolateAerialNudge(-117.05, 33.95, pts).north, -3.6);
  approx(interpolateAerialNudge(-117.02, 33.90, pts).east, 2.0);
});

test("interpolateAerialNudge: equidistant points average evenly", () => {
  const lat0 = 33.95, cosLat = Math.cos(lat0 * Math.PI / 180);
  const dLng = 100 / (cosLat * 111320); // ~100m east/west of the query point
  const pts = [
    { lng: -117 - dLng, lat: lat0, east: 0, north: 0 },
    { lng: -117 + dLng, lat: lat0, east: 10, north: 20 }
  ];
  const r = interpolateAerialNudge(-117, lat0, pts);
  approx(r.east, 5, 1e-6);
  approx(r.north, 10, 1e-6);
});

test("interpolateAerialNudge: closer point dominates the blend", () => {
  const lat0 = 33.95, cosLat = Math.cos(lat0 * Math.PI / 180);
  const nearDLng = 10 / (cosLat * 111320), farDLng = 1000 / (cosLat * 111320);
  const pts = [
    { lng: -117 + nearDLng, lat: lat0, east: 1, north: 0 },
    { lng: -117 - farDLng, lat: lat0, east: -1, north: 0 }
  ];
  const r = interpolateAerialNudge(-117, lat0, pts);
  assert.ok(r.east > 0.9, `expected the near point (10x closer) to dominate, got ${r.east}`);
});
