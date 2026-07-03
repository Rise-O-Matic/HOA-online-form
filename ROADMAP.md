# Roadmap

Distilled from a full-project critique (2026-07-02): architecture, robustness, and user-workflow reviews. Work proceeds **one sprint at a time** — see the working agreement in `CLAUDE.md`. Each sprint is sized to roughly one working session. Don't renumber sprints; mark items done (`~~strikethrough~~` or ✅) and log outcomes in `ISSUES.md`.

**The through-line:** the form is excellent at *collecting* (landing, wizard, photo questionnaire) but treats *assembling and delivering the packet* as the user's problem — and the HOA's own rules make incompleteness unforgiving (auto-denial, 45-day clock never starts). Sprints 1–2 fix that. Sprints 3–5 pay down robustness, code-health, and accessibility debt.

---

## Sprint 0 — Baseline (housekeeping, small) ✅ 2026-07-02

- [x] Commit the outstanding working tree (the Konva grid-painter rework + CLAUDE.md updates) so sprints start from a clean anchor. (`5b88785`)
- [x] Rewrite `README.md` (~10 lines): live branch is `master`, feature list still describes the pre-map-wizard plot painter. Remove the need for CLAUDE.md's "distrust the README" disclaimer.
- [x] Move `416603fe-...pdf` to `docs/source-form.pdf` (nothing in the code references it; update the mention in CLAUDE.md).

## Sprint 1 — Packet assembly & the submission ending (highest impact) ✅ 2026-07-02

The submit bar's primary-styled "Email to Committee" opens an *empty* email; the successful path (Preview → Save as PDF → find file → reopen email → manually attach PDF + photos + neighbor form) is ~8 steps across 3 apps that the UI never states, and `validate()` doesn't require a plot, photos, or the neighbor form even though the copy threatens auto-denial for incomplete packets.

- [x] **Packet review screen** — new Section 08 "Review & Submit" (`#packet`) with a live "Your packet" list: form PDF, plot plan (drawn `plotUsed()` or uploaded `#plot-upload`), each requested photo by name, signed neighbor form (`#neighbor-form-file`), sketches.
- [x] **Guided two-step finish** — "1. Save your PDF → 2. Open pre-addressed email," replacing the three coequal submit-bar buttons (submit bar removed).
- [x] **Soft-gate submission** — the email flow opens `#packet-gate-modal` listing missing packet items, with an explicit "Open the email anyway" override; not hard-blocked.
- [x] **Attachment manifest in the mailto body** — `openMailto()` enumerates every file to attach (plus a "still outstanding" list when overridden).
- [x] **Derive Section 06 from app state** — plot/photos/neighbor-form rows are now live status rows (`.reqstat`), auto-derived; only sketches + fee remain manual checkboxes. `collect()` derives `req_plot`/`req_photos`/`req_neighbors` from real state.
- [x] Move "Download data (JSON)" out of the primary submit bar → "Export JSON" in the sidenav actions.
- [x] Fix inconsistency: `#do-email` and `#email-btn` now share one `startEmailFlow()` that always validates.

## Sprint 2 — Workflow temporality & friction ✅ 2026-07-02 (code items; #3 awaits user content)

The form looks single-sitting but embeds multi-day loops (neighbor wet signatures, daytime photos), and the Draw step frontloads a nine-tool manual nobody reads.

- [x] **Save-and-return messaging** at Sections 04 (neighbors) and 05 (photos) — `.pause-note` asides: draft text saves automatically, come back anytime; honest that file attachments can't persist between browser sessions, so attach in the sitting you submit.
- [x] **Per-tool contextual hints** in the Draw step — one hint line (`#tool-hint`) above the canvas swaps with the selected tool, driven by a `hint` string on each `TOOL_MODES` entry; the wall-of-text intro paragraph reduced to two sentences.
- [x] **Progress meter counts packet items** — plot, photos (questionnaire answered + all requested shots attached), and neighbor form add three slots to the denominator; "100%" is structurally unreachable with an empty packet.
- [x] `startBuilder()` empty-address error: paints a field error and scrolls to / focuses `#property-address`.
- [x] Default `#ack-date` to today (local time), unless the restored draft carried a value.
- [x] Graceful build→upload bail-out — "Upload an existing plan instead" links on wizard steps 2–4 (and the Konva-failure notice) share one `data-switch-upload` handler: switches to the upload path back on step 1, preserving parcel selection and drawn state for a switch back.
- [ ] ISSUES #3 — replace the ✓/✗ photo placeholder frames with real comparison images (content task; **needs images from the user** — the one Sprint 2 item left open).

