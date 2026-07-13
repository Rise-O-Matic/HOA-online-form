/* =========================================================
   Requirements engine (Sprint 25) — the ONE source of truth for
   "what does this application still need."

   Pure and DOM-free (unit-tested in tests/requirements.test.js, same
   discipline as geometry.js / image-budget.js — keep it dependency-free).
   app.js builds the input from live form state (requirementsInput()) and
   feeds the result to every completion consumer: the progress meter, the
   Save & Print step-status overview, the advisory review gate, and the
   printed warning cover. Philosophy unchanged since Sprint 20: advisory,
   never blocking — but never silently optimistic either.

   INPUT SHAPE (all fields optional-tolerant; strings may be empty):
   {
     applicant: { ownerName, propertyAddress, ownerPhone, ownerEmail },
     items: [{ uid, category, action, name, materials, dimensions,
               location, photo }],          // photo: filename list (legacy: string)
     plan: { mode: "build"|"upload", drawn: bool, confirmed: bool,
             uploadNames: [string] },
     photos: {
       areas: { front, back, side, exterior },   // questionnaire checkboxes
       materialAnswer: "yes"|"no"|null,           // null = UNANSWERED (≠ "no")
       shots: [{ id, title, attached: bool }],    // currently-requested photos
     },
     acks: [bool, ...],                           // the 8 acknowledgment checks
     signatureProvided: bool,                     // method-aware (ink or typed)
   }

   OUTPUT — assessApplication(input) returns:
   {
     rows: [{ id, step, label, status }],   // status: one of the four states below
     steps: { <stepId>: { ok, reason, notes: [string] } },
     progress: { done, total, pct },        // required rows only
   }
   Step ids match the form's <section> ids: applicant · description ·
   siteplan · photos-section · acknowledgments.

   NOTE: the acknowledgment DATE is an ASYMMETRIC requirement — it's
   auto-stamped at init (and Sprint 28 re-stamps it at signing), so its
   presence earns no progress row (an empty form honestly reads 0%, not
   "6% complete" off a prefilled date) — but a user can clear it, and a
   blank required date on a printed packet is a real defect, so a
   required-missing row appears ONLY when it's absent.
   ========================================================= */

export const REQUIRED_PRESENT = "required-present";
export const REQUIRED_MISSING = "required-missing";
export const NOT_APPLICABLE = "not-applicable";
export const RECOMMENDED = "recommended";

/* ----- field format checks (moved from app.js so both the engine and the
   inline-error painter share one definition) ----- */
export const PHONE_RE = /^[\d\s().+-]{10,}$/;
export const PHONE_DIGITS_RE = /\d/g;
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$/;
export function validEmail(v) { return EMAIL_RE.test((v || "").trim()); }
export function validPhone(v) {
  const s = (v || "").trim();
  return ((s.match(PHONE_DIGITS_RE) || []).length >= 10) && PHONE_RE.test(s);
}

/* ----- per-category item rules (Section 02) -----
   What each improvement type must include, per the source form's "Must
   Include: Materials, Dimensions, and Example Pictures" block, specialized
   the same way CATEGORIES (app.js) specializes the two field slots — keep
   the `what` labels in sync with CATEGORIES' slot labels. `dims: null`
   means the slot is optional or hidden for that category. A Remove item
   requires nothing beyond its name (its picture is optional too). */
export const ITEM_RULES = {
  structure: { materials: "materials & color", dims: "dimensions" },
  hardscape: { materials: "materials & color", dims: "dimensions / area" },
  landscape: { materials: "plant type & quantity", dims: null }, // mature size stays optional
  paint:     { materials: "color name, code & manufacturer", dims: null },
  equipment: { materials: "make / model", dims: "dimensions / location" },
  pool:      { materials: "materials & finish", dims: "dimensions" },
  other:     { materials: "materials / details", dims: null },
};

// The upload-path plan checklist (source page 6, Design Diagram Requirements) —
// exported so the engine's recommended row and any UI checklist share one list.
export const PLAN_CHECKLIST = [
  "your property outline",
  "the location of every proposed change",
  "dimensions",
  "labels or a color key for each material",
];

const nonEmpty = v => !!(v && String(v).trim());
const photoNames = it => Array.isArray(it.photo) ? it.photo : (it.photo ? [it.photo] : []);
const plural = (n, s, p) => n === 1 ? s : (p || s + "s");

const AREA_LABELS = { front: "front yard", back: "back yard", side: "side yard", exterior: "home exterior" };

