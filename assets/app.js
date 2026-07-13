/* =========================================================
   Fairway Canyon HOA — ARC Application (front-end mockup)
   Entry module: form content (acks, dates, photos),
   packet status, validation, persistence (localStorage
   drafts), the preview/print/JSON output paths,
   landing + init.
   Siblings: geometry.js (pure math, unit-tested),
   plot-editor.js (Konva drawing surface), map-wizard.js
   (parcel select/orient flow), utils.js ($, $$, esc).
   No backend; no build step — the browser loads these ES
   modules directly.
   ========================================================= */
import { $, $$, esc } from "./utils.js";
import {
  plotUsed, isPlotConfirmed, renderPlotImage, rebuildGridForParcel,
  serializePlot, restorePlot, plotLegend, materialSwatchStyle
} from "./plot-editor.js";
import {
  planMode, setPlanMode, plotUploadInput, restoreParcelFromDraft,
  parcelBearing, selectedAPN, selectedParcelGeoJSON, mapInstance
} from "./map-wizard.js";
import { registerDropzone, DROPZONE_ICON } from "./dropzone.js";
import {
  idbAvailable, saveAttachment, loadAttachment, delAttachment,
  clearAttachments, clearAllAttachments
} from "./attach-store.js";
import { allocateImageBudget, dataUrlByteLength, ENCODE_LADDER } from "./image-budget.js";

const DRAFT_KEY = "fairwayCanyonArcDraft.v4";        // fixed-scale grid painter + Konva annotations
const PLOT_VERSION = 4;                              // kept in lockstep with DRAFT_KEY's suffix; drafts written before the reconcile carry plot.version 3 in the identical format, so restore accepts >= 3
const LEGACY_DRAFT_KEYS = ["fairwayCanyonArcDraft.v3", "fairwayCanyonArcDraft.v2"]; // pre-grid-painter formats — read once for a one-time non-destructive migration (all non-plot fields carry over; the drawing itself is left to be redrawn)
const SCROLL_KEY = "fairwayCanyonArcDraft.scroll"; // sessionStorage — per-tab only, so a stale position never haunts a fresh visit later

/* A per-application reference id, stamped once and persisted with the draft (so it's
   stable across reprints/reloads) and printed in the packet's running header. NOTE: this
   is a client-side mockup with no backend, so this is a locally-generated handle for the
   applicant/reviewer to cite — NOT an official HOA case number. */
let appRefId = null;
// Base57 alphabet (the shortuuid default: 0/O/1/I/l dropped so a hand-cited id can't be
// misread). Case-sensitive — the encoding depends on both cases, so never upper-case it.
const REFID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function genRefId() {
  const uuid = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    // Fallback for non-secure contexts where randomUUID is unavailable (e.g. plain http/file).
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
        const r = Math.floor(Math.random() * 16), v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
  // Base57-encode the UUID and keep the low-order REFID_LEN digits as the random tail — no
  // ambiguous glyphs, short to read aloud or type. The random tail carries ALL the collision
  // resistance (57^8 ≈ 1.1e14 of space); the two-digit year prefix is pure human provenance
  // (self-dating for filing) layered on top, and also partitions collisions by year. Because the
  // year isn't load-bearing for uniqueness, a wrong client clock only mislabels the year — it
  // can't raise collision risk (unlike a timestamp-only id, whose uniqueness IS the clock).
  // Slicing the *tail* (low-order digits) stays uniform, whereas the leading digit is slightly
  // constrained since 57^22 > 2^122. Old drafts keep their full-length refId (restore re-adopts
  // d.refId verbatim), so this shortening/prefixing is forward-only.
  let n = BigInt("0x" + uuid.replace(/-/g, "")), out = "";
  while (n > 0n) { out = REFID_ALPHABET[Number(n % 57n)] + out; n /= 57n; }
  const REFID_LEN = 8;
  const tail = out.padStart(REFID_LEN, REFID_ALPHABET[0]).slice(-REFID_LEN);
  // Plain decimal year (not base57) so it reads as a year at a glance, kept as its own dash-
  // delimited segment so the familiar number never blurs into the opaque random tail.
  const yy = String(new Date().getFullYear() % 100).padStart(2, "0");
  return "FC-ARC-" + yy + "-" + tail;
}
function getRefId() { return appRefId || (appRefId = genRefId()); }

/* ------------------------------------------------------
   DATA: acknowledgments, palette, review dates
------------------------------------------------------ */
const ACKS = [
  'Compliance with the <a href="https://www.fsresidential.com/california/communities/fairway-canyon/" target="_blank" rel="noopener">Guidelines</a>, <a href="https://www.fsresidential.com/california/communities/fairway-canyon/" target="_blank" rel="noopener">Protective Covenants</a> and ARC approval does <strong>not</strong> necessarily constitute compliance with building and zoning codes of <a href="https://www.rivcocob.org/building-and-safety/" target="_blank" rel="noopener">Riverside County</a>. A building permit may still be required.',
  "No exterior alteration shall commence until <strong>written ARC approval</strong> has been returned to the homeowner. Unapproved or out-of-scope work may require restoration to the former condition at the homeowner's expense, plus legal costs.",
  'I am responsible to provide all required details on attached sheets (plot, sketches, scale drawings, photos, illustrations, plans, contracts, etc.), with the location of the change indicated on a color-coded plot. <span class="muted">(Your improvement details, plot plan, and photos are assembled into the printed packet as you fill this out.)</span>',
  'For changes in <strong>paint color</strong>, I will attach a manufacturer\'s sample indicating the color/code and the proposed vendor\'s name. <span class="muted">(If your project adds a new color or material, the sample photo requested in Section 04 covers this.)</span>',
  "ARC members may enter the property at a reasonable, pre-arranged time to inspect the project site(s) during and upon completion of the work. Such entry does not constitute trespass.",
  "Any approval is contingent upon construction or alterations being completed in a <strong>workmanlike manner</strong>.",
  "Authority granted may be revoked automatically if the alteration has not commenced within <strong>180 days</strong> of the approval date and completed by the date specified by the ARC.",
  "If I disagree with the decision, I may appeal: a verbal request within 48 hours of receipt of the decision, followed by a written request within five (5) business days."
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
    const r = this.canvas.getBoundingClientRect();
    // Hidden (the landing gate, or the Type signature method): the rect is 0×0, and sizing
    // the backing store to it would destroy any ink. Keep the bitmap; resize again on reveal.
    if (!r.width || !r.height) return;
    const data = this.pending || (preserve && this.hasInk ? this.canvas.toDataURL() : null);
    this.pending = null;
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
  toDataURL() {
    if (this.pending) return this.pending; // restored ink not yet drawn (pad was hidden) — pass it through
    return this.hasInk ? this.canvas.toDataURL("image/png") : null;
  }
  fromDataURL(url) {
    if (!url) return;
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) { this.pending = url; this._ink(); return; } // hidden — draw on next resize
    const img = new Image();
    img.onload = () => {
      this.ctx.drawImage(img, 0, 0, r.width, r.height);
      this._ink();
    };
    img.src = url;
  }
}

const sigPads = {};
$$(".sigpad").forEach(w => { sigPads[w.dataset.sigpad] = new SignaturePad(w); });

/* Signature method: draw on the canvas pad, or type a full legal name. The typed path is
   the keyboard/assistive-tech alternative — the pad is the only pointer-only required
   interaction in the form. Both inputs are preserved when toggling; only the active
   method counts for validation/progress and lands in preview/print. */
let sigMethod = "draw";
const typedSigInput = $("#typed-signature");

function ownerSignatureProvided() {
  return sigMethod === "type"
    ? !!(typedSigInput && typedSigInput.value.trim())
    : !sigPads.ownerAckSignature.isEmpty();
}

function setSigMethod(method) {
  sigMethod = method === "type" ? "type" : "draw";
  const pad = sigPads.ownerAckSignature;
  [["#sig-method-draw", "draw"], ["#sig-method-type", "type"]].forEach(([sel, m]) => {
    const btn = $(sel);
    if (!btn) return;
    btn.classList.toggle("is-active", sigMethod === m);
    btn.setAttribute("aria-pressed", String(sigMethod === m));
  });
  pad.wrap.hidden = sigMethod !== "draw";
  const typedWrap = $("#sig-typed-wrap");
  if (typedWrap) typedWrap.hidden = sigMethod !== "type";
  // The pad's canvas can't size itself while hidden — (re)size it on reveal.
  if (sigMethod === "draw") pad.resize(true);
  // Don't let a stale error from the other method linger.
  pad.wrap.classList.remove("invalid");
  if (typedSigInput) clearFieldError(typedSigInput);
}
$("#sig-method-draw")?.addEventListener("click", () => { setSigMethod("draw"); updateProgress(); scheduleAutosave(); });
$("#sig-method-type")?.addEventListener("click", () => { setSigMethod("type"); updateProgress(); scheduleAutosave(); });


/* ------------------------------------------------------
   PROPOSED IMPROVEMENTS  (Section 02 — item repeater)
   Replaces the old single free-text proposal: each change is
   its own item (category / action / short name / materials /
   dimensions / example-or-catalog picture), so the committee's
   "must include" list is structured and checkable instead of
   hoped-for in a prose blob.

   The CATEGORY drives which of the two flexible fields show and
   how they're labeled — a plant needs "plant type & quantity",
   not "materials & color / 12×24 dimensions"; a paint change is
   a color code, not dimensions. Same data-driven discipline as
   PALETTE/PHOTO_SPECS: edit CATEGORIES to change the questions.
   A Remove item additionally hides materials, and its picture
   becomes an optional "what's being removed" shot.
------------------------------------------------------ */
const improvementList = $("#improvement-list");
let improvementCount = 0;

