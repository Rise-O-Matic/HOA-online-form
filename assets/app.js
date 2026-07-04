/* =========================================================
   Fairway Canyon HOA — ARC Application (front-end mockup)
   Entry module: form content (acks, dates, neighbors,
   photos), packet status, validation, persistence
   (localStorage drafts), the preview/print/email/JSON
   output paths, landing + init.
   Siblings: geometry.js (pure math, unit-tested),
   plot-editor.js (Konva drawing surface), map-wizard.js
   (parcel select/orient flow), utils.js ($, $$, esc).
   No backend; no build step — the browser loads these ES
   modules directly.
   ========================================================= */
import { $, $$, esc } from "./utils.js";
import {
  plotUsed, isPlotConfirmed, renderPlotImage, rebuildGridForParcel,
  serializePlot, restorePlot, plotLegend
} from "./plot-editor.js";
import {
  planMode, setPlanMode, plotUploadInput, restoreParcelFromDraft,
  parcelBearing, selectedAPN, selectedParcelGeoJSON, mapInstance
} from "./map-wizard.js";
import { registerDropzone, DROPZONE_ICON } from "./dropzone.js";

const DRAFT_KEY = "fairwayCanyonArcDraft.v4";        // fixed-scale grid painter + Konva annotations
const PLOT_VERSION = 4;                              // kept in lockstep with DRAFT_KEY's suffix; drafts written before the reconcile carry plot.version 3 in the identical format, so restore accepts >= 3
const LEGACY_DRAFT_KEYS = ["fairwayCanyonArcDraft.v3", "fairwayCanyonArcDraft.v2"]; // pre-grid-painter formats — read once for a one-time non-destructive migration (all non-plot fields carry over; the drawing itself is left to be redrawn)
const SCROLL_KEY = "fairwayCanyonArcDraft.scroll"; // sessionStorage — per-tab only, so a stale position never haunts a fresh visit later

