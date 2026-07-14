/* =========================================================
   Plot editor — the "Draw Your Plan" Konva surface.
   Raster material grid (cellState painted onto an offscreen
   canvas) + vector annotations (callouts / measurements /
   Line-tool walls) + undo/redo + DOM-scroll pan/zoom + the
   offscreen print/preview compositor.
   Pure geometry (grid projection, flood-fill core) lives in
   geometry.js; form plumbing (autosave, progress, packet)
   in app.js; the parcel/orientation come in through
   rebuildGridForParcel() and setPlotBackdrop() from the
   map wizard.
   ========================================================= */
import {
  CELL_SIZE, FEET_PER_CELL, LINE_WIDTH_FEET, FOOT_IN_METERS,
  computeBBox, fitSimilarity, buildParcelGrid, computeFloodFill, pointInPolygon,
  interpolateAerialNudge, applyPolygonOffsets
} from "./geometry.js";
import { $, $$, trapModalFocus, releaseModalFocus } from "./utils.js";
// Function-only imports from the entry module (a deliberate ESM cycle: app.js
// imports this module. Hoisted function declarations are safe to import in a
// cycle as long as they're only CALLED at event time — never read a non-function
// binding from app.js at this module's top level).
import { scheduleAutosave, updateProgress } from "./app.js";

// The material library's built-in presets, in the order the library grid (and a
// pre-library draft's default chip row) shows them: the "Empty" eraser-as-material
// entry first, then ground covers → hardscape → water → structures. Ids are
// persisted in drafts — never rename one, only add.
// "empty" is the palette's one sentinel: picking it as the active material makes
// Marker/Rectangle/Fill erase instead of paint (onStagePointerDown/Move resolve
// activeMaterial === EMPTY_MATERIAL to a null cell id, same as a right-click quick-
// erase), so its color/texture only ever render as a swatch — cellState never
// actually stores "empty", so it can never show up in the "materials used" print
// legend the way a real material would.
const EMPTY_MATERIAL = "empty";
const PALETTE = [
  { id: EMPTY_MATERIAL, label: "Empty",             color: "#f2efe7", texture: "empty" },
  { id: "turf",        label: "Turf",               color: "#7cb342" },
  { id: "grass",       label: "Grass",              color: "#a5d36a", texture: "tufts" },
  { id: "groundcover", label: "Ground Cover Plants", color: "#4e8f43", texture: "tufts" },
  { id: "mulch",       label: "Mulch / Planter",    color: "#b07a4e", texture: "dashes" },
  { id: "dg",          label: "Decomposed Granite", color: "#c9a86a", texture: "dots" },
  { id: "gravel",      label: "Gravel / Rock",      color: "#98928a", texture: "speckle" },
  { id: "concrete",    label: "Concrete",           color: "#c2bdb2", texture: "speckle" },
  { id: "pavers",      label: "Pavers",             color: "#b3714e", texture: "brick" },
  { id: "deck",        label: "Wood Deck",          color: "#9a6b3f", texture: "diag" },
  { id: "patio",       label: "Patio Cover",        color: "#d98a6a", texture: "diag" },
  { id: "pool",        label: "Pool / Spa",         color: "#2f7d9c", texture: "waves" },
  { id: "retaining",   label: "Retaining Wall",     color: "#7a5c46", texture: "brick" },
  { id: "shed",        label: "Shed",               color: "#e2473b", texture: "cross" }
];
// Point objects retired from the paint palette (they're Stamps now). Their ids stay
// resolvable so cells painted in old drafts still render — and the legend can name them.
const RETIRED_MATERIALS = [
  { id: "tree",   label: "Tree",       color: "#2e6b35" },
  { id: "light",  label: "Yard Light", color: "#f4c430" },
  { id: "camera", label: "Camera",     color: "#6a4bb0" }
];
// Every id the paint layer can resolve: live chips + retired ids + the user's custom
// materials (setCustomMaterials/addCustomMaterial mutate this map in place).
const PALETTE_MAP = Object.fromEntries([...PALETTE, ...RETIRED_MATERIALS].map(p => [p.id, p]));
let customMaterials = []; // { id, label, color, texture? } user-defined, persisted as plot.customMaterials
// The swatches actually in the work row above the canvas — ids (built-in or custom) picked
// from the material library, in chip order. Persisted as plot.selectedMaterials; empty until
// the library modal's first "Use these materials".
let selectedMaterials = [];

/* --- Material textures --------------------------------------------------------
   Standard plan-drafting hatches so similar colors still read apart over the
   aerial (solid grey concrete all but vanishes). Each `draw` lays its marks over
   an already-color-filled TEXTURE_TILE-square canvas; the geometry is periodic
   (spacings divide the tile, edge marks are drawn on both edges) so the tile
   repeats seamlessly — and because TEXTURE_TILE is a whole number of cells,
   per-cell fillRect calls stay aligned (canvas patterns anchor at the canvas
   origin, not the fill rect). Coordinates below are authored for a 16px tile
   and scaled by k, so a CELL_SIZE change won't distort them. */
const TEXTURE_TILE = CELL_SIZE * 2;
const TEXTURES = {
  speckle: { label: "Speckle", draw(ctx, s, mark) {      // concrete stipple
    const k = s / 16;
    ctx.fillStyle = mark;
    [[3, 3], [10, 2], [6, 7], [13, 9], [2, 12], [9, 13], [13.5, 14], [5, 14.5]].forEach(([x, y]) => {
      ctx.beginPath(); ctx.arc(x * k, y * k, 0.95 * k, 0, Math.PI * 2); ctx.fill();
    });
  } },
  dots: { label: "Dots", draw(ctx, s, mark) {            // offset dot grid (gravel / DG)
    const k = s / 16;
    ctx.fillStyle = mark;
    [[4, 4], [12, 12]].forEach(([x, y]) => {
      ctx.beginPath(); ctx.arc(x * k, y * k, 1.3 * k, 0, Math.PI * 2); ctx.fill();
    });
  } },
  diag: { label: "Hatch", draw(ctx, s, mark) {           // single diagonal hatch (roofing / cover)
    const k = s / 16;
    ctx.strokeStyle = mark; ctx.lineWidth = 1.3 * k; ctx.beginPath();
    for (let b = -16; b <= 16; b += 8) { ctx.moveTo(-2 * k, (b - 2) * k); ctx.lineTo(18 * k, (b + 18) * k); }
    ctx.stroke();
  } },
  cross: { label: "Cross-hatch", draw(ctx, s, mark) {    // structure
    TEXTURES.diag.draw(ctx, s, mark);
    const k = s / 16;
    ctx.strokeStyle = mark; ctx.lineWidth = 1.3 * k; ctx.beginPath();
    for (let b = 0; b <= 32; b += 8) { ctx.moveTo(-2 * k, (b + 2) * k); ctx.lineTo(18 * k, (b - 18) * k); }
    ctx.stroke();
  } },
  brick: { label: "Brick", draw(ctx, s, mark) {          // running bond (walls / pavers)
    const k = s / 16;
    ctx.strokeStyle = mark; ctx.lineWidth = 1.1 * k; ctx.beginPath();
    [0, 8, 16].forEach(y => { ctx.moveTo(0, y * k); ctx.lineTo(16 * k, y * k); });
    ctx.moveTo(8 * k, 0); ctx.lineTo(8 * k, 8 * k);
    ctx.moveTo(0, 8 * k); ctx.lineTo(0, 16 * k);
    ctx.moveTo(16 * k, 8 * k); ctx.lineTo(16 * k, 16 * k);
    ctx.stroke();
  } },
  dashes: { label: "Dashes", draw(ctx, s, mark) {        // mulch / bark
    const k = s / 16;
    ctx.strokeStyle = mark; ctx.lineWidth = 1.2 * k; ctx.lineCap = "round"; ctx.beginPath();
    [[2, 3, 6, 4], [9.5, 6, 13.5, 5], [3, 11, 7, 11], [10, 13.5, 14, 12.5]].forEach(([x0, y0, x1, y1]) => {
      ctx.moveTo(x0 * k, y0 * k); ctx.lineTo(x1 * k, y1 * k);
    });
    ctx.stroke();
  } },
  tufts: { label: "Tufts", draw(ctx, s, mark) {          // grass
    const k = s / 16;
    ctx.strokeStyle = mark; ctx.lineWidth = 1.1 * k; ctx.lineCap = "round"; ctx.beginPath();
    [[4, 6.5], [12, 14]].forEach(([x, y]) => {
      ctx.moveTo(x * k, y * k); ctx.lineTo((x - 1.6) * k, (y - 2.6) * k);
      ctx.moveTo(x * k, y * k); ctx.lineTo(x * k, (y - 3.2) * k);
      ctx.moveTo(x * k, y * k); ctx.lineTo((x + 1.6) * k, (y - 2.6) * k);
    });
    ctx.stroke();
  } },
  waves: { label: "Waves", draw(ctx, s, mark) {          // water (pool / spa)
    // Two full-width S-curves per tile. Each row's start/end tangents match ((±4, ∓3)
    // control offsets at both ends), so the wave continues seamlessly across tile
    // seams; rows are mirrored for a watery alternation and stay ≥1px inside the
    // tile, so no both-edges duplication is needed.
    const k = s / 16;
    ctx.strokeStyle = mark; ctx.lineWidth = 1.2 * k; ctx.lineCap = "round"; ctx.beginPath();
    [[4, -1], [12, 1]].forEach(([y, dir]) => {
      ctx.moveTo(0, y * k);
      ctx.quadraticCurveTo(4 * k, (y + 3 * dir) * k, 8 * k, y * k);
      ctx.quadraticCurveTo(12 * k, (y - 3 * dir) * k, 16 * k, y * k);
    });
    ctx.stroke();
  } },
  empty: { label: "None", draw(ctx, s) {         // "Empty" material swatch — a diagonal
    // erase-red slash (matches the erase-gesture ghost color, #a4111f) rather than a
    // brightness-derived mark, since this tile is never actually painted onto the grid.
    const k = s / 16;
    ctx.strokeStyle = "#a4111f"; ctx.lineWidth = 1.6 * k; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(2.5 * k, 13.5 * k); ctx.lineTo(13.5 * k, 2.5 * k); ctx.stroke();
  } }
};

// Marks darker than the fill on light materials, lighter on dark ones (a black
// hatch on the dark-brown retaining wall would be invisible — light "mortar"
// lines read better anyway).
function textureMarkStyle(color) {
  return perceivedBrightness(color) < 110 ? "rgba(255,255,255,.5)" : "rgba(0,0,0,.34)";
}

// "texture|color" → the finished tile canvas (base color + marks). Shared by the
// paint patterns and every swatch (palette chips, legends, popover previews).
const textureTileCache = new Map();
function textureTile(tex, color) {
  const key = tex + "|" + color;
  let cv = textureTileCache.get(key);
  if (cv) return cv;
  cv = document.createElement("canvas");
  cv.width = cv.height = TEXTURE_TILE;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, TEXTURE_TILE, TEXTURE_TILE);
  TEXTURES[tex].draw(ctx, TEXTURE_TILE, textureMarkStyle(color));
  textureTileCache.set(key, cv);
  return cv;
}

// CanvasPatterns are minted against gridCtx — cleared whenever makeGridCanvases
// replaces it.
const cellPatternCache = new Map();
function cellFillStyle(id) {
  const m = PALETTE_MAP[id];
  const color = m?.color || "#7cb342";
  const tex = m?.texture;
  if (!tex || !TEXTURES[tex]) return color;
  const key = tex + "|" + color;
  let pat = cellPatternCache.get(key);
  if (!pat) {
    pat = gridCtx.createPattern(textureTile(tex, color), "repeat");
    cellPatternCache.set(key, pat);
  }
  return pat;
}

// One inline-style string for anything that renders a material swatch — palette
// chips here, the preview/print legends in app.js.
export function materialSwatchStyle(m) {
  let css = "background-color:" + m.color;
  if (m.texture && TEXTURES[m.texture]) css += ";background-image:url(" + textureTile(m.texture, m.color).toDataURL() + ")";
  return css;
}

// Point-object plan symbols placed by the Stamp tool. Two kinds share the STAMPS list:
// image stamps (`img`, a full-color top-down SVG in a `box`×`box` viewBox — the plant/
// landscape catalog in assets/stamps/) and path stamps (`d`, a 24×24 stroke-only path,
// default `box` 24 — the legacy hardware symbols, drawn twice as a white-halo-under-black-
// stroke pair). `ft` is the real-world footprint the box is scaled to.
const STAMPS = [
  { id: "canopy_tree",        label: "Canopy tree",        ft: 20, box: 64, img: "assets/stamps/canopy_tree.svg" },
  { id: "ornamental_tree",    label: "Ornamental tree",    ft: 10, box: 64, img: "assets/stamps/ornamental_tree.svg" },
  { id: "fruit_tree",         label: "Fruit tree",         ft: 12, box: 64, img: "assets/stamps/fruit_tree.svg" },
  { id: "palm",                label: "Palm",               ft: 10, box: 64, img: "assets/stamps/palm.svg" },
  { id: "conifer",             label: "Conifer",            ft: 10, box: 64, img: "assets/stamps/conifer.svg" },
  { id: "round_shrub",         label: "Round shrub",        ft: 4,  box: 64, img: "assets/stamps/round_shrub.svg" },
  { id: "hedge",               label: "Hedge",              ft: 6,  box: 64, img: "assets/stamps/hedge.svg" },
  { id: "shrub_row",           label: "Shrub row",          ft: 8,  box: 64, img: "assets/stamps/shrub_row.svg" },
  { id: "groundcover",         label: "Groundcover",        ft: 6,  box: 64, img: "assets/stamps/groundcover.svg" },
  { id: "turf_lawn",           label: "Turf lawn",          ft: 8,  box: 64, img: "assets/stamps/turf_lawn.svg" },
  { id: "ornamental_grass",    label: "Ornamental grass",   ft: 4,  box: 64, img: "assets/stamps/ornamental_grass.svg" },
  { id: "flower_bed",          label: "Flower bed",         ft: 6,  box: 64, img: "assets/stamps/flower_bed.svg" },
  { id: "succulent_rosette",   label: "Succulent rosette",  ft: 2,  box: 64, img: "assets/stamps/succulent_rosette.svg" },
  { id: "agave",               label: "Agave",              ft: 3,  box: 64, img: "assets/stamps/agave.svg" },
  { id: "cactus",              label: "Cactus",             ft: 4,  box: 64, img: "assets/stamps/cactus.svg" },
  { id: "yucca",               label: "Yucca",              ft: 4,  box: 64, img: "assets/stamps/yucca.svg" },
  { id: "vine_trellis",        label: "Vine / trellis",     ft: 4,  box: 64, img: "assets/stamps/vine_trellis.svg" },
  { id: "raised_planter",      label: "Raised planter",     ft: 6,  box: 64, img: "assets/stamps/raised_planter.svg" },
  { id: "potted_plant",        label: "Potted plant",       ft: 2,  box: 64, img: "assets/stamps/potted_plant.svg" },
  { id: "native_planting_mix", label: "Native planting mix", ft: 8, box: 64, img: "assets/stamps/native_planting_mix.svg" },
  { id: "mulch_bed",           label: "Mulch bed",          ft: 6,  box: 64, img: "assets/stamps/mulch_bed.svg" },
  { id: "gravel_rock_bed",     label: "Gravel / rock bed",  ft: 6,  box: 64, img: "assets/stamps/gravel_rock_bed.svg" },
  { id: "boulder",             label: "Boulder",            ft: 4,  box: 64, img: "assets/stamps/boulder.svg" },
  { id: "plant_remove",        label: "Plant to remove",    ft: 3,  box: 64, img: "assets/stamps/plant_remove.svg" },
  { id: "camera",  label: "Camera",      ft: 3,  d: "M3 8h11v8H3zM14 11l6-3v8l-6-3" },
  { id: "light",   label: "Yard Light",  ft: 3,  d: "M12 5a3 3 0 1 0 0 6 3 3 0 1 0 0-6M12 11v10M8.5 21h7M12 1.5V3M7.4 4.4l1.1 1.1M16.6 4.4l-1.1 1.1" },
  { id: "ac",      label: "AC Unit",     ft: 4,  d: "M4 4h16v16H4zM12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8M12 11.2v1.6" }
];

// Preloaded <img> elements backing image stamps, keyed by stamp id — same-origin static
// SVGs (assets/stamps/), loaded once at module init. A stamp Konva.Image can be created
// before its element finishes loading; the onload here just triggers a redraw so it
// appears as soon as it's ready instead of waiting on the next unrelated draw.
const STAMP_IMG_CACHE = {};
STAMPS.forEach(s => {
  if (!s.img) return;
  const el = new Image();
  el.onload = () => { drawLayer?.batchDraw(); overlayLayer?.batchDraw(); };
  el.src = s.img;
  STAMP_IMG_CACHE[s.id] = el;
});
const STAMP_MAP = Object.fromEntries(STAMPS.map(s => [s.id, s]));

