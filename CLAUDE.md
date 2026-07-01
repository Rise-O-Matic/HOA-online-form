# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **static, client-side mockup** of the Fairway Canyon HOA Architectural Review Committee (ARC) application, rebuilt from a printed PDF (`416603fe-...pdf`) as a web form for GitHub Pages. **There is no backend.** Nothing is transmitted: drafts persist to `localStorage`, "submitting" generates a printable preview or opens a `mailto:`, and data can be exported as JSON.

Plain HTML/CSS/JS — **no build step, no package.json, no npm dependencies, no tests, no linter.** The only external runtime dependencies are CDN `<script>`/`<link>` tags: MapLibre GL JS (maps) and Google Fonts.

## Commands

- **Run locally:** `python -m http.server 8000`, then visit `http://localhost:8000`. Use a server rather than opening `index.html` via `file://` — the county GIS `fetch()` calls and map tiles need an http(s) origin.
- **Deploy:** GitHub Pages serves the repo root (`.nojekyll` disables Jekyll processing). The live branch is **`master`** (the README still says `main` — it is stale).
- There is no build/lint/test tooling. Edit the three source files and reload.

## Architecture

Three files do everything: `index.html` (markup), `assets/styles.css` (presentation, ~850 lines, organized in clearly-labeled `/* === SECTION === */` blocks ending with a `@media print` block that styles the print output), and `assets/app.js` (all behavior).

`assets/app.js` is a single ~1460-line IIFE. All state lives in module-level `let` variables; there are no modules or classes beyond `SignaturePad`. Content is data-driven from constants at the top of the file — **edit these arrays to change form content**, not the generated DOM:
- `ACKS` — the 8 acknowledgment statements (HTML strings, rendered into `#acks`)
- `PALETTE` — plot-plan materials (`id`/`label`/`color`); `erase` and `move` are tools with `color: null`
- `DATES` — the 2026 review-date table (rendered into `#dates-body`, which lives on the **landing page**)
- `PHOTO_SPECS` / `PHOTO_MATERIAL` — the per-area photo requests for the Photos section (each shot has `id`/`title`/`instr`/`good`/`bad`); editing these changes which photos are requested and their instructions

The form is a **multi-section single page**, gated behind a **landing/cover screen**. DOM/section order (and card numbers): landing → `01` Applicant · `02` Site/Plot Plan · `03` Proposed Change · `04` Adjacent Owners · `05` Photos · `06` Required Submissions (confirm & attach) · `07` Acknowledgments. The sidenav, card numbers, and DOM order must agree when sections are added/reordered.

### Key subsystems in app.js

- **Landing / form reveal** — a full-screen cover (`#landing`, between the masthead and the form) holds the unpacked required-submissions overview + the 2026 review-dates table + how-to-submit/assistance. The whole form (`.layout`, `id="form-layout"`) starts with the `hidden` attribute; `enterForm()` (wired to `#start-application`) unhides it, and `showLanding()` (wired to the sidenav `#view-landing` link) returns to it. **Returning users skip the landing:** `restoreDraft()` returns a boolean and `enterForm()` is called when a draft was restored.

- **Photos** (`#photos-section`) — a **questionnaire drives which photos are requested**. The two questions (which areas: `area_front/back/side/exterior` checkboxes; plus a `photoMaterial` yes/no radio) toggle pre-built per-area groups via `refreshPhotoGroups()` (it flips each `.photo-group`'s `hidden`, and shows/hides the `#photo-empty` placeholder). Groups/blocks are generated once by `buildPhotoRequests()` from `PHOTO_SPECS`/`PHOTO_MATERIAL`, so already-attached files survive a questionnaire change (groups are hidden, not destroyed). Each shot has its own `<input type=file data-photo-input=ID>` + a ✓/✗ example pair (**placeholder frames** — real comparison images pending, ISSUES #3). `collect()` emits `photoAreas`, `photoMaterial`, and a `photos` map (`id → filename`); `files` is the flat list of attached photo names for preview/print. As with all file inputs, restore can only show the prior filename (browsers can't repopulate a file input), shown as an `is-prior` status.

- **`SignaturePad`** (the one class) — DPR-aware `<canvas>` signature capture via pointer events. Serializes to a PNG dataURL (`toDataURL`/`fromDataURL`) so signatures survive localStorage round-trips. Instances are tracked in the `sigPads` map, keyed by the element's `data-sigpad` attribute.

- **Plot grid** — the drawing model is `cellState[r][c]` = a palette id or `null`. `parcelMask[r][c]` is a parallel 2D boolean marking cells inside the parcel polygon; `isOutside(c,r)` gates all painting so you can't draw outside the lot. Painting uses pointer capture; the **Move tool** flood-fills (`floodFill`) the contiguous same-material region and drags it. `renderPlotImage()` rasterizes `cellState` to a PNG `<canvas>` for the preview/print output.

