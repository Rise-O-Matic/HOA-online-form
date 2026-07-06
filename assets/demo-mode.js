/* =========================================================
   Demo mode — one-click sample-data fill, wired to the toggle
   switch in the temporary "Demo / mockup" banner. Not part of
   the real application flow: it exists purely so the mockup
   is easy to demo/screenshot without hand-typing every field.

   Drives the real form the same way a user would (sets values,
   dispatches input/change events, clicks the same buttons the
   UI already exposes) rather than reaching into other modules'
   internals, so it stays a thin, low-risk add-on: the only new
   cross-module surface is showStep (exported from map-wizard.js
   for this file) plus the site-plan pair already exported for
   draft restore (restoreParcelFromDraft / restorePlot).

   The demo house (DEMO_PARCEL) is a real Beaumont/Fairway Canyon
   parcel picked once and fixed forever — NOT re-randomized on
   each run — so the applicant address + site plan are always
   the same lot; its boundary ring was pulled once from a live
   app session (plotMeta.parcelCoords) rather than re-derived
   from assets/parcels.json, so this file has no dependency on
   that 3.7 MB extract at all. Fills two sample proposed
   improvements, answers the photo questionnaire with sample
   photos, types the owner signature, and checks every
   acknowledgment. Sample photos come from Unsplash's image CDN
   (CORS-enabled, so they can be fetched and attached as real
   File objects, not just <img> decorations) with a canvas-drawn
   placeholder fallback when offline.
   ========================================================= */
import { $, $$ } from "./utils.js";
import { setPlanMode, restoreParcelFromDraft, showStep } from "./map-wizard.js";
import { restorePlot, serializePlot } from "./plot-editor.js";
import { updateProgress, scheduleAutosave } from "./app.js";

/* ------------------------------------------------------
   Sample photos — Unsplash's images.unsplash.com CDN serves
   with Access-Control-Allow-Origin, so these can be fetched
   cross-origin and attached as real Files (picsum.photos and a
   plain unsplash.com page URL do NOT send that header — verified
   by hand before picking this source). Each array entry is a
   base photo URL (no query string); sizing params are appended
   at fetch time. A theme with no entries (or a failed fetch —
   offline, CDN hiccup) falls back to a canvas-drawn placeholder,
   so demo mode still works without a network connection.
   ------------------------------------------------------ */
const DEMO_IMAGES = {
  "house-front": [
    "https://images.unsplash.com/photo-1592595896616-c37162298647",
    "https://images.unsplash.com/photo-1510627489930-0c1b0bfb6785"
  ],
  "backyard": [
    "https://images.unsplash.com/photo-1613544723412-b331bda01e87",
    "https://images.unsplash.com/photo-1613544723371-23b514a78c85"
  ],
  "side-yard": [
    "https://images.unsplash.com/photo-1707178337303-dd825f603a3e",
    "https://images.unsplash.com/photo-1712566758028-5a97ad965e71"
  ],
  "house-wall": [
    "https://images.unsplash.com/photo-1686952454951-737e4581c4e0",
    "https://images.unsplash.com/photo-1533628635777-112b2239b1c7"
  ],
  "patio-cover": [
    "https://images.unsplash.com/photo-1696846911635-83b97e53fb65",
    "https://images.unsplash.com/photo-1694885090746-d90472e11c0e"
  ],
  "landscaping": [
    "https://images.unsplash.com/photo-1782141243609-28a334472e4f",
    "https://images.unsplash.com/photo-1760958932736-2c80ef43d9b5"
  ],
  "paint-swatch": [
    "https://images.unsplash.com/photo-1749207325171-ae2294e277ed",
    "https://images.unsplash.com/photo-1716471330475-f0669db8947a"
  ]
};

const DEMO_NAMES = [
  "Jordan Whitfield", "Morgan Alvarez", "Taylor Nguyen", "Sam Okafor",
  "Riley Bennett", "Casey Donovan", "Avery Lindqvist", "Dana Marchetti"
];