// Inline stroke icons (18px, currentColor) — one per tool. Most are 24-box glyphs at
// stroke 1.9; the user-supplied ones (fill, pan) are 48-box, so their stroke-width
// doubles to 3.8 for the same visual weight — cursorForMode reads each icon's own viewBox
// to scale its halo/ink strokes to match.
const ICON = {
  marker: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 3.5 20.5 6.5 10 17 5.5 18.5 7 14 17.5 3.5Z"/><path d="M4.5 20.5h5"/></svg>',
  rect: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/></svg>',
  fill: '<svg viewBox="0 0 48 48" width="17" height="17" fill="none" stroke="currentColor" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round"><path d="M39 20.9706L22.0294 4L5.76599 20.2635C3.81337 22.2161 3.81337 25.3819 5.76599 27.3345L15.6655 37.234C17.6181 39.1866 20.7839 39.1866 22.7366 37.234L39 20.9706Z"/><path d="M7.5 18.5L7.95002 18.8326C15.0052 24.0473 23.892 26.1367 32.5317 24.6121L36 24"/><path d="M40 31C42.619 32.9566 44.5 35.32 44.5 38.2738C44.5 40.8839 42.4851 43 40 43C37.5149 43 35.5 40.8839 35.5 38.2738C35.5 35.32 37.381 32.9566 40 31Z"/></svg>',
  callout: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v11H10l-4 4v-4H4z"/></svg>',
  measure: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="8" width="20" height="8" rx="1.2"/><path d="M6.5 8v3M10 8v4M13.5 8v3M17 8v4"/></svg>',
  select: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3l5.5 15 2-6.4 6.4-2z"/><path d="m13.5 13.5 5 5"/></svg>',
  pan: '<svg viewBox="0 0 48 48" width="17" height="17" fill="none" stroke="currentColor" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round"><path d="M33.75 18.3158L33.75 12.375C33.75 10.511 35.261 9 37.125 9V9C38.989 9 40.5 10.511 40.5 12.375L40.5 35C40.5 40.5228 36.0229 45 30.5 45L22.8952 45C21.1851 45 19.4876 44.7076 17.8761 44.1354L17.1685 43.8841C12.5233 42.2347 8.98492 38.4083 7.70341 33.6484L4.7249 22.5853C4.57796 22.0396 4.58819 21.4634 4.75441 20.9232L4.86976 20.5483C5.71594 17.7982 9.57317 17.7012 10.5565 20.4053L13.5 28.5L13.5 9.375C13.5 7.51104 15.011 6 16.875 6V6C18.739 6 20.25 7.51104 20.25 9.375L20.25 14.2105"/><path d="M20.25 21L20.25 5.375C20.25 3.51104 21.761 2 23.625 2V2C25.489 2 27 3.51104 27 5.375V21"/><path d="M27 20.5V8.375C27 6.51104 28.511 5 30.375 5V5C32.239 5 33.75 6.51104 33.75 8.375V22.5"/></svg>',
  line: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20 20 4"/><circle cx="4" cy="20" r="1.7" fill="currentColor" stroke="none"/><circle cx="20" cy="4" r="1.7" fill="currentColor" stroke="none"/></svg>',
  stamp: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21h14"/><path d="M6.5 18h11c.6 0 1-.4 1-1v-.5a2.5 2.5 0 0 0-2.5-2.5h-2c-.6 0-1-.5-1-1.1 0-2 1.6-2.6 1.6-4.9a2.6 2.6 0 1 0-5.2 0c0 2.3 1.6 2.9 1.6 4.9 0 .6-.4 1.1-1 1.1H8A2.5 2.5 0 0 0 5.5 16.5v.5c0 .6.4 1 1 1z"/></svg>',
  align: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>'
};

// Each tool's one-line hint is shown above the canvas while that tool is selected
// (replaces the old wall-of-text intro paragraph). Edit the copy here, not the DOM.
// `key` is the tool's single-letter hotkey (active while the pointer is over the canvas;
// shown in the rail tooltip by buildToolbar).
const TOOL_MODES = [
  { id: "paint",    label: "Marker",    key: "m", icon: ICON.marker,
    hint: "Drag to paint the selected material — hold <strong>Shift</strong> for a straight stroke; <strong>Alt</strong>+scroll (or the control here) changes thickness. Pick <strong>Empty</strong> to erase instead, or right-click erases from any tool." },
  { id: "rect",     label: "Rectangle", key: "r", icon: ICON.rect,
    hint: "Drag diagonally to fill a solid block with the selected material — pick <strong>Empty</strong> to clear a block instead." },
  { id: "fill",     label: "Fill",     key: "f", icon: ICON.fill,
    hint: "Click an enclosed area to flood it with the selected material — <strong>Outline</strong> edges act as walls. Pick <strong>Empty</strong> to flood-clear it instead, or right-click floods it back to empty." },
  { id: "stamp",    label: "Stamp",    key: "s", icon: ICON.stamp,
    hint: "Pick a symbol here in this bar, then click inside your property line to place it — <strong>Select</strong> moves one, right-click deletes it." },
  { id: "line",     label: "Outline",  key: "o", icon: ICON.line,
    hint: "Drag between two points to draw an outline edge. It snaps to grid corners and blocks <strong>Fill</strong> like a wall." },
  { id: "callout",  label: "Callout",  key: "c", icon: ICON.callout,
    hint: "Press where the label should sit, drag to the thing it points at, release, then type the text." },
  { id: "measure",  label: "Measure",  key: "d", icon: ICON.measure,
    hint: "Drag between two points to add a dimension arrow labeled with the distance in feet." },
  { id: "select",   label: "Select",   key: "v", icon: ICON.select,
    hint: "Drag a shape to move it. Round handles reshape an outline, measurement, or callout — double-click a callout to edit its text. <strong>Backspace</strong> or the red &times; deletes the selected shape." },
  { id: "align",    label: "Align Corners", key: "a", icon: ICON.align,
    hint: "Drag a corner to match what you actually see in the aerial photo. This only corrects the outline trace and where Stamps may be placed — it does not move or re-scale the photo itself." },
  { id: "pan",      label: "Pan",      key: "p", icon: ICON.pan,
    hint: "Drag to move around your plan. From any tool: hold <strong>Space</strong> or middle-mouse to drag-pan, mouse wheel zooms — on a touch screen, drag with two fingers to pan and pinch to zoom." }
];