/* ------------------------------------------------------
   DATA: acknowledgments, palette, review dates
------------------------------------------------------ */
const ACKS = [
  'Compliance with the <a href="https://www.fsresidential.com/california/communities/fairway-canyon/" target="_blank" rel="noopener">Guidelines</a>, <a href="https://www.fsresidential.com/california/communities/fairway-canyon/" target="_blank" rel="noopener">Protective Covenants</a> and ARC approval does <strong>not</strong> necessarily constitute compliance with building and zoning codes of <a href="https://www.rivcocob.org/building-and-safety/" target="_blank" rel="noopener">Riverside County</a>. A building permit may still be required.',
  "No exterior alteration shall commence until <strong>written ARC approval</strong> has been returned to the homeowner. Unapproved or out-of-scope work may require restoration to the former condition at the homeowner's expense, plus legal costs.",
  'I am responsible to provide all required details on attached sheets (plot, sketches, scale drawings, photos, illustrations, plans, contracts, etc.), with the location of the change indicated on a color-coded plot. <span class="muted">(The packet checklist in Review &amp; Submit tracks these attachments for you.)</span>',
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
registerDropzone(neighborFormInput.closest(".dropzone"), neighborFormInput);

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
          <span class="dropzone__text"><strong data-imp-photo-label>Attach example / catalog picture</strong> — drag &amp; drop, paste, or <span class="dropzone__browse">browse</span></span>
          <input type="file" id="imp_photo_${idx}" name="imp_photo_${idx}" data-imp-photo="${idx}" accept="image/*,application/pdf" class="dropzone__input" />
        </label>
        <span class="improvement__status" data-imp-status="${idx}">No picture attached yet.</span>
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
      ? "Attach a photo of what's being removed (optional)"
      : "Attach example / catalog picture";
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

function addImprovement() {
  improvementCount++;
  const wrap = document.createElement("div");
  wrap.innerHTML = improvementTemplate(improvementCount).trim();
  const node = wrap.firstChild;
  improvementList.appendChild(node);
  $(".improvement__remove", node).addEventListener("click", () => {
    node.remove();
    // Keep at least one item so "name required per item" always demands one named change.
    if (!$$(".improvement", improvementList).length) addImprovement();
    renumberImprovements();
    updateProgress();
  });
  $("[data-imp-category]", node).addEventListener("change", () => applyImprovementSchema(node));
  $("[data-imp-action]", node).addEventListener("change", () => {
    applyImprovementSchema(node);
    updateImprovementStatus(node.dataset.improvement);
  });
  const photoInput = $(`[data-imp-photo="${improvementCount}"]`, node);
  photoInput.addEventListener("change", () => updateImprovementStatus(node.dataset.improvement));
  registerDropzone(photoInput.closest(".dropzone"), photoInput);
  applyImprovementSchema(node);
  renumberImprovements();
  return node;
}
$("#add-improvement").addEventListener("click", () => addImprovement());
// start with one improvement block
addImprovement();

function updateImprovementStatus(idx) {
  const node = $(`.improvement[data-improvement="${idx}"]`, improvementList);
  if (!node) return;
  const input = $(`[data-imp-photo="${idx}"]`, node);
  const statusEl = $(`[data-imp-status="${idx}"]`, node);
  if (!input || !statusEl) return;
  const removing = ($("[data-imp-action]", node)?.value) === "remove";
  statusEl.classList.remove("is-prior");
  if (input.files && input.files.length) {
    const f = input.files[0];
    statusEl.textContent = `Attached: ${f.name} (${Math.round(f.size / 1024)} KB)`;
    statusEl.classList.add("is-attached");
    node.classList.add("is-attached");
  } else {
    statusEl.textContent = removing ? "Optional — no picture attached." : "No picture attached yet.";
    statusEl.classList.remove("is-attached");
    node.classList.remove("is-attached");
  }
}

// Single DOM->data source for the item list. `photo` is the real attached filename
// or "" — a restored draft can't repopulate a file input (same browser limit as
// photos), so an un-reattached picture is dropped on the next save by design.
function improvementItems() {
  return $$(".improvement", improvementList).map(node => {
    const idx = node.dataset.improvement;
    const input = $(`[data-imp-photo="${idx}"]`, node);
    return {
      category: $("[data-imp-category]", node)?.value || DEFAULT_CATEGORY,
      action: $("[data-imp-action]", node)?.value || "add",
      name: $("[data-imp-name]", node)?.value.trim() || "",
      materials: $("[data-imp-materials]", node)?.value.trim() || "",
      dimensions: $("[data-imp-dims]", node)?.value.trim() || "",
      photo: (input && input.files && input.files.length) ? input.files[0].name : ""
    };
  });
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

function buildPhotoRequests() {
  photoRequestsEl.innerHTML = "";
  Object.entries(PHOTO_SPECS).forEach(([area, spec]) => {
    photoRequestsEl.appendChild(photoGroup(area, spec.label + " photos", spec.shots));
  });
  photoRequestsEl.appendChild(photoGroup("closeup", "Work-area close-ups", [PHOTO_CLOSEUP]));
  photoRequestsEl.appendChild(photoGroup("material", "Color / material sample", [PHOTO_MATERIAL]));
  $$("[data-photo-input]", photoRequestsEl).forEach(input => {
    input.addEventListener("change", () => updatePhotoStatus(input.dataset.photoInput));
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
      updatePhotoStatus(id);
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
      updatePhotoStatus(id);
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

// One thumbnail card per attached file on a multi-file shot, each with its own
// Remove (handled by the delegated [data-photo-remove-one] listener).
function multiThumbCard(id, f, i, url) {
  return `
    <figure class="photo-thumb photo-thumb--multi">
      <div class="photo-thumb__frame">
        <img class="photo-thumb__img is-fresh" src="${url}" alt="Your attached photo" />
        <span class="photo-thumb__badge" aria-hidden="true">&#10003;</span>
      </div>
      <figcaption class="photo-thumb__meta">
        <span class="photo-thumb__label">Attached</span>
        <span class="photo-thumb__name">${esc(f.name)}</span>
        <span class="photo-thumb__size">${formatBytes(f.size)}</span>
        <span class="photo-thumb__actions">
          <button type="button" class="photo-thumb__btn photo-thumb__btn--remove" data-photo-remove-one="${id}" data-file-index="${i}">Remove</button>
        </span>
      </figcaption>
    </figure>`;
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
  // Packet items count too — 100% must not be reachable with an empty packet.
  // Four items: the plot plan, the requested photos (questionnaire answered AND
  // every requested shot attached), the signed neighbor form, and the example
  // pictures for every Add/Replace improvement item.
  total += 4;
  if (plotProvided().ok) done++;
  const reqPhotos = photoChecklist();
  if (reqPhotos.length > 0 && reqPhotos.every(p => p.file)) done++;
  if (neighborFormFiles().length > 0) done++;
  // Lenient: a Remove-only (or empty) item list needs no catalog pictures, so [].every() -> done;
  // the always-required item name still keeps the denominator honest for an empty packet.
  if (improvementChecklist().every(r => r.file)) done++;
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
   plan, every requested photo, the improvement pictures, and
   the signed neighbor form — all derived from real app state
   (the old manual sketches/fee checkboxes are gone). Feeds
   the Review & Submit packet list, the email soft-gate, and
   the mailto attachment manifest.
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
    .map(it => ({ name: it.name, action: it.action, file: it.photo || null }));
}

function neighborFormFiles() {
  return neighborFormInput.files ? Array.from(neighborFormInput.files).map(f => f.name) : [];
}

// Human-readable list of what's still missing, for the soft-gate modal and
// the mailto manifest. includePdf: whether the not-yet-saved form PDF counts
// (the gate cares; the email body lists the PDF in the attach checklist anyway).
function packetMissingList(includePdf) {
  const missing = [];
  if (includePdf && !pdfSaved) missing.push("The application form PDF — save it in Step 1 first");
  const plot = plotProvided();
  if (!plot.ok) missing.push(plot.mode === "upload"
    ? "Plot plan file (upload chosen, but nothing attached in Section 03)"
    : plot.started
      ? "Plot plan — drawn but not marked finished (press “Done — use this plan” in Section 03)"
      : "Plot plan (nothing drawn yet in Section 03)");
  const photos = photoChecklist();
  if (!photos.length) missing.push("Property photos — the questionnaire in Section 04 hasn't been answered");
  else photos.filter(p => !p.file).forEach(p => missing.push("Photo — " + p.title));
  improvementChecklist().filter(it => !it.file).forEach(it =>
    missing.push("Example/catalog picture — " + it.name + " (Section 02)"));
  if (!neighborFormFiles().length) missing.push("Signed neighbor signature form (Section 07, Step 2)");
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
        : plot.started
          ? "In progress — mark it finished in Section 03 (“Done — use this plan”)."
          : "Nothing drawn yet.",
      href: "#siteplan"
    });
  }
  // Example / catalog pictures for each Add/Replace improvement item (Section 02).
  // Remove-only lists need none, so the row only appears when pictures are expected.
  const impReq = improvementChecklist();
  if (impReq.length) {
    const impAttached = impReq.filter(r => r.file).length;
    items.push({
      label: `Example / catalog pictures — ${impAttached} of ${impReq.length} attached`,
      ok: impAttached === impReq.length,
      note: "One picture per Add/Replace item — attach each to your email.",
      href: "#description",
      subs: impReq.map(r => ({ label: r.name, ok: !!r.file, note: r.file }))
    });
  }
  if (!photos.length) {
    items.push({
      label: "Property photos",
      ok: false,
      note: "Answer the questionnaire in Section 04 to see which photos are needed.",
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
      : "Print the form in Step 2 below, collect signatures, then attach the scan.",
    href: "#finish-step-2"
  });
  packetListEl.textContent = "";
  items.forEach(item => packetListEl.appendChild(packetItemNode(item)));
}

function refreshFinishSteps() {
  const s1 = $("#finish-step-1");
  if (s1) s1.classList.toggle("is-done", pdfSaved);
}

// The Draw step's "Done — use this plan" CTA + the wizard's Draw dot reflect the
// declared-completion state (see plot-editor's isPlotConfirmed). Runs from every
// updateProgress(), so a paint stroke / Clear / Done click all repaint it.
function refreshPlotDoneUI() {
  const btn = $("#plot-done");
  if (btn) {
    const confirmed = isPlotConfirmed();
    btn.disabled = !plotUsed();
    btn.classList.toggle("is-confirmed", confirmed);
    btn.textContent = confirmed ? "✓ Plan added to your packet" : "Done — use this plan";
  }
  const drawDot = $('.plot-steps-nav__dot[data-goto="4"]');
  if (drawDot) drawDot.classList.toggle("is-done", isPlotConfirmed());
}

export function refreshPacketUI() {
  renderPacket();
  refreshFinishSteps();
  refreshPlotDoneUI();
}

/* ------------------------------------------------------
   COLLECT DATA
------------------------------------------------------ */
function collect() {
  const plotData = serializePlot();
  const data = {
    ownerName: $("#owner-name").value.trim(),
    propertyAddress: $("#property-address").value.trim(),
    ownerPhone: $("#owner-phone").value.trim(),
    ownerEmail: $("#owner-email").value.trim(),
    submissions: {},
    items: improvementItems(),
    proposal: proposal.value.trim(),
    neighbors: [],
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
    files: [],
    neighborForm: neighborFormInput.files ? Array.from(neighborFormInput.files).map(f => f.name) : []
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
const saveWarningEl = $("#save-warning");
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
      const node = addImprovement();
      const idx = node.dataset.improvement;
      const catSel = $("[data-imp-category]", node);
      if (catSel && it.category && CATEGORY_MAP[it.category]) catSel.value = it.category;
      const actionSel = $("[data-imp-action]", node);
      if (actionSel && it.action) actionSel.value = it.action;
      $(`[name=imp_name_${idx}]`, node).value = it.name || "";
      $(`[name=imp_materials_${idx}]`, node).value = it.materials || "";
      $(`[name=imp_dims_${idx}]`, node).value = it.dimensions || "";
      applyImprovementSchema(node);
      if (it.photo) {
        const st = $(`[data-imp-status="${idx}"]`, node);
        if (st) {
          st.textContent = `Previously attached: ${it.photo} — re-attach to include it again.`;
          st.classList.add("is-prior");
          st.classList.remove("is-attached");
        }
      }
    });
  }
  // (No manual submission checkboxes remain — older drafts' req_sketches/req_fee/derived
  // keys are simply ignored; every packet row is derived from real app state.)
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
  setTimeout(updateProgress, 200);
  status("Draft restored from your last session.", "ok");
  return true;
}

$("#save-draft").addEventListener("click", () => saveDraft(false));
$("#clear-draft").addEventListener("click", () => {
  if (!confirm("Clear all fields and delete the saved draft?")) return;
  deleteDraft();
  location.reload();
});
// Post-submission cleanup — same action, offered in context once the email step has
// run (the draft holds PII including the signature image; see finishEmail()).
$("#post-submit-clear")?.addEventListener("click", () => {
  if (!confirm("Delete the saved application draft (including your signature) from this browser?")) return;
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
  // Owner signature — drawn ink or a typed full name, whichever method is selected.
  const pad = sigPads.ownerAckSignature;
  if (sigMethod === "type") {
    pad.wrap.classList.remove("invalid");
    clearFieldError(typedSigInput);
    if (!typedSigInput.value.trim()) {
      setFieldError(typedSigInput, "Type your full legal name to sign.");
      if (!firstBad) firstBad = typedSigInput;
    }
  } else {
    const empty = pad.isEmpty();
    pad.wrap.classList.toggle("invalid", empty);
    if (empty && !firstBad) firstBad = pad.wrap;
  }
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

// Clear inline errors on input (the typed signature isn't [required] — its requiredness
// is conditional on the selected signature method — but its error should clear the same way)
form.addEventListener("input", e => {
  if (e.target.matches("[required]") || e.target === typedSigInput) clearFieldError(e.target);
});

/* ------------------------------------------------------
   PREVIEW + PRINT
------------------------------------------------------ */
const modal = $("#preview-modal");
const previewContent = $("#preview-content");

const yn = b => b ? '<span class="yes">✓ Included</span>' : '<span class="no">— not checked</span>';
const sigImg = url => url ? `<img class="sig-img" src="${url}" alt="signature" />` : '<span class="no">— not signed</span>';
// Owner signature per the selected method: drawn ink image, or the typed name set in a script face.
const ownerSigHTML = d => d.ownerSigMethod === "type"
  ? (d.ownerTypedSignature
      ? `<span class="sig-typed-preview">${esc(d.ownerTypedSignature)}</span> <span class="no">(typed signature)</span>`
      : '<span class="no">— not signed</span>')
  : sigImg(d.ownerAckSignature);

const SUB_LABELS = {
  req_plot: "Plot design with modification marked",
  req_photos: "Property photos (Section 04)",
  req_neighbors: "Impacted neighbor signatures"
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
    ? `<ul class="doc-list">${attached.map(([id, name]) => `<li>${esc(photoTitle(id))} — <span class="yes">✓ ${esc(Array.isArray(name) ? name.join(", ") : name)}</span></li>`).join("")}</ul>`
    : (areas.length ? '<p class="no">No photos attached yet.</p>' : "");
  return areaLine + list;
}

// Auto legend beside the drawn plan: a swatch + name for every material actually painted
// (incl. retired and custom ids) and a glyph + name for every stamp symbol placed. Without
// this the reviewer's PDF shows colored regions with no key at all. `cls` is the CSS block
// name — "plot-legend" (preview modal, styles.css) or "print-legend" (print doc's inline styles).
function plotLegendHTML(cls) {
  const { materials, stamps } = plotLegend();
  if (!materials.length && !stamps.length) return "";
  const items = materials.map(m =>
    `<li><span class="${cls}__swatch" style="background:${esc(m.color)}"></span>${esc(m.label)}</li>`
  ).concat(stamps.map(s => `<li>${s.img
    ? `<img src="${esc(s.img)}" alt="" aria-hidden="true" />`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="#1e1a14" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${s.d}"/></svg>`
  }${esc(s.label)}</li>`));
  return `<ul class="${cls}" aria-label="Site plan legend">${items.join("")}</ul>`;
}

/* ----- Proposed-improvements table (shared by preview + print) -----
   Renders the Section 02 item list as a structured table — action / type / item /
   materials-or-details / dimensions / picture filename — so the committee's "Must
   Include: Materials, Dimensions, and Example Pictures" list is visibly satisfied
   instead of buried in a prose blob. Per category, Remove shows n/a for materials
   and paint shows n/a for dimensions (it has no dimensions field). */
const ACTION_LABEL = { add: "Add", replace: "Replace", remove: "Remove" };
function improvementRows(d) {
  return (d.items || []).filter(it => it.name || it.materials || it.dimensions || it.photo);
}
function improvementsTableHTML(d, opts) {
  const rows = improvementRows(d);
  const cls = opts.cls;
  const no = txt => `<span class="no">${txt}</span>`;
  const notes = d.proposal
    ? `<p class="${opts.noteCls}"><strong>Additional notes:</strong> ${esc(d.proposal)}</p>`
    : "";
  if (!rows.length) return `<p class="no">No improvement items listed.</p>` + notes;
  const body = rows.map(it => {
    const remove = it.action === "remove";
    const cat = CATEGORY_MAP[it.category];
    const noDims = !!cat && !cat.dims; // paint: no dimensions field at all
    return `<tr>
      <td>${esc(ACTION_LABEL[it.action] || it.action || "—")}</td>
      <td>${esc(categoryLabelShort(it.category)) || no("—")}</td>
      <td>${esc(it.name) || no("—")}</td>
      <td>${remove ? no("n/a") : (esc(it.materials) || no("—"))}</td>
      <td>${noDims ? no("n/a") : (esc(it.dimensions) || no("—"))}</td>
      <td>${it.photo ? esc(it.photo) : (remove ? no("—") : no("not attached"))}</td>
    </tr>`;
  }).join("");
  return `<table class="${cls}">
      <thead><tr><th>Action</th><th>Type</th><th>Item</th><th>Materials / details</th><th>Dimensions</th><th>Example picture</th></tr></thead>
      <tbody>${body}</tbody>
    </table>` + notes;
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
        : (plotUsed() ? `<img class="plot-img" src="${renderPlotImage()}" alt="Site plan" />${plotLegendHTML("plot-legend")}` : '<p class="no">No site plan drawn.</p>')}

      <h3>Photos</h3>
      ${photoPreviewHTML(d)}

      <h3>Proposed Improvements</h3>
      ${improvementsTableHTML(d, { cls: "doc-table improvements-table", noteCls: "doc-note" })}

      <h3>Adjacent Property Owners</h3>
      ${neighbors}
      <p style="margin-top:.6rem"><strong>Signed signature form:</strong> ${neighborForm}</p>

      <h3>Owner Acknowledgments</h3>
      <ul class="doc-list">${acks}</ul>
      <dl style="margin-top:.6rem">
        <dt>Owner Signature</dt><dd>${ownerSigHTML(d)}</dd>
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
  const photoCount = Object.values(d.photos || {}).reduce((n, v) => n + (Array.isArray(v) ? v.length : 1), 0);
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
        </div>
        <div class="print-col">
          <h4>Site / Plot Plan</h4>
          ${d.planMode === "upload"
            ? `<p style="font-size:11px;">${d.plotUpload && d.plotUpload.length ? "Plot plan uploaded separately: " + d.plotUpload.map(esc).join(", ") : "⚠ No plot plan attached."}</p>`
            : (plotUsed() ? `<img class="print-plot" src="${renderPlotImage()}" />${plotLegendHTML("print-legend")}` : '<p style="color:#999;font-size:11px;">No site plan drawn.</p>')}
        </div>
      </div>

      <!-- Proposed improvements -->
      <h4>Proposed Improvements</h4>
      ${improvementsTableHTML(d, { cls: "print-table print-improvements", noteCls: "print-ack-summary" })}

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
            <div class="print-sig-ink">${
              d.ownerSigMethod === "type"
                ? (d.ownerTypedSignature ? `<span class="print-sig-typed">${esc(d.ownerTypedSignature)}</span>` : "")
                : (d.ownerAckSignature ? `<img src="${d.ownerAckSignature}" style="height:36px;" />` : "")
            }</div>
            <div class="print-sig-line"></div>
            <div class="print-sig-label">Homeowner(s) Signature${d.ownerSigMethod === "type" ? " — signed electronically by typing name" : ""}</div>
          </div>
          <div class="print-sig-field print-sig-field--narrow">
            <div class="print-sig-ink">${esc(d.ackDate)}</div>
            <div class="print-sig-line"></div>
            <div class="print-sig-label">Date</div>
          </div>
        </div>
      </div>

      <p class="print-footer-note">This application was generated from the Fairway Canyon HOA online form. The 45-day review period begins once the complete application packet is received.</p>
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
      .print-improvements { width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 4px; }
      .print-improvements th { font-size: 9px; text-transform: uppercase; letter-spacing: .05em; color: #a4111f; background: #faf8f4; text-align: left; padding: 2px 5px; border: 1px solid #ddd; }
      .print-improvements td { padding: 2px 5px; border: 1px solid #ddd; vertical-align: top; }
      .print-plot { width: 100%; border: 1px solid #ccc; }
      .print-legend { list-style: none; display: flex; flex-wrap: wrap; gap: 2px 12px; margin: 4px 0 0; padding: 0; font-size: 9px; }
      .print-legend li { display: flex; align-items: center; gap: 4px; }
      .print-legend__swatch { display: inline-block; width: 10px; height: 10px; border: 1px solid #999; border-radius: 2px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .print-legend svg, .print-legend img { flex: none; width: 12px; height: 12px; }
      .print-neighbors th { font-size: 9px; text-transform: uppercase; letter-spacing: .05em; color: #a4111f; background: #faf8f4; text-align: left; }
      .print-ack-summary { font-size: 10px; margin: 2px 0 6px; }
      .print-sig-block { margin-top: 10px; }
      .print-sig-row { display: flex; gap: 20px; }
      .print-sig-field { flex: 1; }
      .print-sig-field--narrow { flex: 0 0 160px; }
      .print-sig-ink { min-height: 28px; display: flex; align-items: flex-end; }
      .print-sig-line { border-bottom: 1px solid #333; margin-top: 2px; }
      .print-sig-typed { font-family: Georgia, "Times New Roman", serif; font-style: italic; font-size: 16px; }
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
  improvementChecklist().filter(it => it.file).forEach(it =>
    attach.push("Example/catalog picture \u2014 " + it.name + ": " + it.file));
  photos.filter(p => p.file).forEach(p => attach.push("Photo \u2014 " + p.title + ": " + p.file));
  if (nf.length) attach.push("Signed neighbor signature form: " + nf.join(", "));
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
  // The draft (PII incl. the signature image) has served its purpose once the email
  // is sent — surface the delete offer here, in context, rather than nagging earlier.
  // Not automatic: we can't observe whether the mail was actually sent, and the user
  // may still need the draft to revise and resubmit.
  const cleanup = $("#post-submit-cleanup");
  if (cleanup) cleanup.hidden = false;
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
if (new URLSearchParams(location.search).has("reset") || location.hash === "#reset") {
  deleteDraft();
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