const DEMO_IMPROVEMENTS = [
  {
    category: "structure", action: "add",
    name: "Alumawood patio cover over back patio",
    materials: "Alumawood lattice/solid combo, color “Sandalwood”, from ABC Patio Covers",
    dimensions: "14′ × 20′, 9′ tall",
    photoTheme: "patio-cover"
  },
  {
    category: "landscape", action: "add",
    name: "Drought-tolerant front yard landscaping",
    materials: "3 × 15-gal Texas sage, 2 × 24-in box olive trees, decomposed granite groundcover",
    dimensions: "~6′ tall at maturity",
    photoTheme: "landscaping"
  }
];

// PHOTO_SPECS shot ids (app.js) -> a DEMO_IMAGES theme. Kept as a plain id map here
// instead of importing PHOTO_SPECS, since this file only needs to know which theme
// each already-rendered [data-photo-input] element wants — one less coupling to
// app.js's internals.
const PHOTO_THEME_BY_ID = {
  front_street: "house-front", front_left: "house-front", front_right: "house-front",
  back_full: "backyard", back_left: "backyard", back_right: "backyard",
  side_full: "side-yard",
  ext_elevation: "house-wall",
  back_closeup: "patio-cover",
  material_sample: "paint-swatch"
};

// The demo house — picked once, fixed forever (not re-randomized per run). A real,
// CONFIRMED-in-HOA Fairway Canyon parcel (bearing 0, north-up) — 11506 Aaron Ave, APN
// 413882015, the user's own trusted alignment reference (see Sprint 23, ROADMAP.md) — its
// exact boundary ring cross-referenced from assets/parcels.json by APN. (The prior pick,
// 36692 Gallery Ln, was confirmed to be in Tournament Hills, a different Beaumont gated
// community entirely — assets/parcels.json's bbox spans several unrelated subdivisions, it's
// not an HOA-boundary-filtered extract, so a bare in-bbox pick isn't enough; don't reuse
// Gallery Ln or trust city === "BEAUMONT" alone as an HOA filter.)
const DEMO_PARCEL = {
  a: "413882015",
  address: "11506 AARON AVE",
  bearing: 0,
  g: [[[-117.045362, 33.953645], [-117.045554, 33.953776], [-117.045762, 33.953563], [-117.045571, 33.953432], [-117.045362, 33.953645]]]
};

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/* ------------------------------------------------------
   Field setters — mirror real user interaction (set the value,
   fire the same events a real interaction would) so every
   existing listener (schema reflection, autosave, progress,
   photo-group visibility, thumbnail rendering) runs unchanged.
   ------------------------------------------------------ */
function fire(el, types) { types.forEach(t => el.dispatchEvent(new Event(t, { bubbles: true }))); }
function setInputValue(el, value) { if (!el) return; el.value = value; fire(el, ["input", "change"]); }
function setSelectValue(el, value) { if (!el) return; el.value = value; fire(el, ["input", "change"]); }
function setChecked(el, checked) { if (!el || el.checked === checked) return; el.checked = checked; fire(el, ["input", "change"]); }
function setInputFiles(input, files) {
  if (!input) return;
  const dt = new DataTransfer();
  files.forEach(f => dt.items.add(f));
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true })); // matches app.js's own hydrateInput()
}

/* ------------------------------------------------------
   Sample images
   ------------------------------------------------------ */
async function fetchAsFile(url, filename) {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error("image fetch failed: " + res.status);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type || "image/jpeg" });
}