// Per-tool canvas cursor. Select/Pan/Stamp/Fill/Marker keep the full glyph-as-cursor treatment
// (a white-halo + dark-stroke rendering of the tool's rail icon, same look as a Stamp on the
// canvas) since those tools' "active point" isn't obvious from a crosshair alone. HOTSPOT is
// where in the 26x26 glyph the tool's active point sits (e.g. a marker's tip); tools without a
// natural tip use the glyph's center. Pan keeps the native grab/grabbing hand — that's already a
// conventional, dynamic (idle vs. dragging) pan affordance a static glyph can't reproduce.
// Every other tool gets a plain crosshair with the tool's glyph badged above-and-right of it, so
// the click point stays exact while still showing which tool is active.
const CURSOR_SIZE = 26;
const CURSOR_HOTSPOT = {
  paint: [6, 20], select: [5, 3]
};
const KEEP_ICON_CURSOR = new Set(["select", "pan", "stamp", "fill", "paint"]);
const cursorCache = {};
function cursorForMode(mode) {
  if (mode === "pan") return "grab";
  if (cursorCache[mode]) return cursorCache[mode];
  const t = TOOL_MODES.find(x => x.id === mode);
  const fallback = mode === "select" ? "default" : "crosshair";
  if (!t || !t.icon) return fallback;
  const inner = (t.icon.match(/<svg[^>]*>([\s\S]*)<\/svg>/) || [, ""])[1];
  // Most rail icons live in a 24-box, but not all (Fill/Pan are 48-box) —
  // read the glyph's own viewBox and scale the halo/ink stroke widths to match,
  // or a larger-box icon would render clipped and visually half-weight.
  const vb = Number((t.icon.match(/viewBox="0 0 (\d+)/) || [])[1]) || 24;
  const sw = w => (w * vb / 24).toFixed(2);
  let svg, hx, hy;
  if (KEEP_ICON_CURSOR.has(mode)) {
    [hx, hy] = CURSOR_HOTSPOT[mode] || [CURSOR_SIZE / 2, CURSOR_SIZE / 2];
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vb} ${vb}" width="${CURSOR_SIZE}" height="${CURSOR_SIZE}">`
      + `<g fill="none" stroke="#fff" stroke-width="${sw(3.4)}" stroke-linecap="round" stroke-linejoin="round">${inner.replace(/currentColor/g, "#fff")}</g>`
      + `<g fill="none" stroke="#1c1c1c" stroke-width="${sw(1.7)}" stroke-linecap="round" stroke-linejoin="round">${inner.replace(/currentColor/g, "#1c1c1c")}</g>`
      + `</svg>`;
  } else {
    const SIZE = 36, cx = 10, cy = 26, arm = 7, gap = 2, iconSize = 15;
    hx = cx; hy = cy;
    const cross = `
      <line x1="${cx}" y1="${cy - arm}" x2="${cx}" y2="${cy - gap}" />
      <line x1="${cx}" y1="${cy + gap}" x2="${cx}" y2="${cy + arm}" />
      <line x1="${cx - arm}" y1="${cy}" x2="${cx - gap}" y2="${cy}" />
      <line x1="${cx + gap}" y1="${cy}" x2="${cx + arm}" y2="${cy}" />`;
    const iconX = cx + 5, iconY = cy - arm - iconSize - 1;
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">`
      + `<g fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round">${cross}</g>`
      + `<g fill="none" stroke="#1c1c1c" stroke-width="1.4" stroke-linecap="round">${cross}</g>`
      + `<g transform="translate(${iconX},${iconY}) scale(${iconSize / vb})">`
      + `<g fill="none" stroke="#fff" stroke-width="${sw(3.4)}" stroke-linecap="round" stroke-linejoin="round">${inner.replace(/currentColor/g, "#fff")}</g>`
      + `<g fill="none" stroke="#1c1c1c" stroke-width="${sw(1.7)}" stroke-linecap="round" stroke-linejoin="round">${inner.replace(/currentColor/g, "#1c1c1c")}</g>`
      + `</g>`
      + `</svg>`;
  }
  const cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hx} ${hy}, ${fallback}`;
  cursorCache[mode] = cursor;
  return cursor;
}

// Fixed real-world scale (1 grid tile = 1 sq ft, CELL_SIZE px at 100% zoom) — the scale
// constants and the projection math live in geometry.js.
const MAX_ZOOM_ABS = 6;       // hard zoom-in cap (relative to 100%)
const ANNOTATION_FONT_PX = 9;   // callout + measurement text baseline, in CSS px. The text nodes carry a
                                // counter-scale (see syncAnnotationTextScale) so they read 9px on screen up
                                // to ANNOTATION_REF_ZOOM, then scale UP with the view past it — so a
                                // measurement grows as you zoom in but never shrinks below 9px when zoomed
                                // out. renderPlotImage() re-normalizes them to land at 9px on the printed page.
const ANNOTATION_REF_ZOOM = 0.71; // pivot: at/below this zoom labels hold at ANNOTATION_FONT_PX (the size
                                  // the user found right at ~71%); above it they scale proportionally.
const PRINT_PLOT_WIDTH_PX = 340; // how wide the plan prints, in the print doc's CSS px: letter page
                                 // (8.5in) minus 16mm side margins ≈ 695px, split into two flex
                                 // columns with a 14px gap (see buildPrintHTML's .print-col/.print-plot)
const SCREEN_AERIAL_OPACITY = 0.33; // faint tracing aid on the live stage AND in print — the printed
                                    // packet matches the builder: this faded opacity plus a real
                                    // multiply blend (globalCompositeOperation in renderPlotImage)
const SAFE_CANVAS_PX = 3200;  // cap on the backing canvas's longest side (content × zoom) to bound memory
// Ground-truth aerial alignment calibration. The county's 2020 orthophoto sits a few feet off
// the parcel vectors at any given lot — verified NOT a datum issue (a NAD83↔WGS84
// datumTransformation on the query moves the parcels 0.00 ft) and NOT a projection-choice bug in
// this app's own math either (empirically checked: fitting the aerial's true-Web-Mercator vertex
// projection against this grid's local-tangent-plane one, over real parcel rings up to 250+ ft
// across at several bearings, leaves a residual of ~1e-4 ft — fitSimilarity's scale term already
// absorbs the whole Mercator-vs-equirectangular gap as a pure uniform scale). So the drift is
// real ortho-rectification error in the source imagery itself, and — unlike a coordinate bug —
// that error varies across the neighborhood (mosaic seams, camera-model residuals), which is why
// a single flat constant looked right on one lot and visibly off on others. Fix: treat it as a
// standard control-point/rubber-sheeting problem. Each entry is a hand-calibrated ground vector
// (feet, +E/+N) at a real lng/lat, gathered by eye with the dev-only calibration overlay below
// (add ?calibrate-aerial to the URL); interpolateAerialNudge() (geometry.js) inverse-distance-
// weights them for whatever parcel is on screen. rebuildBgLayer()/renderPlotImage() rotate the
// result by the parcel's own bearing into stage space, so it's correct at any orientation.
// Seeded with 11506 Aaron Ave (the user's trusted reference, carrying forward the old flat
// constant's exact value), a first round gathered 2026-07-05 with the calibration overlay,
// spot-checked against tools/find-calibration-addresses.mjs's Fairway-Canyon-bbox evidence (2 of
// the 5 raw points gathered that round — Brutus Way, Crenshaw St — landed outside that bbox in a
// different Beaumont subdivision and were deliberately left out; see ISSUES.md), and a second
// round from that tool's own recommended addresses (compass extremes + interior spread). Note
// 11010 Coody Ct's correction is notably larger than every other point (~8 ft vs ~1–4 ft) — kept
// as reported (spatially-varying ortho error is exactly what this scheme exists to capture, and
// the user visited it deliberately as a recommended point), but worth a recheck if it ever looks
// wrong on screen, since some 2020-imagery lots are still bare dirt and harder to align by eye.
const AERIAL_CONTROL_POINTS = [
  { lng: -117.045522, lat: 33.953612, east: -1.0, north: -3.6 },  // 11506 Aaron Ave, APN 413882015
  { lng: -117.051413, lat: 33.956888, east: -2.5, north: -2.9 },  // 34928 Roberts Pl, APN 413892010
  { lng: -117.048267, lat: 33.955035, east: -2.0, north: -3.3 },  // 11455 Aaron Ave, APN 413881020
  { lng: -117.042862, lat: 33.951759, east: -1.3, north: -3.2 },  // 35339 Stewart St, APN 413871014
  { lng: -117.054035, lat: 33.963262, east: -1.72, north: -2.74 }, // 11284 Demaret Dr, APN 413671005
  { lng: -117.039374, lat: 33.961756, east: -7.95, north: -7.28 }, // 11010 Coody Ct, APN 413520013 (outlier, see above)
  { lng: -117.046327, lat: 33.956176, east: -4.81, north: -3.04 }, // 11429 Lyle Ln, APN 413820018
  { lng: -117.045897, lat: 33.960531, east: -0.74, north: -3.23 }, // 35216 Hogan Dr, APN 413500003
  { lng: -117.043714, lat: 33.959970, east: -1.72, north: -3.27 }, // 35315 Hogan Dr, APN 413501005
  { lng: -117.043656, lat: 33.962221, east: -1.56, north: -5.95 }, // 11014 Watson Way, APN 413540022
  { lng: -117.044090, lat: 33.960527, east: -2.15, north: -2.46 }, // 35290 Hogan Dr, APN 413500011
  // Fourth round (2026-07-06), gathered with the rapid Ctrl+arrow walk — all pre-vetted by
  // construction (loadCalibCandidates already filters to this same bbox + Beaumont city):
  { lng: -117.040557, lat: 33.955071, east: -3.75, north: -2.01 }, // 35492 Smith Ave
  { lng: -117.044115, lat: 33.954837, east: -2.21, north: -3.73 }, // 35262 Goalby Dr
  { lng: -117.042128, lat: 33.955138, east: -2.2,  north: -3.01 }, // 35338 Thorpe Tr
  { lng: -117.035818, lat: 33.955275, east: 0.83,  north: -4.15 }, // 11448 Trevor Way
  { lng: -117.035046, lat: 33.955887, east: -0.41, north: -2.16 }, // 35948 Michelle Ln
  { lng: -117.043183, lat: 33.955873, east: -1.06, north: -3.45 }, // 35331 Smith Ave
  { lng: -117.042289, lat: 33.956109, east: -4.15, north: -2.34 }, // 35368 Smith Ave (avg of 2 readings, see fifth-round note)
  { lng: -117.03596,  lat: 33.956269, east: 0.03,  north: -2.09 }, // 35930 Michelle Ln
  { lng: -117.039185, lat: 33.956482, east: -0.77, north: -2.91 }, // 35520 Stockton St
  { lng: -117.045396, lat: 33.956387, east: -2.09, north: -3.16 }, // 35209 Smith Ave
  { lng: -117.051558, lat: 33.95708,  east: -1.4,  north: -2.91 }, // 34920 Roberts Pl
  { lng: -117.048384, lat: 33.957038, east: -2.79, north: -3.94 }, // 11380 Aaron Ave
  { lng: -117.044562, lat: 33.956752, east: -4.62, north: -2.12 }, // 35236 Smith Ave
  { lng: -117.034943, lat: 33.957098, east: 0.37,  north: 1.05 },  // 35942 Dylan Ct (avg of 2 readings, see fifth-round note)
  { lng: -117.038664, lat: 33.957388, east: -1.29, north: -4.06 }, // 35582 Byron Tr
  // Fifth round (2026-07-06), also via the rapid Ctrl+arrow walk. Two stops (35368 Smith Ave,
  // 35942 Dylan Ct) turned out to already be in the fourth round — same lng/lat exactly, different
  // manual reading — so those two entries above were averaged in place rather than duplicated:
  // interpolateAerialNudge()'s exact-match early-return would otherwise silently favor whichever
  // duplicate happens to iterate first for that one house, while every *other* house would see it
  // double-weighted (same distance from two entries at the same point). One entry per location.
  { lng: -117.043021, lat: 33.952755, east: -2.52, north: -3.18 }, // 35325 Stewart St
  { lng: -117.034949, lat: 33.954994, east: 0.22,  north: -3.94 }, // 35979 Michelle Ln
  { lng: -117.046003, lat: 33.955655, east: -3.95, north: -3.81 }, // 11445 Lyle Ln
  { lng: -117.043049, lat: 33.957794, east: -0.66, north: -3.05 }, // 11445 Locke Ln
  { lng: -117.044837, lat: 33.958517, east: -0.38, north: -3.81 }, // 35261 Stockton St
  { lng: -117.035564, lat: 33.958978, east: 1.18,  north: -2.74 }, // 35972 Anderson St
  { lng: -117.037485, lat: 33.958958, east: -0.46, north: -3.96 }, // 35761 Trevino Tr
  { lng: -117.038042, lat: 33.959496, east: -1.04, north: -2.32 }, // 35718 Trevino Tr
  // Sixth round (2026-07-06), also via the rapid Ctrl+arrow walk. 11286 Coody Ct's correction is
  // another outlier (~9 ft, like 11010 Coody Ct above) — two different houses on the same street
  // both showing a much larger offset than their neighbors suggests this block's 2020 orthophoto
  // has more localized error, not a bad reading; kept as reported.
  { lng: -117.035585, lat: 33.959451, east: 4.36,  north: -3.65 }, // 35934 Anderson St
  { lng: -117.03709,  lat: 33.959918, east: 4.25,  north: -3.44 }, // 11231 Casper Cove
  { lng: -117.044336, lat: 33.960004, east: -1.62, north: -4.02 }, // 35287 Hogan Dr
  { lng: -117.053618, lat: 33.959813, east: -2.1,  north: -3.92 }, // 34851 Miller Pl
  { lng: -117.051933, lat: 33.960064, east: -1.43, north: -3.16 }, // 34918 Miller Pl
  { lng: -117.046892, lat: 33.960095, east: -1.56, north: -3.87 }, // 35161 Hogan Dr
  { lng: -117.043877, lat: 33.960069, east: -1.78, north: -4.3  }, // 35303 Hogan Dr
  { lng: -117.039687, lat: 33.960235, east: -8.24, north: -9.42 }, // 11286 Coody Ct
  { lng: -117.037992, lat: 33.960092, east: 4.08,  north: -3.33 }, // 11236 Rosburg Rd
  { lng: -117.035839, lat: 33.960276, east: 6.04,  north: -8.27 }  // 35872 Anderson St
];
let gridCols = 80;            // grid width in tiles (= feet); recomputed per parcel
let gridRows = 60;            // grid height in tiles (= feet)
let parcelPolygonPx = null;   // polygon vertices in pixel coords, traced as a Konva.Line overlay
let scaleFeetPerPixel = FEET_PER_CELL / CELL_SIZE; // real-world scale for the Measure tool (content px → feet); refined once a parcel is selected

const KONVA_AVAILABLE = typeof Konva !== "undefined";
const plotHost = $("#plot-konva-host");
let plotBgDataUrl = null; // aerial snapshot from the Orient step, shown behind the drawing as a tracing aid
let plotBgParcelPx = null; // the parcel ring projected into the snapshot's own pixel space, so the
                           // aerial can be registered 1:1 to parcelPolygonPx instead of blindly cover-fit
let plotBgImg = null;      // the decoded aerial <img>, cached once loaded so the synchronous print/preview
                           // export (renderPlotImage) can composite it without re-waiting on an async load

let stage = null, bgLayer = null, gridLayer = null, drawLayer = null, overlayLayer = null;
let gridLinesCanvas = null, paintCanvas = null, gridCtx = null; // offscreen 2D canvases behind the grid
let gridLinesNode = null, gridImageNode = null;                 // Konva.Images wrapping the two canvases
let paintClipGroup = null;                                      // clips painted material to the parcel footprint
let cellState = new Map();     // "c,r" -> material id (sparse; big lots are mostly empty)
let stageReady = false;
let activeMaterial = "turf";
let activeMode = "paint";
let brushSize = 1;             // square Marker brush, in tiles (= feet)
let eraseSize = 1;             // square eraser, in tiles (= feet) — independent of the Marker brush,
                                // used whenever the effective paint is an erase (a right-click quick-
                                // erase gesture, or Marker with the Empty material picked)
let painting = false, lastCell = null; // in-progress freehand paint/erase stroke
let eraseGesture = false;              // right-click / Ctrl(⌘)+click forces erase regardless of tool
let lineDraft = null, lineGhost = null; // shift-held straight-line paint stroke
let gridLineDraft = null, gridLineGhost = null; // Line tool: grid-snapped vector line annotation
let rectDraft = null, rectGhost = null; // Rectangle tool: drag-to-fill a block of cells
let brushGhost = null;                  // Marker footprint hover preview (thickness > 1 only)

// True while Marker would erase rather than paint on press — the Empty material is picked.
// Mirrors the id===null resolution in onStagePointerDown/Move, and picks which of
// eraseSize/brushSize the Thickness control and Alt+scroll dial (see nudgeBrushSize).
function usingEraseMaterial() { return activeMaterial === EMPTY_MATERIAL; }

let lastPlotAPN, lastPlotBearing; // guards the confirm-before-clear check in rebuildGridForParcel
let lastPlotRing = null; // current parcel's lng/lat ring — feeds the aerial nudge lookup and the calibration overlay's centroid readout
let calibNudge = { east: 0, north: 0 }; // manual dial from the dev-only calibration overlay (?calibrate-aerial), on top of the interpolated baseline; always {0,0} outside that mode
// Sparse {dx,dy}[] index-matched to parcelPolygonPx — the Align Corners tool's manual, per-vertex
// visual correction to the traced boundary, for when the county polygon's own vertex position is
// locally wrong (fence/pavement doesn't match the platted line) and a uniform aerial-photo nudge
// can't fix it. Reset only where calibNudge is reset (rebuildGridForParcel's full-rebuild branch)
// — a correction from a different parcel/bearing must never leak forward. Deliberately NEVER read
// by fitSimilarity/buildAerialNode's fit — that would re-warp the WHOLE photo's rotation/scale/
// translation from one corner's nudge. Persisted as plot.boundaryAdjust, captured in undo/redo.
let boundaryAdjust = [];

let dragOrigin = null, ghostNode = null;         // measure drag
let calloutDraft = null, calloutGhost = null;    // callout
let selectedNode = null, selectionRect = null;   // Select/move tool
let selectionDeleteBtn = null;                   // the "×" delete button on the selection box (overlayLayer)
let editAnchors = [];                            // reshape handles on the selected shape (overlayLayer)
let boundaryHandles = [];                        // Align Corners tool's draggable handles, one per distinct parcel corner (overlayLayer)
let activeStamp = "canopy_tree";                 // selected symbol in the Stamp picker
let stampArmed = null, stampGhost = null;        // press position awaiting release + cursor preview

let undoStack = [], redoStack = [], restoringHistory = false;

// View model: the stage is sized to content × viewZoom and lives inside the scrollable host,
// so panning is native scroll (scrollbars / middle-mouse / hand tool) and zoom is a resize.
let viewZoom = 1;
let panActive = false, panStartX = 0, panStartY = 0, panScrollL = 0, panScrollT = 0;
let spacePan = false;   // Space held = temporary Pan from any tool (keyboard handlers in initPlotStage)
let plotHover = false;  // pointer over the canvas host — gates the canvas hotkeys (Space, tool keys)

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
  stage.on("mouseleave", () => { removeStampGhost(); removeBrushGhost(); }); // don't leave a cursor preview stranded at the edge
  // A gesture that RELEASES past the canvas edge never fires the stage's own pointerup
  // (native events only reach elements the pointer is still over) — without this, an
  // in-progress paint stroke / measurement / callout is silently abandoned. onStagePointerUp
  // is idempotent, so double-binding alongside the stage's own listener is safe.
  window.addEventListener("pointerup", onStagePointerUp);
  window.addEventListener("pointercancel", onStagePointerUp); // touch gestures can be browser-cancelled mid-stroke
  // Touch: two-finger pinch zooms / pans. Capture phase on the host so the pinch flag is
  // set before Konva's own pointerdown starts a draw gesture with the second finger;
  // move/end on window so fingers drifting off the host don't strand the gesture.
  plotHost.addEventListener("pointerdown", onTouchPointerDown, true);
  window.addEventListener("pointermove", onTouchPointerMove);
  window.addEventListener("pointerup", onTouchPointerEnd, true);
  window.addEventListener("pointercancel", onTouchPointerEnd, true);
  // Native scroll panning: middle-mouse anywhere, or left-drag while the Pan tool is active.
  plotHost.addEventListener("pointerdown", onHostPointerDown);
  window.addEventListener("pointermove", onHostPointerMove);
  window.addEventListener("pointerup", onHostPointerUp);
  plotHost.addEventListener("mousedown", e => { if (e.button === 1) e.preventDefault(); }); // suppress MMB autoscroll
  plotHost.addEventListener("contextmenu", e => e.preventDefault()); // right-click erases instead of opening the menu
  plotHost.addEventListener("selectstart", e => e.preventDefault()); // a held thumb must never start a text selection (CSS user-select is the primary guard; this backstops engines that still fire it)
  stageReady = true;
  applyStageSize();
  fitView();
  window.addEventListener("resize", onViewportResize);
  // Pointer-over-canvas flag: Space-pan and the single-letter tool hotkeys only fire while
  // the cursor is over the drawing surface, so stray keypresses elsewhere on the (long,
  // input-heavy) form page can't invisibly switch tools or hijack the space bar.
  plotHost.addEventListener("pointerenter", () => { plotHover = true; });
  plotHost.addEventListener("pointerleave", () => { plotHover = false; });
  // Keyboard undo/redo while the Draw step is on screen: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or
  // Ctrl/Cmd+Y. Never while typing (inputs/textareas keep the browser's own text undo —
  // e.g. editing callout text), and only when the plot host is actually rendered
  // (offsetParent is null whenever the landing gate or another wizard step hides it).
  window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k !== "z" && k !== "y") return;
    if (isTypingTarget(e.target) || anyModalOpen()) return;
    if (!plotHost || plotHost.offsetParent === null) return;
    if (plotConfirmedFlag) return;   // locked plan: undo/redo disabled until "Make changes"
    e.preventDefault();
    if (k === "y" || e.shiftKey) redo(); else undo();
  });
  // Hold Space = temporary Pan from any tool (pointer must be over the canvas — see plotHover).
  // Works on a locked plan too (pan/zoom stay live for review). While held, annotations stop
  // listening/dragging so a press starts a pan, never a node drag (see syncNodeInteractivity).
  window.addEventListener("keydown", (e) => {
    if (e.code !== "Space") return;
    if (isTypingTarget(e.target) || anyModalOpen() || !plotHover || !plotHost || plotHost.offsetParent === null) return;
    e.preventDefault();  // no page scroll / focused-button activation while over the canvas
    if (e.repeat || spacePan) return; // key auto-repeat still needs the preventDefault above
    spacePan = true;
    syncAllNodeInteractivity();
    removeBrushGhost();
    if (!panActive) plotHost.style.cursor = "grab";
  });
  window.addEventListener("keyup", (e) => {
    if (e.code !== "Space" || !spacePan) return;
    spacePan = false;
    syncAllNodeInteractivity();
    if (!panActive && plotHost) plotHost.style.cursor = plotConfirmedFlag ? "default" : cursorForMode(activeMode);
  });
  window.addEventListener("blur", () => {   // released outside the window: don't strand the flag
    if (!spacePan) return;
    spacePan = false;
    syncAllNodeInteractivity();
    if (!panActive && plotHost) plotHost.style.cursor = plotConfirmedFlag ? "default" : cursorForMode(activeMode);
  });
  // Single-letter tool hotkeys (see TOOL_MODES `key`), also gated on hovering the canvas.
  // Ignored mid-gesture — switching tools inside an in-progress stroke would corrupt it.
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(e.target) || anyModalOpen()) return;
    if (!plotHover || !plotHost || plotHost.offsetParent === null || plotConfirmedFlag) return;
    if (spacePan || painting || rectDraft || lineDraft || gridLineDraft || calloutDraft || dragOrigin || stampArmed) return;
    const t = TOOL_MODES.find(x => x.key === e.key.toLowerCase());
    if (!t) return;
    e.preventDefault();
    setActiveMode(t.id);
  });
  // Backspace / Delete removes the shape selected with the Select tool.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Backspace" && e.key !== "Delete") return;
    if (isTypingTarget(e.target) || anyModalOpen()) return;
    if (!selectedNode || plotConfirmedFlag || !plotHost || plotHost.offsetParent === null) return;
    e.preventDefault();
    deleteAnnotation(selectedNode);
  });
}

// Keys must never fire while the user is typing (callout text prompts are modal, but the
// rest of the form is full of inputs) — shared guard for every canvas keyboard shortcut.
function isTypingTarget(t) {
  return !!(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable));
}
// ...nor while any dialog is open (Sprint 27's focus trap keeps focus on modal BUTTONS,
// which isTypingTarget doesn't cover — without this, Ctrl+Z in the material library would
// undo canvas strokes, Backspace would delete the selected annotation, a letter key would
// switch tools, and the Space-pan handler would swallow Space activation of a focused
// button whenever the pointer happens to still hover the canvas under the dialog).
function anyModalOpen() {
  return !!document.querySelector(".modal:not([hidden])");
}

/* --- Middle-mouse / hand-tool / held-Space panning (adjusts native scroll) --- */
function onHostPointerDown(e) {
  if (e.button === 1 || ((activeMode === "pan" || spacePan) && e.button === 0)) {
    panActive = true;
    removeBrushGhost(); // pointer capture starves the stage of move events, so hide it now
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
  plotHost.style.cursor = plotConfirmedFlag ? "default" : cursorForMode(activeMode);
}

/* --- Touch: two-finger pinch-zoom + pan (one finger keeps using the active tool) --- */
const touchPts = new Map(); // pointerId -> latest client position, touch pointers on the host only
let pinch = null;           // { startDist, startZoom, contentMid } while two fingers are down

function beginPinch() {
  // A second finger landing mid-gesture means "zoom", not "draw" — abandon whatever the
  // first finger started. A half-painted stroke is rolled back through the undo point
  // recorded when it began, so an accidental palm/finger graze leaves no paint behind.
  if (painting) {
    painting = false; lastCell = null; eraseGesture = false;
    if (undoStack.length) { applyHistorySnapshot(undoStack.pop()); updateUndoRedoButtons(); }
  }
  if (rectDraft) { rectDraft = null; if (rectGhost) { rectGhost.destroy(); rectGhost = null; } }
  if (lineDraft) { lineDraft = null; if (lineGhost) { lineGhost.destroy(); lineGhost = null; } }
  if (gridLineDraft) { gridLineDraft = null; if (gridLineGhost) { gridLineGhost.destroy(); gridLineGhost = null; } }
  if (calloutDraft) { calloutDraft = null; if (calloutGhost) { calloutGhost.destroy(); calloutGhost = null; } }
  if (dragOrigin) { dragOrigin = null; if (ghostNode) { ghostNode.destroy(); ghostNode = null; } }
  stampArmed = null; // stamps place on release, so the second finger simply disarms the tap
  removeStampGhost();
  removeBrushGhost();
  overlayLayer?.batchDraw();
  const [p1, p2] = [...touchPts.values()];
  const rect = plotHost.getBoundingClientRect();
  const mid = { x: (p1.x + p2.x) / 2 - rect.left, y: (p1.y + p2.y) / 2 - rect.top };
  pinch = {
    startDist: Math.max(Math.hypot(p1.x - p2.x, p1.y - p2.y), 1),
    startZoom: viewZoom,
    contentMid: { x: (plotHost.scrollLeft + mid.x) / viewZoom, y: (plotHost.scrollTop + mid.y) / viewZoom }
  };
}

function onTouchPointerDown(e) {
  if (e.pointerType !== "touch" || !stageReady) return;
  touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touchPts.size === 2) beginPinch();
}

function onTouchPointerMove(e) {
  if (!touchPts.has(e.pointerId)) return;
  touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!pinch || touchPts.size < 2) return;
  const [p1, p2] = [...touchPts.values()];
  const rect = plotHost.getBoundingClientRect();
  const mid = { x: (p1.x + p2.x) / 2 - rect.left, y: (p1.y + p2.y) / 2 - rect.top };
  const nz = clampZoom(pinch.startZoom * (Math.hypot(p1.x - p2.x, p1.y - p2.y) / pinch.startDist));
  viewZoom = nz;
  applyStageSize();
  // Pin the content point that began under the fingers' midpoint to wherever the midpoint
  // is now — one formula covers both the zoom (distance change) and the pan (midpoint move).
  plotHost.scrollLeft = pinch.contentMid.x * nz - mid.x;
  plotHost.scrollTop = pinch.contentMid.y * nz - mid.y;
}

function onTouchPointerEnd(e) {
  if (!touchPts.delete(e.pointerId)) return;
  if (touchPts.size < 2) pinch = null; // remaining finger doesn't draw — a new stroke needs a fresh pointerdown
}

// Clip path (content-pixel space) tracing the parcel footprint, used as the clipFunc for the
// painted-material group so paint is occluded outside the dashed red outline. Reads the
// Align-Corners-adjusted boundary each draw (see adjustedParcelPolygon), so a manual corner
// correction clips paint at the corrected line too — reused verbatim as the print clip group's
// clipFunc (renderPlotImage), so this one fix covers both the live canvas and print. Before a
// parcel resolves, it falls back to the full content rect (nothing hidden).
function clipToParcel(ctx) {
  const poly = adjustedParcelPolygon();
  if (!poly || poly.length < 3) {
    ctx.rect(0, 0, gridCols * CELL_SIZE, gridRows * CELL_SIZE);
    return;
  }
  ctx.beginPath();
  poly.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

// The single place parcelPolygonPx and boundaryAdjust get combined. Everything that traces or
// hit-tests the boundary as the user now sees/corrects it (the drawn outline, the paint clip,
// Stamp containment) reads THIS — never parcelPolygonPx directly. fitSimilarity's call in
// buildAerialNode and any parcel-bbox/centering math deliberately keep reading the pristine
// parcelPolygonPx (see boundaryAdjust's declaration comment) — a manual corner nudge must never
// re-warp the aerial photo or perturb the "Fit" view.
function adjustedParcelPolygon() {
  return applyPolygonOffsets(parcelPolygonPx, boundaryAdjust);
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
  cellPatternCache.clear(); // patterns were minted against the old context
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
    gridCtx.fillStyle = cellFillStyle(id);
    gridCtx.fillRect(c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, CELL_SIZE);
  } else {
    cellState.delete(key);
    gridCtx.clearRect(c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, CELL_SIZE);
  }
}

// Square brush, roughly centered on (c, r). Erase strokes (id === null) use their own
// width so the eraser and the marker each remember their dialed thickness.
function paintBrush(c, r, id) {
  const size = id === null ? eraseSize : brushSize;
  const off = Math.floor(size / 2);
  for (let dy = 0; dy < size; dy++)
    for (let dx = 0; dx < size; dx++)
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

// Hover/stroke preview of the square Marker brush footprint (incl. Marker-with-Empty and
// a right-click quick-erase stroke from any tool), snapped to the exact cells paintBrush
// would hit. Shown only when the dialed thickness is > 1 — at 1 ft the cursor already marks
// the single tile. Same overlayLayer ghost styling as the Rectangle tool's rubber-band.
function updateBrushGhost() {
  if (!overlayLayer) return;
  const erasing = (painting && eraseGesture) || usingEraseMaterial();
  const size = erasing ? eraseSize : brushSize;
  const show = (painting || activeMode === "paint")
    && size > 1 && stageReady && plotHover && !spacePan && !panActive && !plotConfirmedFlag;
  const cell = show ? cellFromPointer() : null;
  if (!cell) { removeBrushGhost(); return; }
  const off = Math.floor(size / 2);   // same centering as paintBrush
  const color = erasing ? "#a4111f" : (PALETTE_MAP[activeMaterial]?.color || "#7cb342");
  if (!brushGhost) {
    brushGhost = new Konva.Rect({ listening: false });
    overlayLayer.add(brushGhost);
  }
  brushGhost.setAttrs({
    x: (cell.c - off) * CELL_SIZE, y: (cell.r - off) * CELL_SIZE,
    width: size * CELL_SIZE, height: size * CELL_SIZE,
    fill: color, opacity: erasing ? 0.18 : 0.5,
    stroke: color, strokeWidth: 1.5, dash: erasing ? [6, 4] : null
  });
  overlayLayer.batchDraw();
}

function removeBrushGhost() {
  if (!brushGhost) return;
  brushGhost.destroy();
  brushGhost = null;
  overlayLayer?.batchDraw();
}

// Fill the axis-aligned block of cells between two corners with `id` (null = erase).
function fillRect(c0, r0, c1, r1, id) {
  const cMin = Math.min(c0, c1), cMax = Math.max(c0, c1);
  const rMin = Math.min(r0, r1), rMax = Math.max(r0, r1);
  for (let r = rMin; r <= rMax; r++)
    for (let c = cMin; c <= cMax; c++) paintCellRaw(c, r, id);
}

// --- Line-tool walls as flood-fill barriers (any angle, including triangles) ---
// Lines are thin geometric walls; the paint-bucket core (sub-tile flood, >50%-coverage
// tile rule, on-wall strip recovery) is computeFloodFill in geometry.js. This side just
// collects the wall segments from the live drawLayer, in TILE units (1 unit = CELL_SIZE px).
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

// Paint-bucket. The region logic (same-material flood bounded by grid edges, colour and
// Line-tool walls at any angle, >50%-coverage tile rule, seeded on the clicked side of a
// wall) is computeFloodFill in geometry.js — this wrapper just feeds it the live state
// and paints whatever tiles it returns.
function floodFill(c0, r0, id, seed) {
  computeFloodFill({
    cols: gridCols, rows: gridRows, cells: cellState,
    c0, r0, id, seed, segments: collectLineSegments()
  }).forEach(([c, r]) => paintCellRaw(c, r, id));
}

function repaintAllCells() {
  if (!gridCtx) return;
  gridCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
  cellState.forEach((id, key) => {
    const i = key.indexOf(","), c = +key.slice(0, i), r = +key.slice(i + 1);
    gridCtx.fillStyle = cellFillStyle(id);
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
  syncAnnotationTextScale();
  syncEditAnchorScale();
  stage.batchDraw();
  updateZoomReadout();
}

// Callout / measurement text scale: nodes flagged screenFixed carry a counter-scale so the text
// reads ANNOTATION_FONT_PX CSS px on the user's monitor up to ANNOTATION_REF_ZOOM, then holds that
// counter-scale steady so the text scales UP proportionally with the view as you zoom in past the
// pivot (leader arrows/geometry stay plan-scaled throughout). The max() floors the counter-scale at
// 1/ANNOTATION_REF_ZOOM: below the pivot it's the plain 1/viewZoom screen-lock (never smaller than
// 9px when zoomed out); above it, the fixed floor lets the stage's own viewZoom grow the text.
// Runs on every zoom change (via applyStageSize) and after every hydrate (draft restore / undo),
// which also normalizes away whatever counter-scale was serialized into the draft at save time.
function annotationTextScale() {
  return Math.max(1 / viewZoom, 1 / ANNOTATION_REF_ZOOM);
}
function syncAnnotationTextScale() {
  if (!drawLayer) return;
  const k = annotationTextScale();
  drawLayer.find(n => n.getAttr("screenFixed")).forEach(n => n.scale({ x: k, y: k }));
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
  // Alt+scroll dials the Marker's brush thickness instead of zooming (scroll up = thicker) —
  // the eraser's own thickness, when Empty is the active material (see usingEraseMaterial).
  // Only in Marker mode — everywhere else (incl. a locked plan) the wheel keeps zooming.
  if (e.evt.altKey && !plotConfirmedFlag && activeMode === "paint") {
    nudgeBrushSize(e.evt.deltaY < 0 ? 1 : -1);
    return;
  }
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

// Build the aerial-backdrop Konva.Image, registered to the parcel outline, at the
// given opacity — the single source of the fit/nudge math so the live bgLayer and the
// print/preview export (renderPlotImage) can never drift out of alignment. Returns null
// if no aerial has loaded yet. `img` must already be decoded (its .width/.height read).
function buildAerialNode(img, opacity) {
  if (!img || !img.width || !img.height) return null;
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
      opacity, listening: false
    });
  } else {
    // Fallback (e.g. a restored draft with no fresh capture): cover-fit + center.
    const scale = Math.max(w / img.width, h / img.height);
    node = new Konva.Image({
      image: img,
      width: img.width * scale, height: img.height * scale,
      x: (w - img.width * scale) / 2, y: (h - img.height * scale) / 2,
      opacity, listening: false
    });
  }
  // Apply the ground-truth calibration nudge (see AERIAL_CONTROL_POINTS above), interpolated for
  // this parcel's own centroid, plus whatever the dev calibration overlay has dialed in on top
  // (calibNudge, always {0,0} outside ?calibrate-aerial). It's a ground vector in feet; rotate it
  // by the parcel bearing and flip Y to land in stage pixels, then translate the whole aerial by
  // it. At bearing 0 this is just (+E → +x, +N → −y). A pure translation of the node origin is
  // unaffected by the node's own rotation, so this composes cleanly with either branch above.
  const centroid = currentParcelCentroid();
  const base = centroid ? interpolateAerialNudge(centroid.lng, centroid.lat, AERIAL_CONTROL_POINTS) : { east: 0, north: 0 };
  const e = base.east + calibNudge.east, nth = base.north + calibNudge.north;
  if (e || nth) {
    const b = (lastPlotBearing || 0) * Math.PI / 180;
    node.x(node.x() + (e * Math.cos(b) - nth * Math.sin(b)) * CELL_SIZE);
    node.y(node.y() - (e * Math.sin(b) + nth * Math.cos(b)) * CELL_SIZE);
  }
  return node;
}

// Current parcel's ring centroid in lng/lat — the point interpolateAerialNudge() calibrates
// against. null before any parcel has been selected (lastPlotRing unset).
function currentParcelCentroid() {
  if (!lastPlotRing || !lastPlotRing.length) return null;
  const lng = lastPlotRing.reduce((s, p) => s + p[0], 0) / lastPlotRing.length;
  const lat = lastPlotRing.reduce((s, p) => s + p[1], 0) / lastPlotRing.length;
  return { lng, lat };
}

// Single source of truth for how the boundary Line is built — shared by the live stage
// (rebuildBgLayer), the throwaway print/preview stage (renderPlotImage), and the cheap
// incremental redraw (redrawParcelOutline). Always reads the Align-Corners-adjusted polygon
// (adjustedParcelPolygon), never the pristine one — this is the user-visible trace, distinct
// from what fitSimilarity registers the aerial photo against.
function buildParcelOutlineNode() {
  const poly = adjustedParcelPolygon();
  if (!poly.length) return null;
  return new Konva.Line({
    points: poly.flatMap(p => [p.x, p.y]),
    closed: true, stroke: "#a4111f", strokeWidth: 2, dash: [6, 3], listening: false
  });
}

function rebuildBgLayer() {
  if (!stageReady) return;
  bgLayer.destroyChildren();
  plotBgImg = null; // reloaded below; stays null (print omits the aerial, gracefully) until decode
  if (plotBgDataUrl) {
    const img = new Image();
    img.onload = () => {
      if (!stageReady) return;
      plotBgImg = img; // cache for the synchronous print/preview export
      const node = buildAerialNode(img, SCREEN_AERIAL_OPACITY);
      if (!node) return;
      bgLayer.add(node);
      node.moveToBottom();
      bgLayer.batchDraw();
      refreshCalibPanel(); // no-op unless ?calibrate-aerial is on
    };
    img.src = plotBgDataUrl;
  }
  const outline = buildParcelOutlineNode();
  if (outline) bgLayer.add(outline);
  bgLayer.batchDraw();
}

// Re-render just the boundary Line from the current parcelPolygonPx + boundaryAdjust — the
// drag-tick-safe counterpart to reapplyAerialNudge() below (that one only touches the Image;
// this one only touches the Line). rebuildBgLayer() itself is too expensive to call on every
// dragmove (it re-decodes the aerial <img> via a fresh Image()/onload).
function redrawParcelOutline() {
  if (!stageReady || !bgLayer) return;
  bgLayer.find(n => n.getClassName() === "Line").forEach(n => n.destroy());
  const outline = buildParcelOutlineNode();
  if (outline) bgLayer.add(outline); // default add() appends on top — the untouched aerial Image stays at the bottom
  bgLayer.batchDraw();
}

/* ------------------------------------------------------
   Dev-only aerial calibration overlay — add ?calibrate-aerial to the URL. Not part of the
   normal app UI (no shipped markup; the panel/listener/candidate-list fetch are created only
   when the flag is on). Lets a human gather AERIAL_CONTROL_POINTS by eye: nudge the aerial
   backdrop with the arrow keys or the panel's buttons until it lines up with the drawn parcel
   outline (Shift+arrow = 1 ft steps, else 0.1 ft), then Ctrl/Cmd+Right/Left rapidly walks to the
   next/previous house in a pre-built list — auto-committing the current house's point first if
   it was nudged, so a whole session's points accumulate in the panel's running log instead of
   needing a manual "Copy point" per stop. See CLAUDE.md's aerial-calibration gotcha for the
   workflow, and tools/find-calibration-addresses.mjs for the one-off, non-interactive version
   of the same idea (compass extremes + a spread sample) this reuses the boundary logic from.
   ------------------------------------------------------ */
const CALIBRATE_AERIAL = new URLSearchParams(location.search).has("calibrate-aerial");
const CALIB_STEP_FT = 0.1, CALIB_STEP_FT_BIG = 1;
// Same evidence-derived Fairway Canyon proxy as tools/find-calibration-addresses.mjs (duplicated,
// not shared — dev tools and app code are independent; re-sync both if parcels.json changes).
const CALIB_BBOX = { minLng: -117.054247, maxLng: -117.030243, minLat: 33.949346, maxLat: 33.963270 };
const CALIB_TARGET_STOPS = 150; // decimated walk size — enough spatial density without hundreds of stops
const CALIB_BAND_FT = 150;      // serpentine row height: keeps consecutive stops geographically close
let calibPanelEls = null;
let calibCandidates = null;      // [{apn, addr, lng, lat, ring}], built once, lazily, on first nav
let calibCandidatesPromise = null;
let calibIndex = -1;             // index into calibCandidates of the house currently on screen
const calibLog = new Map();      // apn -> {lng, lat, east, north, addr} — committed this session

// Re-render just the aerial node from the already-decoded, cached image (plotBgImg) — used for
// every calibration nudge so interactive dialing doesn't re-fetch/re-decode the backdrop.
function reapplyAerialNudge() {
  if (!stageReady || !plotBgImg) return;
  bgLayer.find(n => n.getClassName() === "Image").forEach(n => n.destroy());
  const node = buildAerialNode(plotBgImg, SCREEN_AERIAL_OPACITY);
  if (node) { bgLayer.add(node); node.moveToBottom(); }
  bgLayer.batchDraw();
}

function nudgeCalib(dEast, dNorth) {
  calibNudge = { east: calibNudge.east + dEast, north: calibNudge.north + dNorth };
  reapplyAerialNudge();
  refreshCalibPanel();
}

// Lazily fetches assets/parcels.json (same independent-lazy-fetch pattern as demo-mode.js) and
// builds the walk order: addressed, single-polygon, Beaumont, inside CALIB_BBOX, sorted into a
// serpentine (row-by-row, alternating direction) sweep so consecutive stops are geographically
// adjacent — surfacing localized variation is the whole point — then decimated to a manageable,
// evenly-spread walk. Cached: only fetches/sorts once per page load.
async function loadCalibCandidates() {
  if (calibCandidates) return calibCandidates;
  if (calibCandidatesPromise) return calibCandidatesPromise;
  calibCandidatesPromise = (async () => {
    const res = await fetch("assets/parcels.json");
    const data = await res.json();
    const rows = data.parcels
      .filter(p => p.t && p.g.length === 1 && (p.c || "").startsWith("BEAUM"))
      .map(p => {
        const ring = p.g[0];
        const lng = ring.reduce((s, v) => s + v[0], 0) / ring.length;
        const lat = ring.reduce((s, v) => s + v[1], 0) / ring.length;
        return { apn: p.a, addr: p.t, lng, lat, ring: p.g };
      })
      .filter(p => p.lng >= CALIB_BBOX.minLng && p.lng <= CALIB_BBOX.maxLng &&
                   p.lat >= CALIB_BBOX.minLat && p.lat <= CALIB_BBOX.maxLat);
    const bandDeg = (CALIB_BAND_FT * FOOT_IN_METERS) / 111320;
    const banded = new Map();
    for (const r of rows) {
      const band = Math.floor((r.lat - CALIB_BBOX.minLat) / bandDeg);
      if (!banded.has(band)) banded.set(band, []);
      banded.get(band).push(r);
    }
    const ordered = [];
    [...banded.keys()].sort((a, b) => a - b).forEach((band, i) => {
      const list = banded.get(band);
      list.sort((a, b) => (i % 2 === 0 ? a.lng - b.lng : b.lng - a.lng)); // alternate direction per row
      ordered.push(...list);
    });
    const stride = Math.max(1, Math.round(ordered.length / CALIB_TARGET_STOPS));
    calibCandidates = ordered.filter((_, i) => i % stride === 0);
    return calibCandidates;
  })();
  return calibCandidatesPromise;
}

// Jumps the Draw step straight to a given walk index — the same restoreParcelFromDraft +
// showStep(4) pair demo-mode.js already uses to skip the click-through wizard, reached via a
// DYNAMIC import so this dev-only code adds no static plot-editor.js -> map-wizard.js edge to
// the module graph (map-wizard.js already imports FROM plot-editor.js; a static import back
// would form a new cross-module cycle affecting every page load, not just calibration mode — a
// dynamic import only resolves the (already-loaded, singleton) module when this code path
// actually runs). Always north-up (bearing 0) for a consistent, simple walk.
async function jumpToCalibrationHouse(index) {
  const list = await loadCalibCandidates();
  if (!list.length) return;
  calibIndex = ((index % list.length) + list.length) % list.length;
  const entry = list[calibIndex];
  const mw = await import("./map-wizard.js");
  const feature = { type: "Feature", geometry: { type: "Polygon", coordinates: entry.ring }, properties: { APN: entry.apn } };
  mw.setPlanMode("build");
  mw.restoreParcelFromDraft(feature, entry.apn, 0);
  mw.showStep(4);
  calibNudge = { east: 0, north: 0 };
  refreshCalibPanel();
}

// Records the CURRENT house's total point (interpolated baseline + manual dial) into the
// session log, keyed by APN so revisiting/re-nudging a house updates rather than duplicates.
// No-ops if nothing was actually nudged (an already-aligned house, or a bare-dirt lot with
// nothing to calibrate against) — advancing past those is a deliberate skip, not an omission.
function commitCurrentCalibPoint() {
  if (!calibNudge.east && !calibNudge.north) return;
  const centroid = currentParcelCentroid();
  if (!centroid || calibIndex < 0 || !calibCandidates) return;
  const entry = calibCandidates[calibIndex];
  const base = interpolateAerialNudge(centroid.lng, centroid.lat, AERIAL_CONTROL_POINTS);
  calibLog.set(entry.apn, {
    lng: +centroid.lng.toFixed(6), lat: +centroid.lat.toFixed(6),
    east: +(base.east + calibNudge.east).toFixed(2), north: +(base.north + calibNudge.north).toFixed(2),
    addr: entry.addr
  });
}

async function advanceCalibHouse(delta) {
  commitCurrentCalibPoint();
  await jumpToCalibrationHouse(calibIndex < 0 ? 0 : calibIndex + delta);
}

// "Update" / refresh: re-fetches and redraws the CURRENT house (fresh aerial fetch, nudge reset
// to the interpolated baseline) without changing position in the walk — for when something looks
// stuck, or to re-check a house after adding more control points elsewhere. Commits first so a
// refresh can't silently discard an in-progress nudge.
async function refreshCalibHouse() {
  if (calibIndex < 0) return;
  commitCurrentCalibPoint();
  await jumpToCalibrationHouse(calibIndex);
}

function calibLogText() {
  return [...calibLog.values()]
    .map(p => `{ lng: ${p.lng}, lat: ${p.lat}, east: ${p.east}, north: ${p.north} }, // ${p.addr}`)
    .join("\n");
}

function refreshCalibPanel() {
  if (!calibPanelEls) return;
  const centroid = currentParcelCentroid();
  if (calibCandidates && calibIndex >= 0) {
    const entry = calibCandidates[calibIndex];
    calibPanelEls.walk.textContent = `House ${calibIndex + 1}/${calibCandidates.length}: ${entry.addr}`;
  } else {
    calibPanelEls.walk.textContent = calibCandidatesPromise ? "Loading house list…" : "Press Shift+→ to start the walk";
  }
  calibPanelEls.log.value = calibLogText();
  calibPanelEls.logCount.textContent = String(calibLog.size);
  if (!centroid) {
    calibPanelEls.status.textContent = "No parcel selected yet — reach the Draw step first.";
    calibPanelEls.stats.hidden = true;
    return;
  }
  calibPanelEls.status.textContent = "";
  calibPanelEls.stats.hidden = false;
  const base = interpolateAerialNudge(centroid.lng, centroid.lat, AERIAL_CONTROL_POINTS);
  const totalE = base.east + calibNudge.east, totalN = base.north + calibNudge.north;
  calibPanelEls.centroid.textContent = `${centroid.lng.toFixed(6)}, ${centroid.lat.toFixed(6)}`;
  calibPanelEls.base.textContent = `${base.east.toFixed(2)} ft E, ${base.north.toFixed(2)} ft N`;
  calibPanelEls.dial.textContent = `${calibNudge.east.toFixed(2)} ft E, ${calibNudge.north.toFixed(2)} ft N`;
  calibPanelEls.total.textContent = `${totalE.toFixed(2)} ft E, ${totalN.toFixed(2)} ft N`;
  calibPanelEls.point.value =
    `{ lng: ${centroid.lng.toFixed(6)}, lat: ${centroid.lat.toFixed(6)}, east: ${totalE.toFixed(2)}, north: ${totalN.toFixed(2)} }`;
}

function buildCalibrationPanel() {
  const panel = document.createElement("div");
  panel.style.cssText = "position:fixed;bottom:12px;right:12px;z-index:99999;background:#1d1a17;" +
    "color:#f4ede1;font:12px/1.6 'Libre Franklin',sans-serif;padding:10px 12px;border-radius:8px;" +
    "box-shadow:0 4px 16px rgba(0,0,0,.4);width:290px;max-height:90vh;overflow:auto;";
  panel.innerHTML =
    '<div style="font-weight:700;margin-bottom:4px;">Aerial calibration (dev only)</div>' +
    '<div style="opacity:.8;margin-bottom:6px;">Arrows nudge (Shift = 1 ft). Ctrl+←/→ walks houses.</div>' +
    '<div data-f="walk" style="margin-bottom:4px;font-weight:700;"></div>' +
    '<div style="display:flex;gap:6px;margin-bottom:8px;">' +
      '<button type="button" data-action="prev" style="flex:1;">← Prev house</button>' +
      '<button type="button" data-action="refresh" style="flex:1;">Update</button>' +
      '<button type="button" data-action="next" style="flex:1;">Next house →</button>' +
    '</div>' +
    '<div data-f="status" style="opacity:.8;"></div>' +
    '<div data-f="stats">' +
      '<div>Parcel centroid: <span data-f="centroid">—</span></div>' +
      '<div>Interpolated base: <span data-f="base">—</span></div>' +
      '<div>Manual dial: <span data-f="dial">—</span></div>' +
      '<div style="font-weight:700;">Total: <span data-f="total">—</span></div>' +
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin:8px 0;text-align:center;">' +
        '<span></span><button type="button" data-nudge="0,1">N ▲</button><span></span>' +
        '<button type="button" data-nudge="-1,0">W ◀</button><span></span><button type="button" data-nudge="1,0">E ▶</button>' +
        '<span></span><button type="button" data-nudge="0,-1">S ▼</button><span></span>' +
      '</div>' +
      '<textarea data-f="point" readonly rows="2" style="width:100%;font:11px monospace;resize:none;margin-bottom:6px;box-sizing:border-box;"></textarea>' +
      '<div style="display:flex;gap:6px;margin-bottom:8px;">' +
        '<button type="button" data-action="copy" style="flex:1;">Copy point</button>' +
        '<button type="button" data-action="reset" style="flex:1;">Reset</button>' +
      '</div>' +
    '</div>' +
    '<div style="font-weight:700;margin-bottom:4px;">Session log (<span data-f="logCount">0</span>)</div>' +
    '<textarea data-f="log" readonly rows="6" style="width:100%;font:10px monospace;resize:vertical;margin-bottom:6px;box-sizing:border-box;"></textarea>' +
    '<button type="button" data-action="copyLog" style="width:100%;">Copy all logged points</button>';
  document.body.appendChild(panel);
  const els = {
    walk: panel.querySelector('[data-f="walk"]'),
    status: panel.querySelector('[data-f="status"]'),
    stats: panel.querySelector('[data-f="stats"]'),
    centroid: panel.querySelector('[data-f="centroid"]'),
    base: panel.querySelector('[data-f="base"]'),
    dial: panel.querySelector('[data-f="dial"]'),
    total: panel.querySelector('[data-f="total"]'),
    point: panel.querySelector('[data-f="point"]'),
    log: panel.querySelector('[data-f="log"]'),
    logCount: panel.querySelector('[data-f="logCount"]')
  };
  panel.querySelectorAll("[data-nudge]").forEach(btn => {
    const [dE, dN] = btn.dataset.nudge.split(",").map(Number);
    btn.addEventListener("click", (e) => nudgeCalib(dE * (e.shiftKey ? CALIB_STEP_FT_BIG : CALIB_STEP_FT), dN * (e.shiftKey ? CALIB_STEP_FT_BIG : CALIB_STEP_FT)));
  });
  panel.querySelector('[data-action="copy"]').addEventListener("click", () => {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(els.point.value).catch(() => {});
    els.point.select();
  });
  panel.querySelector('[data-action="reset"]').addEventListener("click", () => {
    calibNudge = { east: 0, north: 0 };
    reapplyAerialNudge();
    refreshCalibPanel();
  });
  panel.querySelector('[data-action="prev"]').addEventListener("click", () => advanceCalibHouse(-1));
  panel.querySelector('[data-action="next"]').addEventListener("click", () => advanceCalibHouse(1));
  panel.querySelector('[data-action="refresh"]').addEventListener("click", () => refreshCalibHouse());
  panel.querySelector('[data-action="copyLog"]').addEventListener("click", () => {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(els.log.value).catch(() => {});
    els.log.select();
  });
  calibPanelEls = els;
  refreshCalibPanel();
  loadCalibCandidates(); // kick off the fetch/sort in the background so the first Shift+→ is instant
}

function initAerialCalibration() {
  if (!CALIBRATE_AERIAL) return;
  buildCalibrationPanel();
  // Same "rendered + not typing" guard as the keyboard-undo handler; deliberately no hover
  // requirement (a human dialing this in may have focus on the panel's own buttons).
  window.addEventListener("keydown", (e) => {
    if (isTypingTarget(e.target)) return;
    if (!plotHost || plotHost.offsetParent === null) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      e.preventDefault();
      advanceCalibHouse(e.key === "ArrowRight" ? 1 : -1);
      return;
    }
    if (e.ctrlKey || e.metaKey) return; // leave other Ctrl/Cmd+arrow combos alone (browser/OS shortcuts)
    const step = e.shiftKey ? CALIB_STEP_FT_BIG : CALIB_STEP_FT;
    if (e.key === "ArrowUp") { e.preventDefault(); nudgeCalib(0, step); }
    else if (e.key === "ArrowDown") { e.preventDefault(); nudgeCalib(0, -step); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); nudgeCalib(-step, 0); }
    else if (e.key === "ArrowRight") { e.preventDefault(); nudgeCalib(step, 0); }
  });
}