## Sprint 3 — Robustness & external-dependency hardening ✅ 2026-07-03

Five external services, unpinned or unguaranteed, sit under a public form.

- [x] **Vendor Konva + MapLibre into `assets/vendor/`** — exact pinned builds (`konva-10.3.0.min.js`, `maplibre-gl-5.23.0.js/.css`, version in the filename) replace the unpkg tags; the floating `konva@10` major tag is gone. Google Fonts stays on CDN (degrades gracefully to system fonts).
- [x] **Visible autosave failure** — `saveDraft()` now toggles a persistent `#save-warning` sidenav indicator on quota/blocked errors (clears on the next successful save), pointing at Export JSON as the backup.
- [x] **County GIS failure story** — all ArcGIS requests go through `gisFetch()` (10s `AbortController` timeout); hard failures surface `#gis-fallback-msg` in wizard step 2 with a route to the upload path; `startBuilder()` also guards against MapLibre itself failing to load (routes to upload, mirroring the Konva fallback).
- [x] **Draft lifecycle** — `finishEmail()` reveals a post-submit cleanup panel (Section 08) offering to delete the saved draft (PII incl. signature image); `deleteDraft()` also removes the legacy `.v3`/`.v2` keys so clearing can't resurrect an old draft via the one-time migration; version drift reconciled (`PLOT_VERSION = 4` in lockstep with `DRAFT_KEY`, restore accepts plot versions 3–4).

## Sprint 4 — Code health ✅ 2026-07-03

`app.js` was a 3,100-line IIFE mixing ~1,400 lines of computational geometry with form plumbing; zero tests over the riskiest code.

- [x] **Extract pure geometry + unit tests** — `assets/geometry.js` (ES module) now holds the projection/fill core (`buildParcelGrid`, `fitSimilarity`, `computeAutoAlignBearing` — road dir is a parameter now — `segmentsIntersect`, `connectorBlocked`, `computeFloodFill`, …) with 29 `node:test` cases in `tests/geometry.test.js` (`node --test`). Dead `pointInPolygon` deleted. Minimal `package.json` (`"type":"module"` only) added for Node tooling.
- [x] **ES-module split** — `utils.js` / `geometry.js` / `plot-editor.js` / `map-wizard.js` / `app.js` (entry: form+persistence), loaded natively; no build step. Found & fixed along the way: restore never re-set `selectedParcelGeoJSON`, so the first post-restore autosave dropped `parcelCoords` and the grid failed to rebuild on the *next* reload.
- [x] Update CLAUDE.md architecture section to match the new file layout (module map, cycle rules, test command).

## Sprint 5 — Accessibility & mobile ✅ 2026-07-03

- [x] **Non-canvas alternative for the owner signature** — Draw/Type toggle on the owner signature; typing a full legal name acts as the e-signature (validated, in the progress meter, persisted as `ownerSigMethod`/`ownerTypedSignature`, rendered in preview + print). Also fixed the latent pad-sizing bug (canvas was sized while the layout was `display:none`).
- [x] **Touch/mobile pass** — map drag-to-rotate converted to pointer events (works with a finger; step 3 forces `touch-action:none` on the map canvas); the plot stage gained two-finger pinch-zoom/pan (a second finger cancels an in-progress draw and rolls back the half stroke via its undo point); `pointer: coarse` CSS bumps tool/zoom/rotate buttons to fingertip size. Sidenav already collapsed at ≤900px (unchanged).
- [x] Keyboard access review — Orient step is now a focus stop (arrow keys rotate 1°, Shift 15°, aria-live readout). Documented as inherently pointer-only: parcel selection (map click) and freehand drawing; the upload path is the complete keyboard route (native controls end-to-end), every builder step carries a focusable "upload instead" bail-out, and the typed signature removed the last pointer-only *required* interaction. See CLAUDE.md "Keyboard access".

## Sprint 6 — Draw-step UX: explicit completion + compact layout