// Per-category field schema. `namePh` is the grey placeholder for the "What is
// it?" name field; `materials` and `dims` describe the two flexible slots
// (label + placeholder), and `dims: null` hides the dimensions slot for that
// category. All placeholders are assigned to input.placeholder as raw strings,
// so use real characters (× ′), not HTML entities.
const CATEGORIES = [
  { id: "structure", label: "Structure (patio cover, pergola, shed, addition)",
    namePh: "e.g. Alumawood patio cover",
    materials: { label: "Materials & color", ph: "Material, color name & code, manufacturer / vendor" },
    dims: { label: "Dimensions", ph: "e.g. 12′ × 24′, 10′ tall" } },
  { id: "hardscape", label: "Hardscape (pavers, concrete, wall, walkway)",
    namePh: "e.g. Paver patio extension",
    materials: { label: "Materials & color", ph: "Material, color name & code, manufacturer / vendor" },
    dims: { label: "Dimensions / area", ph: "e.g. 200 sq ft, or 8′ × 25′" } },
  { id: "landscape", label: "Plants and landscaping (trees, shrubs, turf)",
    namePh: "e.g. Front-yard desert landscaping",
    materials: { label: "Plant type & quantity", ph: "e.g. 3 × 15-gal Texas sage, 1 × 24-in box olive tree" },
    dims: { label: "Mature size / spread (optional)", ph: "e.g. ~6′ tall at maturity" } },
  { id: "paint", label: "Paint or exterior color",
    namePh: "e.g. Repaint house exterior",
    materials: { label: "Color name, code & manufacturer", ph: "e.g. Dunn-Edwards 'Cliffside' DE6216, from a paint retailer" },
    dims: null },
  { id: "equipment", label: "Equipment (solar, AC, EV charger, dish)",
    namePh: "e.g. Rooftop solar panels",
    materials: { label: "Make / model", ph: "Manufacturer & model number" },
    dims: { label: "Dimensions / location", ph: "Size, and where it's mounted or placed" } },
  { id: "pool", label: "Pool, spa or water feature",
    namePh: "e.g. In-ground spa",
    materials: { label: "Materials & finish", ph: "Shell / deck material, color, manufacturer" },
    dims: { label: "Dimensions", ph: "e.g. 15′ × 30′, 6′ deep" } },
  { id: "other", label: "Other",
    namePh: "e.g. Wrought-iron entry gate",
    materials: { label: "Materials / details", ph: "Describe the materials, colors, finishes" },
    dims: { label: "Dimensions", ph: "Size or extent, if applicable" } }
];
const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));
const DEFAULT_CATEGORY = "structure";
// Short label for the output table's "Type" column (drops the "(examples…)" tail)
const categoryLabelShort = id => (CATEGORY_MAP[id]?.label || "").replace(/\s*\(.*$/, "");

function improvementTemplate(idx) {
  const cats = CATEGORIES.map(c => `<option value="${c.id}">${c.label}</option>`).join("");
  return `
    <div class="improvement" data-improvement="${idx}">
      <button type="button" class="improvement__remove" aria-label="Remove improvement" title="Remove">&times;</button>
      <div class="improvement__num">Improvement ${idx}</div>
      <div class="grid-2">
        <div class="field">
          <label for="imp_cat_${idx}">Type of change</label>
          <select id="imp_cat_${idx}" name="imp_cat_${idx}" data-imp-category>${cats}</select>
        </div>
        <div class="field">
          <label for="imp_action_${idx}">Action</label>
          <select id="imp_action_${idx}" name="imp_action_${idx}" data-imp-action>
            <option value="add">Add (new)</option>
            <option value="replace">Replace existing</option>
            <option value="remove">Remove</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label for="imp_name_${idx}">What is it?</label>
        <input type="text" id="imp_name_${idx}" name="imp_name_${idx}" data-imp-name required placeholder="e.g. Alumawood patio cover" />
      </div>
      <div class="grid-2">
        <div class="field" data-imp-materials-field>
          <label for="imp_materials_${idx}">Materials &amp; color</label>
          <input type="text" id="imp_materials_${idx}" name="imp_materials_${idx}" data-imp-materials placeholder="Material, color name &amp; code, manufacturer / vendor" />
        </div>
        <div class="field" data-imp-dims-field>
          <label for="imp_dims_${idx}">Dimensions</label>
          <input type="text" id="imp_dims_${idx}" name="imp_dims_${idx}" data-imp-dims placeholder="e.g. 12&#8242; &#215; 24&#8242;" />
        </div>
      </div>
      <div class="improvement__upload">
        <label class="dropzone dropzone--compact">
          ${DROPZONE_ICON}
          <span class="dropzone__text"><strong data-imp-photo-label>Attach example / catalog pictures</strong> — drag &amp; drop, paste, or <span class="dropzone__browse">browse</span> <span class="muted">(one or more)</span></span>
          <input type="file" id="imp_photo_${idx}" name="imp_photo_${idx}" data-imp-photo="${idx}" accept="image/*,application/pdf" multiple class="dropzone__input" />
        </label>
        <span class="improvement__status" data-imp-status="${idx}">No picture attached yet.</span>
        <div class="photo-thumb-list" data-imp-thumb-list hidden></div>
      </div>
    </div>`;
}

// Reflect the chosen category + action onto the row's flexible fields:
//  - the category relabels the materials/dimensions slots and hides dimensions
//    for categories that don't need them (paint);
//  - Remove overrides: hide the materials field entirely and relabel the picture
//    as an optional "what's being removed" shot.
// Hiding uses the `hidden` attribute (safe: .field sets no display). Called on
// build, on category change, and on action change.
function applyImprovementSchema(node) {
  const cat = CATEGORY_MAP[$("[data-imp-category]", node)?.value] || CATEGORY_MAP[DEFAULT_CATEGORY];
  const removing = ($("[data-imp-action]", node)?.value) === "remove";

  // Per-category grey hint for the "What is it?" name field (placeholder only —
  // never a value, so switching categories can't clobber what the user typed).
  const nameInput = $("[data-imp-name]", node);
  if (nameInput) nameInput.placeholder = cat.namePh;

  const matField = $("[data-imp-materials-field]", node);
  if (matField) {
    const matLabel = $("label", matField);
    const matInput = $("[data-imp-materials]", node);
    if (matLabel) matLabel.textContent = cat.materials.label;
    if (matInput) matInput.placeholder = cat.materials.ph;
    matField.hidden = removing; // Remove skips materials; every category otherwise shows it
  }

  const dimsField = $("[data-imp-dims-field]", node);
  if (dimsField) {
    if (cat.dims) {
      const dimsLabel = $("label", dimsField);
      const dimsInput = $("[data-imp-dims]", node);
      if (dimsLabel) dimsLabel.textContent = cat.dims.label;
      if (dimsInput) dimsInput.placeholder = cat.dims.ph;
    }
    dimsField.hidden = !cat.dims; // paint has no dimensions
  }

  const label = $("[data-imp-photo-label]", node);
  const idx = node.dataset.improvement;
  const input = $(`[data-imp-photo="${idx}"]`, node);
  const hasFile = !!(input && input.files && input.files.length);
  if (label && !hasFile) {
    label.textContent = removing
      ? "Attach photo(s) of what's being removed (optional)"
      : "Attach example / catalog pictures";
  }
}

// The visible "Improvement N" labels re-derive from 1-based DOM position after
// every add/remove — deleting rows must not leave "Improvement 3" as the only
// item. data-improvement / input ids / names stay on the monotonic counter:
// uniqueness is what the label/for pairs and the photo-status wiring depend on.
function renumberImprovements() {
  $$(".improvement", improvementList).forEach((node, i) => {
    const num = $(".improvement__num", node);
    if (num) num.textContent = "Improvement " + (i + 1);
  });
}

// Stable per-row id for keying the improvement's picture in IndexedDB — survives the
// display renumbering (which reassigns the visible label) AND a save/restore round trip
// (persisted in items[].uid), where the monotonic data-improvement idx does NOT (restore
// re-counts rows from 1). So a restored row rehydrates the right stored blob.
let impUidSeq = 0;
function newImpUid() { return "iu-" + Date.now().toString(36) + "-" + (impUidSeq++).toString(36); }

function addImprovement(uid) {
  improvementCount++;
  const wrap = document.createElement("div");
  wrap.innerHTML = improvementTemplate(improvementCount).trim();
  const node = wrap.firstChild;
  node.dataset.impUid = uid || newImpUid();
  improvementList.appendChild(node);
  $(".improvement__remove", node).addEventListener("click", () => {
    const rowUid = node.dataset.impUid;
    revokeThumbUrls("imp:" + rowUid); // release the row's thumbnail blob URLs
    node.remove();
    // The row's stored picture goes with it (no orphan blob in IDB).
    if (idbAvailable() && appRefId) delAttachment(appRefId, "imp:" + rowUid).catch(() => {});
    // Keep at least one item so "name required per item" always demands one named change.
    if (!$$(".improvement", improvementList).length) addImprovement();
    renumberImprovements();
    updateProgress();
    scheduleAutosave();
  });
  $("[data-imp-category]", node).addEventListener("change", () => applyImprovementSchema(node));
  $("[data-imp-action]", node).addEventListener("change", () => {
    applyImprovementSchema(node);
    updateImprovementStatus(node.dataset.improvement);
  });
  const photoInput = $(`[data-imp-photo="${improvementCount}"]`, node);
  photoInput.addEventListener("change", () => {
    updateImprovementStatus(node.dataset.improvement);
    persistAttachment("imp:" + node.dataset.impUid, photoInput);
  });
  registerDropzone(photoInput.closest(".dropzone"), photoInput);
  applyImprovementSchema(node);
  renumberImprovements();
  return node;
}
$("#add-improvement").addEventListener("click", () => addImprovement());
// Per-file remove on a multi-file improvement picture list — rebuild the FileList
// without that one file (immutable, so via DataTransfer), then repaint + re-persist by
// hand (editing .files fires no change event). Mirrors the photo remove-one path.
improvementList.addEventListener("click", e => {
  const rm = e.target.closest("[data-imp-remove-one]");
  if (!rm) return;
  const node = rm.closest(".improvement");
  if (!node) return;
  const input = $("input[data-imp-photo]", node);
  const idx = Number(rm.dataset.fileIndex);
  if (input && input.files) {
    const dt = new DataTransfer();
    Array.from(input.files).forEach((f, i) => { if (i !== idx) dt.items.add(f); });
    input.files = dt.files;
  }
  updateImprovementStatus(node.dataset.improvement);
  if (input) persistAttachment("imp:" + node.dataset.impUid, input);
  updateProgress();
  scheduleAutosave();
});
// start with one improvement block
addImprovement();

// The improvement picture input is `multiple` (Sprint 19) — mirror the multi-file photo
// pattern: a count in the status line plus one thumbnail card per file (with per-file
// Remove), blob URLs cached under "imp:<uid>" so replacing/removing can't leak handles.
function updateImprovementStatus(idx) {
  const node = $(`.improvement[data-improvement="${idx}"]`, improvementList);
  if (!node) return;
  const input = $(`[data-imp-photo="${idx}"]`, node);
  const statusEl = $(`[data-imp-status="${idx}"]`, node);
  const list = $("[data-imp-thumb-list]", node);
  if (!input || !statusEl) return;
  const removing = ($("[data-imp-action]", node)?.value) === "remove";
  const urlKey = "imp:" + node.dataset.impUid;
  statusEl.classList.remove("is-prior");
  revokeThumbUrls(urlKey);
  const files = Array.from(input.files || []);
  if (files.length) {
    const total = files.reduce((n, f) => n + f.size, 0);
    statusEl.textContent = `Attached: ${files.length} picture${files.length === 1 ? "" : "s"} (${formatBytes(total)})`;
    statusEl.classList.add("is-attached");
    node.classList.add("is-attached");
    if (list) {
      list.innerHTML = files.map((f, i) => {
        let url = null;
        if (f.type.startsWith("image/")) { url = URL.createObjectURL(f); photoThumbUrls[urlKey].push(url); }
        return thumbCardHTML(f, url, "data-imp-remove-one", node.dataset.improvement, i);
      }).join("");
      list.hidden = false;
    }
  } else {
    statusEl.textContent = removing ? "Optional — no picture attached." : "No picture attached yet.";
    statusEl.classList.remove("is-attached");
    node.classList.remove("is-attached");
    if (list) { list.hidden = true; list.innerHTML = ""; }
  }
}

// Single DOM->data source for the item list. `photo` is a LIST of attached filenames
// (Sprint 19 made the picture input `multiple`) — empty when none attached. A restored
// draft can't repopulate a file input from localStorage alone (same browser limit as
// photos), but the bytes rehydrate from IDB; an un-reattached picture drops on the next
// save by design. (Older drafts stored `photo` as a single string — restore normalizes it.)
function improvementItems() {
  return $$(".improvement", improvementList).map(node => {
    const idx = node.dataset.improvement;
    const input = $(`[data-imp-photo="${idx}"]`, node);
    return {
      uid: node.dataset.impUid, // stable IDB key for the row's picture (survives renumbering)
      category: $("[data-imp-category]", node)?.value || DEFAULT_CATEGORY,
      action: $("[data-imp-action]", node)?.value || "add",
      name: $("[data-imp-name]", node)?.value.trim() || "",
      materials: $("[data-imp-materials]", node)?.value.trim() || "",
      dimensions: $("[data-imp-dims]", node)?.value.trim() || "",
      photo: (input && input.files && input.files.length) ? Array.from(input.files).map(f => f.name) : []
    };
  });
}

// Normalize an item's `photo` (a list since Sprint 19; a single string in older drafts)
// to a plain array of filenames.
function itemPhotoNames(it) {
  return Array.isArray(it.photo) ? it.photo : (it.photo ? [it.photo] : []);
}

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
        bad: "Too close, sharply angled, or with a car blocking the yard.",
        goodImg: "assets/photo-examples/front_street-good.jpg", badImg: "assets/photo-examples/front_street-bad.jpg" },
      { id: "front_left", title: "From the left curb",
        instr: "From the curb at the left edge of your yard, capture the home and yard looking across the front.",
        good: "Yard and house visible from the left corner.",
        bad: "Only a slice of the yard, or shot from the porch.",
        goodImg: "assets/photo-examples/front_left-good.jpg", badImg: "assets/photo-examples/front_left-bad.jpg" },
      { id: "front_right", title: "From the right curb",
        instr: "From the curb at the right edge of your yard, capture the home and yard looking across the front.",
        good: "Yard and house visible from the right corner.",
        bad: "Only a slice of the yard, or shot from the porch.",
        goodImg: "assets/photo-examples/front_right-good.jpg", badImg: "assets/photo-examples/front_right-bad.jpg" }
    ]
  },
  back: {
    label: "Back yard",
    shots: [
      { id: "back_full", title: "Full yard from the farthest point",
        instr: "Stand at the point farthest from the house and capture the entire back yard in one frame.",
        good: "Entire back yard, fence to fence, in one shot.",
        bad: "Standing near the house so half the yard is cut off.",
        goodImg: "assets/photo-examples/back_full-good.jpg", badImg: "assets/photo-examples/back_full-bad.jpg" },
      { id: "back_left", title: "From the left side",
        instr: "From the left side of the yard, capture the entire space, property line to property line.",
        good: "Full left-to-right view of the yard.",
        bad: "Zoomed in on a single corner.",
        goodImg: "assets/photo-examples/back_left-good.jpg", badImg: "assets/photo-examples/back_left-bad.jpg" },
      { id: "back_right", title: "From the right side",
        instr: "From the right side of the yard, capture the entire space, property line to property line.",
        good: "Full right-to-left view of the yard.",
        bad: "Zoomed in on a single corner.",
        goodImg: "assets/photo-examples/back_right-good.jpg", badImg: "assets/photo-examples/back_right-bad.jpg" }
    ]
  },
  side: {
    label: "Side yard",
    shots: [
      { id: "side_full", title: "Full length of the side yard",
        instr: "Capture the full length of the affected side yard, fence line to fence line. Take one for each side if both are affected.",
        good: "Whole side-yard run, visible end to end.",
        bad: "A single fence panel or a cropped section.",
        goodImg: "assets/photo-examples/side_full-good.jpg", badImg: "assets/photo-examples/side_full-bad.jpg" }
    ]
  },
  exterior: {
    label: "Home exterior",
    shots: [
      { id: "ext_elevation", title: "Affected wall or elevation",
        instr: "Photograph the wall, roof section, or elevation of the home that the change affects, straight on and evenly lit.",
        good: "The full affected face of the home, evenly lit.",
        bad: "Sharp angle, deep shadow, or only part of the wall.",
        goodImg: "assets/photo-examples/ext_elevation-good.jpg", badImg: "assets/photo-examples/ext_elevation-bad.jpg" }
    ]
  }
};
// Work-area close-ups — requested whenever ANY area is selected (the work area is
// wherever the improvements go, not a property of the back yard, where this shot
// used to live). `multiple`: Section 02 can itemize improvements in different
// spots, so one file per work area. The id stays "back_closeup" so pre-Sprint-12
// drafts restore their prior filename into this slot unchanged.
const PHOTO_CLOSEUP = {
  id: "back_closeup", title: "Close-up(s) of the work area(s)",
  instr: "A closer photo of the exact spot where each change will go, so existing conditions are clear. If your improvements are in different places, attach one photo per spot.",
  good: "Clear view of precisely where the change will be made.",
  bad: "A wide shot where the spot can't be identified.",
  goodImg: "assets/photo-examples/back_closeup-good.jpg", badImg: "assets/photo-examples/back_closeup-bad.jpg",
  multiple: true
};
const PHOTO_MATERIAL = {
  id: "material_sample", title: "Paint color / material sample",
  instr: "Photograph the manufacturer's color chip or material sample, clearly showing the printed name and code.",
  good: "Sample with the name/code legible.",
  bad: "Blurry chip, or a screen photo without the code.",
  goodImg: "assets/photo-examples/material_sample-good.jpg", badImg: "assets/photo-examples/material_sample-bad.jpg"
};
// id -> human label, for preview/print summaries
const PHOTO_TITLE = {};
Object.values(PHOTO_SPECS).forEach(spec => spec.shots.forEach(s => { PHOTO_TITLE[s.id] = spec.label + " — " + s.title; }));
PHOTO_TITLE[PHOTO_CLOSEUP.id] = PHOTO_CLOSEUP.title; // deliberately no area prefix
PHOTO_TITLE[PHOTO_MATERIAL.id] = PHOTO_MATERIAL.title;
function photoTitle(id) { return PHOTO_TITLE[id] || id; }
// id -> {area, shot, instr}: the context each print "plate" binds to its photo so a
// reviewer never has to flip back to the request list (area = grouping label, shot =
// the specific request title, instr = what the shot should show).
const PHOTO_INFO = {};
Object.entries(PHOTO_SPECS).forEach(([, spec]) => spec.shots.forEach(s => {
  PHOTO_INFO[s.id] = { area: spec.label, shot: s.title, instr: s.instr };
}));
PHOTO_INFO[PHOTO_CLOSEUP.id] = { area: "Work area", shot: PHOTO_CLOSEUP.title, instr: PHOTO_CLOSEUP.instr };
PHOTO_INFO[PHOTO_MATERIAL.id] = { area: "Material sample", shot: PHOTO_MATERIAL.title, instr: PHOTO_MATERIAL.instr };

const photoRequestsEl = $("#photo-requests");
const photoEmptyEl = $("#photo-empty");

function exampleFrame(kind, caption, imgSrc) {
  return imgSrc
    ? `<img src="${esc(imgSrc)}" alt="Example: ${esc(caption)}" loading="lazy">`
    : `<span class="photo-example__ph">Example image</span>`;
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return Math.max(1, Math.round(bytes / 1024)) + " KB";
}

