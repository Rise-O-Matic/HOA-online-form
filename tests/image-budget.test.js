/* Unit tests for assets/image-budget.js — the pure allocation math behind the print
   packet's best-effort image compression (Sprint 19). Run with `node --test`.

   The interesting property is the water-fill: floors are honored when they fit, an image
   is never targeted above its own original size, and surplus from a capped image flows to
   images that still have headroom. Expected values below are derived by hand from the
   documented rules in image-budget.js. */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  allocateImageBudget, dataUrlByteLength, ENCODE_LADDER, DEFAULT_FLOOR_BYTES
} from "../assets/image-budget.js";

const sum = a => a.reduce((x, y) => x + y, 0);
const approx = (actual, expected, eps = 1e-6, msg) =>
  assert.ok(Math.abs(actual - expected) <= eps,
    (msg ? msg + ": " : "") + `expected ${expected} ± ${eps}, got ${actual}`);

test("empty input returns empty allocation", () => {
  assert.deepEqual(allocateImageBudget([], 1000), []);
});

test("everything already fits — originals are kept as targets", () => {
  assert.deepEqual(allocateImageBudget([100, 200, 300], 1000), [100, 200, 300]);
  // exact fit still counts as fitting
  assert.deepEqual(allocateImageBudget([500, 500], 1000), [500, 500]);
});

test("equal over-budget sizes split evenly", () => {
  const t = allocateImageBudget([1000, 1000, 1000], 1500, { floorBytes: 0 });
  t.forEach(v => approx(v, 500));
  approx(sum(t), 1500);
});

test("no image is ever targeted above its own original size", () => {
  // A huge image beside a tiny one: the tiny one is capped at its 50-byte original,
  // and its unused budget flows to the big one.
  const t = allocateImageBudget([2000, 50], 1000, { floorBytes: 200 });
  approx(t[1], 50, 1e-6, "tiny image pinned at its original size");
  approx(t[0], 950, 1e-6, "big image absorbs the tiny one's surplus");
  approx(sum(t), 1000);
});

test("floors are reserved before proportional headroom fill", () => {
  // sizes 2000 & 400, budget 1000, floor 300. Floors [300,300] reserved (sum 600),
  // leftover 400 split by headroom [1700,100] → +400*1700/1800 ≈ 377.8 and +22.2.
  const t = allocateImageBudget([2000, 400], 1000, { floorBytes: 300 });
  approx(sum(t), 1000, 1e-6, "targets sum to budget");
  approx(t[0], 300 + 400 * 1700 / 1800, 1e-3);
  approx(t[1], 300 + 400 * 100 / 1800, 1e-3);
  assert.ok(t[0] <= 2000 && t[1] <= 400, "each within its own size cap");
});

test("when floors alone exceed the budget, squeeze proportionally to floors", () => {
  // sizes all 500, floor 200 → floors [200,200,200] sum 600 > budget 300.
  const t = allocateImageBudget([500, 500, 500], 300, { floorBytes: 200 });
  t.forEach(v => approx(v, 100));
  approx(sum(t), 300, 1e-6, "still lands exactly on budget");
});

test("targets never exceed the total budget when over-subscribed", () => {
  const sizes = [5_000_000, 3_000_000, 4_000_000, 800_000];
  const budget = 6_000_000;
  const t = allocateImageBudget(sizes, budget);
  approx(sum(t), budget, 1, "water-fill consumes the whole budget");
  t.forEach((v, i) => assert.ok(v <= sizes[i] + 1e-6, `image ${i} within its cap`));
});

test("default floor is applied when no opts given", () => {
  // Two 2 MB images, 1 MB budget: floors = min(2MB, 60KB) = 60KB each (120KB reserved),
  // leftover split evenly by equal headroom → each gets 500 KB.
  const t = allocateImageBudget([2 << 20, 2 << 20], 1 << 20);
  approx(sum(t), 1 << 20, 1);
  approx(t[0], t[1], 1, "equal images get equal targets");
  assert.equal(DEFAULT_FLOOR_BYTES, 60 * 1024);
});

test("encode ladder is monotonically decreasing in both size and quality", () => {
  for (let i = 1; i < ENCODE_LADDER.length; i++) {
    assert.ok(ENCODE_LADDER[i].maxDim < ENCODE_LADDER[i - 1].maxDim, "maxDim decreases");
    assert.ok(ENCODE_LADDER[i].quality < ENCODE_LADDER[i - 1].quality, "quality decreases");
  }
});

test("dataUrlByteLength recovers the decoded byte count", () => {
  // "Zm9vYmFy" is base64 for "foobar" (6 bytes), no padding.
  approx(dataUrlByteLength("data:image/jpeg;base64,Zm9vYmFy"), 6);
  // "Zm9vYmE=" -> "fooba" (5 bytes), one pad char.
  approx(dataUrlByteLength("data:image/jpeg;base64,Zm9vYmE="), 5);
  // "Zm9v" -> "foo" (3 bytes)
  approx(dataUrlByteLength("Zm9v"), 3);
  approx(dataUrlByteLength(""), 0);
});
