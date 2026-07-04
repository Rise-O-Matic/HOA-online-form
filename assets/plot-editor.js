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
  CELL_SIZE, FEET_PER_CELL, LINE_WIDTH_FEET,
  computeBBox, fitSimilarity, buildParcelGrid, computeFloodFill
} from "./geometry.js";
import { $, $$ } from "./utils.js";
// Function-only imports from the entry module (a deliberate ESM cycle: app.js
// imports this module. Hoisted function declarations are safe to import in a
// cycle as long as they're only CALLED at event time — never read a non-function
// binding from app.js at this module's top level).
import { scheduleAutosave, updateProgress } from "./app.js";

const PALETTE = [
  { id: "turf",      label: "Turf",            color: "#7cb342" },
  { id: "grass",     label: "Grass",           color: "#a5d36a" },
  { id: "concrete",  label: "Concrete",        color: "#c2bdb2" },
  { id: "patio",     label: "Patio Cover",     color: "#d98a6a" },
  { id: "mulch",     label: "Mulch / Planter", color: "#b07a4e" },
  { id: "retaining", label: "Retaining Wall",  color: "#7a5c46" },
  { id: "shed",      label: "Shed",            color: "#e2473b" }
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
let customMaterials = []; // { id, label, color } user-defined, persisted as plot.customMaterials

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

// Inline stroke icons (18px, currentColor) — one per tool.
const ICON = {
  marker: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 3.5 20.5 6.5 10 17 5.5 18.5 7 14 17.5 3.5Z"/><path d="M4.5 20.5h5"/></svg>',
  rect: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/></svg>',
  erase: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21h16"/><path d="M15.5 5.5 20 10l-7.5 7.5H8.5L4 13a2 2 0 0 1 0-2.8l6.7-6.7a2 2 0 0 1 2.8 0z"/></svg>',
  // Paint bucket + drop — a 48-box glyph (user-supplied), so its stroke-width is the
  // rail's 1.9-at-24-box doubled to 3.8; cursorForMode reads the viewBox to compensate.
  fill: '<svg viewBox="0 0 48 48" width="17" height="17" fill="none" stroke="currentColor" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round"><path d="M39 20.9706L22.0294 4L5.76599 20.2635C3.81337 22.2161 3.81337 25.3819 5.76599 27.3345L15.6655 37.234C17.6181 39.1866 20.7839 39.1866 22.7366 37.234L39 20.9706Z"/><path d="M7.5 18.5L7.95002 18.8326C15.0052 24.0473 23.892 26.1367 32.5317 24.6121L36 24"/><path d="M40 31C42.619 32.9566 44.5 35.32 44.5 38.2738C44.5 40.8839 42.4851 43 40 43C37.5149 43 35.5 40.8839 35.5 38.2738C35.5 35.32 37.381 32.9566 40 31Z"/></svg>',
  callout: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v11H10l-4 4v-4H4z"/></svg>',
  measure: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="8" width="20" height="8" rx="1.2"/><path d="M6.5 8v3M10 8v4M13.5 8v3M17 8v4"/></svg>',
  select: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3l5.5 15 2-6.4 6.4-2z"/><path d="m13.5 13.5 5 5"/></svg>',
  pan: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0V11m0-3a1.5 1.5 0 0 1 3 0v5.5c0 3-2.2 5.5-5.2 5.5H12c-1.6 0-2.6-.6-3.6-1.7l-3-3.3a1.5 1.5 0 0 1 2.2-2z"/></svg>',
  line: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20 20 4"/><circle cx="4" cy="20" r="1.7" fill="currentColor" stroke="none"/><circle cx="20" cy="4" r="1.7" fill="currentColor" stroke="none"/></svg>',
  stamp: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21h14"/><path d="M6.5 18h11c.6 0 1-.4 1-1v-.5a2.5 2.5 0 0 0-2.5-2.5h-2c-.6 0-1-.5-1-1.1 0-2 1.6-2.6 1.6-4.9a2.6 2.6 0 1 0-5.2 0c0 2.3 1.6 2.9 1.6 4.9 0 .6-.4 1.1-1 1.1H8A2.5 2.5 0 0 0 5.5 16.5v.5c0 .6.4 1 1 1z"/></svg>'
};

// Each tool's one-line hint is shown above the canvas while that tool is selected
// (replaces the old wall-of-text intro paragraph). Edit the copy here, not the DOM.
const TOOL_MODES = [
  { id: "paint",    label: "Marker",    icon: ICON.marker,
    hint: "Drag to paint the selected material — hold <strong>Shift</strong> for a straight stroke; the thickness control is here in this bar. Right-click erases from any tool." },
  { id: "rect",     label: "Rectangle", icon: ICON.rect,
    hint: "Drag diagonally to fill a solid block with the selected material." },
  { id: "erase",    label: "Erase",    icon: ICON.erase,
    hint: "Drag to clear painted tiles. Click an outline, callout, or measurement to delete it." },
  { id: "fill",     label: "Fill",     icon: ICON.fill,
    hint: "Click an enclosed area to flood it with the selected material — <strong>Outline</strong> edges act as walls. Right-click floods it back to empty." },
  { id: "stamp",    label: "Stamp",    icon: ICON.stamp,
    hint: "Pick a symbol here in this bar, then click the plan to place it — <strong>Select</strong> moves one, <strong>Erase</strong> removes it." },
  { id: "line",     label: "Outline",  icon: ICON.line,
    hint: "Drag between two points to draw an outline edge. It snaps to grid corners and blocks <strong>Fill</strong> like a wall." },
  { id: "callout",  label: "Callout",  icon: ICON.callout,
    hint: "Press where the label should sit, drag to the thing it points at, release, then type the text." },
  { id: "measure",  label: "Measure",  icon: ICON.measure,
    hint: "Drag between two points to add a dimension arrow labeled with the distance in feet." },
  { id: "select",   label: "Select",   icon: ICON.select,
    hint: "Drag an outline, callout, or measurement to reposition it." },
  { id: "pan",      label: "Pan",      icon: ICON.pan,
    hint: "Drag to move around your plan. From any tool: middle-mouse drag pans, the mouse wheel zooms — on a touch screen, drag with two fingers to pan and pinch to zoom." }
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
  const fallback = mode === "erase" ? "cell" : (mode === "select" ? "default" : "crosshair");
  if (!t || !t.icon) return fallback;
  const inner = (t.icon.match(/<svg[^>]*>([\s\S]*)<\/svg>/) || [, ""])[1];
  // Most rail icons live in a 24-box, but not all (the Fill bucket is a 48-box) —
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
const ANNOTATION_FONT_PX = 9;   // callout + measurement text: SCREEN-FIXED size in CSS px. The text
                                // nodes carry a counter-scale of 1/viewZoom (see syncAnnotationTextScale)
                                // so they read 9px on the user's monitor at any plot zoom, and
                                // renderPlotImage() re-normalizes them to land at 9px on the printed page.
const PRINT_PLOT_WIDTH_PX = 348; // how wide the plan prints, in the print doc's CSS px: letter page
                                 // (8.5in) minus 14mm side margins ≈ 710px, split into two flex
                                 // columns with a 14px gap (see buildPrintHTML's .print-col/.print-plot)
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
let scaleFeetPerPixel = FEET_PER_CELL / CELL_SIZE; // real-world scale for the Measure tool (content px → feet); refined once a parcel is selected

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
let activeMode = "rect";
let brushSize = 1;             // square paint brush, in tiles (= feet)
let painting = false, lastCell = null; // in-progress freehand paint/erase stroke
let eraseGesture = false;              // right-click / Ctrl(⌘)+click forces erase regardless of tool
let lineDraft = null, lineGhost = null; // shift-held straight-line paint stroke
let gridLineDraft = null, gridLineGhost = null; // Line tool: grid-snapped vector line annotation
let rectDraft = null, rectGhost = null; // Rectangle tool: drag-to-fill a block of cells
let lastPlotAPN, lastPlotBearing; // guards the confirm-before-clear check in rebuildGridForParcel

let dragOrigin = null, ghostNode = null;         // measure drag
let calloutDraft = null, calloutGhost = null;    // callout
let selectedNode = null, selectionRect = null;   // Select/move tool
let activeStamp = "canopy_tree";                 // selected symbol in the Stamp picker
let stampArmed = null, stampGhost = null;        // press position awaiting release + cursor preview

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
  stage.on("mouseleave", removeStampGhost); // don't leave the Stamp cursor preview stranded at the edge
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
  stageReady = true;
  applyStageSize();
  fitView();
  window.addEventListener("resize", onViewportResize);
  // Keyboard undo/redo while the Draw step is on screen: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or
  // Ctrl/Cmd+Y. Never while typing (inputs/textareas keep the browser's own text undo —
  // e.g. editing callout text), and only when the plot host is actually rendered
  // (offsetParent is null whenever the landing gate or another wizard step hides it).
  window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k !== "z" && k !== "y") return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (!plotHost || plotHost.offsetParent === null) return;
    if (plotConfirmedFlag) return;   // locked plan: undo/redo disabled until "Make changes"
    e.preventDefault();
    if (k === "y" || e.shiftKey) redo(); else undo();
  });
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
  syncAnnotationTextScale();
  stage.batchDraw();
  updateZoomReadout();
}