/* --- Toolbars --- */
// The material chip row: the swatches picked from the library (built-in or custom, in pick
// order), each with a remove "×", plus the "+ Materials" chip that reopens the library.
// Re-rendered whenever the selection changes (library apply, chip remove, draft restore).
function renderPaletteChips() {
  const pal = $("#palette");
  if (!pal) return;
  // Done-lock: the row becomes a legend of what's actually ON the plan — only painted
  // materials show (the same set the print legend names, so a painted-then-removed or
  // retired id still gets decoded), unused swatches hide. "Make changes" re-renders the
  // full interactive row via setPlotConfirmed(false).
  if (plotConfirmedFlag) {
    const used = new Set(cellState ? cellState.values() : []);
    const mats = [...PALETTE, ...RETIRED_MATERIALS, ...customMaterials].filter(p => used.has(p.id));
    pal.classList.toggle("is-empty", !mats.length); // nothing painted (annotation-only plan): hide the bare "Legend:" row
    pal.innerHTML = "";
    mats.forEach(p => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.material = p.id;
      const sw = document.createElement("span");
      sw.className = "swatch";
      sw.style.cssText = materialSwatchStyle(p);
      b.append(sw, document.createTextNode(p.label));
      pal.appendChild(b); // no listeners — the locked row is pointer-events:none anyway
    });
    return;
  }
  pal.classList.remove("is-empty");
  selectedMaterials = selectedMaterials.filter(id => PALETTE_MAP[id]); // a restore may have replaced the customs
  if (!selectedMaterials.includes(activeMaterial)) activeMaterial = selectedMaterials[0] || "";
  pal.innerHTML = "";
  selectedMaterials.forEach(id => {
    const p = PALETTE_MAP[id];
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.material = p.id;
    if (p.id === activeMaterial) b.classList.add("is-active");
    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.cssText = materialSwatchStyle(p);
    // The remove affordance is a span, not a nested <button> (invalid HTML) — the chip's
    // click handler routes on the event target. Keyboard removal goes through the library
    // modal instead (untick + Continue), which is fully focusable.
    const x = document.createElement("span");
    x.className = "palette__x";
    x.title = "Remove from palette";
    x.setAttribute("aria-hidden", "true");
    x.textContent = "×";
    b.append(sw, document.createTextNode(p.label), x);
    b.addEventListener("click", e => {
      if (e.target === x) { removeSelectedMaterial(p.id); return; }
      activeMaterial = p.id;
      $$("#palette button").forEach(el => el.classList.toggle("is-active", el === b));
      // Empty and a real material dial independent thicknesses (usingEraseMaterial) — keep
      // the Thickness control honest on a bare swatch swap, without leaving Marker mode.
      refreshBrushControl();
      updateBrushGhost();
    });
    pal.appendChild(b);
  });
  const add = document.createElement("button");
  add.type = "button";
  add.className = "palette__add";
  add.textContent = selectedMaterials.length ? "+ Materials" : "+ Choose materials";
  add.addEventListener("click", () => openMaterialLibrary(true));
  pal.appendChild(add);
}