- **Parcel → grid projection** (the non-obvious part) — a county GeoJSON parcel polygon is turned into a grid mask by: `geoToLocalMeters` (lng/lat → local meters) → `rotatePoints` (by `-bearing` to match the rotated map view) → flip Y (geographic north-up → screen rows-down) → `computeBBox` → scale so the longest dimension = `TARGET_MAX_DIM` cells → `pointInPolygon` ray-cast per cell. `buildParcelGrid` returns `{cols, rows, mask, polygonPx}`. **`gridCols`/`gridRows` are mutable and recomputed per parcel**; `rebuildGridForParcel()` resets `cellState`, `parcelMask`, and `parcelPolygonPx` together, then rebuilds the DOM.

- **Map wizard** — the Site/Plot Plan section (`#siteplan`) is a 4-step flow driven by `showStep(n)`: **1 Method → 2 Select → 3 Orient → 4 Draw**. Step 1 is a `planMode` choice (`"build"` vs `"upload"`): "Build a plan" runs `startBuilder()` (which reads `#property-address` from the standalone Applicant Information card and kicks off geocoding) and reveals the Select/Orient/Draw dots; "Upload an existing plan" reveals a file input (`#plot-upload`) and hides those dots. Map data comes from MapLibre GL + OpenFreeMap tiles + **Riverside County ArcGIS REST** services: the assessor table (layer `50`) resolves address → APN, and the parcel layer (`40`) returns polygon geometry. Note: the **single `#map-container` DOM node is physically moved** between the step-2 and step-3 containers via `target.prepend(mapContainer)` — there is only one map instance, reparented as you navigate. Step 2 locks north-up; step 3 enables rotation. Rotation is driven by a single `setRotation(deg)` function (normalizes mod 360, updates `parcelBearing`, the slider, its `--pct` fill custom property, the big degree readout, and `mapInstance.setBearing`) — the slider's `input` event, the **Rotate ±15°**/**Reset** buttons, `restoreDraft()`, and `computeAutoAlignBearing()` (which squares the view to the parcel's longest boundary edge; **Auto-align** no-ops without a `selectedParcelGeoJSON`) all funnel through it. Step 3 also dismisses the "Selected parcel" popup (`selectedPopup`, created on parcel click) on entry, and shows a transparent **Back Yard / Front Yard overlay** (`.map-orient-overlay`) — that overlay lives *inside* `#map-container` so it rides along when the node is reparented, but is `display:none` by default and only revealed by the `#map-step3 .map-orient-overlay` rule. The map's zoom/compass control buttons are likewise hidden in step 3 only via `#map-step3 .maplibregl-ctrl-top-right { display:none }` (kept for step 2's parcel selection). Gotcha: builder-only step dots are hidden via inline `style.display` (not the `hidden` attribute), because `.plot-steps-nav__dot` sets `display:flex`, which would override `[hidden]`.

- **Address geocoding** — `parseAddress()` regex-splits "number + street name" and queries the county assessor endpoint. It is **hardcoded to `CITY='BEAUMONT'`** and Riverside County URLs — this app is not geographically portable without changing those endpoints and the city filter.

- **Persistence** — `collect()` serializes the entire form (text fields, checkboxes, neighbors, all signatures as dataURLs, `cellState`, and `plotMeta` with parcel coords/APN/bearing) into one object. `saveDraft`/`restoreDraft` read/write it to `localStorage` under `DRAFT_KEY = "fairwayCanyonArcDraft.v2"`. Autosave is debounced 1200ms on `input`. Restoring rebuilds the parcel grid from the saved `parcelCoords`.

- **Output paths** — four ways data leaves the form, all client-side: the **preview modal** (`buildPreview`), a **single-page print window** (`buildPrintHTML` → `printPreview` opens `window.open` and writes a self-contained doc with an inline `<style>` block — print CSS lives there, not in styles.css), a **`mailto:`** link (`openMailto`), and **JSON download**. `collect()` is the single source feeding all four.

## Gotchas

- **`EMAIL_TO` (app.js) CCs the developer:** it is `"carolmarie.taylor@fsresidential.com,steven@stevenbrown.design"`. The second address is the developer's, baked in for the demo.
- **Magic number `22`:** the Move tool's pointer→cell math uses `Math.floor(x / 22)` literally instead of the `CELL_SIZE` constant (which is also 22). Keep them in sync if you change cell size.
- **Form-content edits go in the data constants** (`ACKS`/`PALETTE`/`DATES`/`PHOTO_SPECS`), not the DOM, which is generated from them.
- **`[hidden]` vs author `display`:** hiding an element with the `hidden` attribute only works if no author rule sets `display` on it. Both `.layout` (`display:grid`) and `.modal` (`display:grid`) therefore need an explicit `.layout[hidden]`/`.modal[hidden] { display:none }` rule, and builder-only step dots use inline `style.display` instead of `hidden` (`.plot-steps-nav__dot` is `display:flex`). Same gotcha, three places.
- `ISSUES.md` is the running work log; **#3** (good-vs-bad photography examples) is now wired into the Photos section as **placeholder frames** — the structure exists, the real comparison images are still pending.