// Callout / measurement text is screen-fixed: nodes flagged screenFixed carry a counter-scale
// of 1/viewZoom so the text reads ANNOTATION_FONT_PX CSS px on the user's monitor at any plot
// zoom, while the leader arrows/geometry stay plan-scaled. Runs on every zoom change (via
// applyStageSize) and after every hydrate (draft restore / undo), which also normalizes away
// whatever counter-scale was serialized into the draft at save time.
function syncAnnotationTextScale() {
  if (!drawLayer) return;
  const k = 1 / viewZoom;
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
        const b = (lastPlotBearing || 0) * Math.PI / 180;
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
// The material chip row: built-in materials + the user's custom ones + the "+ Add material"
// chip. Re-rendered whenever the custom list changes (add, draft restore).
function renderPaletteChips() {
  const pal = $("#palette");
  if (!pal) return;
  if (!PALETTE_MAP[activeMaterial]) activeMaterial = "turf"; // a restore may have replaced the customs
  pal.innerHTML = "";
  [...PALETTE, ...customMaterials].forEach(p => {
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
  const add = document.createElement("button");
  add.type = "button";
  add.className = "palette__add";
  add.textContent = "+ Add material";
  add.addEventListener("click", () => {
    const pop = $("#palette-pop");
    if (!pop) return;
    pop.hidden = !pop.hidden;
    if (!pop.hidden) { const warn = $("#custom-mat-warn"); if (warn) warn.hidden = true; $("#custom-mat-name")?.focus(); }
  });
  pal.appendChild(add);
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
  const color = colorEl ? colorEl.value : "";
  const warn = msg => { if (warnEl) { warnEl.textContent = msg; warnEl.hidden = false; } };
  if (!label) { warn("Give the material a name — the legend shows it to the reviewer."); nameEl?.focus(); return; }
  if (perceivedBrightness(color) > 220) { warn("That color is too light to read over the aerial photo — pick a darker shade."); return; }
  const mat = { id: "custom-" + Date.now().toString(36), label, color };
  customMaterials.push(mat);
  PALETTE_MAP[mat.id] = mat;
  activeMaterial = mat.id;
  renderPaletteChips();
  if (nameEl) nameEl.value = "";
  if (warnEl) warnEl.hidden = true;
  const pop = $("#palette-pop");
  if (pop) pop.hidden = true;
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
    customMaterials.push(mat);
    PALETTE_MAP[mat.id] = mat;
  });
  renderPaletteChips();
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
    b.dataset.tip = t.label; // custom CSS tooltip (see .tool-rail button::after) — shows instantly, unlike a native title's hover delay
    b.setAttribute("aria-label", t.label);
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
  // The contextual slot in the status strip: brush width for Paint, symbol picker for Stamp.
  const brushControl = $("#brush-control");
  if (brushControl) brushControl.hidden = mode !== "paint";
  const stampControl = $("#stamp-control");
  if (stampControl) stampControl.hidden = mode !== "stamp";
  if (mode !== "stamp") { stampArmed = null; removeStampGhost(); }
  // Annotations intercept pointer events in Erase (click removes) and Select (click/drag to
  // move) modes, and are draggable only in Select; otherwise they're inert so a paint stroke
  // passes straight through to the grid underneath.
  if (drawLayer) drawLayer.getChildren().forEach(n => {
    n.listening(mode === "erase" || mode === "select");
    n.draggable(mode === "select");
  });
  if (plotHost) plotHost.style.cursor = cursorForMode(mode);
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
    x: mid.x, y: mid.y, text: formatFeet(feet),
    fontFamily: "sans-serif", fontSize: ANNOTATION_FONT_PX, fontStyle: "bold", fill: "#2b6cb0", padding: 2
  });
  label.setAttr("screenFixed", true);
  label.scale({ x: 1 / viewZoom, y: 1 / viewZoom });
  label.offsetX(label.width() / 2);
  label.offsetY(label.height() + 3); // gap above the arrow in label-local px, so it holds at any zoom
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
  label.setAttr("screenFixed", true);
  label.scale({ x: 1 / viewZoom, y: 1 / viewZoom });
  label.add(new Konva.Tag({ fill: "#fff9f2", stroke: "#a4111f", strokeWidth: 1.5, cornerRadius: 4, shadowColor: "#000", shadowOpacity: .15, shadowBlur: 4, shadowOffset: { x: 0, y: 2 } }));
  label.add(new Konva.Text({ text, fontFamily: "sans-serif", fontSize: ANNOTATION_FONT_PX, padding: 5, fill: "#1e1a14" }));
  group.add(arrow, label);
  return group;
}

