/* image-budget.js — the pure, DOM-free allocation math behind the print packet's
   best-effort image compression (Sprint 19). Given the source file sizes and a total
   byte budget, decide how many bytes each image is allowed, so the whole packet stays
   emailable. The *encode* itself (canvas draw + JPEG re-encode) lives in app.js and isn't
   unit-testable; this half is, and it's the part with the interesting logic.

   Under Path A (paged.js → browser "Save as PDF"), the browser does the final PDF encode,
   so pre-compressed JPEGs are a lever, not a guarantee — the per-image target is an aim the
   encoder walks a quality/size ladder toward, and may miss for a genuinely large image.

   Keep this module dependency-free and DOM-free (like geometry.js) — it has a node:test
   suite (tests/image-budget.test.js). */

// Default: never starve an image below this many bytes (unless its original is already
// smaller, in which case the original is the floor). Keeps a small-but-important shot from
// being crushed when a huge sibling would otherwise soak up the whole budget.
export const DEFAULT_FLOOR_BYTES = 60 * 1024;

// The quality/max-dimension ladder the DOM encoder walks per image: encode at step 0, and
// step down only while the result still exceeds that image's byte target. Exported (and the
// encoder imports it) so the ladder lives next to the allocation logic, and so a test can
// assert it's monotonically decreasing. First step is a mild recompress for images that
// already fit; the tail is the best-effort floor for a photo that simply won't shrink enough.
export const ENCODE_LADDER = [
  { maxDim: 2200, quality: 0.82 },
  { maxDim: 2000, quality: 0.78 },
  { maxDim: 1750, quality: 0.72 },
  { maxDim: 1500, quality: 0.66 },
  { maxDim: 1300, quality: 0.58 },
  { maxDim: 1100, quality: 0.50 },
  { maxDim: 1000, quality: 0.42 }
];

/* Allocate `totalTargetBytes` across images of the given `sizes` (bytes), returning a
   per-image byte target in the same order.

   Rules, in order:
   1. If everything already fits (Σsizes ≤ total), keep originals as targets — the encoder
      will still mildly recompress (JPEG @ the top ladder step is usually < original) but
      won't chase a smaller size it doesn't need.
   2. Otherwise water-fill against two constraints: a per-image floor (min(size, floor)) so
      nothing is starved, and a per-image cap of its own original size (compressing to *more*
      than the original is meaningless). Surplus released by an image that hits its cap is
      redistributed to the images that still have headroom, proportional to that headroom.
   3. If the floors alone already exceed the budget, we can't honor them — squeeze everything
      proportionally to its floor so the targets still sum to the budget (maximally best-effort). */
export function allocateImageBudget(sizes, totalTargetBytes, opts = {}) {
  const floor = opts.floorBytes == null ? DEFAULT_FLOOR_BYTES : opts.floorBytes;
  const n = sizes.length;
  if (!n) return [];

  const sum = sizes.reduce((a, b) => a + b, 0);
  if (sum <= totalTargetBytes) return sizes.slice(); // (1) everything fits

  const floors = sizes.map(s => Math.min(s, floor));
  const sumFloors = floors.reduce((a, b) => a + b, 0);
  if (sumFloors >= totalTargetBytes) {
    // (3) can't even meet the floors — proportional squeeze so the sum still lands on budget.
    return floors.map(f => (sumFloors ? (totalTargetBytes * f) / sumFloors : 0));
  }

  // (2) water-fill the leftover above the reserved floors.
  const targets = floors.slice();
  let leftover = totalTargetBytes - sumFloors;
  let active = sizes.map((_, i) => i).filter(i => targets[i] < sizes[i] - 1e-9);
  while (leftover > 1e-6 && active.length) {
    const headroomSum = active.reduce((a, i) => a + (sizes[i] - targets[i]), 0);
    if (headroomSum <= 1e-9) break;
    let used = 0;
    const next = [];
    for (const i of active) {
      const headroom = sizes[i] - targets[i];
      const add = Math.min((leftover * headroom) / headroomSum, headroom);
      targets[i] += add;
      used += add;
      if (targets[i] < sizes[i] - 1) next.push(i); // still has headroom for another round
    }
    leftover -= used;
    active = next;
    if (used <= 1e-6) break; // converged (everyone at cap)
  }
  return targets;
}

/* Bytes encoded in a data: URI's base64 payload (used to compare an encode against its
   byte target). Pure string math, so it lives here with the rest. */
export function dataUrlByteLength(dataUrl) {
  if (!dataUrl) return 0;
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const len = b64.length;
  if (!len) return 0;
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((len / 4) * 3) - pad;
}
