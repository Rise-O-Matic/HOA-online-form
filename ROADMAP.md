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

## Sprint 9 — Itemized improvements list (Section 03 rework) ✅ 2026-07-04

The source form demands, per proposed modification: "Sketches, Dimensions, example photos and materials" (page 1 directions), "**Must Include: Materials, Dimensions, and Example Pictures for everything**" (the graph-paper template), and catalog illustrations / sales pamphlets (Ack 3; Ack 4 adds manufacturer color/code + vendor for paint). Today Section 03 is one free textarea whose placeholder *hopes* the user covers all that — nothing structures or checks it — and the Photos section only documents *existing conditions*; there is nowhere to attach a catalog/product picture of the proposed patio cover, shed, or pavers. So an application incomplete by the HOA's own definition sails through the soft gate — the exact failure mode Sprint 1 exists to prevent.

- [x] **Improvements repeater** — Section 03 becomes an item list (neighbor-list pattern: generated rows + "+ Add another improvement"). Each item: action (**Add / Replace / Remove**), short name ("Alumawood patio cover"), materials & color (free text; placeholder nudges manufacturer, color/code, vendor per Ack 4), dimensions (free text, "12′ × 24′"), and a file input for an **example/catalog picture**. *Remove* items hide the materials field (`applyImprovementAction`), and their picture slot becomes an optional "photo of what's being removed." A per-row remove button never empties the list (re-adds one) so "name required per item" always demands at least one named change.
- [x] **Textarea demoted, not deleted** — `#proposal` is now an optional "Anything else the committee should know" notes field (`required` removed); requiredness moved to the item list — each row's name input is `[required]`, and the always-present starter row guarantees at least one.
- [x] **Packet integration** — each Add/Replace item's example picture is a packet row (`improvementChecklist()`) feeding `packetMissingList()`, the `renderPacket()` list (with per-item subrows), the email soft gate, the mailto attachment manifest, and the progress meter (a 4th packet slot, lenient: a Remove-only list needs no pictures) — warn, never hard-block, same as photos.
- [x] **Preview/print table** — `improvementsTableHTML()` (shared) renders the items as a table (action / item / materials / dimensions / example-picture filename) in both `buildPreview()` and `buildPrintHTML()`, plus the notes below it — visibly satisfies the "must include" blurb on the committee's own template. The old prose `.print-proposal` block is gone.
- [x] **Persistence** — `items: [{action, name, materials, dimensions, photo}]` in the draft, additive to `.v4`; file inputs restore as `is-prior` filenames (browser limitation, same as photos); an old draft's `proposal` text restores into the notes field unchanged.