// Offline / CDN-hiccup fallback: a plain canvas-drawn placeholder, so demo mode never
// hard-fails just because a photo couldn't be fetched.
function placeholderFile(label, filename, w, h) {
  return new Promise(resolve => {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d");
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, "#ddd0b4"); grad.addColorStop(1, "#a9987a");
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(29,26,23,.25)"; ctx.lineWidth = Math.max(2, w * 0.01);
    ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, w - ctx.lineWidth * 2, h - ctx.lineWidth * 2);
    ctx.fillStyle = "rgba(29,26,23,.6)";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "600 " + Math.round(w / 16) + "px 'Libre Franklin', sans-serif";
    ctx.fillText("Demo photo", w / 2, h / 2 - w * 0.03);
    ctx.font = "400 " + Math.round(w / 26) + "px 'Libre Franklin', sans-serif";
    ctx.fillText(label, w / 2, h / 2 + w * 0.05);
    cv.toBlob(blob => resolve(new File([blob], filename, { type: "image/jpeg" })), "image/jpeg", 0.85);
  });
}

async function demoImageFile(theme, filename, w, h) {
  const candidates = DEMO_IMAGES[theme];
  if (candidates && candidates.length) {
    const url = `${pick(candidates)}?w=${w}&h=${h}&fit=crop&q=60&auto=format`;
    try { return await fetchAsFile(url, filename); }
    catch (e) { /* offline, or the CDN hiccuped — fall through to the placeholder */ }
  }
  return placeholderFile(theme.replace(/-/g, " "), filename, w, h);
}

/* ------------------------------------------------------
   Section fillers
   ------------------------------------------------------ */
function revealFormIfHidden() {
  const layout = document.getElementById("form-layout");
  if (layout && layout.hidden) $("#start-application")?.click();
}

function fillApplicant(name) {
  setInputValue($("#owner-name"), name);
  setInputValue($("#property-address"), DEMO_PARCEL.address);
  const line = String(1000 + Math.floor(Math.random() * 9000));
  setInputValue($("#owner-phone"), `(951) 555-${line}`);
  setInputValue($("#owner-email"), name.toLowerCase().replace(/[^a-z]+/g, ".") + "@example.com");
}

async function fillImprovements() {
  const list = $("#improvement-list");
  const addBtn = $("#add-improvement");
  if (!list || !addBtn) return;
  while ($$(".improvement", list).length < DEMO_IMPROVEMENTS.length) addBtn.click();
  const rows = $$(".improvement", list);
  for (let i = 0; i < DEMO_IMPROVEMENTS.length; i++) {
    const row = rows[i], spec = DEMO_IMPROVEMENTS[i];
    if (!row) continue;
    setSelectValue($("[data-imp-category]", row), spec.category);
    setSelectValue($("[data-imp-action]", row), spec.action);
    setInputValue($("[data-imp-name]", row), spec.name);
    setInputValue($("[data-imp-materials]", row), spec.materials);
    const dims = $("[data-imp-dims]", row);
    if (dims) setInputValue(dims, spec.dimensions);
    const photoInput = $("[data-imp-photo]", row);
    if (photoInput) setInputFiles(photoInput, [await demoImageFile(spec.photoTheme, spec.photoTheme + ".jpg", 700, 500)]);
  }
}

// Two simple rectangles on the plot grid — a patio-cover block toward the back of the
// lot and a landscaping-bed strip toward the front — illustrating the two sample
// improvements above. Not polygon-aware (doesn't check the actual parcel outline), just
// centered/margined percentages of the grid, which buildParcelGrid already centers on
// the parcel — good enough for an illustrative demo plan, not a precise one.
function buildDemoCells(cols, rows) {
  const cells = [];
  const rect = (c0, r0, w, h, id) => {
    for (let r = r0; r < r0 + h; r++) {
      if (r < 0 || r >= rows) continue;
      for (let c = c0; c < c0 + w; c++) {
        if (c < 0 || c >= cols) continue;
        cells.push([`${c},${r}`, id]);
      }
    }
  };
  const pw = Math.max(6, Math.round(cols * 0.26));
  const ph = Math.max(8, Math.round(rows * 0.20));
  rect(Math.round((cols - pw) / 2), Math.round(rows * 0.58), pw, ph, "patio");
  const bw = Math.max(8, Math.round(cols * 0.55));
  const bh = Math.max(2, Math.round(rows * 0.08));
  rect(Math.round((cols - bw) / 2), Math.round(rows * 0.10), bw, bh, "mulch");
  return cells;
}