// Removing a chip only takes the swatch out of the work row — cells already painted with
// it stay painted (PALETTE_MAP still resolves the color) and it still shows in the print
// legend if used. Removing the last chip reopens the library: at least one swatch is
// required to draw.
function removeSelectedMaterial(id) {
  selectedMaterials = selectedMaterials.filter(x => x !== id);
  renderPaletteChips();
  scheduleAutosave();
  if (!selectedMaterials.length) openMaterialLibrary(true);
}

/* --- Custom named materials ("+ Add material" popover) --- */
// Perceived brightness (0–255). The paint layer multiplies over the aerial on screen,
// so near-white materials wash out to invisible — block those at the door.
function perceivedBrightness(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return 255;
  const v = parseInt(m[1], 16);
  return 0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255);
}

function addCustomMaterial() {
  const nameEl = $("#custom-mat-name"), colorEl = $("#custom-mat-color"), warnEl = $("#custom-mat-warn");
  const label = (nameEl?.value || "").trim();
  const color = colorEl ? colorEl.value : "#8a6d3b";
  if (!label) {
    if (warnEl) { warnEl.textContent = "Give the material a name — the legend shows it to the reviewer."; warnEl.hidden = false; }
    nameEl?.focus();
    return;
  }
  // (The old "too light to read over the aerial" brightness gate was removed 2026-07-07 at the
  // user's request — a near-white custom may still wash out under the on-screen multiply blend.)
  const mat = { id: "custom-" + Date.now().toString(36), label, color };
  if (customTexture) mat.texture = customTexture;
  customMaterials.push(mat);
  PALETTE_MAP[mat.id] = mat;
  if (matLibPending) {
    // Created from the open library: tick it there and keep picking.
    matLibPending.add(mat.id);
    renderMatLibGrid();
    syncMatLibFooter();
  } else {
    // Defensive — the creation form only lives inside the library modal today.
    selectedMaterials.push(mat.id);
    activeMaterial = mat.id;
    renderPaletteChips();
  }
  if (nameEl) nameEl.value = "";
  if (warnEl) warnEl.hidden = true;
  scheduleAutosave();
}

// Draft restore path: replace the custom list wholesale and re-point PALETTE_MAP.
// Must run BEFORE loadCells() so restored cells painted in a custom color resolve.
function setCustomMaterials(list) {
  customMaterials.forEach(m => { delete PALETTE_MAP[m.id]; });
  customMaterials = [];
  (Array.isArray(list) ? list : []).forEach(m => {
    if (!m || !m.id || !m.label || !m.color) return;
    const mat = { id: String(m.id), label: String(m.label), color: String(m.color) };
    if (m.texture && TEXTURES[m.texture]) mat.texture = String(m.texture); // additive — older drafts are solid
    customMaterials.push(mat);
    PALETTE_MAP[mat.id] = mat;
  });
  renderPaletteChips();
}

// Draft-restore path for the chip row. Pre-library drafts (incl. the captured demo session)
// carry no selectedMaterials — default to every built-in + custom, the pre-feature row.
function setSelectedMaterials(list) {
  selectedMaterials = Array.isArray(list)
    ? list.map(String).filter(id => PALETTE_MAP[id])
    : [...PALETTE, ...customMaterials].map(m => m.id);
  renderPaletteChips();
}

/* --- Material library modal ----------------------------------------------------
   The Draw step opens it automatically while the swatch row is empty (the deferred
   openMaterialLibrary(false) call in map-wizard's showStep(4)); the chip row's
   "+ Materials" chip reopens it any time. Picks accumulate in matLibPending and only
   commit to selectedMaterials on "Use these materials" — closing any other way
   discards them. At least one swatch is required to begin: Continue stays disabled
   at zero, removing the last chip reopens the library, and the paint tools reopen
   it if the row is somehow empty (see onStagePointerDown). */