/* --- Stamp (click-to-place plan symbol) ---
   A stamp is a Konva.Group (kind:"stamp") on drawLayer: the glyph path drawn twice —
   a fat white halo under a black stroke, the standard plan-symbol treatment so it reads
   over both the aerial and painted fills — plus an invisible full-footprint hit disc so
   Select/Erase can grab it anywhere inside the symbol, not just on a hairline stroke.
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

// Translucent cursor preview so the symbol's true footprint is visible before you commit.
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
  if (!stageReady || activeMode === "pan") return;          // pan is handled by the host scroll pan
  if (plotConfirmedFlag) return;                            // plan marked Done: canvas is locked until "Make changes"
  if (pinch || touchPts.size >= 2) return;                  // two fingers = pinch-zoom, never a draw
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
  if (activeMode === "fill") {
    // Fill floods the clicked region; right-click / Ctrl(⌘) floods it back to empty (bucket eraser).
    const cell = cellFromPointer();
    if (!cell) return;
    recordUndoPoint();
    floodFill(cell.c, cell.r, eraseGesture ? null : activeMaterial, contentPos());
    gridLayer.batchDraw();
    scheduleAutosave();
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
  if (calloutDraft) { updateCalloutGhost(pos); return; }
  if (activeMode === "stamp" && !eraseGesture && !painting) updateStampGhost(pos);
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
  // so a paint/bucket glyph doesn't linger over a plan you can no longer edit.
  if (plotHost) plotHost.style.cursor = v ? "default" : cursorForMode(activeMode);
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
initPlotStage();
setActiveMode("rect");
$("#plot-clear").addEventListener("click", clearPlot);
$("#custom-mat-add")?.addEventListener("click", addCustomMaterial);
$("#custom-mat-cancel")?.addEventListener("click", () => { const pop = $("#palette-pop"); if (pop) pop.hidden = true; });
// The popover sits inside the big <form>: Enter in the name field must add the material,
// not submit the whole application to the preview modal.
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
    customMaterials: customMaterials.map(m => ({ ...m }))
  };
}

// Rehydrate a saved drawing (draft restore). No-ops before the stage exists
// (e.g. Konva failed to load — the fallback message is already showing).
export function restorePlot(plot) {
  if (!stageReady) return;
  setCustomMaterials(plot.customMaterials); // before loadCells — restored cells may use custom colors
  loadCells(plot.cells);
  gridLayer.batchDraw();
  if (Array.isArray(plot.annotations)) {
    hydrateShapesInto(drawLayer, plot.annotations);
    drawLayer.batchDraw();
  }
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