// Drives the builder wizard straight to a finished, confirmed plot without needing the
// map click / drag-to-rotate gestures: restoreParcelFromDraft + showStep(4) is the exact
// pair restoreDraft() (app.js) already uses to re-adopt a saved parcel, so this is a
// well-trodden path, not a new one.
function fillSitePlan() {
  setPlanMode("build");
  const feature = { type: "Feature", geometry: { type: "Polygon", coordinates: DEMO_PARCEL.g }, properties: { APN: DEMO_PARCEL.a } };
  restoreParcelFromDraft(feature, DEMO_PARCEL.a, DEMO_PARCEL.bearing);
  showStep(4); // rebuilds the grid for this parcel (rebuildGridForParcel), same as a real wizard walk
  const { cols, rows } = serializePlot();
  restorePlot({ cell: 8, cols, rows, cells: buildDemoCells(cols, rows), annotations: [], confirmed: true, customMaterials: [] });
}

function fillPhotoQuestionnaire() {
  ["front", "back", "side", "exterior"].forEach(area => setChecked($(`.photo-quiz [data-area="${area}"]`), true));
  setChecked($('.photo-quiz [name=photoMaterial][value="yes"]'), true);
}

async function fillPhotos() {
  const root = $("#photo-requests");
  if (!root) return;
  for (const input of $$("[data-photo-input]", root)) {
    const id = input.dataset.photoInput;
    const theme = PHOTO_THEME_BY_ID[id] || "house-front";
    if (input.multiple) {
      const files = await Promise.all([
        demoImageFile(theme, id + "-1.jpg", 900, 650),
        demoImageFile("landscaping", id + "-2.jpg", 900, 650)
      ]);
      setInputFiles(input, files);
    } else {
      setInputFiles(input, [await demoImageFile(theme, id + ".jpg", 900, 650)]);
    }
  }
}

function fillAcknowledgments(name) {
  $$("#acks input[type=checkbox]").forEach(cb => setChecked(cb, true));
  $("#sig-method-type")?.click();
  setInputValue($("#typed-signature"), name);
}

/* ------------------------------------------------------
   Orchestration + toggle wiring
   ------------------------------------------------------ */
async function fillDemoData() {
  setBusy(true);
  setStatus("Filling demo data…");
  try {
    revealFormIfHidden();
    const name = pick(DEMO_NAMES);
    fillApplicant(name);
    await fillImprovements();
    fillSitePlan();
    fillPhotoQuestionnaire();
    await fillPhotos();
    fillAcknowledgments(name);
    updateProgress();
    scheduleAutosave();
    window.scrollTo({ top: 0, behavior: "smooth" });
    setStatus(`Demo data filled — a fictional sample application for ${DEMO_PARCEL.address}.`);
  } catch (err) {
    console.error("[demo-mode] fill failed:", err);
    setStatus("Demo fill hit a snag — some sections may be incomplete.");
  } finally {
    setBusy(false);
  }
}

const demoToggle = $("#demo-mode-toggle");
const demoToggleWrap = demoToggle?.closest(".demo-toggle");
const demoStatusEl = $("#demo-mode-status");
function setStatus(msg) { if (demoStatusEl) demoStatusEl.textContent = msg; }
function setBusy(on) { demoToggleWrap?.classList.toggle("is-busy", on); if (demoToggle) demoToggle.disabled = on; }

demoToggle?.addEventListener("change", () => {
  if (demoToggle.checked) {
    fillDemoData();
  } else {
    // Held checked until the clear actually happens — #clear-draft's own confirm()
    // decides whether the data really goes away (Cancel leaves it in place).
    demoToggle.checked = true;
    setStatus("");
    $("#clear-draft")?.click();
  }
});