let matLibPending = null; // Set of ids while the modal is open, else null

export function openMaterialLibrary(force = false) {
  if (!KONVA_AVAILABLE) return;
  const modal = $("#material-library-modal");
  if (!modal) return;
  if (!force && selectedMaterials.length) return; // auto-open route: only offer while the row is empty
  // Auto-open also yields to a dialog that's already up — on a first run, the tutorial
  // modal and this library both fire on entering Draw, and stacking would put the focus
  // trap on a panel hidden UNDER the tutorial overlay. The user still gets the library
  // via "+ Choose materials" or the paint-press-with-no-material reopen.
  if (!force && anyModalOpen()) return;
  matLibPending = new Set(selectedMaterials);
  renderMatLibGrid();
  syncMatLibFooter();
  const warn = $("#custom-mat-warn");
  if (warn) warn.hidden = true;
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  trapModalFocus(modal);
}

function closeMaterialLibrary(apply) {
  const modal = $("#material-library-modal");
  if (!modal || modal.hidden) return;
  if (apply && matLibPending) {
    // Surviving swatches keep their chip order; newly-ticked ones append in library order.
    const keep = selectedMaterials.filter(id => matLibPending.has(id));
    const added = [...PALETTE, ...customMaterials].map(m => m.id)
      .filter(id => matLibPending.has(id) && !keep.includes(id));
    selectedMaterials = [...keep, ...added];
    renderPaletteChips();
    scheduleAutosave();
  }
  matLibPending = null;
  modal.hidden = true;
  document.body.style.overflow = "";
  // Fallback: the commit path's renderPaletteChips() above just rebuilt the chip
  // row, detaching whichever chip opened the library — land on the fresh add chip.
  releaseModalFocus(modal, ".palette__add");
}

function renderMatLibGrid() {
  const grid = $("#mat-lib-grid");
  if (!grid || !matLibPending) return;
  grid.innerHTML = "";
  [...PALETTE, ...customMaterials].forEach(m => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mat-lib__item";
    b.dataset.material = m.id;
    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.cssText = materialSwatchStyle(m);
    const label = document.createElement("span");
    label.className = "mat-lib__label";
    label.textContent = m.label;
    const tick = document.createElement("span");
    tick.className = "mat-lib__tick";
    tick.setAttribute("aria-hidden", "true");
    b.append(sw, label, tick);
    const sync = on => { b.classList.toggle("is-selected", on); b.setAttribute("aria-pressed", on ? "true" : "false"); };
    sync(matLibPending.has(m.id));
    b.addEventListener("click", () => {
      const on = !matLibPending.has(m.id);
      if (on) matLibPending.add(m.id); else matLibPending.delete(m.id);
      sync(on);
      syncMatLibFooter();
    });
    grid.appendChild(b);
  });
}

function syncMatLibFooter() {
  const n = matLibPending ? matLibPending.size : 0;
  const count = $("#mat-lib-count");
  if (count) count.textContent = n ? `${n} material${n === 1 ? "" : "s"} selected` : "Select at least one material to begin";
  const btn = $("#mat-lib-continue");
  if (btn) btn.disabled = !n;
}

// The popover's texture row: one swatch button per texture (plus Solid), previewed
// in the currently-chosen color so what you pick is what the chip will look like.
let customTexture = ""; // "" = solid
function buildTexturePicker() {
  const wrap = $("#custom-mat-textures");
  if (!wrap) return;
  const opts = [["", "Solid"], ...Object.entries(TEXTURES).map(([id, t]) => [id, t.label])];
  opts.forEach(([id, label]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.texture = id;
    b.title = label;
    b.setAttribute("role", "radio");
    b.setAttribute("aria-label", label);
    b.setAttribute("aria-checked", id === customTexture ? "true" : "false");
    if (id === customTexture) b.classList.add("is-active");
    b.addEventListener("click", () => {
      customTexture = id;
      $$("#custom-mat-textures button").forEach(x => {
        const on = x === b;
        x.classList.toggle("is-active", on);
        x.setAttribute("aria-checked", on ? "true" : "false");
      });
    });
    wrap.appendChild(b);
  });
  syncTexturePickerPreviews();
  $("#custom-mat-color")?.addEventListener("input", syncTexturePickerPreviews);
}
function syncTexturePickerPreviews() {
  const color = $("#custom-mat-color")?.value || "#8a6d3b";
  $$("#custom-mat-textures button").forEach(b => {
    b.style.cssText = materialSwatchStyle({ color, texture: b.dataset.texture || undefined });
  });
}

// Glyph buttons for the Stamp tool's contextual slot in the status strip.
function buildStampPicker() {
  const wrap = $("#stamp-control");
  if (!wrap) return;
  STAMPS.forEach(s => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.stamp = s.id;
    b.dataset.tip = s.label; // instant CSS tooltip (see .plot-status__stamps button::after), not a delayed native title
    b.setAttribute("aria-label", s.label);
    b.setAttribute("aria-pressed", s.id === activeStamp ? "true" : "false");
    if (s.id === activeStamp) b.classList.add("is-active");
    b.innerHTML = s.img
      ? `<img src="${s.img}" width="18" height="18" alt="" aria-hidden="true" />`
      : `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${s.d}"/></svg>`;
    b.addEventListener("click", () => {
      activeStamp = s.id;
      removeStampGhost(); // next pointer move rebuilds it at the new symbol's footprint
      $$("#stamp-control button").forEach(x => {
        const on = x === b;
        x.classList.toggle("is-active", on);
        x.setAttribute("aria-pressed", on ? "true" : "false");
      });
    });
    wrap.appendChild(b);
  });
}

// Icon-only buttons for the vertical tool rail beside the canvas — the tool's NAME is
// carried by data-tip/aria-label here and led into the status-strip hint by updateToolHint().
function buildToolbar() {
  const pal = $("#tool-palette");
  TOOL_MODES.forEach(t => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.mode = t.id;
    if (t.id === activeMode) b.classList.add("is-active");
    b.innerHTML = t.icon || "";
    const tipLabel = t.key ? `${t.label} (${t.key.toUpperCase()})` : t.label; // hotkey rides in the tooltip
    b.dataset.tip = tipLabel; // custom CSS tooltip (see .tool-rail button::after) — shows instantly, unlike a native title's hover delay
    b.setAttribute("aria-label", tipLabel);
    b.setAttribute("aria-pressed", t.id === activeMode ? "true" : "false");
    b.addEventListener("click", () => setActiveMode(t.id));
    pal.appendChild(b);
  });
}

// One contextual hint line above the canvas, swapped as the tool changes.
function updateToolHint(mode) {
  const hintEl = $("#tool-hint");
  const t = TOOL_MODES.find(x => x.id === mode);
  if (hintEl && t) hintEl.innerHTML = "<strong>" + t.label + ":</strong> " + t.hint;
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
  updateToolHint(mode);
  // Only Marker/Rectangle/Fill consume the selected material — dim the chip row's chrome
  // (not the color swatches) for the other tools so it reads as "not in play right now".
  const pal = $("#palette");
  if (pal) pal.classList.toggle("is-muted", !["paint", "rect", "fill"].includes(mode));
  $$("#tool-palette button").forEach(x => {
    const on = x.dataset.mode === mode;
    x.classList.toggle("is-active", on);
    x.setAttribute("aria-pressed", on ? "true" : "false");
  });
  // The contextual slot in the status strip: brush width for Marker (its own dial, or the
  // Empty material's, per usingEraseMaterial()), symbol picker for Stamp.
  const brushControl = $("#brush-control");
  if (brushControl) brushControl.hidden = mode !== "paint";
  if (mode === "paint") refreshBrushControl();
  updateBrushGhost(); // hotkey switch mid-hover: restyle or drop the footprint preview now
  const stampControl = $("#stamp-control");
  if (stampControl) stampControl.hidden = mode !== "stamp";
  if (mode !== "stamp") { stampArmed = null; removeStampGhost(); }
  const alignControl = $("#align-control");
  if (alignControl) alignControl.hidden = mode !== "align";
  if (mode === "align") buildBoundaryHandles(); else destroyBoundaryHandles();
  // Outside Select, annotations go inert so a paint stroke passes straight through to the
  // grid underneath (the mode/lock logic lives in syncNodeInteractivity); a right-click
  // quick-erase still hit-tests them via annotationAtPointer()'s temporary listening flip.
  syncAllNodeInteractivity();
  if (plotHost) plotHost.style.cursor = cursorForMode(mode);
}

// Alt+scroll over the canvas: step the active tool's brush width by ±1, clamped to the
// #brush-size slider's own range so the two controls can never disagree.
function nudgeBrushSize(delta) {
  const brushInput = $("#brush-size");
  const min = Number(brushInput?.min) || 1, max = Number(brushInput?.max) || 20;
  const cur = usingEraseMaterial() ? eraseSize : brushSize;
  const val = Math.max(min, Math.min(max, cur + delta));
  if (val === cur) return;
  if (usingEraseMaterial()) eraseSize = val; else brushSize = val;
  refreshBrushControl();   // reflect into the slider + "N ft" readout
  updateBrushGhost();      // resize the footprint preview under the cursor immediately
}

// Reflect the active tool's dialed width into the shared Thickness slider (the Marker and
// the Empty-material eraser each keep their own size, so switching between them shows the
// right one — including a plain material↔Empty swatch swap without leaving Marker mode).
function refreshBrushControl() {
  const brushInput = $("#brush-size");
  if (!brushInput) return;
  const val = usingEraseMaterial() ? eraseSize : brushSize;
  brushInput.value = val;
  const brushOut = $("#brush-size-val");
  if (brushOut) brushOut.textContent = val + " ft";
}

/* --- Annotation interactions: Select click/drag-to-move, right-click/Backspace to delete --- */

// One shared delete path (right-click hit, Backspace/Delete, the selection ×): snapshot for
// undo, drop the selection if it was the selected shape, destroy, autosave.
function deleteAnnotation(node) {
  recordUndoPoint();
  if (node === selectedNode) clearSelection();
  node.destroy();
  drawLayer.batchDraw();
  if (plotHost) plotHost.style.cursor = plotConfirmedFlag ? "default" : cursorForMode(activeMode);
  updateProgress(); // keyboard deletes fire no pointerup, so the packet/Done UI needs this
  scheduleAutosave();
}

// The top-level drawLayer annotation an event target belongs to (or null). Works off the
// Konva parent chain, so it only sees nodes that were actually hit — i.e. Select mode, or a
// right-click quick-erase hit-test (annotationAtPointer flips listening on temporarily).
function annotationRootOf(target) {
  let n = target;
  while (n && n !== stage) {
    if (n.getParent && n.getParent() === drawLayer) return n;
    n = n.getParent ? n.getParent() : null;
  }
  return null;
}

// Hit-test the annotation under the pointer even in modes where drawLayer nodes are
// deliberately non-listening (so paint passes through them): flip listening on, rebuild
// the hit graph, query, restore. Only runs on a right-click press, so the cost is fine.
function annotationAtPointer() {
  if (!drawLayer || !stage) return null;
  const p = stage.getPointerPosition();
  if (!p) return null;
  const nodes = drawLayer.getChildren();
  if (!nodes.length) return null;
  const prev = nodes.map(n => n.listening());
  nodes.forEach(n => n.listening(true));
  drawLayer.drawHit();
  const shape = drawLayer.getIntersection(p);
  nodes.forEach((n, i) => n.listening(prev[i]));
  drawLayer.drawHit();
  return shape ? annotationRootOf(shape) : null;
}

// Select-tool drag bound: keep the dragged shape's bounding box on the canvas, so a
// callout/stamp/measurement can never be parked out of sight past the grid edge.
// dragBoundFunc works in absolute (zoom-scaled) coordinates — convert through viewZoom.
function annotationDragBound(node, pos) {
  const box = node.getClientRect({ relativeTo: drawLayer }); // content coords at the current position
  const offX = box.x - node.x(), offY = box.y - node.y();    // bbox offset from the node origin (drag-invariant)
  const w = gridCols * CELL_SIZE, h = gridRows * CELL_SIZE;
  const x = Math.max(-offX, Math.min(pos.x / viewZoom, w - box.width - offX));
  const y = Math.max(-offY, Math.min(pos.y / viewZoom, h - box.height - offY));
  return { x: x * viewZoom, y: y * viewZoom };
}

function attachShapeInteractions(node) {
  syncNodeInteractivity(node);
  node.dragBoundFunc(pos => annotationDragBound(node, pos));
  node.on("click tap", () => {
    if (plotConfirmedFlag) return;
    if (activeMode === "select") selectShape(node); // the only mode where nodes listen at all
  });
  // Double-click re-opens a callout's text (Select only).
  if (node.getAttr("kind") === "callout") {
    node.on("dblclick dbltap", () => {
      if (!plotConfirmedFlag && activeMode === "select") editCalloutText(node);
    });
  }
  node.on("dragstart", () => { recordUndoPoint(); selectShape(node); });
  node.on("dragmove", () => { updateSelectionRect(); refreshEditAnchorPositions(); });
  node.on("dragend", () => { updateSelectionRect(); refreshEditAnchorPositions(); scheduleAutosave(); });
}

// One place decides whether annotations respond to the pointer: they intercept events only in
// Select (click/drag to move, handles reshape — draggable there too), and go fully inert while
// the plan is locked (marked Done). A right-click quick-erase still reaches them regardless of
// mode via annotationAtPointer()'s temporary listening flip. The lock HAS to be reflected down
// here on the nodes — Konva starts a node drag from its own hit graph without ever consulting
// the plotConfirmedFlag guards in the stage-level pointer handlers.
function syncNodeInteractivity(node) {
  const unlocked = !plotConfirmedFlag && !spacePan; // held Space = pan, never a node grab
  node.listening(unlocked && activeMode === "select");
  node.draggable(unlocked && activeMode === "select");
}

function syncAllNodeInteractivity() {
  if (drawLayer) drawLayer.getChildren().forEach(n => syncNodeInteractivity(n));
}

/* --- Select / move / reshape: highlight a shape, drag it to reposition, or drag its round
   edit handles to reshape it (outline & measurement endpoints; callout tip + label box).
   Handles live on overlayLayer, so they can never leak into persistence or print. --- */
function selectShape(node) {
  selectedNode = node;
  updateSelectionRect();
  buildEditAnchors(node);
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
  if (!selectionDeleteBtn) {
    selectionDeleteBtn = buildSelectionDeleteBtn();
    overlayLayer.add(selectionDeleteBtn);
    syncEditAnchorScale();
  }
  selectionDeleteBtn.position({ x: box.x + box.width + pad, y: box.y - pad }); // selection-box top-right corner
  overlayLayer.batchDraw();
}

// The "×" on the selection box's top-right corner — the pointer route to deleting the
// selected shape (Backspace/Delete is the keyboard route). Counter-scaled with the edit
// anchors so it holds a constant on-screen size.
function buildSelectionDeleteBtn() {
  const g = new Konva.Group();
  g.add(new Konva.Circle({
    radius: 9, fill: "#fff", stroke: "#a4111f", strokeWidth: 1.5,
    shadowColor: "#000", shadowOpacity: 0.25, shadowBlur: 3, shadowOffset: { x: 0, y: 1 }
  }));
  g.add(new Konva.Line({ points: [-3.2, -3.2, 3.2, 3.2], stroke: "#a4111f", strokeWidth: 1.8, lineCap: "round" }));
  g.add(new Konva.Line({ points: [-3.2, 3.2, 3.2, -3.2], stroke: "#a4111f", strokeWidth: 1.8, lineCap: "round" }));
  g.on("click tap", () => { if (selectedNode && !plotConfirmedFlag) deleteAnnotation(selectedNode); });
  g.on("mouseenter", () => { if (plotHost) plotHost.style.cursor = "pointer"; });
  g.on("mouseleave", () => { if (plotHost) plotHost.style.cursor = plotConfirmedFlag ? "default" : cursorForMode(activeMode); });
  return g;
}

function clearSelection() {
  selectedNode = null;
  destroyEditAnchors();
  if (selectionRect) { selectionRect.destroy(); selectionRect = null; }
  if (selectionDeleteBtn) { selectionDeleteBtn.destroy(); selectionDeleteBtn = null; }
  overlayLayer?.batchDraw();
}

/* --- Edit handles ---
   Each handle is a get/set pair working in CONTENT coordinates; set() converts back into
   the node's local space, so handles stay correct after the whole shape has been dragged
   to a nonzero x/y offset. Stamps get no handles (move/erase only — their size is the
   symbol's real-world footprint, not something to reshape). */