Verified in-browser (fresh port, restored draft): zero console errors; the repeater adds/removes and the Remove action hides materials + relabels the picture; removing the last row re-adds one; the packet list shows "Example / catalog pictures — N of M attached"; an `items[]` + notes draft round-trips through reload (incl. the Remove row's hidden materials); the preview renders the improvements table (Add row with materials/dims, Remove row showing "n/a"/"—") with the notes beneath. `node --check` clean on app.js; 29/29 geometry tests (unaffected).

## Sprint 10 — Sequence the packet endgame (journey reorder) ✅ 2026-07-04

From the 2026-07-04 user-journey discussion. Two structural issues: (1) the heaviest step (the map+draw wizard) was the *first* thing after Applicant, and you were asked to draw the lot before naming what you're adding to it; (2) "Adjacent Owners" sat early (Section 04) but hosted a **late, physical act** — printing the neighbor form and re-attaching wet signatures — even though neighbors sign *against the printed packet*, which doesn't exist until the end. The data (neighbor names/addresses) belongs early; the signing belongs at the end.

- [x] **Reorder sections** — Improvements moves ahead of Site/Plot (name the change → place it on the lot); Photos moves up one; Adjacent Owners down one. New order: `01` Applicant · `02` Proposed Improvements · `03` Site/Plot Plan · `04` Photos · `05` Adjacent Owners · `06` Acknowledgments · `07` Review & Submit. Sidenav, card numbers, and DOM order all updated in lockstep; all "Section 0X" copy references across `app.js`/`index.html` remapped; the Draw-step "Done" CTA now scrolls **forward** to Photos (`#photos-section`) instead of back to Improvements.
- [x] **Split neighbor data from neighbor act** — Adjacent Owners (Section 05) is now the **roster only** (names/addresses, which pre-address the printed form). The `#print-neighbor-form` button, `#neighbor-form-file` re-attach input, `#neighbor-filelist`, and the multi-day `.pause-note` all moved into Section 07.
- [x] **Section 07 = a 3-step Print → Sign → Transmit finish** — Step 1 *Save & print your application packet* (the record your neighbors sign against), Step 2 *Collect your neighbors' signatures* (print the form, collect in person, attach the scan — the honest physical loop), Step 3 *Email your packet* ("keep your printed packet for your records"). The "Signed neighbor signature form" packet row now links to `#finish-step-2`; the soft-gate/manifest copy points at Section 07 Step 2. The orphaned `.neighbor-form-actions` CSS was removed (its old divider was noise inside a finish-step; `.btn` already sets the pointer cursor).

Verified in-browser (fresh port 8137, form revealed): DOM section order + card numbers + sidenav all read 01→07 in the new order; the three finish steps render 1/2/3 with the neighbor form present under `#packet` and **absent** from `#neighbors`; no duplicate element ids; the packet list renders 5 rows incl. "Signed neighbor signature form"; zero console errors on load. `node --check` clean on app.js/map-wizard.js/plot-editor.js; 29/29 geometry tests.

## Sprint 11 — Improvement categories with per-category fields ✅ 2026-07-04

From the same 2026-07-04 discussion: a **plant** doesn't need "materials & color" or "12′ × 24′ dimensions"; a **paint** change is all about the color code, not dimensions. Section 02's one-size-fits-all row (materials + dimensions for everything) asked the wrong questions for whole categories of change.

- [x] **`CATEGORIES` data constant** — each improvement row gains a **category `<select>`** (Structure / Hardscape / Plants and landscaping / Paint or exterior color / Equipment / Pool, spa or water feature / Other). The constant declares, per category, which of the two flex fields show and how they're **relabeled** (id/label + `materials` and `dims` slots as `{label, ph}`; `dims: null` hides dimensions). Data-driven, same "edit the constant, not the DOM" discipline as `PALETTE`/`PHOTO_SPECS`; the row layout moved the name onto its own full-width line to fit the new category + action pair.
- [x] **Schema reflection** — `applyImprovementSchema(node)` (generalizes the old `applyImprovementAction`) relabels + shows/hides the materials & dimensions slots per category; **Remove** still overrides (hides materials, relabels the picture). Wired to the category select's `change`. A CSS `:has()` rule spans materials across the row when the category hides dimensions (e.g. paint's long color-code field).
- [x] **Data + outputs** — `improvementItems()` emits `category`; `improvementsTableHTML()` gained a **Type** column (`categoryLabelShort()`) and category-aware n/a (Remove → materials n/a, paint → dimensions n/a); persistence stores `category` (additive on Sprint 9's `items` shape — old drafts default to `structure`), and restore sets the select + re-applies the schema. Section 02 sub-copy reworded to "pick the type of change and we'll ask only for what it needs". The packet picture soft-gate stays uniform (a catalog/example picture is reasonable for every category); per-category *required*-field enforcement is left as a backlog nicety.

Verified in-browser (fresh port 8138): the 7-option category select toggles correctly — structure shows materials + dimensions; landscape relabels to "Plant type & quantity" + "Mature size / spread"; paint relabels materials to "Color name, code & manufacturer" and **hides** dimensions (materials spans the row); Remove hides materials. `category` persists to the `.v4` draft and a reload restores it with the schema re-applied (paint label + hidden dims intact). The preview table renders the Type column with correct n/a cells (paint → dimensions n/a; Remove → materials n/a). Zero console errors throughout. `node --check` clean on app.js; 29/29 geometry tests.

## Sprint 12 — Quick fixes: numbering, redundancy, tool chrome ✅ 2026-07-04

From the 2026-07-04 issue dump (items 1, 5, 7, 8, 9, 14). Five small, independent fixes — one session.

- [x] **Area-agnostic work-area close-up(s)** (item 14) — the shot moved out of `PHOTO_SPECS.back.shots` into a standalone `PHOTO_CLOSEUP` constant with its own photo group (`data-area="closeup"`), shown whenever **at least one** area is selected, titled "Close-up(s) of the work area(s)" (own `PHOTO_TITLE` entry, no area prefix; the generic `back_closeup-good/bad.jpg` examples reused). The input is **`multiple`** (dropzone appends; native picker replaces — the neighbor-form semantics): status shows a count, thumbnails render one card per file into `.photo-thumb-list` with per-file Remove (FileList rebuilt via `DataTransfer`), the dropzone stays visible after attaching (no `.has-thumb`), and the `photos` map value is a filename **list** — `collect()`, restore (`is-prior`, string-or-array), the packet subrow, preview, the print photo count, and the mailto manifest all handle the plural case. The id stays `back_closeup`, so a pre-Sprint-12 draft's single filename restores unchanged.
- [x] **Re-enumerate improvement rows** — `renumberImprovements()` re-derives the visible "Improvement N" labels from 1-based DOM position after every add/remove; `data-improvement` / input ids stay on the monotonic counter (uniqueness for label/`for` pairs and the photo-status wiring).
- [x] **Drop the manual sketches attestation** — the `.packet-confirm` checkbox, `sketchesConfirmed()`, its `packetMissingList()` entry, the `renderPacket()` row, `collect()`'s `req_sketches`, the `SUB_LABELS` entry, the mailto attach-list line, and the restore loop for manual submission checkboxes are all gone (plus the orphaned `.checklist__intro`/`.packet-confirm` CSS). Every packet row is now derived; old drafts' `req_sketches`/`req_fee` keys restore harmlessly into nothing.
- [x] **Instant tooltips on the draw chrome** — the `data-tip` + `::after` treatment (begun with the tool rail in the dropzone session) now covers the whole chrome: stamp-picker buttons switched from `title` to `data-tip` with an up-flowing `.plot-status__stamps button::after` tooltip (the rail's flows right), and Undo/Redo swapped their native `title`s for `data-tip`s — Redo's reads "Redo (Ctrl+Shift+Z)" (Ctrl+Y still works). `aria-label`s kept everywhere; no native `title` remains where `data-tip` applies.
- [x] **Paint-bucket icon swap** — `ICON.fill` is the user-supplied 48-box bucket+drop glyph, restyled to rail conventions (`stroke="currentColor"`, `fill="none"`, 17×17, stroke-width 3.8 ≈ the neighbors' 1.9-at-24-box weight). `cursorForMode()` no longer assumes a 24-box: it reads each icon's viewBox and scales the cursor halo/ink stroke widths to match (Fill is a glyph-as-cursor tool, so this was load-bearing, not cosmetic).

Verified in-browser (fresh port 8141): zero console errors incl. a draft-restore load. Close-up group hidden with no areas, shown with front-only; 2-file attach → "Attached: 2 photos", 2 thumb cards, dropzone still visible; per-file Remove leaves the other file; packet shows "Property photos — 1 of 4 attached" with the close-up subrow naming its files; draft stores `photos.back_closeup` as a list and restores it as one is-prior line ("re-attach to include them again"); `submissions` carries only the 3 derived keys; no sketches row/checkbox anywhere. Improvements: 3 rows → middle removed → labels 1,2; remove-all re-adds "Improvement 1" (monotonic id 4). Undo/Redo/stamp buttons carry `data-tip` (no `title`), the stamp tooltip's `::after` resolves; Fill renders the 48-box 3-path bucket at stroke 3.8. `node --check` clean on app.js/plot-editor.js; 29/29 geometry tests. Rail tooltip hover-feel and the Fill cursor left for the user's eyeball pass.

## Sprint 13 — Eraser & object lifecycle (items 11–13)

Erasing today is split-brained: right-click / Ctrl+click quick-erase only nulls **grid cells** from any tool, while vector objects (stamps, lines, callouts, measurements) die only to an Erase-mode left click — and annotations are `listening(false)` outside Erase/Select, so a right-click on a stamp erases the paint *under* it instead. There's also no keyboard delete.

- [ ] **One erase resolution, topmost-first** — a single shared routine for both the Erase tool and the right-click gesture: hit-test `drawLayer` for the **topmost vector node** under the pointer; if hit, delete that node only; otherwise erase paint cells. Repeated clicks peel: line first click, paint beneath on the second. Caveat: nodes outside Erase/Select are `listening(false)`, which excludes them from Konva's hit graph (`getIntersection`) — either hit-test geometrically (`getClientRect` walk, top-down) or temporarily flip listening during the test.
- [ ] **Right-click erases objects from any tool** (item 11) — route the `eraseGesture` pointerdown through the shared resolution above, so stamps/lines/callouts right-click-erase exactly like paint does. One undo point per deletion; autosave + packet refresh on commit.
- [ ] **Erase-mode double-action check** (item 12 corollary) — verify a left click on a vector node in Erase mode doesn't *also* start a cell-erase stroke underneath (node click handler and stage pointerdown both fire today); the shared resolution should make the paths mutually exclusive.
- [ ] **Backspace/Delete removes the selection** (item 13) — in the existing plot-visible keydown handler (host-rendered + not-typing guards already there), Backspace or Delete destroys `selectedNode`: record an undo point, `clearSelection()`, autosave, `updateProgress()`.

## Sprint 14 — Callout anatomy: independent label & leader repositioning (item 6)

A callout is one Konva group (Label + free-angle Arrow leader); Select drags it as a unit, so you can't move the text out of the way while keeping the arrow pinned to the thing it points at.

- [ ] **Select-mode sub-part dragging** — dragging the **label** moves only the label (the leader's tail follows the label edge; the anchor/tip stays pinned); a small **tip handle**, shown while the callout is selected, drags the anchor independently.
- [ ] **Persistence + outputs** — label offset and anchor point live in group attrs so `serializePlot()`/`restorePlot()`/undo/`renderPlotImage()` reproduce the geometry; the tail-recompute must run on rehydrate (serialized JSON carries no listeners — same `attachShapeInteractions` gotcha).
- [ ] *(Stretch, from the Sprint 7 deferral)* — resize-on-select for stamps, if the selection-handle plumbing built here makes it cheap.

## Sprint 15 — Submission & data lifecycle (decision sprint; items 2–4)

The three 2026-07-04 architecture questions, researched 2026-07-04 (web pass over current free tiers; MailChannels/Resend/Cloudflare/Cloudinary docs). **Needs a user/HOA decision before any implementation** — this sprint's deliverable is the decision, not code. Absorbs the old "Real submission backend" + "localStorage PII expiry" backlog items.

**Research verdicts (2026-07):**
- **Cloudinary (item 2): feasible but not recommended.** Unsigned upload presets let a static site upload with zero backend (free tier: 25 pooled credits/mo ≈ ~20 GB headroom — plenty). But default assets are **public to anyone with the URL** (randomized ids = unguessable-URL security, not access control; true auth'd delivery needs a backend to sign URLs); anyone holding the preset name can upload junk into the account; and the client's `delete_token` expires **10 minutes** after upload — a homeowner can never later purge photos of their own house. Wrong privacy shape for this data.
- **No form relay carries the packet (item 3).** Photo packets run 10–40 MB; free tiers: Web3Forms/Formspree — no file attachments at all; FormSubmit — 10 MB total; Getform — paid only. Apps Script could, but PII transits a personal Google account and CORS/auth is fiddly. **MailChannels' free Workers integration died 2024-08-31.**
- **The zero-cost path that works: Cloudflare Worker (free) + R2 (free).** Browser POSTs the whole packet (JSON + images) to a Worker → R2 under a 128-bit unguessable key (free tier: 10 GB storage, 1M writes/mo, zero egress, deletes free); the Worker emails the committee a **link, not bytes** — via the Workers `send_email` binding to a *verified destination address* (permanently free; needs Email Routing on a domain + one verification click by the recipient), Resend free tier (100/day, 40 MB) as fallback. Turnstile (free) for spam; an R2 **lifecycle rule** auto-expires packets (e.g. 90 days) for retention hygiene. Recipient address leaves the markup entirely (currently baked into `EMAIL_TO`). Cost: a domain on Cloudflare + an afternoon of Worker code.

**To decide (with the HOA client):**
- [ ] Adopt the Worker+R2 architecture (flips the app from mockup to usable tool; obsoletes the mailto manifest / manual-attachment UX — the packet screen becomes the upload UI) — or stay a zero-transmission mockup and drop items 2–4?
- [ ] **Post-submission journey (item 4)** — keep "offer, don't auto-wipe" for the local draft (we still can't observe delivery, and users revise); if Worker+R2 lands, the draft-cleanup offer pairs with a **receipt link** (same secret URL the committee gets) and a stated expiry, which is also the honest answer to "how do I get my submission back?". PII surface: no third-party form vendor, no Cloudinary; one bucket the HOA controls, auto-expiring.
- [ ] Who owns the Cloudflare account/domain — the HOA, the property manager (FSResidential), or the developer?

## Sprint 16 — Cross-checks & per-category enforcement (backlog promotion, item 10)

- [ ] **Improvements ↔ plot cross-check** (Sprint 9 v2 nicety, sharper since categories) — compare the item list against `plotLegend()` and nudge on mismatches ("you painted Concrete on the plan but no improvement item mentions it"); only structure/hardscape/pool categories are expected on the plan.
- [ ] **Per-category required-field enforcement** (Sprint 11 deferral) — e.g. paint items really do need the color code; plants really do need type & quantity. Today only the name is `[required]`.

## Decision-gated / backlog

- Photo questionnaire partially re-asks what the proposal/plot already express — acceptable; revisit only if users stumble.
