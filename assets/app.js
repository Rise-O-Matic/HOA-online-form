/* =========================================================
   Fairway Canyon HOA — ARC Application (front-end mockup)
   No backend. Drafts persist to localStorage.
   ========================================================= */
(function () {
  "use strict";

  const $  = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const DRAFT_KEY = "fairwayCanyonArcDraft.v3";
  const LEGACY_DRAFT_KEY = "fairwayCanyonArcDraft.v2"; // pre-Konva cell-grid format — read once for a one-time non-destructive migration

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

  const TOOL_MODES = [
    { id: "select",   label: "Select" },
    { id: "rect",     label: "Rectangle" },
    { id: "circle",   label: "Circle" },
    { id: "line",     label: "Line" },
    { id: "curve",    label: "Curve" },
    { id: "polygon",  label: "Polygon" },
    { id: "freehand", label: "Freehand" },
    { id: "fill",     label: "Fill" },
    { id: "callout",  label: "Callout" },
    { id: "measure",  label: "Measure" },
    { id: "erase",    label: "Erase" }
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

  const CELL_SIZE = 22;
  const TARGET_MAX_DIM = 30; // longest parcel dimension maps to this many cells
  let gridCols = 30;         // stage width, in CELL_SIZE units (drives Konva stage px size)
  let gridRows = 18;         // stage height, in CELL_SIZE units
  let parcelPolygonPx = null;   // polygon vertices in pixel coords, traced as a Konva.Line overlay
  let selectedParcelGeoJSON = null;
  let parcelBearing = 0;
  let parcelsData = null;       // raw GeoJSON from county query
  let scaleFeetPerPixel = 3 / CELL_SIZE; // real-world scale for the Measure tool; refined once a parcel is selected

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
    const w = bb.maxX - bb.minX, h = bb.maxY - bb.minY;
    // Scale: longest dimension → TARGET_MAX_DIM cells
    const metersPerCell = Math.max(w, h) / TARGET_MAX_DIM;
    const cols = Math.max(6, Math.min(60, Math.ceil(w / metersPerCell)));
    const rows = Math.max(6, Math.min(40, Math.ceil(h / metersPerCell)));
    // Build mask
    const mask = Array.from({ length: rows }, () => Array(cols).fill(false));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const px = bb.minX + (c + 0.5) * metersPerCell;
        const py = bb.minY + (r + 0.5) * metersPerCell;
        mask[r][c] = pointInPolygon(px, py, screen);
      }
    }
    // Polygon in pixel coords (for SVG overlay)
    const polyPx = screen.map(p => ({
      x: (p.x - bb.minX) / metersPerCell * CELL_SIZE,
      y: (p.y - bb.minY) / metersPerCell * CELL_SIZE
    }));

    // Real parcels are rarely perfect rectangles square to the auto-aligned view
    // (flag lots, notches, slight rotation slack), so the bbox above often has
    // empty margin rows/cols the mask never touches. Crop to the tight bounding
    // box of the "inside" cells (plus a 1-cell buffer) so the lot fills the grid.
    let minR = rows, maxR = -1, minC = cols, maxC = -1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!mask[r][c]) continue;
        if (r < minR) minR = r; if (r > maxR) maxR = r;
        if (c < minC) minC = c; if (c > maxC) maxC = c;
      }
    }
    if (maxR >= minR && maxC >= minC) {
      minR = Math.max(0, minR - 1); maxR = Math.min(rows - 1, maxR + 1);
      minC = Math.max(0, minC - 1); maxC = Math.min(cols - 1, maxC + 1);
      const trimmedMask = mask.slice(minR, maxR + 1).map(row => row.slice(minC, maxC + 1));
      const trimmedPolyPx = polyPx.map(p => ({ x: p.x - minC * CELL_SIZE, y: p.y - minR * CELL_SIZE }));
      return { cols: maxC - minC + 1, rows: maxR - minR + 1, mask: trimmedMask, polygonPx: trimmedPolyPx, metersPerCell };
    }
    return { cols, rows, mask, polygonPx: polyPx, metersPerCell };
  }

  function computeAutoAlignBearing(ring) {
    if (!ring || ring.length < 3) return 0;
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const local = geoToLocalMeters(ring, [cx, cy]);
    // The longest boundary edge is usually a *side* lot line — lots are typically
    // deeper (front-to-back) than they are wide — so square the view to make that
    // edge vertical, not horizontal: add a quarter turn to the "make it horizontal" angle.
    let best = { len: -1, angle: 0 };
    for (let i = 0; i < local.length - 1; i++) {
      const a = local[i], b = local[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len > best.len) best = { len, angle: Math.atan2(dy, dx) * 180 / Math.PI };
    }
    return (((-best.angle + 90) % 180) + 180) % 180;
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

  let stage = null, bgLayer = null, drawLayer = null, overlayLayer = null;
  let stageReady = false;
  let activeMaterial = "turf";
  let activeMode = "rect";
  let transformer = null;
  let selectedNode = null;
  let lastPlotAPN, lastPlotBearing; // guards the confirm-before-clear check in rebuildGridForParcel

  let dragOrigin = null, ghostNode = null;         // drag-to-draw: rect/circle/line/measure
  let freehandPoints = null, freehandNode = null;  // freehand/curve
  let polygonPoints = null, polygonNode = null, polygonHud = null; // polygon
  let calloutDraft = null, calloutGhost = null;    // callout

  let undoStack = [], redoStack = [], restoringHistory = false;

  function formatFeet(feet) {
    return `${feet.toFixed(1)} ft`;
  }

  /* --- Stage setup --- */
  function initPlotStage() {
    if (!KONVA_AVAILABLE) {
      const msg = $("#plot-fallback-msg");
      if (msg) msg.hidden = false;
      return;
    }
    stage = new Konva.Stage({ container: "plot-konva-host", width: gridCols * CELL_SIZE, height: gridRows * CELL_SIZE });
    bgLayer = new Konva.Layer({ listening: false });
    drawLayer = new Konva.Layer();
    overlayLayer = new Konva.Layer();
    stage.add(bgLayer, drawLayer, overlayLayer);
    if (plotHost) plotHost.style.touchAction = "none";
    stage.on("pointerdown", onStagePointerDown);
    stage.on("pointermove", onStagePointerMove);
    stage.on("pointerup", onStagePointerUp);
    stage.on("click tap", e => { if (activeMode === "select" && e.target === stage) clearSelection(); });
    // A drag/click-to-vertex gesture that RELEASES past the canvas edge never fires the
    // stage's own pointerup (native events only reach elements the pointer is still over) —
    // without this, an in-progress shape/callout/measurement is silently abandoned instead
    // of committed. onStagePointerUp is idempotent (it no-ops once state is already clear),
    // so double-binding alongside the stage's own listener is safe.
    window.addEventListener("pointerup", onStagePointerUp);
    stageReady = true;
    fitStageToContainer();
    window.addEventListener("resize", fitStageToContainer);
  }

  function fitStageToContainer() {
    if (!stageReady) return;
    const wrap = plotHost.parentElement;
    const naturalW = gridCols * CELL_SIZE, naturalH = gridRows * CELL_SIZE;
    const availW = wrap ? wrap.clientWidth : naturalW;
    const scale = Math.max(0.2, Math.min(1, availW / naturalW));
    stage.width(naturalW * scale);
    stage.height(naturalH * scale);
    stage.scale({ x: scale, y: scale });
  }

  function rebuildBgLayer() {
    if (!stageReady) return;
    bgLayer.destroyChildren();
    if (plotBgDataUrl) {
      const img = new Image();
      img.onload = () => {
        if (!stageReady) return;
        const w = gridCols * CELL_SIZE, h = gridRows * CELL_SIZE;
        const scale = Math.max(w / img.width, h / img.height);
        const node = new Konva.Image({
          image: img,
          width: img.width * scale, height: img.height * scale,
          x: (w - img.width * scale) / 2, y: (h - img.height * scale) / 2,
          opacity: 0.92
        });
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
      b.textContent = t.label;
      b.addEventListener("click", () => setActiveMode(t.id));
      pal.appendChild(b);
    });
  }

  function setActiveMode(mode) {
    if (activeMode === "polygon" && mode !== "polygon") cancelPolygonDraft();
    if (calloutDraft && mode !== "callout") {
      calloutDraft = null;
      if (calloutGhost) { calloutGhost.destroy(); calloutGhost = null; overlayLayer?.batchDraw(); }
    }
    if (activeMode === "select" && mode !== "select") clearSelection();
    activeMode = mode;
    $$("#tool-palette button").forEach(x => x.classList.toggle("is-active", x.dataset.mode === mode));
    if (drawLayer) drawLayer.getChildren().forEach(n => n.draggable(mode === "select"));
    if (plotHost) plotHost.style.cursor = (mode === "select" || mode === "fill" || mode === "erase") ? "pointer" : "crosshair";
  }

  /* --- Shared shape interactions: fill / select / erase / undo hooks --- */
  function attachShapeInteractions(node) {
    node.draggable(activeMode === "select");
    node.on("click tap", () => {
      if (activeMode === "fill") {
        if (node.className === "Line" && !node.closed()) node.closed(true);
        if (typeof node.fill === "function") {
          recordUndoPoint();
          node.fill(PALETTE_MAP[activeMaterial]?.color || "#7cb342");
          drawLayer.batchDraw();
          scheduleAutosave();
        }
      } else if (activeMode === "erase") {
        recordUndoPoint();
        if (node === selectedNode) clearSelection();
        node.destroy();
        drawLayer.batchDraw();
        scheduleAutosave();
      } else if (activeMode === "select") {
        selectShape(node);
      }
    });
    node.on("dragstart transformstart", recordUndoPoint);
    node.on("dragend transformend", scheduleAutosave);
  }

  function selectShape(node) {
    if (!transformer) {
      transformer = new Konva.Transformer({ rotateEnabled: true, flipEnabled: false });
      overlayLayer.add(transformer);
    }
    selectedNode = node;
    transformer.nodes([node]);
    overlayLayer.batchDraw();
  }

  function clearSelection() {
    selectedNode = null;
    if (transformer) { transformer.nodes([]); overlayLayer.batchDraw(); }
  }

  /* --- Undo / redo --- */
  function recordUndoPoint() {
    if (restoringHistory || !drawLayer) return;
    undoStack.push(JSON.stringify(drawLayer.toObject().children || []));
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
    drawLayer.destroyChildren();
    hydrateShapesInto(drawLayer, JSON.parse(json));
    drawLayer.batchDraw();
    restoringHistory = false;
  }

  function undo() {
    if (!undoStack.length || !drawLayer) return;
    redoStack.push(JSON.stringify(drawLayer.toObject().children || []));
    applyHistorySnapshot(undoStack.pop());
    updateUndoRedoButtons();
    scheduleAutosave();
  }

  function redo() {
    if (!redoStack.length || !drawLayer) return;
    undoStack.push(JSON.stringify(drawLayer.toObject().children || []));
    applyHistorySnapshot(redoStack.pop());
    updateUndoRedoButtons();
    scheduleAutosave();
  }

  // Rebuilds shapes from serialized JSON (draft restore, undo/redo) and re-wires
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

  /* --- Drag-to-draw: rect / circle / line / measure --- */
  function ghostStyle() {
    return { stroke: "#a4111f", strokeWidth: 1.5, dash: [4, 3], fill: "rgba(164,17,31,0.08)", listening: false };
  }

  function makeGhost(mode, a) {
    if (mode === "rect") return new Konva.Rect({ x: a.x, y: a.y, width: 0, height: 0, ...ghostStyle() });
    if (mode === "circle") return new Konva.Circle({ x: a.x, y: a.y, radius: 0, ...ghostStyle() });
    if (mode === "measure") return new Konva.Arrow({ points: [a.x, a.y, a.x, a.y], stroke: "#2b6cb0", fill: "#2b6cb0", strokeWidth: 2, pointerAtBeginning: true, pointerAtEnding: true, listening: false });
    return new Konva.Line({ points: [a.x, a.y, a.x, a.y], stroke: "#a4111f", strokeWidth: 2, dash: [4, 3], listening: false });
  }

  function updateGhost(mode, ghost, a, b) {
    if (mode === "rect") {
      ghost.position({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) });
      ghost.size({ width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) });
    } else if (mode === "circle") {
      ghost.radius(Math.hypot(b.x - a.x, b.y - a.y));
    } else {
      ghost.points([a.x, a.y, b.x, b.y]);
    }
  }

  function commitShape(mode, a, b) {
    const color = PALETTE_MAP[activeMaterial]?.color || "#7cb342";
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    if (mode === "rect") {
      const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      if (w < 4 || h < 4) return null;
      return new Konva.Rect({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: w, height: h, fill: color, stroke: "rgba(0,0,0,.2)", strokeWidth: 1 });
    }
    if (mode === "circle") {
      if (dist < 4) return null;
      return new Konva.Circle({ x: a.x, y: a.y, radius: dist, fill: color, stroke: "rgba(0,0,0,.2)", strokeWidth: 1 });
    }
    if (mode === "line") {
      if (dist < 4) return null;
      return new Konva.Line({ points: [a.x, a.y, b.x, b.y], stroke: color, strokeWidth: 3, lineCap: "round" });
    }
    if (mode === "measure") {
      if (dist < 4) return null;
      return buildMeasurementGroup(a, b);
    }
    return null;
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

  /* --- Freehand / curve --- */
  function startFreehand(mode, pos) {
    freehandPoints = [pos.x, pos.y];
    freehandNode = new Konva.Line({
      points: freehandPoints,
      stroke: PALETTE_MAP[activeMaterial]?.color || "#7cb342",
      strokeWidth: 3, lineCap: "round", lineJoin: "round",
      tension: mode === "curve" ? 0.4 : 0
    });
    overlayLayer.add(freehandNode);
  }

  function extendFreehand(pos) {
    if (!freehandNode) return;
    freehandPoints.push(pos.x, pos.y);
    freehandNode.points(freehandPoints);
    overlayLayer.batchDraw();
  }

  function commitFreehand() {
    if (!freehandNode) return;
    const points = freehandPoints, tension = freehandNode.tension();
    freehandNode.destroy();
    freehandNode = null; freehandPoints = null;
    overlayLayer.batchDraw();
    if (points.length < 4) return;
    const first = { x: points[0], y: points[1] };
    const last = { x: points[points.length - 2], y: points[points.length - 1] };
    const closed = points.length >= 6 && Math.hypot(last.x - first.x, last.y - first.y) < 16;
    const node = new Konva.Line({
      points, tension, closed,
      stroke: PALETTE_MAP[activeMaterial]?.color || "#7cb342",
      strokeWidth: 3, lineCap: "round", lineJoin: "round"
    });
    recordUndoPoint();
    drawLayer.add(node);
    attachShapeInteractions(node);
    drawLayer.batchDraw();
    scheduleAutosave();
  }

  /* --- Polygon (click-to-vertex, touch-friendly Finish/Cancel HUD) --- */
  function polygonClick(pos) {
    if (!polygonPoints) {
      polygonPoints = [pos.x, pos.y];
      polygonNode = new Konva.Line({ points: polygonPoints, stroke: "#a4111f", strokeWidth: 2, dash: [4, 3], listening: false });
      overlayLayer.add(polygonNode);
      showPolygonHud();
    } else {
      polygonPoints.push(pos.x, pos.y);
      polygonNode.points(polygonPoints);
    }
    overlayLayer.batchDraw();
  }

  function finishPolygon() {
    const points = polygonPoints;
    cancelPolygonDraft();
    if (!points || points.length < 6) return;
    const node = new Konva.Line({
      points, closed: true,
      fill: PALETTE_MAP[activeMaterial]?.color || "#7cb342",
      stroke: "rgba(0,0,0,.2)", strokeWidth: 1
    });
    recordUndoPoint();
    drawLayer.add(node);
    attachShapeInteractions(node);
    drawLayer.batchDraw();
    scheduleAutosave();
  }

  function cancelPolygonDraft() {
    if (polygonNode) polygonNode.destroy();
    polygonNode = null; polygonPoints = null;
    hidePolygonHud();
    overlayLayer?.batchDraw();
  }

  function showPolygonHud() {
    if (!polygonHud) {
      polygonHud = document.createElement("div");
      polygonHud.className = "plot__polygon-hud";
      const finishBtn = document.createElement("button");
      finishBtn.type = "button"; finishBtn.className = "btn btn--primary btn--sm";
      finishBtn.textContent = "✓ Finish";
      finishBtn.addEventListener("click", finishPolygon);
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button"; cancelBtn.className = "btn btn--ghost btn--sm";
      cancelBtn.textContent = "✕ Cancel";
      cancelBtn.addEventListener("click", cancelPolygonDraft);
      polygonHud.append(finishBtn, cancelBtn);
      plotHost.parentElement?.appendChild(polygonHud);
    }
    polygonHud.hidden = false;
  }

  function hidePolygonHud() {
    if (polygonHud) polygonHud.hidden = true;
  }

  /* --- Callout (leader line + text box, free-angle) --- */
  function startCallout(pos) {
    calloutDraft = { tip: pos };
    calloutGhost = new Konva.Arrow({
      points: [pos.x, pos.y, pos.x, pos.y],
      stroke: "#2b6cb0", fill: "#2b6cb0", strokeWidth: 2, pointerAtEnding: true, listening: false
    });
    overlayLayer.add(calloutGhost);
  }

  function updateCalloutGhost(pos) {
    if (!calloutGhost || !calloutDraft) return;
    calloutGhost.points([calloutDraft.tip.x, calloutDraft.tip.y, pos.x, pos.y]);
    overlayLayer.batchDraw();
  }

  function commitCallout(pos) {
    if (!calloutDraft) return;
    const tip = calloutDraft.tip;
    calloutDraft = null;
    if (calloutGhost) { calloutGhost.destroy(); calloutGhost = null; }
    overlayLayer.batchDraw();
    const labelPos = (pos && Math.hypot(pos.x - tip.x, pos.y - tip.y) > 10) ? pos : { x: tip.x + 60, y: tip.y - 40 };
    const text = window.prompt("Callout text:");
    if (!text || !text.trim()) return;
    const group = buildCalloutGroup(tip, labelPos, text.trim());
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

  /* --- Stage-level pointer dispatch --- */
  function onStagePointerDown() {
    if (!stageReady) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    if (activeMode === "select" || activeMode === "fill" || activeMode === "erase") return; // handled per-shape
    if (activeMode === "polygon") { polygonClick(pos); return; }
    if (activeMode === "freehand" || activeMode === "curve") { startFreehand(activeMode, pos); return; }
    if (activeMode === "callout") { startCallout(pos); return; }
    dragOrigin = pos;
    ghostNode = makeGhost(activeMode, pos);
    overlayLayer.add(ghostNode);
  }

  function onStagePointerMove() {
    if (!stageReady) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    if (dragOrigin && ghostNode) { updateGhost(activeMode, ghostNode, dragOrigin, pos); overlayLayer.batchDraw(); return; }
    if (freehandNode) { extendFreehand(pos); return; }
    if (calloutDraft) { updateCalloutGhost(pos); }
  }

  function onStagePointerUp() {
    if (!stageReady) return;
    const pos = stage.getPointerPosition() || dragOrigin;
    if (dragOrigin && ghostNode) {
      const shape = commitShape(activeMode, dragOrigin, pos);
      ghostNode.destroy(); ghostNode = null; dragOrigin = null;
      overlayLayer.batchDraw();
      if (shape) {
        recordUndoPoint();
        drawLayer.add(shape);
        attachShapeInteractions(shape);
        drawLayer.batchDraw();
        scheduleAutosave();
      }
      return;
    }
    if (freehandNode) { commitFreehand(); return; }
    if (calloutDraft) commitCallout(pos);
  }

  /* --- Clear / parcel rebuild / print export --- */
  function clearPlot() {
    if (!drawLayer || !drawLayer.getChildren().length) return;
    if (!confirm("Clear your drawn site plan? This can't be undone.")) return;
    recordUndoPoint();
    clearSelection();
    drawLayer.destroyChildren();
    drawLayer.batchDraw();
    scheduleAutosave();
  }

  function plotUsed() {
    return !!(drawLayer && drawLayer.getChildren().length > 0);
  }

  function rebuildGridForParcel(feature, bearing) {
    const ring = feature.geometry.coordinates[0];
    const result = buildParcelGrid(ring, bearing);
    const parcelChanged = selectedAPN !== lastPlotAPN || bearing !== lastPlotBearing;
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
      stage.width(gridCols * CELL_SIZE);
      stage.height(gridRows * CELL_SIZE);
      fitStageToContainer();
      rebuildBgLayer();
      clearSelection();
      drawLayer.destroyChildren();
      drawLayer.batchDraw();
      undoStack = []; redoStack = [];
      updateUndoRedoButtons();
    }
    updateProgress();
  }

  // Renders the drawing to a PNG for the preview modal / print output. Built on a
  // throwaway offscreen Stage (never the live one) so Transformer handles / in-progress
  // ghost shapes — which only ever live on overlayLayer — can't leak into the output.
  function renderPlotImage() {
    if (!KONVA_AVAILABLE || !drawLayer) return "";
    const w = gridCols * CELL_SIZE, h = gridRows * CELL_SIZE;
    const exportStage = new Konva.Stage({ container: document.createElement("div"), width: w, height: h });
    const layer = new Konva.Layer();
    exportStage.add(layer);
    layer.add(new Konva.Rect({ x: 0, y: 0, width: w, height: h, fill: "#fff" }));
    if (parcelPolygonPx && parcelPolygonPx.length) {
      layer.add(new Konva.Line({
        points: parcelPolygonPx.flatMap(p => [p.x, p.y]),
        closed: true, stroke: "#a4111f", strokeWidth: 2, dash: [6, 3]
      }));
    }
    const shapes = JSON.parse(drawLayer.toJSON()).children || [];
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
  $("#plot-clear").addEventListener("click", clearPlot);
  $("#plot-undo").addEventListener("click", undo);
  $("#plot-redo").addEventListener("click", redo);
  $("#plot-use-upload")?.addEventListener("click", () => setPlanMode("upload"));
  updateUndoRedoButtons();

  /* ------------------------------------------------------
     MAP REFERENCE (MapLibre GL JS + OpenFreeMap + County Parcels)
  ------------------------------------------------------ */
  const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
  const ASSESSOR_TABLE_URL = "https://gis.countyofriverside.us/arcgis_mapping/rest/services/OpenData/Assessor/MapServer/50/query";
  const PARCEL_URL = "https://gis.countyofriverside.us/arcgis_mapping/rest/services/OpenData/Assessor/MapServer/40/query";
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

  function showStep(n) {
    // Snapshot the oriented map BEFORE its pane goes display:none below — a hidden
    // canvas can't be captured (toDataURL comes back solid black once painting stops).
    if (n === 4 && currentStep === 3 && mapInstance && selectedParcelGeoJSON) {
      try { plotBgDataUrl = mapInstance.getCanvas().toDataURL("image/jpeg", 0.9); } catch (e) { plotBgDataUrl = null; }
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

    // Step 2→3: zoom to fit the selected parcel, and auto-align the very first time we
    // reach Orient for this parcel — never touch orientation on the way back. The rotation
    // is folded into the SAME fitBounds() animation rather than a separate easeTo(): MapLibre
    // only runs one camera animation at a time, so a standalone rotate easeTo() here gets cut
    // off the moment fitBounds() starts a beat later, snapping the bearing back to 0.
    if (n === 3 && selectedParcelGeoJSON && mapInstance) {
      const ring = selectedParcelGeoJSON.geometry.coordinates[0];
      const isFirstAutoAlign = !autoAlignedForParcel;
      if (isFirstAutoAlign) {
        parcelBearing = ((Math.round(computeAutoAlignBearing(ring)) % 360) + 360) % 360;
        autoAlignedForParcel = true;
      }
      const bounds = ring.reduce(
        (b, [lng, lat]) => { b[0][0] = Math.min(b[0][0], lng); b[0][1] = Math.min(b[0][1], lat); b[1][0] = Math.max(b[1][0], lng); b[1][1] = Math.max(b[1][1], lat); return b; },
        [[Infinity, Infinity], [-Infinity, -Infinity]]
      );
      setTimeout(() => {
        mapInstance.resize();
        if (isFirstAutoAlign) {
          const onRotate = () => syncRotationReadout(mapInstance.getBearing());
          mapInstance.on("rotate", onRotate);
          mapInstance.once("moveend", () => { mapInstance.off("rotate", onRotate); syncRotationReadout(parcelBearing); });
        }
        mapInstance.fitBounds(bounds, { padding: 40, duration: 800, bearing: parcelBearing });
      }, 100);
    }

    // Step 2: disable rotation gestures (parcel picking is easier without them);
    // orientation itself is left untouched, including when navigating back from Orient.
    if (n === 2 && mapInstance) {
      mapInstance.dragRotate.disable();
      mapInstance.touchZoomRotate.disableRotation();
    }
    // Step 3: unlock rotation for orientation
    if (n === 3 && mapInstance) {
      mapInstance.dragRotate.enable();
      mapInstance.touchZoomRotate.enableRotation();
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

  function syncRotationReadout(deg) {
    const d = Math.round(((deg % 360) + 360) % 360);
    mapRotate.value = d;
    mapRotate.style.setProperty("--pct", (d / 360 * 100) + "%");
    mapRotateValue.textContent = d;
  }

  function setRotation(deg, opts) {
    deg = ((Math.round(deg) % 360) + 360) % 360;
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

  mapRotate.addEventListener("input", () => setRotation(parseInt(mapRotate.value, 10)));
  $("#rotate-minus15").addEventListener("click", () => setRotation(parcelBearing - 15));
  $("#rotate-plus15").addEventListener("click", () => setRotation(parcelBearing + 15));
  $("#rotate-reset").addEventListener("click", () => setRotation(0));
  $("#rotate-auto").addEventListener("click", () => {
    if (!selectedParcelGeoJSON) return;
    setRotation(computeAutoAlignBearing(selectedParcelGeoJSON.geometry.coordinates[0]), { animate: true });
  });

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
  }
  form.addEventListener("input", updateProgress);
  form.addEventListener("change", updateProgress);
  // also refresh after signing
  ["pointerup"].forEach(ev => document.addEventListener(ev, () => setTimeout(updateProgress, 50)));

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
      plot: { version: 2, shapes: (drawLayer ? JSON.parse(drawLayer.toJSON()).children : []) || [] },
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
      // No .v3 draft yet — fall back to a pre-Konva .v2 draft once. Every field except the
      // plot drawing itself carries over losslessly; the drawing can't be vectorized from the
      // old cell-grid format, so it's left empty with a one-time notice instead of guessed at.
      try { raw = localStorage.getItem(LEGACY_DRAFT_KEY); } catch (e) { raw = null; }
      if (!raw) return false;
      migratedFromLegacy = true;
    }
    let d;
    try { d = JSON.parse(raw); } catch (e) { return false; }
    if (migratedFromLegacy) d.plot = null; // old cellState array — not convertible, don't try
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
    if (d.plot && Array.isArray(d.plot.shapes) && drawLayer) {
      hydrateShapesInto(drawLayer, d.plot.shapes);
      drawLayer.batchDraw();
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
    const subs = Object.entries(SUB_LABELS).map(([k, label]) =>
      `<li>${esc(label)} — ${yn(d.submissions[k])}</li>`).join("");
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
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !modal.hidden) closeModal(); });

  form.addEventListener("submit", e => {
    e.preventDefault();
    const bad = validate();
    if (bad) {
      status("Please complete the highlighted required fields and signatures.", "err");
      bad.scrollIntoView({ behavior: "smooth", block: "center" });
      if (bad.focus) bad.focus({ preventScroll: true });
      return;
    }
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
    const body = encodeURIComponent(
      "Please find the attached Architectural Review Committee Application.\r\n\r\n" +
      "Applicant: " + d.ownerName + "\r\n" +
      "Property: " + d.propertyAddress + "\r\n" +
      "Phone: " + d.ownerPhone + "\r\n" +
      "Email: " + d.ownerEmail + "\r\n\r\n" +
      "\u2014 Submitted via Fairway Canyon HOA Online Form"
    );
    window.location.href = "mailto:" + EMAIL_TO + "?subject=" + subject + "&body=" + body;
  }

  // Email button in the submit bar — validates, opens mailto (no print dialog)
  $("#email-btn").addEventListener("click", () => {
    const bad = validate();
    if (bad) {
      status("Please complete the highlighted required fields and signatures.", "err");
      bad.scrollIntoView({ behavior: "smooth", block: "center" });
      if (bad.focus) bad.focus({ preventScroll: true });
      return;
    }
    status("");
    const d = collect();
    saveDraft(true);
    openMailto(d);
    status("A pre-addressed email has been opened. Use Preview & Print to generate a PDF to attach.", "ok");
  });

  // Email button inside the preview modal
  $("#do-email").addEventListener("click", () => {
    const d = collect();
    openMailto(d);
    closeModal();
    status("A pre-addressed email has been opened. Use Save as PDF to generate an attachment.", "ok");
  });

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
