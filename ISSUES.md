# Initial Issues List

1. ~~Printable version of the signature form to replace built-in signature fields~~
2. ~~Notice at the end explaining what happens next (committee reviews, contacts for payment if approved)~~
3. Examples of good and bad photography — **structure in place** (per-photo ✓/✗ placeholder frames in the Photos section, Section 05); real comparison images still pending
4. ~~Signing their own name digitally is fine~~
5. ~~Remove color-coded plan or key checkbox~~
6. ~~Don't hide the photo requirements modal~~
7. ~~Drawing on the plot plan should be draggable~~
8. ~~Hook up to Google Maps API or similar, have property align with grid~~
9. ~~On acknowledgements checkbox 1, add links to those resources~~
10. ~~Research the First Service Residential Connect API~~
11. ~~Change Carol Taylor to CarolMarie Taylor throughout; change "How to Submit" to "How to submit signature forms"~~
12. ~~Include checks on email and phone number formatting~~
13. ~~"Email to committee" shouldn't automatically invoke the print dialogue~~
14. ~~Reformat the output as a 1-page~~

## Pending

- **#3** — Photography examples: good vs. bad. The Photos section (Section 05) now shows a ✓ Do this / ✗ Not this placeholder frame for each requested photo. Replace the placeholder frames with real comparison images.

## Sprint log

- **Sprint 0 (2026-07-02)** — baseline housekeeping, complete. Committed the outstanding grid-painter/auto-align working tree as a clean anchor; rewrote `README.md` (correct `master` branch, current feature description, points to CLAUDE.md/ROADMAP.md); moved the source PDF to `docs/source-form.pdf` and updated its mention in CLAUDE.md. Next: Sprint 1 (packet assembly & submission ending).
- **Sprint 1 (2026-07-02)** — packet assembly & submission ending, complete. Added Section 08 "Review & Submit": a live "Your packet" ✓/✗ list (form PDF, plot plan, each requested photo by name, signed neighbor form, sketches) plus a guided two-step finish (Save PDF → Open pre-addressed email) that replaces the old three-button submit bar. Emailing now soft-gates on packet completeness (missing-items modal with explicit override), and the mailto body carries an attachment manifest so applicant and reviewer can both verify the packet. Section 06's plot/photos/neighbor rows became live derived status rows (sketches + fee stay manual); `collect()` derives `req_plot`/`req_photos`/`req_neighbors` from real app state. JSON export moved to the sidenav; both email buttons now validate via one shared flow. Verified in-browser: packet list/Section 06 rows react to the photo questionnaire, soft-gate lists per-photo gaps, no console errors. Untested by automation (needs the user's eyes): the actual print-dialog Save-as-PDF and the mailto handoff to a mail client. Next: Sprint 2 (workflow temporality & friction).
