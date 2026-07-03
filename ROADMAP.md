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

## Sprint 4 — Code health

`app.js` is a 3,100-line IIFE mixing ~1,400 lines of computational geometry with form plumbing; zero tests over the riskiest code.

- [ ] **Extract pure geometry + unit tests** — `floodFill` helpers, `segmentsIntersect`, `connectorBlocked`, `buildParcelGrid`, `fitSimilarity`, `computeAutoAlignBearing` are deterministic and pure; test with `node:test` (Node already required for `tools/fetch-streets.mjs`). This is the cheapest insurance against silent geometry regressions that `node --check` can't catch.
- [ ] **ES-module split** — `<script type="module">` works on GitHub Pages with no build step. Target: geometry / plot editor / map wizard / form+persistence. Do this *after* tests exist, not before.
- [ ] Update CLAUDE.md architecture section to match the new file layout (part of the sprint, not an afterthought).

## Sprint 5 — Accessibility & mobile

- [ ] **Non-canvas alternative for the owner signature** (typed-name attestation or the same print-and-attach path neighbors use). The canvas pad is the only required interaction with no keyboard/AT alternative.
- [ ] **Touch/mobile pass** — homeowners will open this on phones: drag-to-rotate, 8-px-tile painting, sidenav layout, pinch-zoom on the plot stage.
- [ ] Keyboard access review for the map wizard and drawing tools (document what's infeasible; ensure the upload path remains a complete keyboard-only route).

## Decision-gated / backlog

- **Real submission backend** — a minimal endpoint (Cloudflare Worker or a form-relay service) accepting the JSON + files would flip the app from mockup to usable tool and obsolete much of Sprint 1's manual-assembly UX. Needs a hosting/ownership decision with the HOA client first. Sprint 1 is still worth doing: the packet-review screen becomes the upload UI.
- localStorage PII expiry policy (beyond clear-on-submit).
- Photo questionnaire partially re-asks what the proposal/plot already express — acceptable; revisit only if users stumble.
