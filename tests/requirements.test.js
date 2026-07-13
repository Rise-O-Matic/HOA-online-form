/* Unit tests for assets/requirements.js — the pure requirements engine (Sprint 25),
   the single source of truth for "what does this application still need." Run with
   `node --test`.

   The interesting properties: category-aware item rules (materials/dimensions/example
   picture per type; a Remove item needs only its name), the photo questionnaire's
   material radio counting as UNANSWERED when null (the hole that let the demo read
   100%), plan build/upload/third-state reasons, recommended rows never gating, and
   the progress math counting required rows only (so an empty form reads 0%). */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assessApplication, ITEM_RULES, PLAN_CHECKLIST,
  REQUIRED_PRESENT, REQUIRED_MISSING, NOT_APPLICABLE, RECOMMENDED,
  validEmail, validPhone,
} from "../assets/requirements.js";

/* ----- input builders ----- */
const applicant = (over = {}) => ({
  ownerName: "Mike Smith", propertyAddress: "11506 Aaron Ave",
  ownerPhone: "951-555-0100", ownerEmail: "mike@example.com", ...over,
});
const item = (over = {}) => ({
  uid: "iu-1", category: "structure", action: "add", name: "Patio cover",
  materials: "Alumawood, tan", dimensions: "12 x 24 ft", location: "back",
  photo: ["catalog.jpg"], ...over,
});
const fullInput = (over = {}) => ({
  applicant: applicant(),
  items: [item()],
  plan: { mode: "build", drawn: true, confirmed: true, uploadNames: [] },
  photos: {
    areas: { front: false, back: true, side: false, exterior: false },
    materialAnswer: "no",
    shots: [{ id: "back_wide", title: "Back yard — full view", attached: true }],
  },
  acks: [true, true, true, true, true, true, true, true],
  signatureProvided: true,
  ...over,
});
const emptyInput = () => ({
  applicant: {},
  items: [{ uid: "iu-1", category: "structure", action: "add", name: "", materials: "", dimensions: "", location: "", photo: [] }],
  plan: { mode: "build", drawn: false, confirmed: false, uploadNames: [] },
  photos: { areas: {}, materialAnswer: null, shots: [] },
  acks: Array(8).fill(false),
  signatureProvided: false,
});

const rowById = (res, id) => res.rows.find(r => r.id === id);

/* ----- overall shape ----- */

test("a complete application: every step ok, progress 100%", () => {
  const res = assessApplication(fullInput());
  assert.ok(Object.values(res.steps).every(s => s.ok), JSON.stringify(res.steps));
  assert.equal(res.progress.pct, 100);
  assert.equal(res.progress.done, res.progress.total);
});

test("an empty form reads 0%, not 6% off a prefilled date", () => {
  const res = assessApplication(emptyInput());
  assert.equal(res.progress.done, 0);
  assert.equal(res.progress.pct, 0);
  assert.ok(Object.values(res.steps).every(s => !s.ok));
  // no acknowledgment-date row exists at all — it's auto-stamped, not a user task
  assert.ok(!res.rows.some(r => /date/i.test(r.id)));
});

/* ----- applicant ----- */

test("applicant format checks: bad email/phone are required-missing, and named in the reason", () => {
  const res = assessApplication(fullInput({
    applicant: applicant({ ownerEmail: "not-an-email", ownerPhone: "123" }),
  }));
  assert.equal(rowById(res, "applicant.ownerEmail").status, REQUIRED_MISSING);
  assert.equal(rowById(res, "applicant.ownerPhone").status, REQUIRED_MISSING);
  assert.equal(res.steps.applicant.ok, false);
  assert.match(res.steps.applicant.reason, /Phone number, Email address/);
});

test("validEmail / validPhone", () => {
  assert.ok(validEmail("a@b.co"));
  assert.ok(!validEmail("a@b"));
  assert.ok(validPhone("(951) 801-4246"));
  assert.ok(!validPhone("801-4246")); // 7 digits
});

/* ----- items: category rules ----- */

test("structure/hardscape/pool/equipment require materials AND dimensions", () => {
  for (const category of ["structure", "hardscape", "pool", "equipment"]) {
    const res = assessApplication(fullInput({
      items: [item({ category, materials: "", dimensions: "" })],
    }));
    assert.equal(rowById(res, "item.iu-1.materials").status, REQUIRED_MISSING, category);
    assert.equal(rowById(res, "item.iu-1.dims").status, REQUIRED_MISSING, category);
    assert.equal(res.steps.description.ok, false, category);
  }
});