From the 2026-07-03 Draw-step UI/UX review. Two problems: `plotUsed()` marks the plan "provided" after a single stroke (completion is inferred, never declared — and step 4 is the wizard's only dead end, with no forward CTA), and five stacked control rows (~250px: intro, 10 material chips, 9 tool chips, brush+zoom, hint) push the canvas below the fold while materials and tools share one undifferentiated pill style.

- [ ] **"Done — use this plan" button** — primary CTA at the bottom of step 4, restoring the wizard's Next-button rhythm. Sets a new `plotConfirmed` flag persisted in the draft (additive to `.v4`, same pattern as `ownerSigMethod`); cleared by Clear plan and by a parcel/orientation rebuild, *kept* across further edits (adding detail shouldn't un-complete the plan). Build-mode `plotProvided()` becomes `plotUsed() && plotConfirmed`; the Section 06 row and soft gate gain a third state ("In progress — mark it finished in Section 02"); the progress meter counts the plot only when confirmed. Done also flips the Draw dot to `is-done` and scrolls on to Section 03.
- [ ] **Tool rail** — tools become an icon-only vertical rail docked to the canvas's left edge (the 17px SVGs already exist in `ICON`); Undo/Redo join the rail; the active tool's *name* leads the hint strip so labels aren't lost. Rail flips to a horizontal strip on narrow viewports; keep `pointer: coarse` fingertip sizing.
- [ ] **Materials = the one palette** — a single swatch-first chip row above the canvas; kills the two-identical-palettes soup.
- [ ] **Zoom overlay** — the − / % / + / Fit group moves onto the canvas as a corner overlay, MapLibre-control style, consistent with the step-2 map.
- [ ] **One status strip** — merge `#tool-hint` and the `.hotkey-bar` into a single strip docked directly under the canvas (hint text left, mouse glyphs right).
- [ ] **Contextual brush control** — brush width appears only while Paint is active (in the status strip), removing the standing `.plot__controls` row.
- [ ] **Scale badge** — persistent `1 □ = 1 ft` badge in a canvas corner; the intro paragraph shrinks to one line.
- [ ] **Breadcrumb-only back-nav** — delete the "Back to orientation" button (redundant: the step dots already navigate back, map-wizard.js `data-goto` guard) and stop parking navigation next to the destructive Clear plan.
- [ ] **Keyboard undo** — Ctrl+Z / Ctrl+Shift+Z (+ Ctrl+Y) while step 4 is active; must not fire while typing in an input/textarea (callout text editing).
- [ ] Fix `clearPlot()` confirm copy — it says "This can't be undone" but `recordUndoPoint()` runs first, so Clear *is* undoable via Undo. Say so instead.

## Sprint 7 — Draw-step content: stamps, legend, custom materials

Second half of the 2026-07-03 review. Tree / Yard Light / Camera are *area materials* today — semantically wrong for point objects (a purple 3-ft smear means "camera") — and no output path carries a material legend, so the reviewer's PDF shows colored regions with no key at all.

- [ ] **Stamp tool** — new data-driven `STAMPS` constant (id / label / SVG path / default footprint in ft): tree, palm, shrub, cactus/agave, xeriscape groundcover, boulder, camera, yard light, AC unit. Black glyph with a white halo (reads over both aerial and painted fills; standard plan-symbol convention). Click to place as `kind:"stamp"` Konva nodes on `drawLayer` — Select-drag, Erase-click, undo/redo, `serializePlot`/`restorePlot` (rehydrate needs `attachShapeInteractions`, like the other shapes), and print via `renderPlotImage()` all come free from the existing vector pipeline. Picker = a glyph flyout in the contextual slot where Paint's brush control lives. v1 uses fixed real-world sizes (tree ~15 ft canopy, shrub ~3 ft, legible symbolic sizes for hardware); resize-on-select is a later nicety.
- [ ] **Retire the point-object materials** — drop the Tree / Yard Light / Camera chips from `PALETTE` but keep their ids resolvable in `PALETTE_MAP` so cells painted in old drafts still render.
- [ ] **Auto legend** — swatch + label for every material actually present in `cellState` (plus stamps used), rendered beside the plan in `buildPreview()` and `buildPrintHTML()`. Prerequisite for custom colors — a custom color is meaningless to the reviewer without its name.
- [ ] **Custom named materials** — "+ Add material" chip → small popover (name + native `<input type=color>`). Persist as `plot.customMaterials` in the draft (additive to `.v4`); restore must merge them into `PALETTE_MAP` *before* `loadCells()` repaints. Guardrail: clamp or warn on very light colors — the paint layer multiplies over the aerial on screen and near-white washes out.

## Decision-gated / backlog

- **Real submission backend** — a minimal endpoint (Cloudflare Worker or a form-relay service) accepting the JSON + files would flip the app from mockup to usable tool and obsolete much of Sprint 1's manual-assembly UX. Needs a hosting/ownership decision with the HOA client first. Sprint 1 is still worth doing: the packet-review screen becomes the upload UI.
- localStorage PII expiry policy (beyond clear-on-submit).
- Photo questionnaire partially re-asks what the proposal/plot already express — acceptable; revisit only if users stumble.
