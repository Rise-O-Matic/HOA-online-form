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

   THE SAMPLE APPLICATION IS A CAPTURED REAL SESSION, not
   generated filler: on 2026-07-07 the user hand-filled the whole
   form as fictional applicant "Mike Smith" (patio cover, turf
   conversion, desert plants — with a hand-drawn plot plan and
   real photos), and that draft + its IndexedDB attachments were
   exported into assets/demo/ — demo-data.json (fields, items,
   photo answers, and the full serialized plot: painted cells +
   plant-stamp annotations) plus locally re-encoded JPEGs
   (~1400 px, ~3 MB total, down from ~34 MB of pasted PNGs).
   Everything is fetched same-origin and lazily (only when the
   toggle is flipped), so demo mode adds zero page-load cost and
   works offline; a canvas-drawn placeholder stands in for any
   image that still fails to load. To refresh the sample data,
   repeat the capture: fill the form by hand, then re-export the
   draft + attachments into assets/demo/ (see ISSUES.md log,
   2026-07-07).

   The demo house is 11506 Aaron Ave, APN 413882015 — a real,
   CONFIRMED-in-HOA Fairway Canyon parcel (also the user's
   trusted aerial-alignment reference, see Sprint 23) — picked
   once and fixed forever, NOT re-randomized per run. (The prior
   pick, 36692 Gallery Ln, turned out to be in Tournament Hills,
   a different Beaumont community entirely — assets/parcels.json's
   bbox spans several unrelated subdivisions, so a bare in-bbox
   pick isn't an HOA filter; don't reuse Gallery Ln or trust
   city === "BEAUMONT" alone.) Its parcel ring, bearing, and the
   drawn plan all live in demo-data.json now.
   ========================================================= */
import { $, $$ } from "./utils.js";
import { setPlanMode, restoreParcelFromDraft, showStep } from "./map-wizard.js";
import { restorePlot, serializePlot } from "./plot-editor.js";
import { updateProgress, scheduleAutosave } from "./app.js";

const DEMO_BASE = "assets/demo/";
let demoDataPromise = null; // lazy, fetched once per page life on first toggle

function loadDemoData() {
  demoDataPromise ||= fetch(DEMO_BASE + "demo-data.json").then(r => {
    if (!r.ok) throw new Error("demo-data.json fetch failed: " + r.status);
    return r.json();
  });
  return demoDataPromise;
}

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
   Sample images — same-origin fetches from assets/demo/.
   ------------------------------------------------------ */
async function fetchAsFile(url, filename) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("image fetch failed: " + res.status);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type || "image/jpeg" });
}

// Fallback for a missing/failed image file: a plain canvas-drawn placeholder, so demo
// mode never hard-fails just because a photo couldn't be loaded.
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

async function demoFile(name) {
  try { return await fetchAsFile(DEMO_BASE + name, name); }
  catch (e) { return placeholderFile(name.replace(/\.[a-z]+$/, "").replace(/-/g, " "), name, 900, 650); }
}

/* ------------------------------------------------------
   Section fillers
   ------------------------------------------------------ */
function revealFormIfHidden() {
  const layout = document.getElementById("form-layout");
  if (layout && layout.hidden) $("#start-application")?.click();
}

function fillApplicant(a) {
  setInputValue($("#owner-name"), a.name);
  setInputValue($("#property-address"), a.address);
  setInputValue($("#owner-phone"), a.phone);
  setInputValue($("#owner-email"), a.email);
}

async function fillImprovements(data) {
  const list = $("#improvement-list");
  const addBtn = $("#add-improvement");
  if (!list || !addBtn) return;
  while ($$(".improvement", list).length < data.items.length) addBtn.click();
  const rows = $$(".improvement", list);
  for (let i = 0; i < data.items.length; i++) {
    const row = rows[i], spec = data.items[i];
    if (!row) continue;
    setSelectValue($("[data-imp-category]", row), spec.category);
    setSelectValue($("[data-imp-action]", row), spec.action);
    setInputValue($("[data-imp-name]", row), spec.name);
    setInputValue($("[data-imp-materials]", row), spec.materials);
    const dims = $("[data-imp-dims]", row);
    if (dims) setInputValue(dims, spec.dimensions);
    if (spec.images.length) {
      const photoInput = $("[data-imp-photo]", row);
      if (photoInput) setInputFiles(photoInput, await Promise.all(spec.images.map(demoFile)));
    }
  }
  setInputValue($("#proposal"), data.notes);
}

// Drives the builder wizard straight to the captured, confirmed plot without needing the
// map click / drag-to-rotate gestures: restoreParcelFromDraft + showStep(4) is the exact
// pair restoreDraft() (app.js) already uses to re-adopt a saved parcel, so this is a
// well-trodden path, not a new one. The plot itself is the hand-drawn plan from the
// captured session (painted material cells + plant-stamp annotations), restored verbatim
// via the same restorePlot() a draft reload uses.
function fillSitePlan(data) {
  setPlanMode("build");
  const p = data.parcel;
  const feature = { type: "Feature", geometry: { type: "Polygon", coordinates: p.ring }, properties: { APN: p.apn } };
  restoreParcelFromDraft(feature, p.apn, p.bearing);
  showStep(4); // rebuilds the grid for this parcel (rebuildGridForParcel), same as a real wizard walk
  const { cols, rows } = serializePlot();
  if (cols !== data.plot.cols || rows !== data.plot.rows) {
    // Same parcel + bearing must yield the same grid; a mismatch means demo-data.json is
    // stale against a geometry change — restore anyway (cells just land best-effort).
    console.warn(`[demo-mode] grid ${cols}x${rows} != captured plot ${data.plot.cols}x${data.plot.rows}`);
  }
  restorePlot(data.plot);
}

function fillPhotoQuestionnaire(data) {
  ["front", "back", "side", "exterior"].forEach(area =>
    setChecked($(`.photo-quiz [data-area="${area}"]`), data.photoAreas.includes(area)));
  if (data.photoMaterial) setChecked($(`.photo-quiz [name=photoMaterial][value="${data.photoMaterial}"]`), true);
}

async function fillPhotos(data) {
  const root = $("#photo-requests");
  if (!root) return;
  for (const [id, names] of Object.entries(data.photos)) {
    if (!names.length) continue;
    const input = $(`[data-photo-input="${id}"]`, root);
    if (input) setInputFiles(input, await Promise.all(names.map(demoFile)));
  }
}

function fillAcknowledgments(data) {
  $$("#acks input[type=checkbox]").forEach(cb => setChecked(cb, true));
  $("#sig-method-type")?.click();
  setInputValue($("#typed-signature"), data.typedSignature);
}

/* ------------------------------------------------------
   Orchestration + toggle wiring
   ------------------------------------------------------ */
async function fillDemoData() {
  setBusy(true);
  setStatus("Filling demo data…");
  try {
    const data = await loadDemoData();
    revealFormIfHidden();
    fillApplicant(data.applicant);
    await fillImprovements(data);
    fillSitePlan(data);
    fillPhotoQuestionnaire(data);
    await fillPhotos(data);
    fillAcknowledgments(data);
    updateProgress();
    scheduleAutosave();
    window.scrollTo({ top: 0, behavior: "smooth" });
    setStatus(`Demo data filled — a fictional sample application for ${data.applicant.address}.`);
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