test("landscape: plant type & quantity required, mature size optional (no dims row)", () => {
  const res = assessApplication(fullInput({
    items: [item({ category: "landscape", materials: "", dimensions: "" })],
  }));
  assert.equal(rowById(res, "item.iu-1.materials").status, REQUIRED_MISSING);
  assert.equal(rowById(res, "item.iu-1.dims"), undefined);
});

test("paint: color code required, no dimensions row, unknown category falls back to `other`", () => {
  const res = assessApplication(fullInput({
    items: [item({ category: "paint", materials: "", dimensions: "" })],
  }));
  assert.equal(rowById(res, "item.iu-1.materials").status, REQUIRED_MISSING);
  assert.equal(rowById(res, "item.iu-1.dims"), undefined);
  // future/unknown category id degrades to `other` rules instead of crashing
  const res2 = assessApplication(fullInput({ items: [item({ category: "solar-farm" })] }));
  assert.equal(rowById(res2, "item.iu-1.materials").status, REQUIRED_PRESENT);
});

test("a Remove item requires nothing beyond its name", () => {
  const res = assessApplication(fullInput({
    items: [item({ action: "remove", materials: "", dimensions: "", location: "", photo: [] })],
  }));
  assert.equal(rowById(res, "item.iu-1.name").status, REQUIRED_PRESENT);
  assert.equal(rowById(res, "item.iu-1.materials").status, NOT_APPLICABLE);
  assert.equal(rowById(res, "item.iu-1.photo").status, NOT_APPLICABLE);
  assert.equal(rowById(res, "item.iu-1.location").status, NOT_APPLICABLE);
  assert.equal(res.steps.description.ok, true);
});

test("example picture is required for Add/Replace items (the Sprint 20 de-gate, reversed)", () => {
  for (const action of ["add", "replace"]) {
    const res = assessApplication(fullInput({ items: [item({ action, photo: [] })] }));
    assert.equal(rowById(res, "item.iu-1.photo").status, REQUIRED_MISSING, action);
    assert.match(res.steps.description.reason, /example picture/);
  }
});

test("legacy single-string photo still counts as attached", () => {
  const res = assessApplication(fullInput({ items: [item({ photo: "old-draft.jpg" })] }));
  assert.equal(rowById(res, "item.iu-1.photo").status, REQUIRED_PRESENT);
});

test("step reason counts gaps across items ('2 of 3 missing…')", () => {
  const res = assessApplication(fullInput({
    items: [
      item({ uid: "a" }),
      item({ uid: "b", materials: "", photo: [] }),
      item({ uid: "c", photo: [] }),
    ],
  }));
  assert.match(res.steps.description.reason, /2 of 3 missing an example picture/);
  assert.match(res.steps.description.reason, /1 of 3 missing materials/);
});

test("no items at all is itself a gap", () => {
  const res = assessApplication(fullInput({ items: [] }));
  assert.equal(rowById(res, "items.any").status, REQUIRED_MISSING);
  assert.equal(res.steps.description.ok, false);
});

/* ----- plot plan ----- */

test("build mode: drawn but not confirmed is a distinct third state", () => {
  const drawn = assessApplication(fullInput({ plan: { mode: "build", drawn: true, confirmed: false, uploadNames: [] } }));
  assert.equal(drawn.steps.siteplan.ok, false);
  assert.match(drawn.steps.siteplan.reason, /Done — use this plan/);
  const nothing = assessApplication(fullInput({ plan: { mode: "build", drawn: false, confirmed: false, uploadNames: [] } }));
  assert.match(nothing.steps.siteplan.reason, /No plot plan yet/);
});

test("upload mode: file gates; the diagram checklist is recommended and never gates", () => {
  const missing = assessApplication(fullInput({ plan: { mode: "upload", drawn: false, confirmed: false, uploadNames: [] } }));
  assert.equal(missing.steps.siteplan.ok, false);
  assert.match(missing.steps.siteplan.reason, /no plot-plan file/);
  const attached = assessApplication(fullInput({ plan: { mode: "upload", drawn: false, confirmed: false, uploadNames: ["plan.pdf"] } }));
  assert.equal(attached.steps.siteplan.ok, true);
  assert.equal(rowById(attached, "plan.checklist").status, RECOMMENDED);
  assert.equal(attached.steps.siteplan.notes.length, 1);
  // every checklist element rides in the note
  for (const piece of PLAN_CHECKLIST) assert.ok(attached.steps.siteplan.notes[0].includes(piece));
});

