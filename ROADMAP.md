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

## Sprint 6 — Draw-step UX: explicit completion + compact layout ✅ 2026-07-03

From the 2026-07-03 Draw-step UI/UX review. Two problems: `plotUsed()` marks the plan "provided" after a single stroke (completion is inferred, never declared — and step 4 is the wizard's only dead end, with no forward CTA), and five stacked control rows (~250px: intro, 10 material chips, 9 tool chips, brush+zoom, hint) push the canvas below the fold while materials and tools share one undifferentiated pill style.

- [x] **"Done — use this plan" button** — primary CTA at the bottom of step 4, restoring the wizard's Next-button rhythm. Sets a new `plotConfirmed` flag persisted in the draft (in `plot.confirmed`, additive to `.v4`); cleared by Clear plan and by a parcel/orientation rebuild, *kept* across further edits (adding detail shouldn't un-complete the plan). Build-mode `plotProvided()` is now `plotUsed() && isPlotConfirmed()`; the Section 06 row, packet list, and soft gate gained a third state ("In progress — mark it finished in Section 02", amber `.is-partial` row); the progress meter counts the plot only when confirmed. Done flips the Draw dot to `is-done` (survives `showStep()` re-renders) and scrolls on to Section 03.
- [x] **Tool rail** — icon-only vertical rail (`.tool-rail`) docked to the canvas's left edge; Undo/Redo joined it (new SVGs in index.html); the active tool's *name* leads the hint strip. Rail flips horizontal ≤640px; `pointer: coarse` bumps buttons to 2.75rem.
- [x] **Materials = the one palette** — `#palette` is the single chip row above the canvas.
- [x] **Zoom overlay** — + / − / Fit / % as a top-right canvas overlay, MapLibre-control style.
- [x] **One status strip** — `.plot-status` (dark, hotkey-bar treatment) docked under the canvas: `#tool-hint` left, mouse glyphs right.
- [x] **Contextual brush control** — `#brush-control` lives in the status strip, shown only while Paint is active; the `.plot__controls` row is gone.
- [x] **Scale badge** — persistent "1 square = 1 ft" badge, bottom-left canvas corner; intro paragraph is one line.
- [x] **Breadcrumb-only back-nav** — "Back to orientation" deleted; step 4 ends in a Clear plan (left) / Done (right) nav bar.
- [x] **Keyboard undo** — Ctrl/Cmd+Z / Ctrl+Shift+Z / Ctrl+Y whenever the plot host is rendered; skipped while typing in inputs/textareas.
- [x] `clearPlot()` confirm copy now says Clear can be brought back with Undo.

## Sprint 7 — Draw-step content: stamps, legend, custom materials ✅ 2026-07-03

Second half of the 2026-07-03 review. Tree / Yard Light / Camera are *area materials* today — semantically wrong for point objects (a purple 3-ft smear means "camera") — and no output path carries a material legend, so the reviewer's PDF shows colored regions with no key at all.