function anchorSpecsFor(node) {
  const kind = node.getAttr("kind");
  const toLocal = pos => ({ x: pos.x - node.x(), y: pos.y - node.y() });
  const toContent = (x, y) => ({ x: x + node.x(), y: y + node.y() });
  if (kind === "line") {
    return [0, 1].map(i => ({
      snap: true, // outline endpoints re-snap to grid intersections, same as when drawn
      get: () => { const p = node.points(); return toContent(p[i * 2], p[i * 2 + 1]); },
      set: pos => { const p = node.points().slice(); const l = toLocal(pos); p[i * 2] = l.x; p[i * 2 + 1] = l.y; node.points(p); }
    }));
  }
  if (kind === "measurement") {
    // find, not findOne: the halo + ink arrows share points and must reshape together
    // (an old draft's single-arrow measurement just yields a one-element list).
    const arrows = node.find("Arrow");
    if (!arrows.length) return [];
    return [0, 1].map(i => ({
      get: () => { const p = arrows[0].points(); return toContent(p[i * 2], p[i * 2 + 1]); },
      set: pos => {
        const l = toLocal(pos);
        arrows.forEach(arrow => {
          const p = arrow.points().slice();
          p[i * 2] = l.x; p[i * 2 + 1] = l.y;
          arrow.points(p);
        });
        syncMeasurementLabel(node); // live re-measure: the feet label tracks the endpoint
      }
    }));
  }
  if (kind === "callout") {
    const arrow = node.findOne("Arrow");
    const label = node.findOne("Label");
    if (!arrow || !label) return [];
    return [
      { // arrowhead — re-aim the leader
        get: () => { const p = arrow.points(); return toContent(p[2], p[3]); },
        set: pos => { const p = arrow.points().slice(); const l = toLocal(pos); p[2] = l.x; p[3] = l.y; arrow.points(p); }
      },
      { // label box — the leader's base rides along, same as at creation
        get: () => { const p = arrow.points(); return toContent(p[0], p[1]); },
        // Clamp the WHOLE label box onto the canvas, not just its anchor point — the box
        // extends right/down from the anchor, so a raw point clamp would still let the
        // text hang past the right/bottom edge.
        clampBox: pos => {
          const r = label.getClientRect({ relativeTo: drawLayer });
          const cur = toContent(label.x(), label.y());
          const ox = r.x - cur.x, oy = r.y - cur.y; // rect offset from the anchor (position-invariant)
          const w = gridCols * CELL_SIZE, h = gridRows * CELL_SIZE;
          return {
            x: Math.max(-ox, Math.min(pos.x, w - r.width - ox)),
            y: Math.max(-oy, Math.min(pos.y, h - r.height - oy))
          };
        },
        set: pos => {
          const p = arrow.points().slice(); const l = toLocal(pos);
          p[0] = l.x; p[1] = l.y;
          arrow.points(p);
          label.position(l);
        }
      }
    ];
  }
  return [];
}

const ANCHOR_RADIUS = 7; // on-screen px — counter-scaled against viewZoom in syncEditAnchorScale

function buildEditAnchors(node) {
  destroyEditAnchors();
  if (!overlayLayer) return;
  anchorSpecsFor(node).forEach(spec => {
    const a = new Konva.Circle({
      radius: ANCHOR_RADIUS, fill: "#fff", stroke: "#2b6cb0", strokeWidth: 2, draggable: true,
      shadowColor: "#000", shadowOpacity: 0.3, shadowBlur: 3, shadowOffset: { x: 0, y: 1 }
    });
    a.position(spec.get());
    a.setAttr("editSpec", spec);
    // Reshaping can't pull an endpoint off the canvas either (dragBoundFunc runs in
    // absolute, zoom-scaled coordinates — clamp there, before the content-space handlers).
    a.dragBoundFunc(pos => ({
      x: Math.max(0, Math.min(pos.x, gridCols * CELL_SIZE * viewZoom)),
      y: Math.max(0, Math.min(pos.y, gridRows * CELL_SIZE * viewZoom))
    }));
    a.on("dragstart", () => recordUndoPoint());
    a.on("dragmove", () => {
      let pos = a.position();
      if (spec.clampBox) { pos = spec.clampBox(pos); a.position(pos); }
      if (spec.snap) { pos = snapToGrid(pos); a.position(pos); }
      spec.set(pos);
      updateSelectionRect(); // tracks the reshaped bounds (and batchDraws the overlay)
      drawLayer.batchDraw();
    });
    a.on("dragend", () => scheduleAutosave());
    overlayLayer.add(a);
    editAnchors.push(a);
  });
  syncEditAnchorScale();
  overlayLayer.batchDraw();
}

function destroyEditAnchors() {
  editAnchors.forEach(a => a.destroy());
  editAnchors = [];
}

// Re-glue handles to their shape after the whole node moved (drag) — specs read live geometry.
function refreshEditAnchorPositions() {
  if (!editAnchors.length) return;
  editAnchors.forEach(a => a.position(a.getAttr("editSpec").get()));
  overlayLayer?.batchDraw();
}

// Handles hold a constant on-screen size: counter-scale them against the stage's viewZoom.
// (The selection ×-button and the Align Corners boundary handles ride along — same overlay,
// same constant-screen-size treatment.)
function syncEditAnchorScale() {
  const k = 1 / viewZoom;
  editAnchors.forEach(a => a.scale({ x: k, y: k }));
  if (selectionDeleteBtn) selectionDeleteBtn.scale({ x: k, y: k });
  boundaryHandles.forEach(h => h.scale({ x: k, y: k }));
}

/* --- Align Corners: draggable handles on the parcel boundary's own vertices --- */
// Unlike buildEditAnchors/anchorSpecsFor (which reshape a selected drawLayer annotation via its
// `kind`), the parcel boundary is a plain Konva.Line on bgLayer — not a drawLayer annotation —
// so these are a small bespoke set of handles rather than another anchorSpecsFor branch.
//
// County rings repeat the first vertex as the last (see geometry.js's buildParcelGrid / the
// pointInPolygon test fixture comment), so a closed N-vertex parcelPolygonPx has N-1 REAL
// corners — build one handle per distinct corner, and keep the duplicate closing vertex's
// offset mirrored to vertex 0's, or the closed ring shows a visible seam after a drag.
function distinctCornerCount() {
  const n = parcelPolygonPx ? parcelPolygonPx.length : 0;
  if (n < 3) return 0;
  const a = parcelPolygonPx[0], b = parcelPolygonPx[n - 1];
  return (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) ? n - 1 : n;
}

function cornerPos(i) {
  const p = parcelPolygonPx[i], o = boundaryAdjust[i];
  return o ? { x: p.x + (o.dx || 0), y: p.y + (o.dy || 0) } : { x: p.x, y: p.y };
}

function setCornerOffset(i, dx, dy) {
  boundaryAdjust[i] = { dx, dy };
  const n = parcelPolygonPx.length;
  if (i === 0 && distinctCornerCount() === n - 1) boundaryAdjust[n - 1] = { dx, dy }; // keep the closing vertex glued to corner 0
}

// One draggable Konva.Circle per distinct corner, on overlayLayer (so it never leaks into
// persistence/print — only the boundaryAdjust data it writes does). Red stroke matches the
// dashed boundary line, keeping these visually distinct from the blue Select-tool reshape
// anchors (the two can never be on screen together — entering any non-Select tool already
// clears the current selection). Deliberately no grid-snap: sub-foot precision is the point.
function buildBoundaryHandles() {
  destroyBoundaryHandles();
  const count = distinctCornerCount();
  if (!overlayLayer || !count) return;
  for (let i = 0; i < count; i++) {
    const h = new Konva.Circle({
      radius: ANCHOR_RADIUS, fill: "#fff", stroke: "#a4111f", strokeWidth: 2, draggable: true,
      shadowColor: "#000", shadowOpacity: 0.3, shadowBlur: 3, shadowOffset: { x: 0, y: 1 }
    });
    h.position(cornerPos(i));
    h.dragBoundFunc(pos => ({
      x: Math.max(0, Math.min(pos.x, gridCols * CELL_SIZE * viewZoom)),
      y: Math.max(0, Math.min(pos.y, gridRows * CELL_SIZE * viewZoom))
    }));
    h.on("dragstart", () => recordUndoPoint());
    h.on("dragmove", () => {
      const pos = h.position();
      setCornerOffset(i, pos.x - parcelPolygonPx[i].x, pos.y - parcelPolygonPx[i].y);
      redrawParcelOutline();
    });
    h.on("dragend", () => scheduleAutosave());
    overlayLayer.add(h);
    boundaryHandles.push(h);
  }
  syncEditAnchorScale();
  overlayLayer.batchDraw();
}

function destroyBoundaryHandles() {
  boundaryHandles.forEach(h => h.destroy());
  boundaryHandles = [];
}

function refreshBoundaryHandlePositions() {
  boundaryHandles.forEach((h, i) => h.position(cornerPos(i)));
  overlayLayer?.batchDraw();
}

// "Reset corners" — clears every manual correction back to the pristine county boundary.
function resetBoundaryCorners() {
  if (!boundaryAdjust.some(o => o && (o.dx || o.dy))) return; // no-op if nothing was ever nudged
  recordUndoPoint();
  boundaryAdjust = [];
  redrawParcelOutline();
  refreshBoundaryHandlePositions();
  scheduleAutosave();
}

// Re-open a callout's text (double-click with the Select tool). Same window.prompt as
// creation; cancel or an empty string keeps the existing text.
function editCalloutText(node) {
  const textNode = node.findOne("Text");
  if (!textNode) return;
  const next = window.prompt("Callout text:", textNode.text());
  if (next === null || !next.trim() || next.trim() === textNode.text()) return;
  recordUndoPoint();
  textNode.text(next.trim()); // the Konva.Label re-sizes its Tag around the new text itself
  if (node === selectedNode) { updateSelectionRect(); refreshEditAnchorPositions(); }
  drawLayer.batchDraw();
  scheduleAutosave();
}

/* --- Undo / redo (snapshots BOTH the painted grid and the annotations) --- */
function snapshotState() {
  return JSON.stringify({
    cells: cellState ? [...cellState] : [],
    ann: (drawLayer ? drawLayer.toObject().children : []) || [],
    boundaryAdjust: boundaryAdjust
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
  boundaryAdjust = Array.isArray(s.boundaryAdjust) ? s.boundaryAdjust : [];
  redrawParcelOutline();
  refreshBoundaryHandlePositions();
  restoringHistory = false;
}

function undo() {
  if (!undoStack.length || !stageReady) return;
  redoStack.push(snapshotState());
  applyHistorySnapshot(undoStack.pop());
  updateUndoRedoButtons();
  updateProgress(); // keyboard undo fires no pointerup, so the packet/Done UI needs this
  scheduleAutosave();
}

function redo() {
  if (!redoStack.length || !stageReady) return;
  undoStack.push(snapshotState());
  applyHistorySnapshot(redoStack.pop());
  updateUndoRedoButtons();
  updateProgress();
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
      rehydrateStampImages(node);
    } catch (e) { /* skip a shape that fails to reconstruct rather than aborting the whole restore */ }
  });
  syncAnnotationTextScale();
}

/* --- Measure (drag-to-draw dimension arrow with a feet label) ---
   Every measure arrow is a PAIR: a fat white halo Arrow under the blue ink Arrow — the
   standard plan-symbol treatment (same as the hardware stamps) so a dimension stays
   legible over the aerial and painted materials alike. Anything that moves the arrow's
   points must move BOTH (node.find("Arrow"), not findOne — see anchorSpecsFor). */
function measureArrowPair(points) {
  const shared = { points, pointerAtBeginning: true, pointerAtEnding: true, pointerLength: 7, pointerWidth: 7 };
  return [
    new Konva.Arrow({ ...shared, stroke: "#fff", fill: "#fff", strokeWidth: 4.5 }),
    new Konva.Arrow({ ...shared, stroke: "#2b6cb0", fill: "#2b6cb0", strokeWidth: 2 })
  ];
}

function makeMeasureGhost(a) {
  const g = new Konva.Group({ listening: false });
  measureArrowPair([a.x, a.y, a.x, a.y]).forEach(n => g.add(n));
  return g;
}

function buildMeasurementGroup(a, b) {
  const group = new Konva.Group();
  group.setAttr("kind", "measurement");
  const [halo, arrow] = measureArrowPair([a.x, a.y, b.x, b.y]);
  const label = new Konva.Text({
    text: "",
    fontFamily: "sans-serif", fontSize: ANNOTATION_FONT_PX, fontStyle: "bold", fill: "#2b6cb0", padding: 2,
    stroke: "#fff", strokeWidth: 3, fillAfterStrokeEnabled: true
  });
  label.setAttr("screenFixed", true);
  label.scale({ x: annotationTextScale(), y: annotationTextScale() });
  group.add(halo, arrow, label);
  syncMeasurementLabel(group);
  return group;
}