export function assessApplication(input) {
  const rows = [];
  const steps = {};
  const add = (id, step, label, status) => { rows.push({ id, step, label, status }); return status; };

  /* ---- 01 Applicant ---- */
  {
    const a = input.applicant || {};
    const fields = [
      ["ownerName", "Homeowner name", nonEmpty],
      ["propertyAddress", "Property address", nonEmpty],
      ["ownerPhone", "Phone number", validPhone],
      ["ownerEmail", "Email address", validEmail],
    ];
    const missing = [];
    fields.forEach(([key, label, okFn]) => {
      const ok = okFn(a[key]);
      add("applicant." + key, "applicant", label, ok ? REQUIRED_PRESENT : REQUIRED_MISSING);
      if (!ok) missing.push(label);
    });
    steps.applicant = {
      ok: !missing.length,
      reason: !missing.length ? ""
        : missing.length <= 2 ? `Still needed: ${missing.join(", ")}.`
        : `${missing.length} required fields still blank or invalid.`,
      notes: [],
    };
  }

  /* ---- 02 Proposed Improvements ---- */
  {
    const items = input.items || [];
    const M = items.length;
    const tally = { unnamed: 0, photo: 0, materials: 0, dims: 0, location: 0 };
    if (!M) {
      add("items.any", "description", "At least one improvement item", REQUIRED_MISSING);
    }
    items.forEach((it, i) => {
      const rules = ITEM_RULES[it.category] || ITEM_RULES.other;
      const removing = it.action === "remove";
      const key = "item." + (it.uid || i + 1);
      const who = `Improvement ${i + 1}${nonEmpty(it.name) ? ` (${String(it.name).trim()})` : ""}`;

      const named = nonEmpty(it.name);
      add(key + ".name", "description", `${who} — what it is`, named ? REQUIRED_PRESENT : REQUIRED_MISSING);
      if (!named) tally.unnamed++;

      if (removing) {
        // A Remove item requires nothing beyond its name; the picture is optional.
        add(key + ".materials", "description", `${who} — ${rules.materials}`, NOT_APPLICABLE);
        if (rules.dims) add(key + ".dims", "description", `${who} — ${rules.dims}`, NOT_APPLICABLE);
        add(key + ".photo", "description", `${who} — picture of what's being removed`, NOT_APPLICABLE);
        add(key + ".location", "description", `${who} — location`, NOT_APPLICABLE);
        return;
      }

      const mat = nonEmpty(it.materials);
      add(key + ".materials", "description", `${who} — ${rules.materials}`, mat ? REQUIRED_PRESENT : REQUIRED_MISSING);
      if (!mat) tally.materials++;

      if (rules.dims) {
        const dims = nonEmpty(it.dimensions);
        add(key + ".dims", "description", `${who} — ${rules.dims}`, dims ? REQUIRED_PRESENT : REQUIRED_MISSING);
        if (!dims) tally.dims++;
      }

      // Source page 2: "Must Include: Materials, Dimensions, and Example Pictures
      // for everything" — an Add/Replace item without a picture is a real gap
      // (advisory here, like everything else; incomplete = returned + denied).
      const pic = photoNames(it).length > 0;
      add(key + ".photo", "description", `${who} — example / catalog picture`, pic ? REQUIRED_PRESENT : REQUIRED_MISSING);
      if (!pic) tally.photo++;

      const loc = nonEmpty(it.location);
      add(key + ".location", "description", `${who} — location on the property`, loc ? REQUIRED_PRESENT : REQUIRED_MISSING);
      if (!loc) tally.location++;
    });

    // One item reads as a needs-list ("Your item still needs a name, materials…");
    // several read as counts ("2 of 3 missing an example picture").
    let reason = "";
    if (!M) reason = "List at least one improvement.";
    else if (M === 1) {
      const gaps = [];
      if (tally.unnamed) gaps.push("a name");
      if (tally.photo) gaps.push("an example picture");
      if (tally.materials) gaps.push("materials");
      if (tally.dims) gaps.push("dimensions");
      if (tally.location) gaps.push("a location");
      if (gaps.length) reason = `Your item still needs ${gaps.join(", ")}.`;
    } else {
      const clauses = [];
      if (tally.unnamed) clauses.push(`${tally.unnamed} of ${M} not yet named`);
      if (tally.photo) clauses.push(`${tally.photo} of ${M} missing an example picture`);
      if (tally.materials) clauses.push(`${tally.materials} of ${M} missing materials`);
      if (tally.dims) clauses.push(`${tally.dims} of ${M} missing dimensions`);
      if (tally.location) clauses.push(`${tally.location} of ${M} missing a location`);
      if (clauses.length) reason = `Of your ${M} items: ${clauses.join("; ")}.`;
    }
    steps.description = { ok: M > 0 && !reason, reason, notes: [] };
  }

  /* ---- 03 Site / Plot Plan ---- */
  {
    const plan = input.plan || {};
    const notes = [];
    let ok, reason = "";
    if (plan.mode === "upload") {
      ok = (plan.uploadNames || []).length > 0;
      add("plan.file", "siteplan", "Plot plan file", ok ? REQUIRED_PRESENT : REQUIRED_MISSING);
      if (!ok) reason = "Upload chosen, but no plot-plan file is attached.";
      // The committee's diagram checklist rides along as a recommendation — it never
      // hard-gates a file that's already attached (we can't inspect the file's content).
      const checklistNote = `Check your plan shows ${PLAN_CHECKLIST.join(", ")} — and is neat and legible.`;
      add("plan.checklist", "siteplan", checklistNote, RECOMMENDED);
      notes.push(checklistNote);
    } else {
      // Build mode: completion is DECLARED (the Draw step's "Done — use this plan"),
      // never inferred from a first stroke.
      ok = !!(plan.drawn && plan.confirmed);
      add("plan.confirmed", "siteplan", "Plot plan drawn and marked done", ok ? REQUIRED_PRESENT : REQUIRED_MISSING);
      if (!ok) {
        reason = plan.drawn
          ? "Plan drawn — press “Done — use this plan” to finish it."
          : "No plot plan yet — draw one, or switch to uploading a file.";
      }
    }
    steps.siteplan = { ok, reason, notes };
  }

  /* ---- 04 Photos ---- */
  {
    const p = input.photos || {};
    const areas = p.areas || {};
    const areasAnswered = Object.values(areas).some(Boolean);
    const materialAnswered = p.materialAnswer === "yes" || p.materialAnswer === "no";
    const shots = p.shots || [];
    const notes = [];

    add("photos.areas", "photos-section", "Which areas does the work touch?",
      areasAnswered ? REQUIRED_PRESENT : REQUIRED_MISSING);
    // An unanswered paint/material radio is UNANSWERED, not "no" — this was the
    // hole that let the demo application read 100% with the question blank.
    add("photos.material-question", "photos-section", "New paint color or exterior material?",
      materialAnswered ? REQUIRED_PRESENT : REQUIRED_MISSING);

    let missingShots = 0;
    shots.forEach(s => {
      add("photo." + s.id, "photos-section", s.title, s.attached ? REQUIRED_PRESENT : REQUIRED_MISSING);
      if (!s.attached) missingShots++;
    });

    // Advisory nudges (never gate):
    const items = input.items || [];
    const paintItem = items.some(it => it.category === "paint" && it.action !== "remove");
    if (paintItem && p.materialAnswer !== "yes") {
      const n = "Your items include a paint / exterior color change — the committee expects a manufacturer's sample, so the material question above is usually “Yes”.";
      add("photos.material-nudge", "photos-section", n, RECOMMENDED);
      notes.push(n);
    }
    const suggest = [...new Set(
      items.filter(it => it.action !== "remove" && AREA_LABELS[it.location] && !areas[it.location])
        .map(it => AREA_LABELS[it.location])
    )];
    if (suggest.length) {
      const n = `Your items are located in the ${suggest.join(" and ")}, but ${plural(suggest.length, "that area isn't", "those areas aren't")} selected in the questionnaire above.`;
      add("photos.area-suggest", "photos-section", n, RECOMMENDED);
      notes.push(n);
    }

    let reason = "";
    if (!areasAnswered && !materialAnswered) reason = "Answer the two questions to see which photos are needed.";
    else if (!materialAnswered) reason = "Answer the paint / exterior-material question — it decides whether a sample photo is needed.";
    else if (!areasAnswered) reason = "Pick which areas the work touches to see the photos needed.";
    else if (missingShots) reason = `${missingShots} of ${shots.length} requested ${plural(shots.length, "photo")} still to attach.`;
    steps["photos-section"] = { ok: !reason, reason, notes };
  }

  /* ---- 05 Acknowledgments ---- */
  {
    const acks = input.acks || [];
    let unchecked = 0;
    acks.forEach((checked, i) => {
      add("ack." + (i + 1), "acknowledgments", `Acknowledgment ${i + 1}`, checked ? REQUIRED_PRESENT : REQUIRED_MISSING);
      if (!checked) unchecked++;
    });
    const signed = !!input.signatureProvided;
    add("signature", "acknowledgments", "Owner signature", signed ? REQUIRED_PRESENT : REQUIRED_MISSING);
    // Asymmetric on purpose (see the header NOTE): the auto-stamped date emits a row
    // only when it's been cleared — presence earns nothing, absence is a real gap.
    const dated = nonEmpty(input.ackDate);
    if (!dated) add("ack.date", "acknowledgments", "Acknowledgment date", REQUIRED_MISSING);
    steps.acknowledgments = {
      ok: !unchecked && signed && dated,
      reason: unchecked ? `${unchecked} of ${acks.length} acknowledgments still to check.`
        : !signed ? "Sign the acknowledgment — draw or type your full legal name."
        : !dated ? "Fill in the date next to your signature." : "",
      notes: [],
    };
  }

  /* ---- progress: required rows only ---- */
  const req = rows.filter(r => r.status === REQUIRED_PRESENT || r.status === REQUIRED_MISSING);
  const done = req.filter(r => r.status === REQUIRED_PRESENT).length;
  const total = req.length;
  let pct = total ? Math.round((done / total) * 100) : 0;
  // Never round up to a false "100% complete": with enough rows, one missing
  // requirement can still round to 100 — hold at 99 until everything is present.
  if (pct === 100 && done < total) pct = 99;

  return { rows, steps, progress: { done, total, pct } };
}