- [x] **Stamp tool** — data-driven `STAMPS` constant (id / label / footprint in ft), two kinds: black-glyph-over-white-halo path stamps (camera, yard light, AC unit) and full-color `Konva.Image` stamps, plus an invisible full-footprint hit disc so Select/Erase grab it anywhere inside the symbol. Placed as `kind:"stamp"` Konva groups on `drawLayer` (armed on press, committed on release so a pinch's second finger cancels it; translucent footprint ghost follows the cursor) — Select-drag, Erase-click, undo/redo, persistence, and print all came free from the existing vector pipeline. Picker = glyph flyout in the status strip's contextual slot (where Paint's brush control lives). Fixed real-world sizes in v1; resize-on-select is a later nicety.
- [x] **Plant icon catalog swap** (post-Sprint-7) — replaced the original 6 hand-drawn plant/landscape glyphs (tree, palm, shrub, cactus/agave, xeriscape groundcover, boulder) with a 24-icon full-color plant/landscape set (`assets/stamps/*.svg`, a downloaded "HOA plant icon starter set") rendered as `Konva.Image` stamps; the 3 hardware symbols (camera, yard light, AC unit) stay as path stamps. Added `rehydrateStampImages()` since Konva can't serialize an Image node's bitmap — draft restore, undo/redo, and print's offscreen composite all re-attach the right `<img>` from a preloaded `STAMP_IMG_CACHE`.
- [x] **Retire the point-object materials** — Tree / Yard Light / Camera chips dropped from `PALETTE`, ids kept resolvable via `RETIRED_MATERIALS` merged into `PALETTE_MAP`, so cells painted in old drafts still render (and the legend still names them).
- [x] **Auto legend** — `plotLegend()` (plot-editor) reports every material present in `cellState` + every stamp placed; `plotLegendHTML()` (app.js) renders swatch/glyph + name under the plan image in both `buildPreview()` and `buildPrintHTML()`.
- [x] **Custom named materials** — "+ Add material" chip → inline popover (name + native `<input type=color>`). Persist as `plot.customMaterials` (additive to `.v4`); restore merges them into `PALETTE_MAP` *before* `loadCells()` repaints. Guardrail: colors with perceived brightness > 220/255 are rejected with a warning (the paint layer multiplies over the aerial on screen and near-white washes out).

## Sprint 8 — Journey de-duplication ✅ 2026-07-03

From the 2026-07-03 user-journey redundancy audit: the form reviewed packet completeness twice (Section 06's derived rows mirrored Section 08's packet list, and 08 sent users *back* to 06 to tick the sketches box), the application fee was explained three times with three conflicting timelines, and the closing "What Happens Next" block restated the submit instructions and pointed at a dates table that had moved to the landing.

- [x] **Merge Section 06 into Review & Submit** — the "Required Submissions" card is gone; its three derived `.reqstat` rows (pure duplicates of the packet list) were deleted along with `refreshRequirementRows()`/`setReqRow()` and their CSS; the sketches checkbox moved to a `.packet-confirm` row directly under the packet list (so the packet's one manual attestation lives where it's judged); Acknowledgments/Review & Submit renumbered 07→06 / 08→07 across the sidenav, card numbers, and all copy references.
- [x] **One fee story** — canonical: nothing due at application; if approved, the committee contacts you to arrange payment ("What Happens Next" wording, per ISSUES #2). The landing checklist item now says so; the contradicting "review will not begin until the fee is received" lines (landing assistance note, print footer) and the no-op `req_fee` checkbox (it appeared "missing" on the printed PDF but never gated anything) are gone; `SUB_LABELS` drops `req_fee`.
- [x] **Acks 3–4 cross-references** — the two acknowledgments that re-ask what the app already tracks (attached sheets; paint/material sample) now carry muted parentheticals pointing at the packet checklist / the Section 05 sample photo, so they read as confirmations rather than new asks. (Ack text itself untouched — presumed legal wording from the printed form.)
- [x] **"What Happens Next" trim** — step 1 (email-the-packet instructions, restating the Section 07 finish steps directly above it) removed; the stale "(see dates below)" now links back to the landing (`#view-dates` → `showLanding()`); "and the fee" dropped from the 45-day sentence.

Verified in-browser (fresh port, fresh profile): zero console errors on load; 7 sidenav/card sections; sketches checkbox drives the packet row, gate copy, preview, and a draft round-trip (restores checked into the new location); preview's Required Submissions lists 4 items with no fee row; `#view-dates` returns to the landing. `node --check` clean on app.js/plot-editor.js; 29/29 geometry tests.

## Decision-gated / backlog

- **Real submission backend** — a minimal endpoint (Cloudflare Worker or a form-relay service) accepting the JSON + files would flip the app from mockup to usable tool and obsolete much of Sprint 1's manual-assembly UX. Needs a hosting/ownership decision with the HOA client first. Sprint 1 is still worth doing: the packet-review screen becomes the upload UI.
- localStorage PII expiry policy (beyond clear-on-submit).
- Photo questionnaire partially re-asks what the proposal/plot already express — acceptable; revisit only if users stumble.
