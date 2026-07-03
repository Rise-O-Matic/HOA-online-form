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
  buildParcelGrid, computeAutoAlignBearing, closestPointOnSegment,
  segmentsIntersect, connectorBlocked, pointOnSegment, pointOnAnyWall,
  computeFloodFill
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