function photoRequestBlock(shot) {
  const block = document.createElement("div");
  block.className = "photo-request" + (shot.multiple ? " photo-request--multi" : "");
  block.dataset.photoId = shot.id;
  // Multi-file shots (the work-area close-ups) keep their dropzone visible after an
  // attach (more spots may need photos — dropzone.js appends on multiple inputs) and
  // render a thumbnail card per file into the list container instead of the single
  // .photo-thumb figure.
  block.innerHTML = `
    <div class="photo-request__head">
      <h4 class="photo-request__title">${shot.title}</h4>
      <p class="photo-request__instr">${shot.instr}</p>
    </div>
    <div class="photo-examples" aria-hidden="true">
      <figure class="photo-example photo-example--good">
        <div class="photo-example__frame${shot.goodImg ? " has-img" : ""}">${exampleFrame("good", shot.good, shot.goodImg)}</div>
        <figcaption><span class="photo-example__tag photo-example__tag--good">&#10003; Do this</span>${shot.good}</figcaption>
      </figure>
      <figure class="photo-example photo-example--bad">
        <div class="photo-example__frame${shot.badImg ? " has-img" : ""}">${exampleFrame("bad", shot.bad, shot.badImg)}</div>
        <figcaption><span class="photo-example__tag photo-example__tag--bad">&#10007; Not this</span>${shot.bad}</figcaption>
      </figure>
    </div>
    <div class="photo-request__upload">
      <label class="dropzone dropzone--compact">
        ${DROPZONE_ICON}
        <span class="dropzone__text"><strong>${shot.multiple ? "Attach these photos" : "Attach this photo"}</strong> — drag &amp; drop, paste, or <span class="dropzone__browse">browse</span>${shot.multiple ? ' <span class="muted">(one per work area)</span>' : ""}</span>
        <input type="file" id="photo-${shot.id}" name="photo_${shot.id}" data-photo-input="${shot.id}" accept="image/*"${shot.multiple ? " multiple" : ""} class="dropzone__input" />
      </label>
      <span class="photo-request__status" data-photo-status="${shot.id}">No photo attached yet.</span>
    </div>
    ${shot.multiple ? `
    <div class="photo-thumb-list" data-photo-thumb-list="${shot.id}" hidden></div>` : `
    <figure class="photo-thumb" data-photo-thumb="${shot.id}" hidden>
      <div class="photo-thumb__frame">
        <img class="photo-thumb__img" alt="Your attached photo" />
        <span class="photo-thumb__badge" aria-hidden="true">&#10003;</span>
      </div>
      <figcaption class="photo-thumb__meta">
        <span class="photo-thumb__label">Attached</span>
        <span class="photo-thumb__name" data-photo-thumb-name></span>
        <span class="photo-thumb__size" data-photo-thumb-size></span>
        <span class="photo-thumb__actions">
          <button type="button" class="photo-thumb__btn photo-thumb__btn--replace" data-photo-replace="${shot.id}">Replace</button>
          <button type="button" class="photo-thumb__btn photo-thumb__btn--remove" data-photo-remove="${shot.id}">Remove</button>
        </span>
      </figcaption>
    </figure>`}`;
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

// The multi-file work-area close-up input must ACCUMULATE across separate picks: the
// native file picker replaces an <input>'s whole FileList on each use, so browsing to
// add a second photo would otherwise silently drop the first (the "only 1 photo at a
// time" bug). We remember the committed set per input and merge freshly-picked files
// into it. dropzone.js already appends on drop (it sets input.files to old+dropped
// before firing change), so this merge is idempotent for that path — the dropped files
// are already present. Kept in sync by the remove / remove-one paths below.
const photoCommitted = new WeakMap();
function photoFileKey(f) { return `${f.name}|${f.size}|${f.lastModified}`; }
function mergePickedFiles(input) {
  const prev = photoCommitted.get(input) || [];
  const dt = new DataTransfer();
  const seen = new Set();
  [...prev, ...Array.from(input.files || [])].forEach(f => {
    const k = photoFileKey(f);
    if (!seen.has(k)) { seen.add(k); dt.items.add(f); }
  });
  input.files = dt.files;
}
function rememberCommitted(input) {
  if (input && input.multiple) photoCommitted.set(input, Array.from(input.files || []));
}

function buildPhotoRequests() {
  photoRequestsEl.innerHTML = "";
  Object.entries(PHOTO_SPECS).forEach(([area, spec]) => {
    photoRequestsEl.appendChild(photoGroup(area, spec.label + " photos", spec.shots));
  });
  photoRequestsEl.appendChild(photoGroup("closeup", "Work-area close-ups", [PHOTO_CLOSEUP]));
  photoRequestsEl.appendChild(photoGroup("material", "Color / material sample", [PHOTO_MATERIAL]));
  $$("[data-photo-input]", photoRequestsEl).forEach(input => {
    input.addEventListener("change", () => {
      // Accumulate picks on the multi-file shot (skip during restore — the rehydrated
      // FileList is already the full stored set, and there's no prior "committed" set).
      if (input.multiple && !rehydratingAttachments) mergePickedFiles(input);
      rememberCommitted(input);
      updatePhotoStatus(input.dataset.photoInput);
      persistAttachment("photo:" + input.dataset.photoInput, input);
    });
    // The whole card is the drop/paste target — the dropzone frame inside it is
    // hidden once a photo is attached (.has-thumb), but dropping on the card
    // still replaces the shot.
    registerDropzone(input.closest(".photo-request"), input);
  });
  // Replace re-opens the picker; Remove clears the input. Clearing a file input
  // programmatically fires no change/input event, so we drive the UI + persistence by hand.
  photoRequestsEl.addEventListener("click", e => {
    const replace = e.target.closest("[data-photo-replace]");
    if (replace) {
      const inp = $(`[data-photo-input="${replace.dataset.photoReplace}"]`, photoRequestsEl);
      inp && inp.click();
      return;
    }
    const remove = e.target.closest("[data-photo-remove]");
    if (remove) {
      const id = remove.dataset.photoRemove;
      const inp = $(`[data-photo-input="${id}"]`, photoRequestsEl);
      if (inp) inp.value = "";
      rememberCommitted(inp); // now empty — a later pick starts fresh
      updatePhotoStatus(id);
      // Programmatic clear fires no change event — mirror the removal into IDB by hand.
      if (inp) persistAttachment("photo:" + id, inp);
      updateProgress();
      scheduleAutosave();
      return;
    }
    // Per-file remove on a multi-file shot: rebuild the FileList without that one
    // file (a FileList is immutable — DataTransfer is the only way to edit it).
    const removeOne = e.target.closest("[data-photo-remove-one]");
    if (removeOne) {
      const id = removeOne.dataset.photoRemoveOne;
      const idx = Number(removeOne.dataset.fileIndex);
      const inp = $(`[data-photo-input="${id}"]`, photoRequestsEl);
      if (inp && inp.files) {
        const dt = new DataTransfer();
        Array.from(inp.files).forEach((f, i) => { if (i !== idx) dt.items.add(f); });
        inp.files = dt.files;
      }
      rememberCommitted(inp); // drop the removed file from the committed set too
      updatePhotoStatus(id);
      // Rebuilding the FileList fires no change event — mirror the shorter list into IDB.
      if (inp) persistAttachment("photo:" + id, inp);
      updateProgress();
      scheduleAutosave();
    }
  });
}

// Live object-URLs for attached-photo thumbnails, keyed by shot id (an ARRAY of
// URLs — multi-file shots mint one per file). We revoke the prior URLs before
// minting new ones (and on remove) so replacing photos repeatedly can't leak
// blob handles.
const photoThumbUrls = {};
function revokeThumbUrls(id) {
  (photoThumbUrls[id] || []).forEach(u => URL.revokeObjectURL(u));
  photoThumbUrls[id] = [];
}

// One thumbnail card per attached file in a multi-file list, each with its own Remove.
// `removeAttr`/`removeVal` wire the button to whichever delegated remove-one listener owns
// the list ([data-photo-remove-one] for photos, [data-imp-remove-one] for improvements).
// `url` is null for non-image files (an improvement can attach a PDF) — those show a small
// file-type placeholder instead of an <img> preview.
function thumbCardHTML(f, url, removeAttr, removeVal, fileIndex) {
  const frame = url
    ? `<img class="photo-thumb__img is-fresh" src="${url}" alt="Preview of attached file: ${esc(f.name)}" />`
    : `<span class="photo-thumb__doc" aria-hidden="true">${esc((f.name.split(".").pop() || "file").toUpperCase())}</span>`;
  return `
    <figure class="photo-thumb photo-thumb--multi">
      <div class="photo-thumb__frame">
        ${frame}
        <span class="photo-thumb__badge" aria-hidden="true">&#10003;</span>
      </div>
      <figcaption class="photo-thumb__meta">
        <span class="photo-thumb__label">Attached</span>
        <span class="photo-thumb__name">${esc(f.name)}</span>
        <span class="photo-thumb__size">${formatBytes(f.size)}</span>
        <span class="photo-thumb__actions">
          <button type="button" class="photo-thumb__btn photo-thumb__btn--remove" ${removeAttr}="${removeVal}" data-file-index="${fileIndex}">Remove</button>
        </span>
      </figcaption>
    </figure>`;
}
function multiThumbCard(id, f, i, url) {
  return thumbCardHTML(f, url, "data-photo-remove-one", id, i);
}

function updateMultiPhotoStatus(id, input, statusEl, block) {
  const list = $(`[data-photo-thumb-list="${id}"]`, photoRequestsEl);
  const files = Array.from(input.files || []);
  revokeThumbUrls(id);
  if (files.length) {
    statusEl.textContent = `Attached: ${files.length} photo${files.length === 1 ? "" : "s"} (${formatBytes(files.reduce((n, f) => n + f.size, 0))})`;
    statusEl.classList.add("is-attached");
    block && block.classList.add("is-attached");
    if (list) {
      list.innerHTML = files.map((f, i) => {
        const url = URL.createObjectURL(f);
        photoThumbUrls[id].push(url);
        return multiThumbCard(id, f, i, url);
      }).join("");
      list.hidden = false;
    }
  } else {
    statusEl.textContent = "No photo attached yet.";
    statusEl.classList.remove("is-attached");
    block && block.classList.remove("is-attached");
    if (list) { list.hidden = true; list.innerHTML = ""; }
  }
}

function updatePhotoStatus(id) {
  const input = $(`[data-photo-input="${id}"]`, photoRequestsEl);
  const statusEl = $(`[data-photo-status="${id}"]`, photoRequestsEl);
  if (!input || !statusEl) return;
  const block = input.closest(".photo-request");
  statusEl.classList.remove("is-prior");
  if (input.multiple) return updateMultiPhotoStatus(id, input, statusEl, block);
  const thumb = $(`[data-photo-thumb="${id}"]`, photoRequestsEl);
  revokeThumbUrls(id);
  if (input.files && input.files.length) {
    const f = input.files[0];
    statusEl.textContent = `Attached: ${f.name} (${formatBytes(f.size)})`;
    statusEl.classList.add("is-attached");
    block && block.classList.add("is-attached");
    if (thumb && f.type.startsWith("image/")) {
      const url = URL.createObjectURL(f);
      photoThumbUrls[id].push(url);
      const img = $(".photo-thumb__img", thumb);
      img.src = url;
      img.alt = `Preview of attached photo: ${f.name}`;
      $("[data-photo-thumb-name]", thumb).textContent = f.name;
      $("[data-photo-thumb-size]", thumb).textContent = formatBytes(f.size);
      thumb.hidden = false;
      block && block.classList.add("has-thumb");
      // re-trigger the pop animation on the image even when the card is already visible (Replace)
      img.classList.remove("is-fresh"); void img.offsetWidth; img.classList.add("is-fresh");
    }
  } else {
    statusEl.textContent = "No photo attached yet.";
    statusEl.classList.remove("is-attached");
    block && block.classList.remove("is-attached", "has-thumb");
    if (thumb) { thumb.hidden = true; $(".photo-thumb__img", thumb).removeAttribute("src"); }
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
    // close-ups are area-agnostic: requested whenever at least one area is selected
    const show = a === "material" ? wantsMaterial
      : a === "closeup" ? areas.length > 0
      : areas.includes(a);
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
export function updateProgress() {
  const required = $$("#arc-form [required]");
  let done = 0;
  required.forEach(el => {
    if (el.type === "checkbox") { if (el.checked) done++; }
    else if (el.value && el.value.trim()) done++;
  });
  // count the ack signature as required-ish (drawn ink or a typed name, per the chosen method)
  let total = required.length + 1;
  if (ownerSignatureProvided()) done++;
  // Two workflow signals that aren't [required] DOM fields still count, so 100% stays
  // unreachable with an empty packet: a provided plot plan (Step 03) and every requested
  // photo attached (Step 04). Catalog pictures no longer gate (Sprint 20) — the print
  // pages show them, and requiring one per improvement read as nagging.
  total += 2;
  if (plotProvided().ok) done++;
  const reqPhotos = photoChecklist();
  if (reqPhotos.length > 0 && reqPhotos.every(p => p.file)) done++;
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
   WORKFLOW-STEP STATUS  (Sprint 20)
   The "Save & Print Packet" card used to audit packet artifacts
   (plot present, each photo attached, each catalog picture) — which
   duplicated what the print pages already show and read as nagging.
   Now one source of truth reports each WORKFLOW STEP as done/incomplete,
   judged by that section's own inputs: 01 Applicant · 02 Proposed
   Improvements · 03 Site/Plot Plan · 04 Photos · 05 Acknowledgments.
   Feeds the Save & Print Packet overview, the advisory review gate,
   and the printed cover's "still to finish" note.
   (plotProvided/photoChecklist below are still the per-section signals
   for steps 03/04; catalog pictures no longer gate anywhere.)
------------------------------------------------------ */
let pdfSaved = false; // flips once the print/save-PDF view is opened this session

function plotProvided() {
  const names = plotUploadInput.files ? Array.from(plotUploadInput.files).map(f => f.name) : [];
  if (planMode === "upload") return { mode: "upload", ok: names.length > 0, names };
  // Build mode: completion is DECLARED (the Draw step's "Done — use this plan" button),
  // not inferred from a first stroke. `started` drives the "in progress" third state.
  return { mode: "build", ok: plotUsed() && isPlotConfirmed(), started: plotUsed(), names: [] };
}

// Every photo the questionnaire currently requests, with the attached filename(s)
// (or null). A multi-file shot's `file` is the joined name list — one row, one
// truthy display string, so every consumer (meter, gate, packet subrow, manifest)
// handles it unchanged.
function photoChecklist() {
  const rows = [];
  const areas = selectedPhotoAreas();
  areas.forEach(area => {
    const spec = PHOTO_SPECS[area];
    if (spec) spec.shots.forEach(s => rows.push({ id: s.id, title: spec.label + " — " + s.title }));
  });
  if (areas.length) rows.push({ id: PHOTO_CLOSEUP.id, title: PHOTO_CLOSEUP.title });
  if (selectedPhotoMaterial() === "yes") rows.push({ id: PHOTO_MATERIAL.id, title: PHOTO_MATERIAL.title });
  rows.forEach(r => {
    const input = $(`[data-photo-input="${r.id}"]`, photoRequestsEl);
    const names = (input && input.files) ? Array.from(input.files).map(f => f.name) : [];
    r.file = names.length ? names.join(", ") : null;
  });
  return rows;
}

// Add/Replace items expect an example/catalog picture (the committee's "must include");
// Remove items don't (their picture is optional). Rows carry the attached filename or null.
function improvementChecklist() {
  return improvementItems()
    .filter(it => it.action !== "remove" && it.name)
    .map(it => {
      const names = itemPhotoNames(it);
      return { name: it.name, action: it.action, file: names.length ? names.join(", ") : null };
    });
}

/* ----- WORKFLOW STEPS -----
   The five form sections, in order, keyed to their DOM containers. The step-status
   overview, the advisory gate, and the printed cover all read from stepStatus(). */
const STEPS = [
  { num: "01", label: "Applicant Information", id: "applicant" },
  { num: "02", label: "Proposed Improvements", id: "description" },
  { num: "03", label: "Site / Plot Plan", id: "siteplan" },
  { num: "04", label: "Photos", id: "photos-section" },
  { num: "05", label: "Acknowledgments", id: "acknowledgments" }
];
const FIELDS_REASON = "Some required details are still blank.";

// Shared required-field predicate — used by the (pure) section-completeness check
// AND by fieldIssues() (which additionally paints inline errors). Returns {bad, msg}.
function checkRequired(el) {
  let bad = false, msg = "This field is required.";
  if (el.type === "checkbox") bad = !el.checked;
  else bad = !el.value || !el.value.trim();
  if (!bad && el.type === "email" && !EMAIL_RE.test(el.value.trim())) {
    bad = true; msg = "Please enter a valid email address.";
  }
  if (!bad && el.type === "tel") {
    const digits = (el.value.match(PHONE_DIGITS_RE) || []).length;
    if (digits < 10 || !PHONE_RE.test(el.value.trim())) {
      bad = true; msg = "Please enter a valid phone number (at least 10 digits).";
    }
  }
  return { bad, msg };
}

// Pure (no DOM side effects) — is every [required] input inside this section satisfied?
// The live overview + progress meter use this; the gate uses the painting fieldIssues().
function sectionRequiredComplete(sectionId) {
  const sec = document.getElementById(sectionId);
  if (!sec) return true;
  return $$("[required]", sec).every(el => !checkRequired(el).bad);
}

// One-line reason a plot step isn't done (build vs upload, and the "drawn but not
// confirmed" third state).
function plotStepReason(plot) {
  if (plot.mode === "upload") return "Upload chosen, but no plot-plan file is attached.";
  if (plot.started) return "Plan drawn — press “Done — use this plan” to finish it.";
  return "No plot plan yet — draw one, or switch to uploading a file.";
}

// Per-step done/incomplete for the overview, gate, meter, and printed cover — each step
// judged by its OWN inputs. Steps 03/04/05 add the non-field signals (plot provided,
// photos attached, signature present). Pure — never paints inline errors.
function stepStatus() {
  return STEPS.map(step => {
    const fieldsOk = sectionRequiredComplete(step.id);
    let ok = fieldsOk, reason = fieldsOk ? "" : FIELDS_REASON;
    if (step.id === "siteplan") {
      const plot = plotProvided();
      ok = fieldsOk && plot.ok;
      if (!plot.ok) reason = plotStepReason(plot);
    } else if (step.id === "photos-section") {
      const photos = photoChecklist();
      const photosOk = photos.length > 0 && photos.every(p => p.file);
      ok = fieldsOk && photosOk;
      if (!photos.length) reason = "Answer the questionnaire to see which photos are needed.";
      else if (!photosOk) {
        const need = photos.filter(p => !p.file).length;
        reason = `${need} of ${photos.length} requested photo${photos.length === 1 ? "" : "s"} still to attach.`;
      }
    } else if (step.id === "acknowledgments") {
      const signed = ownerSignatureProvided();
      ok = fieldsOk && signed;
      if (!fieldsOk) reason = "Check each acknowledgment to finish.";
      else if (!signed) reason = "Sign the acknowledgment — draw or type your full legal name.";
    }
    return { ...step, href: "#" + step.id, ok, reason };
  });
}

/* ----- step-status overview rendering (Save & Print Packet card) ----- */
const stepStatusEl = $("#step-status");

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

// The Save & Print Packet card's at-a-glance overview: one row per workflow step,
// each done (green ✓) or incomplete (✗ + a one-line reason and a jump link). No
// per-artifact itemization — that lived in the old packet list and read as nagging.
function renderStepStatus() {
  if (!stepStatusEl) return;
  stepStatusEl.textContent = "";
  stepStatus().forEach(s => stepStatusEl.appendChild(packetItemNode({
    label: `${s.num} · ${s.label}`,
    ok: s.ok,
    note: s.ok ? null : s.reason,
    href: s.href
  })));
}

function refreshFinishSteps() {
  const s1 = $("#finish-step-1");
  if (s1) s1.classList.toggle("is-done", pdfSaved);
}

// The Draw step's "Done — use this plan" CTA + the wizard's Draw dot reflect the
// declared-completion state (see plot-editor's isPlotConfirmed). Runs from every
// updateProgress(), so a paint stroke / Clear / Done click all repaint it.
function refreshPlotDoneUI() {
  const confirmed = isPlotConfirmed();
  const btn = $("#plot-done");
  if (btn) {
    // Once confirmed the Done CTA becomes a static "added" badge (disabled); "Make changes" is
    // the way back into editing, so it — not Done/Clear — is the live control while locked.
    btn.disabled = confirmed || !plotUsed();
    btn.classList.toggle("is-confirmed", confirmed);
    btn.textContent = confirmed ? "✓ Plan added to your packet" : "Done — use this plan";
  }
  const secondaryNav = $("#plot-nav-secondary");  // Back to orientation + Clear plan
  if (secondaryNav) secondaryNav.hidden = confirmed; // no clearing/reorienting a locked plan
  const editBtn = $("#plot-edit");
  if (editBtn) editBtn.hidden = !confirmed;       // unlock control, shown only while locked
  // Lock the drawing surface: hide the material palette, tool rail, and status/hints strip,
  // and freeze the canvas (behavioral guards live in plot-editor's pointer/keyboard handlers).
  const plotEl = $(".plot");
  if (plotEl) plotEl.classList.toggle("is-locked", confirmed);
  const drawDot = $('.plot-steps-nav__dot[data-goto="4"]');
  if (drawDot) drawDot.classList.toggle("is-done", confirmed);
}

export function refreshPacketUI() {
  renderStepStatus();
  refreshFinishSteps();
  refreshPlotDoneUI();
}

/* ------------------------------------------------------
   COLLECT DATA
------------------------------------------------------ */
function collect() {
  const plotData = serializePlot();
  const data = {
    refId: getRefId(),
    ownerName: $("#owner-name").value.trim(),
    propertyAddress: $("#property-address").value.trim(),
    ownerPhone: $("#owner-phone").value.trim(),
    ownerEmail: $("#owner-email").value.trim(),
    submissions: {},
    items: improvementItems(),
    proposal: proposal.value.trim(),
    acks: {},
    ackDate: $("#ack-date").value,
    ownerAckSignature: sigPads.ownerAckSignature.toDataURL(),
    ownerSigMethod: sigMethod,
    ownerTypedSignature: typedSigInput ? typedSigInput.value.trim() : "",
    planMode: planMode,
    plot: { version: PLOT_VERSION, ...plotData },
    plotMeta: {
      cols: plotData.cols, rows: plotData.rows,
      apn: selectedAPN, bearing: parcelBearing,
      parcelCoords: selectedParcelGeoJSON?.geometry?.coordinates || null
    },
    plotUpload: plotUploadInput.files ? Array.from(plotUploadInput.files).map(f => f.name) : [],
    photoAreas: {},
    photoMaterial: selectedPhotoMaterial(),
    photos: {},
    files: []
  };
  $$(".photo-quiz [data-area]").forEach(c => { data.photoAreas[c.dataset.area] = c.checked; });
  $$("[data-photo-input]", photoRequestsEl).forEach(input => {
    if (input.files && input.files.length) {
      const names = Array.from(input.files).map(f => f.name);
      // multi-file shots (work-area close-ups) persist a filename LIST; single shots
      // stay a plain string for draft-shape continuity
      data.photos[input.dataset.photoInput] = input.multiple ? names : names[0];
      data.files.push(...names);
    }
  });
  // Every submission row is derived from real app state — the manual sketches
  // attestation went the way of the fee checkbox (Section 02 itemizes materials,
  // dimensions, and example pictures per improvement now).
  data.submissions.req_plot = plotProvided().ok;
  const reqPhotos = photoChecklist();
  data.submissions.req_photos = reqPhotos.length > 0 && reqPhotos.every(p => p.file);
  $$("#acks input[type=checkbox]").forEach(c => data.acks[c.name] = c.checked);
  return data;
}

/* ------------------------------------------------------
   DRAFT PERSISTENCE
------------------------------------------------------ */
const saveWarningEl = $("#save-warning");

/* ----- ATTACHMENT PERSISTENCE (IndexedDB, via attach-store.js) -----
   File inputs only hold bytes for the session and the localStorage draft persists
   filenames only — so photos, improvement pictures, and the plot upload used to reload
   as a "previously attached" note with no image. We mirror every attach/replace/remove
   into IndexedDB keyed by the draft's refId, and rehydrate live Files (via DataTransfer)
   on restore. Degrades gracefully: if IDB is unavailable or a write throws, the
   filename-only is-prior path still stands. (Signatures + plot state stay in
   localStorage; only file bytes move to IDB.) */

// Suppresses persist-on-change while restore is pushing stored Files back into inputs
// (the synthetic `change` we fire there would otherwise re-write what we just read).
let rehydratingAttachments = false;

// Mirror an input's current files to IDB (or clear the key when empty). Also nudges
// autosave so the draft carries the refId these blobs are stored under before any reload
// — without that, restore couldn't find them. Fire-and-forget; a failure lights the same
// #save-warning indicator the localStorage path uses.
function persistAttachment(inputKey, input) {
  if (rehydratingAttachments) return;
  scheduleAutosave(); // keep the draft (and its refId) current whenever attachments change
  if (!idbAvailable()) return;
  saveAttachment(getRefId(), inputKey, input.files)
    .catch(() => { if (saveWarningEl) saveWarningEl.hidden = false; });
}

// Push stored Files into an input and let its existing change-listeners light up the UI
// (thumbnail, status, progress) — the same path a real attach takes, so restored
// attachments are indistinguishable from freshly-attached ones. No-op if nothing's stored.
async function hydrateInput(input, inputKey) {
  if (!input || !appRefId) return false;
  let files;
  try { files = await loadAttachment(appRefId, inputKey); } catch (e) { return false; }
  if (!files.length) return false;
  const dt = new DataTransfer();
  files.forEach(f => dt.items.add(f));
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

// After a draft restore, upgrade every is-prior filename note to a live attachment
// wherever the bytes still live in IDB. Runs async (IDB reads are promises) so
// restoreDraft() stays synchronous; missing blobs simply leave is-prior in place.
async function rehydrateAttachments(d) {
  if (!idbAvailable() || !appRefId) return;
  rehydratingAttachments = true;
  try {
    for (const id of Object.keys(d.photos || {})) {
      await hydrateInput($(`[data-photo-input="${id}"]`, photoRequestsEl), "photo:" + id);
    }
    for (const node of $$(".improvement", improvementList)) {
      await hydrateInput($("input[data-imp-photo]", node), "imp:" + node.dataset.impUid);
    }
    await hydrateInput(plotUploadInput, "plot");
  } finally {
    rehydratingAttachments = false;
  }
  updateProgress();
}

// Purge this draft's stored file bytes — paired with deleteDraft() (PII hygiene).
async function wipeCurrentAttachments() {
  if (!idbAvailable() || !appRefId) return;
  try { await clearAttachments(appRefId); } catch (e) {}
}

// The plot upload (Section 03) is owned by map-wizard.js (it renders the file list on
// change); we add our own change listener here so its bytes persist to IDB too. Both
// listeners fire on the rehydrate synthetic change — ours is gated by the flag above.
plotUploadInput.addEventListener("change", () => persistAttachment("plot", plotUploadInput));

function saveDraft(silent) {
  const d = collect();
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    // A prior failure may have been transient (quota freed, permission granted) —
    // clear the persistent warning the moment a save goes through again.
    if (saveWarningEl) saveWarningEl.hidden = true;
    if (!silent) status("Draft saved in this browser.", "ok");
  } catch (e) {
    // Signature PNGs + the plot grid can push a draft toward the ~5 MB localStorage
    // quota. Autosave calls this silently, so without the sidenav warning a failure
    // here would mean quietly losing everything typed since the last good save.
    if (saveWarningEl) saveWarningEl.hidden = false;
    if (!silent) status("Could not save draft (storage full or blocked).", "err");
  }
}

// Remove the current draft AND the legacy-format drafts — leaving the legacy keys
// behind would let restoreDraft()'s one-time migration resurrect a stale draft on
// the next load after the user explicitly deleted their data.
function deleteDraft() {
  [DRAFT_KEY, ...LEGACY_DRAFT_KEYS].forEach(key => {
    try { localStorage.removeItem(key); } catch (e) {}
  });
  try { sessionStorage.removeItem(SCROLL_KEY); } catch (e) {}
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
  if (d.refId) appRefId = d.refId; // adopt the saved reference before any collect()/save mints a new one
  if (migratedFromLegacy) d.plot = null; // old format — not convertible, don't try
  $("#owner-name").value = d.ownerName || "";
  $("#property-address").value = d.propertyAddress || "";
  $("#owner-phone").value = d.ownerPhone || "";
  $("#owner-email").value = d.ownerEmail || "";
  proposal.value = d.proposal || ""; proposalCount.textContent = proposal.value.length;
  $("#ack-date").value = d.ackDate || "";
  // improvements (Section 02 item list). Additive to .v4: older drafts have no `items`,
  // so the always-present starter row stays and only the migrated `proposal` text lands
  // in the notes field above. A picture's filename shows as is-prior (browser can't
  // repopulate a file input — same as photos).
  if (Array.isArray(d.items) && d.items.length) {
    improvementList.innerHTML = ""; improvementCount = 0;
    d.items.forEach(it => {
      const node = addImprovement(it.uid); // reuse the saved uid so its stored picture rehydrates
      const idx = node.dataset.improvement;
      const catSel = $("[data-imp-category]", node);
      if (catSel && it.category && CATEGORY_MAP[it.category]) catSel.value = it.category;
      const actionSel = $("[data-imp-action]", node);
      if (actionSel && it.action) actionSel.value = it.action;
      $(`[name=imp_name_${idx}]`, node).value = it.name || "";
      $(`[name=imp_materials_${idx}]`, node).value = it.materials || "";
      $(`[name=imp_dims_${idx}]`, node).value = it.dimensions || "";
      applyImprovementSchema(node);
      const priorNames = itemPhotoNames(it);
      if (priorNames.length) {
        const st = $(`[data-imp-status="${idx}"]`, node);
        if (st) {
          st.textContent = `Previously attached: ${priorNames.join(", ")} — re-attach to include ${priorNames.length > 1 ? "them" : "it"} again.`;
          st.classList.add("is-prior");
          st.classList.remove("is-attached");
        }
      }
    });
  }
  // (No manual submission checkboxes remain — older drafts' req_sketches/req_fee/derived
  // keys are simply ignored; every packet row is derived from real app state.)
  if (d.acks) Object.entries(d.acks).forEach(([k, v]) => { const el = $(`#acks [name="${k}"]`); if (el) el.checked = v; });
  // (Older drafts' neighbors roster / neighborForm keys restore harmlessly into
  // nothing — the Adjacent Owners section was removed when the journey became
  // print-first; the signature form is a blank page of the printed packet now.)
  // signatures
  if (typedSigInput) typedSigInput.value = d.ownerTypedSignature || "";
  if (d.ownerSigMethod === "type") setSigMethod("type");
  setTimeout(() => {
    if (d.ownerAckSignature) sigPads.ownerAckSignature.fromDataURL(d.ownerAckSignature);
  }, 60);
  // Restore parcel-shaped grid if saved
  if (d.plotMeta && d.plotMeta.parcelCoords) {
    const fakeFeature = { geometry: { coordinates: d.plotMeta.parcelCoords } };
    const bearing = d.plotMeta.bearing || 0;
    const apn = d.plotMeta.apn || null;
    restoreParcelFromDraft(fakeFeature, apn, bearing); // re-adopts it as the wizard's selection too
    rebuildGridForParcel(fakeFeature, bearing, apn);
  }
  if (!migratedFromLegacy && d.plot && d.plot.version >= 3 && d.plot.version <= PLOT_VERSION) {
    restorePlot(d.plot);
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
      // A multi-file shot persists a filename list; a pre-Sprint-12 draft's
      // back_closeup is a single string — both restore as one is-prior line.
      const names = (Array.isArray(name) ? name : [name]).filter(Boolean);
      const statusEl = $(`[data-photo-status="${id}"]`, photoRequestsEl);
      if (statusEl && names.length) {
        statusEl.textContent = `Previously attached: ${names.join(", ")} — re-attach to include ${names.length > 1 ? "them" : "it"} again.`;
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
  // Upgrade is-prior filename notes to live attachments wherever the bytes survive in IDB
  // (async, fire-and-forget — restore stays synchronous and returns true for the caller).
  rehydrateAttachments(d);
  setTimeout(updateProgress, 200);
  status("Draft restored from your last session.", "ok");
  return true;
}

$("#save-draft").addEventListener("click", () => saveDraft(false));
$("#clear-draft").addEventListener("click", async () => {
  if (!confirm("Clear all data and delete the saved draft?")) return;
  await wipeCurrentAttachments(); // clear stored file bytes before the reload cancels the async delete
  deleteDraft();
  location.reload();
});
// Post-submission cleanup — same action, offered in context once the packet has
// been saved (the draft holds PII including the signature image + the attached
// photo bytes; see the #finish-pdf-btn handler).
$("#post-submit-clear")?.addEventListener("click", async () => {
  if (!confirm("Delete the saved application draft (including your signature and attached photos) from this browser?")) return;
  await wipeCurrentAttachments();
  deleteDraft();
  location.reload();
});
// autosave — also called directly from the Konva drawing tools' commit handlers,
// since canvas gestures never fire the native "input" event this was originally
// built around (form.addEventListener("input", ...) alone would silently miss
// every shape drawn/edited/erased on the plot).
let saveTimer;
export function scheduleAutosave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveDraft(true), 1200); }
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

export function setFieldError(el, message) {
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

// Walk every [required] field, painting inline error messages as a side effect,
// and return a list of {label, target} issues (empty = all complete). Advisory
// only — nothing here blocks a path. Called from the review gate purely for the
// painting side effect: the gate lists incomplete workflow STEPS (see reviewThen /
// stepStatus), and painting here means jumping to a step shows its bad fields.
// (Replaced validate()/validateOrFocus, which force-scrolled to the first bad field
// and aborted the whole action — the "it just yanks me around" behavior we removed.)
function fieldIssues() {
  const issues = [];
  $$("#arc-form [required]").forEach(el => {
    clearFieldError(el);
    const { bad, msg } = checkRequired(el);
    if (bad) {
      if (el.type !== "checkbox") setFieldError(el, msg);
      else el.classList.add("invalid");
      issues.push({ label: fieldLabel(el), target: el });
    }
  });
  // Owner signature — drawn ink or a typed full name, whichever method is selected.
  const pad = sigPads.ownerAckSignature;
  if (sigMethod === "type") {
    pad.wrap.classList.remove("invalid");
    clearFieldError(typedSigInput);
    if (!typedSigInput.value.trim()) {
      setFieldError(typedSigInput, "Type your full legal name to sign.");
      issues.push({ label: "Your typed signature", target: typedSigInput });
    }
  } else {
    const empty = pad.isEmpty();
    pad.wrap.classList.toggle("invalid", empty);
    if (empty) issues.push({ label: "Your signature", target: pad.wrap });
  }
  return issues;
}

// Human label for a field — its <label> text (trimmed of markers), falling back
// to aria-label / name. Feeds the review-gate list.
function fieldLabel(el) {
  const sel = el.id ? 'label[for="' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]' : null;
  let lab = sel ? document.querySelector(sel) : null;
  if (!lab && el.closest) lab = el.closest("label");
  let t = lab ? lab.textContent : (el.getAttribute("aria-label") || el.name || "A required field");
  t = t.replace(/\s+/g, " ").replace(/[:*]\s*$/, "").trim();
  return t.length > 80 ? t.slice(0, 79) + "…" : t;
}

// Scroll a review-gate target into view and focus it — user-initiated (clicked in
// the modal), never forced. target is an element or a selector string.
function scrollToIssue(target) {
  const el = typeof target === "string" ? $(target) : target;
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  try { if (el.focus) el.focus({ preventScroll: true }); } catch (_) {}
}

// Run `action`, but first offer an advisory review of anything incomplete. Nothing
// blocks: if any workflow step is incomplete we open the gate (one jump link per step
// + a Continue button that runs `action`); if all clear, `action` runs straight away.
// The gate speaks in workflow STEPS, not packet artifacts (Sprint 20) — but we still
// paint the [required]-field errors first, so jumping to a step highlights its gaps.
function reviewThen(action, continueLabel) {
  fieldIssues(); // paint inline errors on incomplete [required] fields
  const incomplete = stepStatus().filter(s => !s.ok);
  if (!incomplete.length) { action(); return; }
  const rows = incomplete.map(s => ({
    label: `${s.num} · ${s.label}${s.reason ? " — " + s.reason : ""}`,
    target: s.href
  }));
  openGateModal(rows, action, continueLabel);
}

// Clear inline errors on input (the typed signature isn't [required] — its requiredness
// is conditional on the selected signature method — but its error should clear the same way)
form.addEventListener("input", e => {
  if (e.target.matches("[required]") || e.target === typedSigInput) clearFieldError(e.target);
});

/* ------------------------------------------------------
   PRINT
   The stripped-down "Preview first" modal was removed in Sprint 17 — it looked
   nothing like the printed packet. The finish flow now opens the paged.js render
   directly (see printPreview), which is a faithful WYSIWYG of what prints.
------------------------------------------------------ */
// Auto legend beside the drawn plan: a swatch + name for every material actually painted
// (incl. retired and custom ids) and a glyph + name for every stamp symbol placed. Without
// this the reviewer's PDF shows colored regions with no key at all. `cls` is the CSS block
// name — "print-legend" (print doc's inline styles); the preview-modal "plot-legend" caller
// was removed in Sprint 17.
function plotLegendHTML(cls) {
  const { materials, stamps } = plotLegend();
  if (!materials.length && !stamps.length) return "";
  const items = materials.map(m =>
    `<li><span class="${cls}__swatch" style="${esc(materialSwatchStyle(m))}"></span>${esc(m.label)}</li>`
  ).concat(stamps.map(s => `<li>${s.img
    ? `<img src="${esc(s.img)}" alt="" aria-hidden="true" />`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="#1e1a14" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${s.d}"/></svg>`
  }${esc(s.label)}</li>`));
  return `<ul class="${cls}" aria-label="Site plan legend">${items.join("")}</ul>`;
}

/* Section 02 item rows worth printing — anything with a name, materials, dimensions, or an
   attached picture (an empty `photo` array is truthy in JS, so test its length). Feeds the
   Proposed Improvements print page (item blocks with scaled pictures) and the neighbor
   form's change summary. (The old single crammed improvements *table* on the application
   page was replaced by the dedicated page in Sprint 19.) */
const ACTION_LABEL = { add: "Add", replace: "Replace", remove: "Remove" };
function improvementRows(d) {
  return (d.items || []).filter(it => it.name || it.materials || it.dimensions || itemPhotoNames(it).length);
}

/* ----- Adobe Acrobat Sign text tags (Sprint 22, item 7) --------------------------------
   OPTIONAL. Currently ENABLED (2026-07-05, per the user's decision to ship the tags on). When
   ADOBE_SIGN.enabled is on, the printed packet carries literal Adobe Acrobat Sign "text tags" —
   e.g. {{Sig_es_:signer1:signature}} / {{Dte_es_:signer1:date}} / {{N_es_:signer2:fullname}} —
   at the signature spots. Adobe Sign scans an *uploaded* PDF, auto-detects these strings, and
   converts each to a fillable e-signature field; in a plain, un-uploaded PDF they are completely
   inert and render near-invisibly (tiny, near-white via .print-esign-tag) so they never mar the
   printed form. No library — just the documented text-tag syntax embedded as text (Path A).

   Set `enabled:false` to remove the tags entirely (the packet then reverts byte-for-byte to the
   pre-Sprint-22 output) if FSResidential doesn't route received packets through Adobe Acrobat
   Sign — the HOA-usage question is still technically open (see ROADMAP Sprint 22). `neighbors`
   gives each adjacent-owner row its own signer role (signer2, signer3, …) so every neighbor can
   e-sign their own line; set it false for an owner-only e-signing flow. */
const ADOBE_SIGN = { enabled: true, neighbors: true };

// One Adobe Sign text tag as a near-invisible inline span — or "" when tagging is off, so it
// drops out of the markup entirely (the default-OFF packet is byte-for-byte unchanged).
// `directive` is the literal inside the braces, e.g. "Sig_es_:signer1:signature". Call sites
// pass hardcoded strings (no user input), so no escaping is needed.
function esignTag(directive) {
  return ADOBE_SIGN.enabled ? `<span class="print-esign-tag">{{${directive}}}</span>` : "";
}

/* The next `count` upcoming application deadlines, parsed from the DATES constant (the
   2026 review-date table, deadline column) relative to today. The cover used to print the
   whole twelve-month chart down a right rail; now the two nearest turn-in deadlines ride
   inside the submission steps and the full schedule is a link. Each returned entry is a
   {label, tentative} — label reads "July 21, 2026". Falls back to the first `count` rows
   if the year is already past every deadline, so the steps always name two dates. */
const REVIEW_YEAR = 2026;
const MONTH_NAMES = ["January","February","March","April","May","June","July",
  "August","September","October","November","December"];
function nextDeadlines(count) {
  const today = new Date();
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const parsed = DATES.map(([, dl]) => {
    const tentative = /tentative/i.test(dl);
    const [mon, day] = dl.replace(/\s*\(tentative\)/i, "").trim().split(/\s+/);
    return { date: new Date(REVIEW_YEAR, MONTH_NAMES.indexOf(mon), parseInt(day, 10)),
             label: `${mon} ${parseInt(day, 10)}, ${REVIEW_YEAR}`, tentative };
  });
  const upcoming = parsed.filter(p => p.date >= cutoff);
  return (upcoming.length >= count ? upcoming : parsed).slice(0, count);
}

/* Sprint 21 — the incompleteness "cover-cover" page (a warning that prints BEFORE the
   cover). It carries the same stepStatus()-derived "what's still missing" the cover used
   to bury, elevated to a full stop-page: a hazard triangle, the outstanding items, and the
   "attach these to your email" instruction. Returns "" when nothing is missing, so the
   page simply doesn't exist for a completed application — the packet then opens on the
   cover. Driven from the live form state at print time, exactly like the old inline note. */
function buildWarningCoverHTML() {
  const incompleteSteps = stepStatus().filter(s => !s.ok);
  if (!incompleteSteps.length) return ""; // completed properly → no warning page at all
  const items = incompleteSteps.map(s => `<li>
      <span class="print-warncover__num">${esc(s.num)}</span>
      <span class="print-warncover__what"><strong>${esc(s.label)}</strong>${s.reason ? `<span>${esc(s.reason)}</span>` : ""}</span>
    </li>`).join("");
  const n = incompleteSteps.length;
  return `
    <section class="print-page print-warncover">
      <div class="print-warncover__band" aria-hidden="true"></div>
      <div class="print-warncover__body">
        <svg class="print-warncover__icon" viewBox="0 0 120 106" role="img" aria-label="Warning" fill="none" stroke="#a4111f" stroke-linejoin="round" stroke-linecap="round">
          <path d="M60 8 L114 100 H6 Z" stroke-width="6"/>
          <line x1="60" y1="40" x2="60" y2="69" stroke-width="8"/>
          <line x1="60" y1="84" x2="60" y2="84" stroke-width="9"/>
        </svg>
        <div class="print-warncover__eyebrow">Stop — do not submit yet</div>
        <h1 class="print-warncover__title">This application is incomplete</h1>
        <p class="print-warncover__lead">This packet was printed before every section was finished.
          <strong>An incomplete application is returned unreviewed</strong>, and the 45-day review period
          does not begin until everything is received.</p>

        <div class="print-warncover__card">
          <div class="print-warncover__cardhead">Still to finish<span>${n} item${n === 1 ? "" : "s"}</span></div>
          <ul class="print-warncover__list">${items}</ul>
        </div>

        <div class="print-warncover__attach">
          <strong>You must attach any outstanding photos or files to your submission email.</strong>
          Best of all: return to the online form, finish the items above, and re-print — a complete
          packet drops this page automatically.
        </div>
      </div>
      <div class="print-warncover__foot">This page appears only while something is missing. Complete every section and it disappears.</div>
      <div class="print-warncover__band" aria-hidden="true"></div>
    </section>`;
}

/* Page 1 of the printed packet (the cover). Below the masthead, three content blocks are
   spread down the sheet with even whitespace between them (.print-cover-body, a flex column
   with justify-content:space-between): (1) a grouped top card (.print-topgroup) holding the
   Applicant of Record summary + the Owner Certification signature block as one unit, (2) the
   four submission steps, and (3) the adjacent-owner signature strip. A single-line "Questions?"
   contact footer sits below that body at the bottom of the sheet. Everything the applicant
   needs to submit lives in the four-step block (2026-07-11): the destination email + the two
   nearest turn-in deadlines are folded into the email step. The applicant table + owner
   certification were grouped and the three blocks set to even distribution 2026-07-11 at the
   user's request (the record + certification had previously been separated by the steps). Within
   the certification block the "Owner certification" header sits on top, the acknowledgments
   summary under it, then the signature (2/3 width) + date (1/3 width) fields share one baseline.
   The full incompleteness warning prints as its own front page when anything is missing
   (buildWarningCoverHTML).

   Design polish (2026-07-11): the cover is refined line-art letterhead — NO solid ink blocks
   (matching the warning page's approved aesthetic). The masthead is the wordmark alone, closed
   by a thin-gold hairline (.print-header::after). The applicant table is a horizontal-hairline
   record card under a ruled .sec-eyebrow; the four steps are a line-art STEPPER (outlined serif
   numerals via a CSS counter, joined by a hairline gutter connector — .print-steps
   li::before/::after); the "Questions?" footer is a warm hairline callout constrained to one
   line (white-space:nowrap). Per the 2026-07-12 cleanup, the crimson section-divider rules
   (masthead border-bottom, "Submit in four steps" heading rule, the certification tick, and the
   neighbor-strip top rule) were removed — the cover now separates sections by whitespace/hairline
   only, no red horizontal rules. Per the 2026-07-11 declutter request the FC seal and the
   "Review Season ${REVIEW_YEAR}" stamp were removed from the masthead, the "What happens next"
   headnote was dropped, and the running page header (@top-left/@top-right margin boxes) is
   suppressed on the cover only via a named page (.print-cover-page{page:cover} + @page cover{
   @top-*: content none }) since the masthead already stands in for it. All cover CSS is
   cover-scoped in printPreview's inline <style>; note .print-cover__head h4 sets border:0 to
   neutralize the print doc's generic h4 rule. */
function buildInstructionsHTML(d) {
  const uploadPlot = d.planMode === "upload";
  const acksChecked = ACKS.every((_, i) => d.acks["ack_" + (i + 1)]);
  const deadlines = nextDeadlines(2);
  const dlText = x => x ? `${x.label}${x.tentative ? " (tentative)" : ""}` : "";
  const dl1 = esc(dlText(deadlines[0]) || "the next posted deadline");
  const dl2 = esc(dlText(deadlines[1]) || "the following deadline");

  return `
    <section class="print-page print-cover-page">
      <header class="print-header">
        <div class="print-header__word">
          <div class="print-eyebrow">Fairway Canyon Homeowners Association</div>
          <div class="print-title">Architectural Review Committee</div>
          <div class="print-subtitle">Homeowner Application &amp; Submission Cover · Beaumont, California</div>
        </div>
      </header>

      <div class="print-cover-body">
        <div class="print-topgroup">
          <div class="print-record">
            <div class="sec-eyebrow">Applicant of record</div>
            <table class="print-table">
              <tr>
                <td class="print-label">Homeowner(s)</td>
                <td class="print-value">${esc(d.ownerName) || ""}</td>
                <td class="print-label">Property Address</td>
                <td class="print-value">${esc(d.propertyAddress) || ""}</td>
              </tr>
              <tr>
                <td class="print-label">Phone</td>
                <td class="print-value">${esc(d.ownerPhone) || ""}</td>
                <td class="print-label">Email</td>
                <td class="print-value">${esc(d.ownerEmail) || ""}</td>
              </tr>
            </table>
          </div>

          <div class="print-certline" aria-label="Owner certification">
            <p class="print-certline__ack">
              ${acksChecked
                ? "All 8 acknowledgment items have been read and accepted."
                : "⚠ Not all acknowledgment items were checked."}
            </p>
            <div class="print-certline__sign">
              <div class="print-sig-field print-sig-field--sign">
                <div class="print-sig-ink">${
                  d.ownerSigMethod === "type"
                    ? (d.ownerTypedSignature ? `<span class="print-sig-typed">${esc(d.ownerTypedSignature)}</span>` : "")
                    : (d.ownerAckSignature ? `<img src="${d.ownerAckSignature}" style="height:36px;" alt="Homeowner signature" />` : "")
                }${esignTag("Sig_es_:signer1:signature")}</div>
                <div class="print-sig-line"></div>
                <div class="print-sig-label">Homeowner(s) Signature${d.ownerSigMethod === "type" ? " (signed electronically by typing name)" : ""}</div>
              </div>
              <div class="print-sig-field print-sig-field--date">
                <div class="print-sig-ink">${esc(d.ackDate)}${esignTag("Dte_es_:signer1:date")}</div>
                <div class="print-sig-line"></div>
                <div class="print-sig-label">Date</div>
              </div>
            </div>
          </div>
        </div>

        <div class="print-cover">
          <div class="print-cover__head">
            <h4>Submit in four steps</h4>
          </div>
          <ol class="print-steps">
            <li><strong>Save or print this packet.</strong> Everything you entered (proposed improvements, plot plan, property photos, and your signature) is already inside it.</li>
            <li><strong>Collect adjacent-owner signatures</strong> on the form at the bottom of this cover, in person, then scan or photograph the signed cover. A signature confirms notification, not approval.</li>
            <li><strong>Email everything to <span class="print-email">carolmarie.taylor@fsresidential.com</span>.</strong> Send this packet and the signed cover${uploadPlot ? ", plus your plot-plan file," : ""} so it arrives by a posted deadline. The next two are <span class="dl">${dl1}</span> and <span class="dl">${dl2}</span>. Meeting a deadline puts you on that month&rsquo;s board agenda.</li>
            <li><strong>Wait for our reply. No payment is due now.</strong> The committee requests the review fee only after confirming your application is complete.</li>
          </ol>
        </div>

        ${buildNeighborStripHTML(d)}
      </div>

      <p class="print-cover__questions"><strong>Questions?</strong> CarolMarie Taylor, Sr. Architectural Specialist · 951-801-4246 · Tue to Sat, 9:00&nbsp;AM to 4:30&nbsp;PM, by appointment</p>
    </section>`;
}

// A print <img> sized by its encoded pixel dims via aspect-ratio, so paged.js can measure
// the page deterministically without waiting for the (large) data: URI to decode.
function printImg(entry, cls, alt) {
  return `<img class="${cls}" src="${entry.dataUrl}" style="aspect-ratio:${entry.w}/${entry.h}" alt="${esc(alt || "Attached application image")}" />`;
}

/* ----- Proposed Improvements page: one block per item (~4 per page), each with its
   fields and a row of its scaled, uncropped example/catalog pictures (item 2 + 3). ----- */
function buildImprovementsPageHTML(d, imgs) {
  const rows = improvementRows(d);
  if (!rows.length) return "";
  const blocks = rows.map(it => {
    const remove = it.action === "remove";
    const cat = CATEGORY_MAP[it.category];
    const noDims = !!cat && !cat.dims; // paint: no dimensions field at all
    const pics = imgs.filter(e => e.kind === "imp" && e.ownerId === it.uid);
    const picNames = itemPhotoNames(it); // includes non-image (PDF) attachments too
    const fields = [
      remove ? "" : `<tr><td>Materials / details</td><td>${esc(it.materials) || "—"}</td></tr>`,
      (remove || noDims) ? "" : `<tr><td>Dimensions</td><td>${esc(it.dimensions) || "—"}</td></tr>`
    ].join("");
    const picsHTML = pics.length
      ? `<div class="print-imp-imgs">${pics.map(e => printImg(e, "print-imp-img", `Example or catalog image for ${it.name || "proposed improvement"}${e.name ? `: ${e.name}` : ""}`)).join("")}</div>`
      : picNames.length
        ? `<p class="print-imp-noimg">Example / catalog file attached separately: ${picNames.map(esc).join(", ")}.</p>`
        : `<p class="print-imp-noimg">${remove ? "No picture (optional for a removal)." : "⚠ No example / catalog picture attached."}</p>`;
    return `<div class="print-imp-block">
      <div class="print-imp-head">
        <span class="print-imp-action print-imp-action--${esc(it.action)}">${esc(ACTION_LABEL[it.action] || it.action || "—")}</span>
        <span class="print-imp-name">${esc(it.name) || "Unnamed item"}</span>
        <span class="print-imp-type">${esc(categoryLabelShort(it.category))}</span>
      </div>
      ${fields ? `<table class="print-imp-fields">${fields}</table>` : ""}
      ${picsHTML}
    </div>`;
  }).join("");
  const notes = d.proposal
    ? `<p class="print-ack-summary"><strong>Additional notes:</strong> ${esc(d.proposal)}</p>` : "";
  return `<section class="print-page">
      <h3 class="print-pagetitle">Proposed Improvements</h3>
      ${blocks}
      ${notes}
    </section>`;
}

/* ----- Site / Plot Plan page: the drawn (or uploaded) plan on its own page, larger
   than the old half-column, with the auto legend beneath a drawn plan. ----- */
function buildPlotPageHTML(d, imgs) {
  const plot = imgs.find(e => e.kind === "plot");
  const upload = d.planMode === "upload";
  const uploadNote = d.plotUpload && d.plotUpload.length ? d.plotUpload.map(esc).join(", ") : "";
  if (!plot && !uploadNote) return ""; // nothing drawn or uploaded — skip an empty page
  const body = plot
    ? `<figure class="print-plot-figure">${printImg(plot, "print-plot-large", `Site or plot plan for ${d.propertyAddress || "the application property"}`)}</figure>${upload ? "" : plotLegendHTML("print-legend")}`
    : `<p class="print-info">Plot plan uploaded as a separate file: <strong>${uploadNote}</strong>. Include ${d.plotUpload.length > 1 ? "these files" : "this file"} when you email your packet.</p>`;
  return `<section class="print-page">
      <h3 class="print-pagetitle">Site / Plot Plan</h3>
      ${body}
    </section>`;
}

/* ----- Property Photos page(s): grouped by area into labeled bands, and — crucially —
   each photo is a self-describing "plate" that binds its context (area chip + the specific
   shot + what the shot should show + filename) to the image itself. Every plate is
   break-inside:avoid, so no matter where paged.js drops a page break, a photo is never
   stranded on a page away from the information that explains it. Flows across as many
   pages as needed. ----- */
function buildPhotosPageHTML(d, imgs) {
  const photos = imgs.filter(e => e.kind === "photo");
  if (!photos.length) return "";
  // Group by area, preserving first-seen (questionnaire) order: front → back → side →
  // exterior → work-area close-ups → material sample.
  const order = [];
  const groups = new Map();
  photos.forEach(e => {
    const area = e.area || "Photos";
    if (!groups.has(area)) { groups.set(area, []); order.push(area); }
    groups.get(area).push(e);
  });
  const sections = order.map(area => {
    const list = groups.get(area);
    const plates = list.map(e => {
      const req = e.instr
        ? `<p class="print-plate__req"><span class="print-plate__reqlabel">Should show</span>${esc(e.instr)}</p>` : "";
      return `<figure class="print-plate">
        <div class="print-plate__frame">${printImg(e, "print-plate__img", `${e.area || "Property photo"} — ${e.shotTitle || e.caption || "attached photo"}${e.name ? `: ${e.name}` : ""}`)}</div>
        <figcaption class="print-plate__cap">
          <div class="print-plate__caphead">
            <span class="print-plate__area">${esc(e.area || "Photo")}</span>
            <span class="print-plate__shot">${esc(e.shotTitle || e.caption || "Photo")}</span>
          </div>
          ${req}
          ${e.name ? `<span class="print-plate__file">${esc(e.name)}</span>` : ""}
        </figcaption>
      </figure>`;
    }).join("");
    return `<div class="print-photogroup">
        <h4 class="print-photogroup__band"><span class="print-photogroup__name">${esc(area)}</span><span class="print-photogroup__count">${list.length} photo${list.length > 1 ? "s" : ""}</span></h4>
        ${plates}
      </div>`;
  }).join("");
  return `<section class="print-page print-photos-page">
      <h3 class="print-pagetitle">Property Photos</h3>
      <p class="print-photos-intro">Each photo is labeled with the area it documents and what it should show, so it can be reviewed on its own — no need to cross-reference the request list.</p>
      ${sections}
    </section>`;
}

/* The printed packet: an incompleteness warning page FIRST (Sprint 21 — printed only when
   something's missing, else absent), then the cover (which now leads with the applicant +
   acknowledgments + owner-signature summary, folds in the submission steps, and pins the
   adjacent-owner signatures to its bottom — the standalone application page was merged into
   it 2026-07-05), then a dedicated page per heavy section (improvements, site/plot, photos —
   each with real scaled images). `imgs` is the pre-compressed image set gathered
   asynchronously by printPreview (preparePrintImages). */
function buildPrintHTML(d, imgs) {
  imgs = imgs || [];
  return `
    <div class="print-doc">
      ${buildWarningCoverHTML()}
      ${buildInstructionsHTML(d)}
      ${buildImprovementsPageHTML(d, imgs)}
      ${buildPlotPageHTML(d, imgs)}
      ${buildPhotosPageHTML(d, imgs)}
    </div>`;
}

// The preview modal is gone (Sprint 17); this handles Escape for the gate modal only —
// the builder tutorial modal (map-wizard.js) has its own Escape listener.
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (!gateModal.hidden) closeGateModal();
});

// No submit button remains, but Enter in a text field can still fire a form submit —
// swallow it so the page can't reload. The finish action is the #finish-pdf-btn handler.
form.addEventListener("submit", e => e.preventDefault());

// Escape a value for use as a CSS string literal (paged.js margin-box `content`).
// `<` is hex-escaped (\3c) so a field containing "</style>" can't break out of the
// inline <style> this is written into via document.write (self-XSS hardening).
function cssStr(s) {
  return '"' + String(s == null ? "" : s)
    .replace(/\\/g, "\\\\").replace(/"/g, '\\"')
    .replace(/</g, "\\3c ").replace(/[\r\n\t]+/g, " ") + '"';
}

/* ----- PRINT-IMAGE COMPRESSION (Sprint 19, best-effort under Path A) -----
   The print packet now embeds real photos + the plot, which would balloon the saved PDF.
   Before writing the popup we downscale + JPEG-re-encode every image toward a per-image
   byte budget (allocated by image-budget.js) so the whole packet stays emailable. The
   browser's own "Save as PDF" still does the final encode, so this is a lever, not a hard
   cap — we note the achieved total in the status line. */
const PRINT_IMAGE_BUDGET = 24 * 1024 * 1024; // 24 MB of images (headroom under a ~25 MB email cap)
let lastPrintImageBytes = 0; // achieved compressed total of the most recent packet build

// A PNG/JPEG data: URI (e.g. the rendered plot) back to a Blob, so it flows through the
// same decode → re-encode path as the file attachments.
function dataURLToBlob(dataUrl) {
  const comma = dataUrl.indexOf(",");
  const mime = (dataUrl.slice(0, comma).match(/data:([^;]+)/) || [])[1] || "image/png";
  const bin = atob(dataUrl.slice(comma + 1));
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: mime });
}

// Decode a Blob to something drawable, preferring createImageBitmap (fast, off-DOM) with an
// <img> fallback. Returns {src, w, h, done()} — call done() to release the bitmap/object URL.
async function decodeForCanvas(blob) {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(blob);
      return { src: bmp, w: bmp.width, h: bmp.height, done: () => { try { bmp.close && bmp.close(); } catch (_) {} } };
    } catch (_) { /* fall through to <img> */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error("image decode failed"));
      im.src = url;
    });
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
  } catch (e) { URL.revokeObjectURL(url); throw e; }
}

// Walk the shared quality/size ladder, re-encoding to JPEG until the result fits the byte
// target (or the ladder bottoms out — best-effort). Returns {dataUrl, bytes, w, h}.
async function encodeToBudget(blob, targetBytes) {
  const dec = await decodeForCanvas(blob);
  const sw = dec.w, sh = dec.h;
  let best = null;
  try {
    for (const step of ENCODE_LADDER) {
      const scale = Math.min(1, step.maxDim / Math.max(sw, sh || 1));
      const w = Math.max(1, Math.round(sw * scale));
      const h = Math.max(1, Math.round(sh * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); // flatten alpha — JPEG has none
      ctx.drawImage(dec.src, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", step.quality);
      best = { dataUrl, bytes: dataUrlByteLength(dataUrl), w, h };
      if (best.bytes <= targetBytes) break;
    }
  } finally { dec.done(); }
  return best;
}

// Gather every embeddable image in the packet (requested photos in questionnaire order,
// each improvement's example pictures, and the plot — drawn→rendered PNG or uploaded
// image), allocate the byte budget across them, and compress each. Returns an array of
// entries {key, kind, ownerId, caption, name, dataUrl, w, h, bytes} for the page builders;
// non-image attachments (a PDF) are skipped here and stay named-only in the instructions.
async function preparePrintImages(d) {
  const sources = [];
  photoChecklist().forEach(r => {
    const input = $(`[data-photo-input="${r.id}"]`, photoRequestsEl);
    const info = PHOTO_INFO[r.id] || { area: "", shot: r.title, instr: "" };
    Array.from((input && input.files) || []).forEach((f, i) => {
      if (f.type && f.type.startsWith("image/")) sources.push({ key: `photo:${r.id}:${i}`, kind: "photo", ownerId: r.id, caption: r.title, area: info.area, shotTitle: info.shot, instr: info.instr, name: f.name, blob: f });
    });
  });
  $$(".improvement", improvementList).forEach(node => {
    const uid = node.dataset.impUid;
    const input = $("input[data-imp-photo]", node);
    Array.from((input && input.files) || []).forEach((f, i) => {
      if (f.type && f.type.startsWith("image/")) sources.push({ key: `imp:${uid}:${i}`, kind: "imp", ownerId: uid, name: f.name, blob: f });
    });
  });
  if (d.planMode === "upload") {
    const f = plotUploadInput.files && plotUploadInput.files[0];
    if (f && f.type && f.type.startsWith("image/")) sources.push({ key: "plot", kind: "plot", name: f.name, blob: f });
  } else if (plotUsed()) {
    const url = renderPlotImage();
    if (url) sources.push({ key: "plot", kind: "plot", blob: dataURLToBlob(url) });
  }
  lastPrintImageBytes = 0;
  if (!sources.length) return [];
  const targets = allocateImageBudget(sources.map(s => s.blob.size), PRINT_IMAGE_BUDGET);
  const out = [];
  for (let i = 0; i < sources.length; i++) {
    try {
      const enc = await encodeToBudget(sources[i].blob, targets[i]);
      if (enc) { out.push({ ...sources[i], dataUrl: enc.dataUrl, w: enc.w, h: enc.h, bytes: enc.bytes }); lastPrintImageBytes += enc.bytes; }
    } catch (_) { /* skip an image that won't decode */ }
  }
  return out;
}

/* ----- SHARED: open the print/save-PDF window -----
   Paged.js (vendored, same-origin) fragments the packet into real letter pages with
   visible margins in the popup itself — so what you see is what prints — and renders the
   @page margin boxes as running headers/footers (reference id + applicant + page numbers).
   If paged.js can't load, the doc still prints via native @page margins (no running head). */
async function printPreview() {
  const d = collect();
  // The finish flow treats "opened the print/save view" as Step 1 done —
  // we can't observe whether the user actually saved the PDF from here.
  pdfSaved = true;
  refreshPacketUI();
  // Open the window synchronously (inside the click gesture) so the popup blocker allows it,
  // then show a placeholder while we gather + compress the packet's images (async — photos
  // and the plot can be tens of MB raw). Only after that do we write the real paginated doc
  // into the same window.
  const w = window.open("", "_blank");
  if (!w) { window.print(); return; }
  w.document.write('<!DOCTYPE html><meta charset="utf-8"><title>Preparing your packet…</title>'
    + '<body style="font:15px \'Segoe UI\',Arial,sans-serif;color:#4a453e;margin:0;padding:48px 40px">'
    + '<p>Preparing your application packet — scaling and compressing images so it stays emailable…</p></body>');
  w.document.close();

  let imgs = [];
  try { imgs = await preparePrintImages(d); } catch (_) { imgs = []; }
  if (w.closed) return; // the user closed the placeholder while we worked

  const html = buildPrintHTML(d, imgs);
  // Running-header content: reference id + applicant name/address/phone/email, plus page counters.
  const applicant = [d.ownerName, d.propertyAddress, d.ownerPhone, d.ownerEmail].filter(Boolean).join("  ·  ");
  const refCss = cssStr("Ref " + (d.refId || ""));
  const applicantCss = cssStr(applicant);
  // Absolute URL so the about:blank popup (no base URL of its own) can resolve the vendored file.
  const pagedSrc = new URL("assets/vendor/paged.polyfill.0.4.3.js", location.href).href;
  w.document.open();
  w.document.write(`<!DOCTYPE html><html lang="en"><head><title>Fairway Canyon HOA — ARC Application</title>
    <meta charset="utf-8">
    <style>
      @page {
        size: letter;
        margin: 18mm 16mm 16mm;
        /* Running header/footer, rendered by paged.js into the page margin boxes. */
        @top-left { content: ${applicantCss}; font: 8pt 'Segoe UI', Arial, sans-serif; color: #5b5650; vertical-align: bottom; padding-bottom: 3mm; }
        @top-right { content: ${refCss}; font: 700 8pt 'Segoe UI', Arial, sans-serif; color: #a4111f; letter-spacing: .03em; vertical-align: bottom; padding-bottom: 3mm; }
        @bottom-left { content: "Fairway Canyon HOA — Architectural Review Committee Application"; font: 8pt 'Segoe UI', Arial, sans-serif; color: #68625b; vertical-align: top; padding-top: 2.5mm; }
        @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt 'Segoe UI', Arial, sans-serif; color: #5b5650; vertical-align: top; padding-top: 2.5mm; }
      }
      /* Suppress the running header on the cover page only (its own masthead stands in);
         the bottom footer + page counters stay. The cover is assigned this named page via
         .print-cover-page{ page: cover } — paged.js supports named pages + per-page margin boxes. */
      @page cover {
        @top-left { content: none; }
        @top-right { content: none; }
      }
      * { box-sizing: border-box; }
      body { font-family: 'Segoe UI', -apple-system, Arial, sans-serif; color: #1d1a17; line-height: 1.42; font-size: 11pt; margin: 0; }
      .print-doc { max-width: 100%; }
      /* One section per sheet. paged.js honors break-after: page (native @page fallback uses it too). */
      .print-page { break-after: page; }
      .print-page:last-child { break-after: auto; }
      /* paged.js preview chrome: a soft gray desk behind the white sheets, so the popup
         reads as paginated paper (with its margins visible) rather than flush-to-edge flow.
         !important because paged.js injects its own page stylesheet after this one. */
      .pagedjs_pages { background: #6b6b6b !important; padding: 4mm 0 !important; }
      .pagedjs_page { background: #fff !important; margin: 6mm auto !important; box-shadow: 0 3px 18px rgba(0,0,0,.32) !important; }
      @media print { .pagedjs_pages { background: #fff !important; padding: 0 !important; } .pagedjs_page { margin: 0 !important; box-shadow: none !important; } }
      /* NOTE: the Save/Print/Close toolbar is injected and FULLY INLINE-STYLED from the
         parent window (see attachPrintBar), deliberately with no rules here. paged.js
         disables the author stylesheet in its on-screen preview and re-applies @media print
         rules to it — so styling the bar here did nothing, and an @media print{display:none}
         rule got extracted and hid the bar in the very preview it belongs in (the first two
         attempts' "no bar" bug). Inline styles can't be disabled/extracted; the bar is hidden
         from real printouts via beforeprint/afterprint in JS instead of @media print. */
      /* Belt-and-suspenders for the "@page cover" running-header suppression: also blank the
         generated top-left/top-right margin boxes on cover pages by class, in case the named-
         page margin-box cascade doesn't fully override. Scoped to .pagedjs_cover_page so only
         the cover loses its header; the bottom footer + page counters are untouched. */
      .pagedjs_cover_page .pagedjs_margin-top-left,
      .pagedjs_cover_page .pagedjs_margin-top-right { visibility: hidden !important; }
      /* --- Sprint 21 warning "cover-cover" page (printed ONLY when something is missing;
         buildWarningCoverHTML returns "" for a complete application, so it simply vanishes) --- */
      .print-warncover { display: flex; flex-direction: column; min-height: 8.8in; }
      /* Caution hatch, NOT a solid stripe fill — thin maroon diagonals on white (far less ink). */
      .print-warncover__band { flex: none; height: 16px; background: repeating-linear-gradient(-45deg, #a4111f 0 2.5px, transparent 2.5px 11px); border-top: 1px solid #e6c9c6; border-bottom: 1px solid #e6c9c6; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .print-warncover__body { flex: 1 1 auto; display: flex; flex-direction: column; align-items: center; text-align: center; padding: 40px 9% 26px; }
      .print-warncover__icon { width: 118px; height: auto; }
      .print-warncover__eyebrow { margin-top: 22px; font-size: 9pt; font-weight: 700; letter-spacing: .3em; text-transform: uppercase; color: #a4111f; }
      .print-warncover__title { font-family: Georgia, serif; font-size: 25pt; font-weight: 700; color: #1d1a17; margin: 5px 0 0; line-height: 1.04; }
      .print-warncover__lead { font-size: 11pt; line-height: 1.5; max-width: 31em; color: #3a352f; margin: 13px 0 22px; }
      .print-warncover__lead strong { color: #7d0d18; }
      .print-warncover__card { width: 100%; max-width: 33em; text-align: left; border: 1.5px solid #e6c9c6; border-radius: 6px; overflow: hidden; }
      .print-warncover__cardhead { display: flex; justify-content: space-between; align-items: baseline; color: #a4111f; font-size: 9.5pt; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; padding: 7px 13px 6px; border-bottom: 1.5px solid #e6c9c6; }
      .print-warncover__cardhead span { font-size: 9pt; font-weight: 600; letter-spacing: .04em; color: #5b5650; text-transform: none; }
      .print-warncover__list { list-style: none; margin: 0; padding: 2px 0; }
      .print-warncover__list li { display: flex; gap: 11px; align-items: baseline; padding: 7px 13px; border-top: 1px solid #f2e5e3; }
      .print-warncover__list li:first-child { border-top: none; }
      .print-warncover__num { flex: none; font-family: Georgia, serif; font-size: 11pt; font-weight: 700; color: #a4111f; width: 20px; }
      .print-warncover__what { font-size: 10pt; color: #1d1a17; line-height: 1.35; }
      .print-warncover__what strong { display: block; }
      .print-warncover__what span { display: block; color: #5b5650; font-size: 9.5pt; }
      .print-warncover__attach { width: 100%; max-width: 33em; text-align: left; margin-top: 18px; font-size: 10.5pt; line-height: 1.5; color: #3a352f; border: 1px solid #e6c9c6; border-left: 4px solid #a4111f; border-radius: 0 4px 4px 0; padding: 11px 15px; }
      .print-warncover__attach strong { color: #7d0d18; }
      .print-warncover__foot { flex: none; text-align: center; font-size: 9pt; color: #5b5650; padding: 0 9% 18px; }
      /* --- cover (page 1): concise submission instructions, full-width single column --- */
      /* The sheet is a flex column: masthead at the top, a single-line Questions footer at the
         bottom, and .print-cover-body filling the middle. min-height stays under the ~9.66in
         content box so the whole cover keeps to one page. */
      .print-cover-page { display: flex; flex-direction: column; min-height: 9.2in; page: cover; }
      /* The three content blocks (grouped record+certification, the steps, the signature strip)
         are spread down the page with even whitespace between them (space-between; the gap is a
         floor so a full page still breathes). ONE-PAGE BUDGET (measured 2026-07-12): the packed
         natural height of this cover is ~9.23in, which clears the ~9.66in printable content box
         (letter minus the 18/16/16mm @page margins) by ~0.4in. The block paddings/margins here,
         the four-step gaps, and the .nf-table row height (.38in) were tuned to hold that budget —
         the neighbor strip's 6 rows are the dominant term. Re-inflating any of them (or restoring
         the .46in rows) pushes the cover onto a second page, so re-measure if you loosen spacing. */
      .print-cover-body { flex: 1 1 auto; display: flex; flex-direction: column; justify-content: space-between; gap: 13px; }
      /* Grouped top card: Applicant of Record + Owner Certification read as one unit, the
         certification's own top hairline serving as the internal divider between them. */
      .print-topgroup { border: 1px solid #e6ddd4; border-radius: 6px; padding: 10px 14px; }
      /* Zero the strip's own top margin inside the evenly-distributed body so the space-between
         gap above it matches the gap above the steps (its crimson top rule + padding stay). */
      .print-cover-body .print-neighbors { margin-top: 0; }
      .print-cover { margin-top: 0; }
      .print-cover__head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding-bottom: 2px; margin-bottom: 6px; }
      .print-cover__head h4 { font-family: Georgia, serif; font-size: 14pt; font-weight: 600; color: #7d0d18; margin: 0; border: 0; padding: 0; }
      /* Line-art stepper: outlined serif numerals joined by a hairline gutter. */
      .print-steps { list-style: none; counter-reset: step; margin: 0; padding: 0; }
      .print-steps li { counter-increment: step; position: relative; padding-left: 33px; margin-bottom: 7px; font-size: 10pt; line-height: 1.42; color: #2a2620; }
      .print-steps li:last-child { margin-bottom: 0; }
      .print-steps li::before { content: counter(step); position: absolute; left: 0; top: -1px; width: 22px; height: 22px; border-radius: 50%; border: 1.5px solid #a4111f; background: #fff; color: #a4111f; font-family: Georgia, serif; font-weight: 700; font-size: 11pt; display: flex; align-items: center; justify-content: center; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .print-steps li:not(:last-child)::after { content: ""; position: absolute; left: 10.5px; top: 23px; bottom: -7px; width: 1px; background: #e6ceca; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .print-steps strong { color: #1d1a17; }
      .print-steps .dl { font-weight: 700; color: #a4111f; white-space: nowrap; }
      .print-email { font-weight: 700; color: #7d0d18; border-bottom: 1.5px solid #d9b8b5; padding-bottom: .5px; overflow-wrap: anywhere; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      /* Single-line contact footer, pinned to the bottom of the cover (after the signature strip). */
      .print-cover__questions { margin: 9px 0 0; padding: 7px 12px; font-size: 8pt; color: #45413c; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: #faf8f4; border: 1px solid #ecdfd6; border-left: 3px solid #a4111f; border-radius: 0 4px 4px 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .print-cover__questions strong { color: #7d0d18; letter-spacing: .01em; }
      .print-info { font-size: 10pt; margin: 4px 0 7px; }
      /* Masthead: the wordmark, closed by a thin gold rule. */
      .print-header { display: flex; align-items: center; gap: 15px; position: relative; padding-bottom: 9px; margin-bottom: 8px; }
      .print-header::after { content: ""; position: absolute; left: 0; right: 0; bottom: -4.5px; height: 1px; background: #b08433; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .print-header__word { flex: 1 1 auto; }
      .print-eyebrow { font-size: 8pt; letter-spacing: .2em; text-transform: uppercase; color: #a4111f; font-weight: 700; }
      .print-title { font-family: Georgia, 'Times New Roman', serif; font-size: 21pt; font-weight: 600; line-height: 1.02; color: #1d1a17; margin: 3px 0 1px; letter-spacing: -.005em; }
      .print-subtitle { font-size: 9.5pt; color: #5b5650; }
      h4 { font-size: 11pt; color: #7d0d18; border-bottom: 1.5px solid #a4111f; padding-bottom: 2px; margin: 10px 0 4px; }
      /* Applicant record: a small ruled eyebrow + a clean horizontal-hairline record card. */
      .print-record { margin-bottom: 3px; }
      .sec-eyebrow { font-size: 8pt; letter-spacing: .16em; text-transform: uppercase; font-weight: 700; color: #a4111f; display: flex; align-items: center; gap: 7px; margin: 0 0 4px; }
      .sec-eyebrow::after { content: ""; flex: 1 1 auto; height: 1px; background: #ecdfd6; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .print-table { width: 100%; border-collapse: collapse; font-size: 10pt; border-top: 1px solid #d5d0c9; border-bottom: 1px solid #d5d0c9; }
      .print-table td { padding: 5px 8px; vertical-align: baseline; border-bottom: 1px solid #efe9e1; }
      .print-table tr:last-child td { border-bottom: none; }
      .print-label { font-size: 7.5pt; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: #8a8278; width: 96px; white-space: nowrap; }
      .print-value { font-weight: 500; color: #1d1a17; }
      .print-legend { list-style: none; display: flex; flex-wrap: wrap; gap: 3px 13px; margin: 5px 0 0; padding: 0; font-size: 9pt; }
      .print-legend li { display: flex; align-items: center; gap: 4px; }
      .print-legend__swatch { display: inline-block; width: 10px; height: 10px; border: 1px solid #777; border-radius: 2px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .print-legend svg, .print-legend img { flex: none; width: 12px; height: 12px; }
      .print-ack-summary { font-size: 9.5pt; margin: 4px 0 7px; }
      /* Owner certification: acknowledgment summary, then the
         signature (2/3) + date (1/3) fields on one shared baseline. */
      .print-certline { display: block; margin-top: 9px; padding-top: 8px; position: relative; }
      .print-certline__ack { margin: 0 0 9px; font-size: 9.5pt; color: #45413c; line-height: 1.42; }
      .print-certline__sign { display: flex; align-items: flex-end; gap: 24px; }
      .print-certline__sign .print-sig-field--sign { flex: 2 1 0; }
      .print-certline__sign .print-sig-field--date { flex: 1 1 0; white-space: nowrap; }
      .print-sig-ink { min-height: 30px; display: flex; align-items: flex-end; }
      .print-sig-line { border-bottom: 1px solid #333; margin-top: 2px; }
      .print-sig-typed { font-family: Georgia, "Times New Roman", serif; font-style: italic; font-size: 14pt; }
      .print-sig-label { font-size: 8pt; color: #514c46; margin-top: 3px; letter-spacing: .02em; }
      /* Adobe Acrobat Sign text tags (Sprint 22): inert in a plain PDF; Adobe Sign converts
         them to fillable fields on upload. Tiny near-white text so they don't mar the printed
         signature spots. print-color-adjust:exact keeps the near-white from being darkened. */
      .print-esign-tag { font-size: 5px; line-height: 1; color: #efece7; letter-spacing: 0; white-space: nowrap; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .print-footer-note { font-size: 9pt; color: #5b5650; margin-top: 12px; border-top: 1px solid #ddd; padding-top: 4px; }
      /* --- dedicated section pages (Sprint 19): improvements, site/plot, photos --- */
      .print-pagetitle { font-family: Georgia, serif; font-size: 16pt; font-weight: 600; color: #7d0d18; border-bottom: 3px solid #a4111f; padding-bottom: 5px; margin: 0 0 12px; }
      /* Proposed Improvements — one block per item, kept whole across a page break. */
      .print-imp-block { break-inside: avoid; border: 1px solid #e2ddd6; border-radius: 4px; padding: 9px 11px; margin-bottom: 11px; }
      .print-imp-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-bottom: 6px; }
      .print-imp-action { font-size: 8.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #fff; background: #a4111f; border-radius: 3px; padding: 1px 6px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .print-imp-action--remove { background: #5b5650; }
      .print-imp-name { font-size: 12pt; font-weight: 600; }
      .print-imp-type { font-size: 9pt; color: #5b5650; margin-left: auto; }
      .print-imp-fields { border-collapse: collapse; font-size: 10pt; margin-bottom: 8px; }
      .print-imp-fields td { padding: 1px 10px 1px 0; vertical-align: top; }
      .print-imp-fields td:first-child { color: #5b5650; white-space: nowrap; }
      .print-imp-imgs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
      .print-imp-img { width: 100%; height: 2.35in; object-fit: contain; border: 1px solid #bdb7b0; background: #f7f5f2; }
      .print-imp-noimg { font-size: 9.5pt; color: #5b5650; font-style: italic; margin: 2px 0 0; }
      /* Site / Plot Plan — the plan on its own page, larger than the old half-column. */
      .print-plot-figure { margin: 0 0 6px; }
      .print-plot-large { display: block; width: 100%; max-height: 8in; object-fit: contain; border: 1px solid #ccc; }
      /* Property Photos — grouped by area, each photo a self-describing "plate" whose
         context (area + shot + requirement + filename) is BOUND to the image so a page
         break can never strand a photo from the information that explains it. */
      .print-photos-intro { font-size: 10pt; color: #514c46; font-style: italic; margin: -6px 0 12px; }
      .print-photogroup { margin-bottom: 6px; }
      /* Area band: a serif divider that leads each area's plates. break-after: avoid keeps
         it from orphaning at a page bottom, away from its first photo. */
      .print-photogroup__band { display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
        font-family: Georgia, serif; font-size: 11pt; font-weight: 600; color: #7d0d18;
        text-transform: uppercase; letter-spacing: .09em; border-bottom: 1.5px solid #d9b8b5;
        padding: 0 0 3px; margin: 15px 0 10px; break-after: avoid; }
      .print-photogroup__band::before { content: ""; }
      .print-photogroup__name { position: relative; padding-left: 13px; }
      .print-photogroup__name::before { content: ""; position: absolute; left: 0; top: 50%; transform: translateY(-50%);
        width: 7px; height: 7px; background: #a4111f; border-radius: 1px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .print-photogroup__count { font-family: 'Segoe UI', Arial, sans-serif; font-size: 9pt; font-weight: 600;
        text-transform: none; letter-spacing: .02em; color: #5b5650; }
      /* The plate: photo + its bound caption block, kept whole across a page break. */
      .print-plate { break-inside: avoid; border: 1px solid #e2ddd6; border-radius: 5px; overflow: hidden;
        background: #fff; margin: 0 0 12px; }
      .print-plate__frame { background: #f2efea; padding: 6px; }
      .print-plate__img { display: block; width: 100%; max-height: 6.5in; object-fit: contain; }
      .print-plate__cap { border-top: 1px solid #e2ddd6; padding: 7px 11px 9px; }
      .print-plate__caphead { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
      .print-plate__area { font-size: 8.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: .07em;
        color: #fff; background: #a4111f; border-radius: 3px; padding: 1.5px 6px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .print-plate__shot { font-size: 11pt; font-weight: 600; color: #1d1a17; }
      .print-plate__req { font-size: 10pt; line-height: 1.4; color: #514c46; margin: 5px 0 0; }
      .print-plate__reqlabel { font-weight: 700; text-transform: uppercase; letter-spacing: .05em; font-size: 8.5pt;
        color: #a4111f; margin-right: 6px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .print-plate__file { display: inline-block; font-family: 'Consolas', 'SFMono-Regular', ui-monospace, monospace;
        font-size: 9pt; color: #5b5650; margin-top: 6px; }
      /* --- adjacent-owner signature strip, folded onto the cover bottom (Sprint 21) --- */
      .print-neighbors { margin-top: 14px; padding-top: 8px; break-inside: avoid; }
      .print-neighbors__head { display: flex; justify-content: space-between; align-items: baseline; }
      .print-neighbors__hint { font-size: 9pt; color: #5b5650; font-style: italic; }
      .print-neighbors__change { font-size: 10pt; margin: 4px 0 2px; color: #1d1a17; }
      .print-neighbors__lbl { display: inline-block; font-size: 8.5pt; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #a4111f; margin-right: 6px; }
      .nf-section { font-family: Georgia, serif; font-size: 12pt; color: #7d0d18; font-weight: 700; }
      .nf-note { font-size: 9.5pt; line-height: 1.35; color: #514c46; margin: 3px 0 5px; }
      .nf-note strong { color: #3a352f; }
      .nf-table { width: 100%; border-collapse: collapse; margin-top: 2px; }
      .nf-table th { font-size: 8pt; text-transform: uppercase; letter-spacing: .06em; color: #7d0d18; background: #faf8f4; text-align: left; padding: 4px 7px; border: 1px solid #cdbfae; font-weight: 700; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .nf-table td { border: 1px solid #cdbfae; padding: 0 7px; height: .38in; vertical-align: bottom; }
      .nf-num { width: 22px; text-align: center; color: #8a8278; }
      .nf-sig { width: 30%; }
      .nf-date { width: 82px; }
    </style></head><body>
    ${html}
    <script src="${pagedSrc}"><\/script>
    </body></html>`);
  w.document.close();
  w.focus();

  // Attach the screen-only toolbar from HERE, the PARENT window — NOT from inside the popup.
  // Two earlier in-popup attempts failed outright (bar missing completely): paged.js
  // paginates whatever is in the popup <body> at load, and driving the injection off its
  // own hooks proved unreliable. The popup is same-origin (about:blank we wrote), so instead
  // we poll it from here and append the bar once paged.js has produced .pagedjs_pages — or
  // after a short cap if paged.js never loads (the native @page flow is still drivable). The
  // buttons drive the popup's own print()/close(). paged.js (.polyfill build) auto-runs
  // without a PagedConfig, so the running-header @page margin boxes are unaffected.
  let barTries = 0;
  const attachPrintBar = () => {
    if (w.closed) return;
    let doc;
    try { doc = w.document; } catch (_) { return; } // cross-origin guard (shouldn't happen for about:blank)
    if (doc && doc.querySelector(".print-bar")) return; // already attached
    const ready = doc && doc.body && (doc.querySelector(".pagedjs_pages") || barTries >= 20);
    if (!ready) { barTries++; setTimeout(attachPrintBar, 160); return; } // wait for pagination, ~3.2s cap
    // Everything INLINE-styled on purpose: paged.js disables the author stylesheet in its
    // preview, so class rules render nothing; inline styles survive.
    const bar = doc.createElement("div");
    bar.className = "print-bar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Packet actions");
    bar.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483000;display:flex;align-items:center;gap:16px;min-height:58px;padding:8px 18px;box-sizing:border-box;background:#1d1a17;color:#f4f1ec;box-shadow:0 2px 12px rgba(0,0,0,.35);font-family:'Segoe UI',Arial,sans-serif;";
    const label = doc.createElement("div");
    label.innerHTML = '<div style="font-weight:600;font-size:13px">Your application packet</div>'
      + '<div style="font-size:11.5px;color:#b9b3aa;margin-top:1px">For a PDF, choose “Save as PDF” as the destination in the print dialog.</div>';
    bar.appendChild(label);
    const spacer = doc.createElement("div"); spacer.style.flex = "1 1 auto"; bar.appendChild(spacer);
    const btnBase = "font:600 13px 'Segoe UI',Arial,sans-serif;cursor:pointer;border:1px solid #4a453e;background:#2c2822;color:#f4f1ec;padding:8px 15px;border-radius:6px;";
    const doPrint = () => { try { w.focus(); w.print(); } catch (_) {} };
    const addBtn = (text, variant, onClick) => {
      const b = doc.createElement("button");
      b.type = "button"; b.textContent = text;
      b.style.cssText = btnBase + (variant === "primary" ? "background:#a4111f;border-color:#a4111f;"
        : variant === "ghost" ? "background:transparent;" : "");
      b.addEventListener("click", onClick);
      bar.appendChild(b);
    };
    addBtn("Print", "", doPrint);
    addBtn("Save as PDF", "primary", doPrint);
    addBtn("Close", "ghost", () => w.close());
    doc.body.appendChild(bar);
    doc.body.style.paddingTop = "58px"; // clear the fixed bar in the preview
    // Hide the bar (and its spacer padding) from ACTUAL printouts. We can't use @media print
    // — paged.js re-applies print rules to its on-screen preview, which would hide it there
    // too — so toggle inline around the print event instead.
    const setHidden = h => { bar.style.display = h ? "none" : "flex"; doc.body.style.paddingTop = h ? "0" : "58px"; };
    try { w.addEventListener("beforeprint", () => setHidden(true)); w.addEventListener("afterprint", () => setHidden(false)); } catch (_) {}
    try {
      const mq = w.matchMedia("print"); const onMq = e => setHidden(e.matches);
      mq.addEventListener ? mq.addEventListener("change", onMq) : mq.addListener(onMq);
    } catch (_) {}
  };
  setTimeout(attachPrintBar, 150);
  // Confirm ready, noting the achieved compressed image total when there is one (best-effort
  // under Path A — the browser's "Save as PDF" still does the final encode, so this is the
  // input size, not the PDF's).
  status(lastPrintImageBytes
    ? `Packet ready — embedded images ≈ ${formatBytes(lastPrintImageBytes)} after compression. Choose “Save as PDF” in the print dialog.`
    : "Packet ready — choose “Save as PDF” in the print dialog. Page 1 explains how to submit it.", "ok");
}

// The one finish action — advisory review (never blocks), then open the print/save-PDF
// view. printPreview is async (it compresses images first), but the window it opens is
// created synchronously inside this gesture, so the popup blocker allows it; the status
// message below shows immediately, and printPreview updates it with the achieved size once
// compression finishes. The journey ends here: page 1 of the printed packet carries the
// submission instructions, so the form has nothing left to do.
$("#finish-pdf-btn")?.addEventListener("click", () => {
  reviewThen(() => {
    saveDraft(true);
    printPreview();
    status("Preparing your packet — compressing images, then the print view opens. Page 1 explains how to submit it.", "ok");
    // The draft (PII incl. the signature image) has served its purpose once the
    // packet is saved — surface the delete offer here, in context. Not automatic:
    // we can't observe the save, and the user may need the draft to revise.
    const cleanup = $("#post-submit-cleanup");
    if (cleanup) cleanup.hidden = false;
  }, "Save the packet anyway");
});

/* ----- ADJACENT-OWNER SIGNATURE STRIP (folded onto the cover, Sprint 21) -----
   Wet signatures, collected in person after printing — the standalone last-page form
   was retired and this compact block now pins to the bottom of the cover. Blank rows;
   neighbors fill in their own details. The note points to the packet's reference id
   (printed in the running header) rather than restating the proposed change inline. */
function buildNeighborStripHTML(d) {
  let rows = "";
  for (let i = 0; i < 6; i++) {
    // Each adjacent-owner row is its own Adobe Sign participant (signer2, signer3, …) so every
    // neighbor e-signs their own line. Untagged in an owner-only flow (ADOBE_SIGN.neighbors=false)
    // or when tagging is off entirely (esignTag returns "").
    const signer = "signer" + (i + 2);
    const nt = ADOBE_SIGN.neighbors ? esignTag : () => "";
    rows += `<tr>
      <td class="nf-num">${i + 1}</td>
      <td>${nt(`N_es_:${signer}:fullname`)}</td>
      <td>${nt(`Addr_es_:${signer}`)}</td>
      <td class="nf-sig">${nt(`Sig_es_:${signer}:signature`)}</td>
      <td class="nf-date">${nt(`Dte_es_:${signer}:date`)}</td>
    </tr>`;
  }
  return `
    <div class="print-neighbors">
      <div class="print-neighbors__head">
        <div class="nf-section">Adjacent Owner Signatures</div>
        <span class="print-neighbors__hint">Collect in person, then scan the signed cover</span>
      </div>
      <p class="nf-note">By signing, each adjacent owner confirms they were <strong>notified</strong> of the changes in packet <strong>${esc(d.refId || "")}</strong>. A signature is <strong>not approval or disapproval</strong>.</p>
      <table class="nf-table">
        <thead><tr><th class="nf-num">#</th><th>Adjacent Owner Name</th><th>Property Address</th><th>Signature</th><th>Date</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/* ----- advisory review gate: list what's incomplete, but never block ----- */
const gateModal = $("#packet-gate-modal");
const gateMissingEl = $("#gate-missing");
const gateContinueBtn = $("#gate-continue");
let pendingGateAction = null;

// Show the review list. Each item with a target renders as a jump link that scrolls
// there (user-initiated) and closes the modal; the Continue button runs onContinue.
// Non-blocking by design — "Keep editing" or Continue, never a wall.
function openGateModal(issues, onContinue, continueLabel) {
  gateMissingEl.textContent = "";
  issues.forEach(iss => {
    const li = document.createElement("li");
    if (iss.target) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "gate-jump";
      btn.innerHTML = esc(iss.label) + " <span aria-hidden=\"true\">›</span>";
      btn.addEventListener("click", () => { closeGateModal(); scrollToIssue(iss.target); });
      li.appendChild(btn);
    } else {
      li.textContent = iss.label;
    }
    gateMissingEl.appendChild(li);
  });
  pendingGateAction = typeof onContinue === "function" ? onContinue : null;
  gateContinueBtn.textContent = continueLabel || "Continue anyway";
  gateModal.hidden = false;
  document.body.style.overflow = "hidden";
}
function closeGateModal() {
  gateModal.hidden = true;
  document.body.style.overflow = "";
}
$$("[data-close]", gateModal).forEach(el => el.addEventListener("click", closeGateModal));
gateContinueBtn.addEventListener("click", () => {
  const act = pendingGateAction;
  pendingGateAction = null;
  closeGateModal();
  if (act) act();
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
  // The signature pads were constructed while the layout was display:none (0×0 rect), so
  // their canvas backing stores are still unsized — size them now that they're visible.
  // Timeout 0 keeps this ahead of restoreDraft()'s 60ms fromDataURL, so restored ink lands
  // on a properly sized canvas.
  setTimeout(() => Object.values(sigPads).forEach(p => p.resize(true)), 0);
}
function showLanding() {
  if (!landingEl || !layoutEl) return;
  layoutEl.hidden = true;
  landingEl.hidden = false;
  window.scrollTo({ top: 0, behavior: "auto" });
}

$("#start-application")?.addEventListener("click", enterForm);
$("#view-landing")?.addEventListener("click", e => { e.preventDefault(); showLanding(); });
// "What Happens Next" links to the review-dates table, which lives on the landing page.
$("#view-dates")?.addEventListener("click", e => { e.preventDefault(); showLanding(); });

// Remember scroll position within the form so a reload can return you to where you
// were, instead of always landing back at the top. sessionStorage (not localStorage)
// because this is reload-continuity, not a durable preference — it should reset once
// the tab closes, same lifetime as "still on this visit".
let scrollSaveTimer;
window.addEventListener("scroll", () => {
  if (layoutEl.hidden) return; // landing page has no position worth remembering
  clearTimeout(scrollSaveTimer);
  scrollSaveTimer = setTimeout(() => {
    try { sessionStorage.setItem(SCROLL_KEY, String(window.scrollY)); } catch (e) {}
  }, 200);
}, { passive: true });

/* ------------------------------------------------------
   INIT
------------------------------------------------------ */
// Dev/test escape hatch: `?reset` (or `#reset`) purges the saved draft before restore,
// so a page load starts clean. A hard refresh only clears the HTTP cache, never
// localStorage, so this is the reliable way to shed leftover test entries between runs.
// The param is stripped from the URL afterward so an ordinary reload doesn't keep wiping.
// (map-wizard.js checks the same param independently to also clear the tutorial seen-flag.)
if (new URLSearchParams(location.search).has("reset") || location.hash === "#reset") {
  deleteDraft();
  // No refId adopted yet at this point, so purge the whole attachment store (fire-and-forget).
  if (idbAvailable()) clearAllAttachments().catch(() => {});
  try { history.replaceState(null, "", location.pathname); } catch (e) {}
}

// Returning users with a saved draft skip the landing and go straight to the form.
const hadDraft = restoreDraft();
if (hadDraft) {
  enterForm();
  // enterForm() itself jumps to top; restore the remembered position after the
  // async map resize / signature-pad resize / photo-group reveal above have run.
  let savedScroll;
  try { savedScroll = sessionStorage.getItem(SCROLL_KEY); } catch (e) {}
  if (savedScroll !== null && savedScroll !== undefined) {
    setTimeout(() => window.scrollTo({ top: parseInt(savedScroll, 10) || 0, behavior: "auto" }), 250);
  }
}
// Default the acknowledgment date to today (local time) unless the draft carried one.
const ackDateEl = $("#ack-date");
if (ackDateEl && !ackDateEl.value) {
  const now = new Date();
  ackDateEl.value = now.getFullYear() + "-" +
    String(now.getMonth() + 1).padStart(2, "0") + "-" +
    String(now.getDate()).padStart(2, "0");
}
updateProgress();