/* ----- photos ----- */

test("an unanswered material radio is UNANSWERED, not 'no' (the demo hole)", () => {
  const res = assessApplication(fullInput({
    photos: {
      areas: { back: true }, materialAnswer: null,
      shots: [{ id: "back_wide", title: "Back yard", attached: true }],
    },
  }));
  assert.equal(rowById(res, "photos.material-question").status, REQUIRED_MISSING);
  assert.equal(res.steps["photos-section"].ok, false);
  assert.match(res.steps["photos-section"].reason, /paint \/ exterior-material question/);
  assert.ok(res.progress.pct < 100);
});

test("both questions unanswered → one combined prompt; unattached shots are counted", () => {
  const blank = assessApplication(fullInput({ photos: { areas: {}, materialAnswer: null, shots: [] } }));
  assert.match(blank.steps["photos-section"].reason, /Answer the two questions/);
  const some = assessApplication(fullInput({
    photos: {
      areas: { back: true }, materialAnswer: "no",
      shots: [
        { id: "a", title: "A", attached: true },
        { id: "b", title: "B", attached: false },
        { id: "c", title: "C", attached: false },
      ],
    },
  }));
  assert.match(some.steps["photos-section"].reason, /2 of 3 requested photos still to attach/);
});

test("a paint item nudges the material question (recommended, non-gating)", () => {
  const res = assessApplication(fullInput({
    items: [item({ category: "paint", dimensions: "", location: "exterior" })],
    photos: {
      areas: { exterior: true }, materialAnswer: "no",
      shots: [{ id: "x", title: "X", attached: true }],
    },
  }));
  assert.equal(rowById(res, "photos.material-nudge").status, RECOMMENDED);
  assert.equal(res.steps["photos-section"].ok, true); // nudge never gates
  assert.equal(res.steps["photos-section"].notes.length, 1);
  // answered "yes" → no nudge
  const yes = assessApplication(fullInput({
    items: [item({ category: "paint", dimensions: "" })],
    photos: { areas: { exterior: true }, materialAnswer: "yes", shots: [{ id: "x", title: "X", attached: true }] },
  }));
  assert.equal(rowById(yes, "photos.material-nudge"), undefined);
});

test("item locations cross-suggest unchecked questionnaire areas (deduped, non-gating)", () => {
  const res = assessApplication(fullInput({
    items: [item({ uid: "a", location: "front" }), item({ uid: "b", location: "front" })],
    photos: {
      areas: { back: true }, materialAnswer: "no",
      shots: [{ id: "x", title: "X", attached: true }],
    },
  }));
  const row = rowById(res, "photos.area-suggest");
  assert.equal(row.status, RECOMMENDED);
  assert.match(row.label, /front yard/);
  assert.ok(!/front yard.*front yard/.test(row.label)); // deduped
  assert.equal(res.steps["photos-section"].ok, true);
});

/* ----- acknowledgments ----- */

test("unchecked acks and the missing signature both gate, acks reason first", () => {
  const res = assessApplication(fullInput({
    acks: [true, false, true, true, true, false, true, true],
    signatureProvided: false,
  }));
  assert.match(res.steps.acknowledgments.reason, /2 of 8 acknowledgments/);
  const signedNot = assessApplication(fullInput({ signatureProvided: false }));
  assert.match(signedNot.steps.acknowledgments.reason, /Sign the acknowledgment/);
});

/* ----- progress math ----- */

test("recommended and not-applicable rows never count toward progress", () => {
  const res = assessApplication(fullInput({
    plan: { mode: "upload", drawn: false, confirmed: false, uploadNames: ["plan.pdf"] },
    items: [item({ action: "remove", materials: "", dimensions: "", location: "", photo: [] })],
  }));
  const counted = res.rows.filter(r => r.status === REQUIRED_PRESENT || r.status === REQUIRED_MISSING);
  assert.equal(res.progress.total, counted.length);
  assert.equal(res.progress.pct, 100); // remove-item n/a rows + the checklist don't dilute
});

test("ITEM_RULES covers every category the form offers", () => {
  for (const id of ["structure", "hardscape", "landscape", "paint", "equipment", "pool", "other"]) {
    assert.ok(ITEM_RULES[id], id);
    assert.ok(ITEM_RULES[id].materials.length > 0, id);
  }
});