// (Re)derives a measurement's feet text from its arrow and recenters the label over it —
// at build time and again whenever an endpoint handle reshapes the arrow.
function syncMeasurementLabel(group) {
  const arrow = group.findOne("Arrow");
  const label = group.findOne("Text");
  if (!arrow || !label) return;
  const [x0, y0, x1, y1] = arrow.points();
  label.text(formatFeet(Math.hypot(x1 - x0, y1 - y0) * scaleFeetPerPixel));
  label.position({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
  label.offsetX(label.width() / 2);
  label.offsetY(label.height() + 3); // gap above the arrow in label-local px, so it holds at any zoom
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
  // A press near the canvas edge would leave the label box (which grows right/down from
  // the anchor, sized only now that the text exists) hanging off-canvas — nudge it back
  // inside, dragging the leader's base along the same way the label-box handle does.
  const label = group.findOne("Label"), arrow = group.findOne("Arrow");
  if (label && arrow) {
    const r = label.getClientRect({ relativeTo: drawLayer });
    const w = gridCols * CELL_SIZE, h = gridRows * CELL_SIZE;
    let dx = 0, dy = 0;
    if (r.x + r.width > w) dx = w - (r.x + r.width);
    if (r.x + dx < 0) dx = -r.x;
    if (r.y + r.height > h) dy = h - (r.y + r.height);
    if (r.y + dy < 0) dy = -r.y;
    if (dx || dy) {
      label.position({ x: label.x() + dx, y: label.y() + dy });
      const p = arrow.points().slice(); p[0] += dx; p[1] += dy; arrow.points(p);
    }
  }
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
  label.setAttr("screenFixed", true);
  label.scale({ x: annotationTextScale(), y: annotationTextScale() });
  label.add(new Konva.Tag({ fill: "#fff9f2", stroke: "#a4111f", strokeWidth: 1.5, cornerRadius: 4, shadowColor: "#000", shadowOpacity: .15, shadowBlur: 4, shadowOffset: { x: 0, y: 2 } }));
  label.add(new Konva.Text({ text, fontFamily: "sans-serif", fontSize: ANNOTATION_FONT_PX, padding: 5, fill: "#1e1a14" }));
  group.add(arrow, label);
  return group;
}

/* --- Stamp (click-to-place plan symbol) ---
   A stamp is a Konva.Group (kind:"stamp") on drawLayer: the glyph path drawn twice —
   a fat white halo under a black stroke, the standard plan-symbol treatment so it reads
   over both the aerial and painted fills — plus an invisible full-footprint hit disc so
   Select (or a right-click quick-erase hit-test) can grab it anywhere inside the symbol,
   not just on a hairline stroke.
   Everything downstream (drag/erase wiring, undo, serialize/restore, print) comes free
   from the existing drawLayer vector pipeline. */
function buildStampGroup(pos, spec) {
  // Scale the glyph's box to the symbol's real-world footprint (ft → content px).
  const box = spec.box || 24;
  const s = (spec.ft * CELL_SIZE / FEET_PER_CELL) / box;
  const group = new Konva.Group({ x: pos.x, y: pos.y, scaleX: s, scaleY: s });
  group.setAttr("kind", "stamp");
  group.setAttr("stampId", spec.id);
  // Hit target: opacity is ignored by Konva's hit graph, so this invisible disc still catches clicks.
  group.add(new Konva.Circle({ x: 0, y: 0, radius: box / 2 + 1, fill: "#000", opacity: 0 }));
  if (spec.img) {
    const img = new Konva.Image({ image: STAMP_IMG_CACHE[spec.id], x: -box / 2, y: -box / 2, width: box, height: box, listening: false });
    img.setAttr("stampId", spec.id);
    group.add(img);
  } else {
    const glyphAttrs = { data: spec.d, x: -box / 2, y: -box / 2, lineCap: "round", lineJoin: "round", listening: false };
    group.add(new Konva.Path({ ...glyphAttrs, stroke: "#fff", strokeWidth: 4.6 }));
    group.add(new Konva.Path({ ...glyphAttrs, stroke: "#1e1a14", strokeWidth: 1.8 }));
  }
  return group;
}

// Konva's serialized JSON can't carry an Image node's actual bitmap, so any stamp
// image rebuilt via Konva.Node.create (restore, undo/redo, print's offscreen stage)
// comes back with no pixels — this re-attaches the cached <img> element by stampId.
// Stamp groups always sit at the top level of drawLayer, so `node` is the group itself.
function rehydrateStampImages(node) {
  if (!node || !node.getAttr || node.getAttr("kind") !== "stamp") return;
  const spec = STAMP_MAP[node.getAttr("stampId")];
  if (!spec || !spec.img) return;
  const imgNode = node.findOne(n => n.getClassName && n.getClassName() === "Image");
  if (imgNode) imgNode.image(STAMP_IMG_CACHE[spec.id]);
}

// Stamps may only be PLACED inside the parcel footprint (they can still be dragged out
// with Select — e.g. to stage a symbol aside). No parcel resolved yet = no restriction.
function insideParcel(pos) {
  if (!parcelPolygonPx || parcelPolygonPx.length < 3) return true;
  return pointInPolygon(pos.x, pos.y, adjustedParcelPolygon());
}

// Translucent cursor preview so the symbol's true footprint is visible before you commit —
// dimmed further (plus a not-allowed cursor) outside the parcel, where placement is refused.
function updateStampGhost(pos) {
  const spec = STAMP_MAP[activeStamp];
  if (!spec || !overlayLayer) return;
  if (stampGhost && stampGhost.getAttr("stampId") !== spec.id) removeStampGhost();
  if (!stampGhost) {
    stampGhost = buildStampGroup(pos, spec);
    stampGhost.opacity(0.45);
    stampGhost.listening(false);
    overlayLayer.add(stampGhost);
  }
  stampGhost.position(pos);
  const ok = insideParcel(pos);
  stampGhost.opacity(ok ? 0.45 : 0.15);
  if (plotHost) plotHost.style.cursor = ok ? cursorForMode("stamp") : "not-allowed";
  overlayLayer.batchDraw();
}

function removeStampGhost() {
  if (!stampGhost) return;
  stampGhost.destroy();
  stampGhost = null;
  overlayLayer?.batchDraw();
}

function placeStamp(pos) {
  const spec = STAMP_MAP[activeStamp];
  if (!spec) return;
  if (!insideParcel(pos)) return; // outside the property line — the ghost/cursor already say no
  const group = buildStampGroup(pos, spec);
  recordUndoPoint();
  drawLayer.add(group);
  attachShapeInteractions(group);
  drawLayer.batchDraw();
  scheduleAutosave();
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
  if (!stageReady || activeMode === "pan" || spacePan) return; // pan (incl. held Space) is handled by the host scroll pan
  if (plotConfirmedFlag) return;                            // plan marked Done: canvas is locked until "Make changes"
  if (pinch || touchPts.size >= 2) return;                  // two fingers = pinch-zoom, never a draw
  const evt = e && e.evt;
  // Right-click or Ctrl(⌘)+click is a quick eraser on the painted grid, available from any tool.
  eraseGesture = !!(evt && (evt.button === 2 || evt.ctrlKey || evt.metaKey));
  if (evt && evt.button !== 0 && !eraseGesture) return;     // left button (or the erase gesture) draws; MMB pans
  // Right-click directly ON an annotation deletes just that annotation — never the paint
  // beneath it. Checked before every tool branch so it wins over the brush quick-erase,
  // the Rectangle-erase, and the Fill tool's bucket eraser alike.
  if (eraseGesture) {
    const hit = annotationAtPointer();
    if (hit) { eraseGesture = false; deleteAnnotation(hit); return; }
  }
  // No swatches in the work row (library dismissed unpicked, or every chip removed): the
  // material tools have nothing to paint with — reopen the library instead. Erase gestures
  // and the non-material tools (stamps, lines, callouts…) still work.
  if (["rect", "fill", "paint"].includes(activeMode) && !eraseGesture && !PALETTE_MAP[activeMaterial]) {
    openMaterialLibrary(true);
    return;
  }
  if (activeMode === "rect") {
    // Rectangle tool: rubber-band a filled block of cells. Right-click/Ctrl erases the block instead.
    const cell = cellFromPointer();
    if (!cell) return;
    const id = (eraseGesture || activeMaterial === EMPTY_MATERIAL) ? null : activeMaterial;
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
  if (activeMode === "fill") {
    // Fill floods the clicked region; right-click / Ctrl(⌘) floods it back to empty (bucket eraser).
    const cell = cellFromPointer();
    if (!cell) return;
    recordUndoPoint();
    floodFill(cell.c, cell.r, (eraseGesture || activeMaterial === EMPTY_MATERIAL) ? null : activeMaterial, contentPos());
    gridLayer.batchDraw();
    scheduleAutosave();
    return;
  }
  if (eraseGesture || activeMode === "paint") {
    const cell = cellFromPointer();
    if (!cell) return;
    const id = (eraseGesture || activeMaterial === EMPTY_MATERIAL) ? null : activeMaterial;
    recordUndoPoint();
    if (evt && evt.shiftKey && !eraseGesture) {
      // Shift: rubber-band a straight line, committed on release.
      lineDraft = { c0: cell.c, r0: cell.r, id };
      const a = cellCenter(cell.c, cell.r);
      lineGhost = new Konva.Line({
        points: [a.x, a.y, a.x, a.y],
        stroke: id ? (PALETTE_MAP[id]?.color || "#7cb342") : "#a4111f",
        strokeWidth: Math.max(2, (id === null ? eraseSize : brushSize) * CELL_SIZE), opacity: 0.5,
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
  const pos = contentPos();
  if (!pos) return;
  if (activeMode === "stamp") {
    // Arm on press, place on release: a second finger landing (pinch) can still cancel it.
    stampArmed = pos;
    return;
  }
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
  if (!stageReady || pinch || plotConfirmedFlag) return;    // locked plan: no hover ghosts / in-progress shapes
  updateBrushGhost(); // self-gating: only Marker (or a quick-erase stroke) at thickness > 1
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
      const id = (eraseGesture || activeMaterial === EMPTY_MATERIAL) ? null : activeMaterial;
      paintStroke(lastCell.c, lastCell.r, cell.c, cell.r, id);
      lastCell = cell;
      gridLayer.batchDraw();
    }
    return;
  }
  const pos = contentPos();
  if (!pos) return;
  if (dragOrigin && ghostNode) { ghostNode.find("Arrow").forEach(a => a.points([dragOrigin.x, dragOrigin.y, pos.x, pos.y])); overlayLayer.batchDraw(); return; }
  if (calloutDraft) { updateCalloutGhost(pos); return; }
  if (activeMode === "stamp" && !eraseGesture && !painting && !spacePan) updateStampGhost(pos);
}

function onStagePointerUp() {
  if (!stageReady) return;
  if (stampArmed) {
    const pos = stampArmed;
    stampArmed = null;
    placeStamp(pos); // at the PRESS point — a slight drag before release shouldn't shift the symbol
    return;
  }
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
  if (painting) { painting = false; lastCell = null; eraseGesture = false; updateBrushGhost(); scheduleAutosave(); return; }
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

/* --- Explicit completion: the Draw step's "Done — use this plan" flag ---
   Completion is DECLARED, not inferred from a first stroke: build-mode plotProvided()
   (app.js) is plotUsed() && isPlotConfirmed(). Cleared by Clear plan and by a real
   parcel/orientation rebuild; deliberately KEPT across further edits — adding detail
   to a finished plan shouldn't un-complete it. Persisted through serializePlot()/
   restorePlot() (additive to the .v4 draft). */
let plotConfirmedFlag = false;

export function isPlotConfirmed() { return plotConfirmedFlag; }

export function setPlotConfirmed(v) {
  v = !!v;
  if (v === plotConfirmedFlag) return;
  plotConfirmedFlag = v;
  // Locking hides the tools/hints (via the .plot.is-locked class in refreshPlotDoneUI) and
  // freezes the canvas (pointer/keyboard guards read plotConfirmedFlag); reset the host cursor
  // so a paint/bucket glyph doesn't linger over a plan you can no longer edit. The lock must
  // also reach the annotation nodes themselves — Konva node drags never hit the stage-level
  // guards — so drop any live selection/handles and sync per-node interactivity both ways.
  clearSelection();
  destroyBoundaryHandles(); // Align Corners handles are Konva nodes too — the lock must reach them directly
  removeBrushGhost();
  syncAllNodeInteractivity();
  if (!v && activeMode === "align") buildBoundaryHandles(); // restore handles if Align Corners was active before lock
  if (plotHost) plotHost.style.cursor = v ? "default" : cursorForMode(activeMode);
  renderPaletteChips(); // locked → used-materials-only legend; unlocked → the full interactive row
  updateProgress();   // cascades refreshPacketUI → Done button, Draw dot, packet list, lock class
  scheduleAutosave();
}

/* --- Clear / parcel rebuild / print export --- */
function clearPlot() {
  if (!plotUsed()) return;
  if (!confirm("Clear your drawn site plan? (You can bring it back with Undo.)")) return;
  recordUndoPoint();
  clearSelection();
  cellState = new Map();
  repaintAllCells();
  gridLayer.batchDraw();
  drawLayer.destroyChildren();
  drawLayer.batchDraw();
  setPlotConfirmed(false);
  scheduleAutosave();
}

export function plotUsed() {
  return !!((cellState && cellState.size > 0) || (drawLayer && drawLayer.getChildren().length > 0));
}

export function rebuildGridForParcel(feature, bearing, apn) {
  const ring = feature.geometry.coordinates[0];
  lastPlotRing = ring;
  const parcelChanged = apn !== lastPlotAPN || bearing !== lastPlotBearing;
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
  calibNudge = { east: 0, north: 0 }; // a manual dial from one parcel shouldn't carry over to the next
  boundaryAdjust = []; // nor should an Align Corners correction from a different parcel/bearing
  gridCols = result.cols;
  gridRows = result.rows;
  parcelPolygonPx = result.polygonPx;
  scaleFeetPerPixel = (result.metersPerCell * 3.28084) / CELL_SIZE;
  lastPlotAPN = apn;
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
    setPlotConfirmed(false); // the plan was wiped with the parcel/orientation change
  }
  updateProgress();
}

// Renders the plan (painted grid + parcel outline + callouts/measurements) to a PNG for
// the preview modal / print output. Built on a throwaway offscreen Stage at full content
// resolution (never the live, pan/zoomed one), so the current view and any in-progress
// ghost shapes on overlayLayer can't affect the output.
export function renderPlotImage() {
  if (!KONVA_AVAILABLE) return "";
  const w = gridCols * CELL_SIZE, h = gridRows * CELL_SIZE;
  const exportStage = new Konva.Stage({ container: document.createElement("div"), width: w, height: h });
  const layer = new Konva.Layer();
  exportStage.add(layer);
  layer.add(new Konva.Rect({ x: 0, y: 0, width: w, height: h, fill: "#fff" }));
  // Satellite base map: the same aerial the user traced over in the Draw step, registered to
  // the parcel outline. Sits above the white fill but below the grid/paint/annotations, so the
  // graph paper reads over it and painted materials (opaque in print) sit on top of the ground.
  // Only composited once the image has decoded (cached in plotBgImg); omitted gracefully if not.
  if (plotBgImg && plotBgImg.complete && plotBgImg.naturalWidth) {
    const aerial = buildAerialNode(plotBgImg, SCREEN_AERIAL_OPACITY);
    if (aerial) layer.add(aerial);
  }
  // Match the live builder: the grid + painted materials multiply over the faded aerial so the
  // ground texture reads through them. On the live stage this is CSS mixBlendMode on the grid
  // layer's DOM canvas, but toDataURL() ignores CSS blend — so here it's Konva's own
  // globalCompositeOperation (which IS baked into the exported bitmap), applied to each node so
  // it multiplies against the white+aerial already drawn beneath it on this one layer.
  if (gridLinesCanvas) layer.add(new Konva.Image({ image: gridLinesCanvas, x: 0, y: 0, globalCompositeOperation: "multiply" }));
  if (paintCanvas) {
    // Occlude paint outside the footprint in print/preview too (same clip as the live stage).
    const clip = new Konva.Group({ clipFunc: clipToParcel });
    clip.add(new Konva.Image({ image: paintCanvas, x: 0, y: 0, globalCompositeOperation: "multiply" }));
    layer.add(clip);
  }
  {
    const printOutline = buildParcelOutlineNode();
    if (printOutline) layer.add(printOutline);
  }
  const shapes = drawLayer ? (JSON.parse(drawLayer.toJSON()).children || []) : [];
  shapes.forEach(obj => {
    try {
      const node = Konva.Node.create(obj);
      layer.add(node);
      rehydrateStampImages(node);
    } catch (e) { /* skip a shape that fails to reconstruct */ }
  });
  // Print normalization: the serialized screen-fixed labels carry the live view's 1/viewZoom
  // counter-scale, which is meaningless on paper. Rescale them so the text lands at
  // ANNOTATION_FONT_PX CSS px in the print doc's ~PRINT_PLOT_WIDTH_PX-wide plan column.
  const kPrint = w / PRINT_PLOT_WIDTH_PX;
  layer.find(n => n.getAttr("screenFixed")).forEach(n => n.scale({ x: kPrint, y: kPrint }));
  layer.draw();
  const dataUrl = exportStage.toDataURL({ pixelRatio: 2, mimeType: "image/png" });
  exportStage.destroy();
  return dataUrl;
}

renderPaletteChips();
buildToolbar();
buildStampPicker();
buildTexturePicker();
initPlotStage();
initAerialCalibration();
setActiveMode("paint");
$("#plot-clear").addEventListener("click", clearPlot);
$("#align-reset")?.addEventListener("click", resetBoundaryCorners);
$("#custom-mat-add")?.addEventListener("click", addCustomMaterial);
// Material library modal: Continue commits the picks; ×/backdrop/Esc discards them
// (closeMaterialLibrary no-ops while the modal is hidden, so the Esc listener is safe).
$("#mat-lib-continue")?.addEventListener("click", () => closeMaterialLibrary(true));
$$("#material-library-modal [data-close]").forEach(el => el.addEventListener("click", () => closeMaterialLibrary(false)));
document.addEventListener("keydown", e => { if (e.key === "Escape") closeMaterialLibrary(false); });
// Enter in the name field must add the material, never submit anything.
$("#custom-mat-name")?.addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); addCustomMaterial(); }
});
$("#plot-undo").addEventListener("click", undo);
$("#plot-redo").addEventListener("click", redo);
// (#plot-use-upload in the Konva-fallback notice carries data-switch-upload and is
// wired with the other mid-wizard bail-out buttons in the plan-mode section below.)
const brushInput = $("#brush-size");
if (brushInput) {
  const brushOut = $("#brush-size-val");
  brushInput.addEventListener("input", () => {
    const val = Math.max(1, parseInt(brushInput.value, 10) || 1);
    if (usingEraseMaterial()) eraseSize = val; else brushSize = val;
    if (brushOut) brushOut.textContent = val + " ft";
    updateBrushGhost();
  });
  refreshBrushControl();
}
$("#plot-zoom-in")?.addEventListener("click", () => zoomButton(1.25));
$("#plot-zoom-out")?.addEventListener("click", () => zoomButton(1 / 1.25));
$("#plot-zoom-reset")?.addEventListener("click", fitView);
updateUndoRedoButtons();

/* --- Cross-module API --- */

// The aerial backdrop image + the parcel ring in that image's own pixel space,
// handed over by the map wizard (a county exportImage fetch, so it lands async —
// usually after rebuildGridForParcel has already built the bg layer).
export function setPlotBackdrop(dataUrl, parcelPx) {
  plotBgDataUrl = dataUrl;
  plotBgParcelPx = parcelPx;
  if (stageReady) rebuildBgLayer();
}

// The drawing exactly as the draft stores it. The version field is stamped by the
// caller — persistence (app.js) owns the draft format.
export function serializePlot() {
  return {
    cell: CELL_SIZE,
    cols: gridCols, rows: gridRows,
    cells: cellState ? [...cellState] : [],
    annotations: (drawLayer ? JSON.parse(drawLayer.toJSON()).children : []) || [],
    confirmed: plotConfirmedFlag,
    customMaterials: customMaterials.map(m => ({ ...m })),
    selectedMaterials: [...selectedMaterials],
    boundaryAdjust: boundaryAdjust.map(o => o ? { ...o } : o) // sparse; holes serialize as null through JSON
  };
}

// Rehydrate a saved drawing (draft restore). No-ops before the stage exists
// (e.g. Konva failed to load — the fallback message is already showing).
export function restorePlot(plot) {
  if (!stageReady) return;
  setCustomMaterials(plot.customMaterials); // before loadCells — restored cells may use custom colors
  setSelectedMaterials(plot.selectedMaterials); // after the customs registered — the selection may reference them
  closeMaterialLibrary(false); // a demo/draft restore may land under an auto-opened library — dismiss it
  loadCells(plot.cells);
  gridLayer.batchDraw();
  if (Array.isArray(plot.annotations)) {
    hydrateShapesInto(drawLayer, plot.annotations);
    drawLayer.batchDraw();
  }
  boundaryAdjust = Array.isArray(plot.boundaryAdjust) ? plot.boundaryAdjust : []; // additive — older drafts have none
  redrawParcelOutline();            // repaint the boundary with the restored correction
  refreshBoundaryHandlePositions(); // no-op unless Align Corners is the active tool
  undoStack = []; redoStack = [];
  updateUndoRedoButtons();
  setPlotConfirmed(!!plot.confirmed); // restoreDraft's rebuildGridForParcel just cleared it
}

// What the plan actually contains, for the auto legend beside the preview/print image:
// every material present in cellState (built-in, retired, or custom — a custom color is
// meaningless to the reviewer without its name) plus every stamp symbol placed.
export function plotLegend() {
  const used = new Set(cellState ? cellState.values() : []);
  const materials = [...PALETTE, ...RETIRED_MATERIALS, ...customMaterials].filter(p => used.has(p.id));
  const stampIds = new Set();
  if (drawLayer) drawLayer.getChildren().forEach(n => {
    if (n.getAttr("kind") === "stamp") stampIds.add(n.getAttr("stampId"));
  });
  const stamps = STAMPS.filter(s => stampIds.has(s.id));
  return { materials, stamps };
}
