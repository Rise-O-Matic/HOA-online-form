# Roadmap

Distilled from a full-project critique (2026-07-02): architecture, robustness, and user-workflow reviews. Work proceeds **one sprint at a time** — see the working agreement in `CLAUDE.md`. Each sprint is sized to roughly one working session. Don't renumber sprints; mark items done (`~~strikethrough~~` or ✅) and log outcomes in `ISSUES.md`.

**The through-line:** the form is excellent at *collecting* (landing, wizard, photo questionnaire) but treats *assembling and delivering the packet* as the user's problem — and the HOA's own rules make incompleteness unforgiving (auto-denial, 45-day clock never starts). Sprints 1–2 fix that. Sprints 3–5 pay down robustness, code-health, and accessibility debt.

---

## Sprint 0 — Baseline (housekeeping, small)

- [ ] Commit the outstanding working tree (the Konva grid-painter rework + CLAUDE.md updates) so sprints start from a clean anchor.
- [ ] Rewrite `README.md` (~10 lines): live branch is `master`, feature list still describes the pre-map-wizard plot painter. Remove the need for CLAUDE.md's "distrust the README" disclaimer.
- [ ] Optional: move `416603fe-...pdf` to `docs/source-form.pdf` (nothing in the code references it; update the mention in CLAUDE.md).

## Sprint 1 — Packet assembly & the submission ending (highest impact)

The submit bar's primary-styled "Email to Committee" opens an *empty* email; the successful path (Preview → Save as PDF → find file → reopen email → manually attach PDF + photos + neighbor form) is ~8 steps across 3 apps that the UI never states, and `validate()` doesn't require a plot, photos, or the neighbor form even though the copy threatens auto-denial for incomplete packets.

- [ ] **Packet review screen** — a final "Your packet" step/panel listing every artifact with live ✓/✗ status: form PDF, plot plan (drawn `plotUsed()` or uploaded `#plot-upload`), each requested photo by name, signed neighbor form (`#neighbor-form-file`), sketches. `collect()` already knows all of it.
- [ ] **Guided two-step finish** — "1. Save your PDF → 2. Open pre-addressed email," replacing three coequal buttons. Sequence matters: PDF must exist before the email opens.
- [ ] **Soft-gate submission** — "Email to Committee" warns with a list of missing packet items and allows explicit override; don't hard-block.
- [ ] **Attachment manifest in the mailto body** — enumerate exactly which files to attach (from `collect()`'s filename data) so applicant and reviewer can both verify completeness.
- [ ] **Derive Section 06 from app state** — the self-attestation checkboxes duplicate what the app knows (photos attached? plot drawn/uploaded? neighbor form present?). Auto-check or cross-check with warnings; turn the section into a live completeness dashboard.
- [ ] Move "Download data (JSON)" out of the primary submit bar (tuck into sidenav or remove).
- [ ] Fix inconsistency: preview-modal `#do-email` skips `validate()`; the submit-bar `#email-btn` doesn't.

## Sprint 2 — Workflow temporality & friction

The form looks single-sitting but embeds multi-day loops (neighbor wet signatures, daytime photos), and the Draw step frontloads a nine-tool manual nobody reads.

- [ ] **Save-and-return messaging** at Sections 04 (neighbors) and 05 (photos): "print now → collect signatures → come back and attach; your draft is saved."
- [ ] **Per-tool contextual hints** in the Draw step — one hint line near the canvas that changes with the selected tool ("Paint: drag to fill · Shift for a straight line"), replacing the wall-of-text intro paragraph.
- [ ] **Progress meter counts packet items** — include plot, photos, neighbor form, not just `[required]` fields; "100%" must not be reachable with an empty packet.
- [ ] `startBuilder()` empty-address error: also scroll to and focus `#property-address`.
- [ ] Default `#ack-date` to today.
- [ ] Graceful build→upload bail-out: a user who abandons drawing mid-wizard should land in the upload path without feeling like they're starting over.
- [ ] ISSUES #3 — replace the ✓/✗ photo placeholder frames with real comparison images (content task; needs images from the user).

## Sprint 3 — Robustness & external-dependency hardening

Five external services, unpinned or unguaranteed, sit under a public form.

- [ ] **Vendor Konva + MapLibre into `assets/vendor/`** (or at minimum pin `konva@10` to an exact version + add SRI hashes). `konva@10` is a floating major tag — production behavior can change without a commit.
- [ ] **Visible autosave failure** — `saveDraft(true)` swallows quota errors; add a persistent "draft not saving" indicator (signature PNGs + plot state can approach the ~5 MB localStorage quota).
- [ ] **County GIS failure story** — friendly error + route to the upload path when the Riverside ArcGIS endpoints are down/changed (currently only Konva-load failure has a fallback).
- [ ] **Draft lifecycle** — offer to clear the draft (PII incl. signature image) after successful submission; reconcile the version drift (`DRAFT_KEY` is v4, `plot.version` is 3).

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
