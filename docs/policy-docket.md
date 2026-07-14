# Policy docket — questions for the Architectural Review Committee

**What this is.** This web form was rebuilt from the association's printed application
(`docs/source-form.pdf`, "Updated May 2026"). While rebuilding it we found places where the
source form contradicts itself, is ambiguous, or where the web form asserted things the
source never says. Each entry below is **one decision we need from the ARC / the
Architectural Specialist**. Until a decision comes back, the app ships the **provisional
position** noted in each entry (chosen 2026-07-13, Sprint 24) — nothing is blocked, but
every provisional position should be confirmed or corrected before this form is treated as
official.

**Second source added 2026-07-13:** `docs/submission-process-email.md` — the office's own
email explaining the updated process, supplied by the user. It settles items 2, 3, and 6
below without waiting on the ARC; those entries are updated in place with a note.

Line numbers are as of the Sprint 24 commit (2026-07-13) and will drift; the element ids /
quoted copy are the stable anchors. The three items the submission-process email settled
outright landed in **Sprint 29** (2026-07-13); the remaining ARC-only items are
**Sprint 30** in `ROADMAP.md`, where returned answers get applied.

---

## 1. Form authority — is this the official application?

- **Where it surfaces:** landing "How to submit" card (`index.html:105`); the demo/mockup
  banner and footer ("Unofficial online mockup", `index.html:632`).
- **What the source says:** page 6: "Required Architectural Application when submitting any
  modification requests." The source is the *printed* form; it says nothing about a web
  version.
- **Provisional position (shipped):** the app presents itself as a **prototype** that
  "prepares a complete packet based on the association's May 2026 application" and tells
  the applicant to confirm acceptance with the office. The earlier claim that this online
  form is "the current, required application — older or printed versions are not accepted"
  was removed (it contradicted the app's own mockup banner, and the source never says it).
- **Decision requested:** Is this form officially adopted? If yes: we remove the mockup
  framing, and every policy statement in the app needs a sign-off (see Sprint 29). If no:
  the prototype framing stands.
- **2026-07-14 update:** deliberately not being escalated to the ARC/office yet — per the
  user, that relationship hasn't built enough trust for this ask yet. Stays TBD; prototype
  framing stands until that changes. No timeline attached.

## 2. Fee timing — when is the application fee collected?

- **Where it surfaces:** landing checklist fee bullet (`index.html:87`); landing "Fees &
  payment" card (`index.html:121`); Section 06 finish-step note (`index.html:602`); "What
  Happens Next" (`index.html:624`); printed cover, submission step 4
  (`assets/app.js`, `buildInstructionsHTML`).
- **What the source says:** page 6, *Application Fee*: "Once your complete application is
  submitted, you will need to arrange payment of the required fee with Carol. **The review
  process will not begin until both the full application and the fee are received.**"
- **Provisional position (shipped):** all five locations now tell the same story — *no
  payment is due when you apply; once the Architectural Specialist confirms the application
  is complete she contacts you to arrange payment; review does not begin until both the
  complete application and the fee are received.* (Two locations previously said the fee
  is collected only **after approval** — that contradicted the source and was rewritten.)
- **Decision requested:** confirm the completeness-triggered story (or supply the real
  office workflow — e.g. whether payment can precede the completeness check, and accepted
  payment methods).
- **2026-07-13 update — confirmed by `docs/submission-process-email.md`:** the shipped
  provisional position is correct. "Payment will only be taken after the ARCH Specialist
  has reviewed your application and confirmed it is complete... Payment will not be
  processed for incomplete applications." Also new: payment is *never* taken at the office
  counter — Carol calls the applicant, or the applicant provides card details by email.
  No further decision needed unless the office wants that office-counter exclusion stated
  explicitly in the app too.

## 3. Incomplete-application outcome — what actually happens?

- **Where it surfaces:** landing lead (`index.html:76`); "How to submit" card
  (`index.html:108`); advisory gate modal (`index.html:681`); printed warning cover
  (`assets/app.js`, `buildWarningCoverHTML`).
- **What the source says — two different things:**
  - page 1: "An application submitted without all required submissions will be considered
    incomplete. In such cases, the Architectural Review Committee's forty-five (45) day
    review period **will not commence** until all required submissions have been provided."
    (i.e., it *waits*.)
  - page 6: "incomplete applications **will not be accepted**" · "Incomplete applications
    will be **returned and automatically denied**" · "Any application missing required
    information will be **returned immediately**." (i.e., it *dies*.)
- **Provisional position (shipped):** one phrase everywhere — "**returned and automatically
  denied**" (page 6 is the newer instruction sheet, and the harsher reading is the safer
  thing to tell an applicant). The page-1 45-day-clock language was removed from
  incomplete-outcome copy; the 45-day period is mentioned only in its positive form ("the
  45-day review period begins once everything is received").
- **Decision requested:** which outcome is true? (Or both — e.g. returned immediately, and
  denied only if not cured by the deadline?) The wording should then be corrected
  everywhere at once.
- **2026-07-13 update — partially settled by `docs/submission-process-email.md`:** it
  describes a middle ground neither page alone states: an incomplete application is
  "returned" generally (implying correction + resubmission is possible within the cycle),
  but one submitted incomplete **on the deadline date itself** gets no review that cycle
  and must resubmit the following month — "No exceptions will be made." Still open: what
  "returned" means for an incomplete application submitted *before* the deadline (does the
  45-day clock wait, per page 1, or does it die outright, per page 6's "automatically
  denied")? Recommend adopting the deadline-day framing as the confirmed hard rule and
  keeping the pre-deadline question open.
- **2026-07-14 note:** the user finds the deadline-day-bump rule counterintuitive (their
  reaction: if submitting exactly on the deadline gets auto-bumped a cycle, why not just
  define the deadline as the day before?). That's a critique of the office's own policy,
  not new information about it — the email's wording stands as the confirmed hard rule
  above and no app copy changes from this. Worth relaying to the office if the relationship
  ever gets to that point (see item 1); the pre-deadline incomplete-outcome question is
  still open.

## 4. Neighbor-signature scope — who exactly must sign?

- **Where it surfaces:** landing checklist signatures bullet (`index.html:86`); the printed
  cover's adjacent-owner signature strip (`assets/app.js`, `buildNeighborStripHTML` — six
  blank rows).
- **What the source says — two different things:**
  - page 1 (directions): "Signatures from **all impacted neighbors**."
  - page 3 (the signature form itself): "Signatures of **adjacent property owners most
    affected by the change**" — six signature slots; plus the note "The signature of
    adjacent property owner does not constitute approval or disapproval."
- **Provisional position (shipped):** the page-3 wording — "adjacent property owners most
  affected by the change" — because it is the wording printed on the form the neighbors
  actually sign, and "all impacted neighbors" is unboundedly broad.
- **Decision requested:** a definition the applicant can act on. Adjacent = sharing a lot
  line? Across the street too? Is six rows enough, and are fewer than six signatures
  acceptable when a lot has fewer adjacent owners? Does a rear-yard change need the
  front-facing neighbors at all?
- **2026-07-14 update — user guidance (not ARC-confirmed, informal):** the user is confident
  the real standard is **sightline-based**, not lot-line-based — it includes neighbors
  across the street, and the office is not strict or specific about the exact boundary in
  practice. Shipped copy updated (`index.html:86`) to say "generally anyone with a direct
  view of it, including neighbors across the street; the committee isn't strict about the
  exact boundary." Six rows still treated as a soft ceiling, not a hard requirement — still
  worth a real confirmation once item 1 is answered, but no longer flagged as unsourced
  guesswork.

## 5. The definitive photo matrix — which photos are required when?

- **Where it surfaces:** Section 04's questionnaire-driven photo requests
  (`assets/app.js`, `PHOTO_SPECS` / `PHOTO_CLOSEUP` / `PHOTO_MATERIAL`); landing checklist
  photos bullet (`index.html:85`).
- **What the source says — garbled and partially contradictory:**
  - page 1: "Full yard photos viewing the entire yard (**back corners facing house**,
    entire left and right sides of the yard). taken from street facing house capture full
    width of the yard and one of each side)" *(sic — the parenthetical doesn't parse).*
  - page 6, *Photo Requirements*: Front Yard "(3 photos total)" — one from the middle of
    the street showing property line to property line with no vehicles or people, one from
    the curb on each side. Back Yard "(**4 photos total**)" — one from the furthest point
    away from the home showing the full yard, one from each side capturing the entire
    yard. *(That enumerates only 3 back-yard shots; the 4th is unstated. Page 1's "back
    corners", plural, suggests two corner shots.)*
- **Provisional position (shipped):** the questionnaire asks which areas the work touches
  and requests per-area shots — **3 front / 3 back** (full-yard + each side; no rear-corner
  shot exists in the app today, pending answer (b) below) / sides / exterior — plus
  close-ups of each work area and a material sample when a new paint color or exterior
  material is introduced. The landing/Section 04 copy no longer claims we tell
  you "**exactly** which photos to take" — softened to "the photos the committee needs"
  until this matrix is confirmed.
- **Decision requested:** (a) are the front + back overview sets mandatory for *every*
  application, or only when that area is affected? (b) what is the 4th back-yard photo?
  (c) are work-area close-ups additional to the overviews or a substitute? (d) when are
  side-yard / home-exterior shots required?
- **2026-07-14 update — user guidance (not ARC-confirmed, informal):** the user confirms the
  vagueness is real, not a gap in our reading of the source — the office wants photos
  **germane to the specific project**, and doesn't work from (or want) a rigid enumerated
  list, because edge cases make a fixed list impractical. This confirms the shipped
  questionnaire-driven, per-area-affected approach is the right shape and should **stay
  advisory rather than becoming a strict checklist** — do not pursue restoring the "exactly
  which photos to take" claim (`ROADMAP.md:391`) even after item 1 is resolved. (b)/(c)/(d)
  remain genuinely open detail questions, but they're now second-order — the app's existing
  "photos the committee needs" framing already matches how the office actually thinks about
  this.

## 6. Three claims the source does not support — verify or keep dropped

All three appeared in earlier versions of this app; none appear in the source form. All
three were **removed in Sprint 24** (provisional: don't assert what we can't source).
If any is actually office policy, say so and we'll restore it as sourced copy.

| # | Dropped claim | Where it lived | What the source actually says |
|---|---|---|---|
| a | "Older or printed versions of the form are not accepted." | landing "How to submit" | Nothing about versions. (Page 6: "All applications must be submitted by email only.") |
| b | "No other staff member will accept applications." | landing "How to submit" | Email-only submission to carolmarie.taylor@fsresidential.com — nothing about other staff. |
| c | "She is not available for meetings on the deadline day itself." | gate modal | "You must schedule an appointment if you need to meet with Carol in person" + "It is strongly recommended that you visit the office before the deadline date." |

- **Decision requested:** confirm or deny each; sourced versions get restored verbatim.
- **2026-07-13 update — all three confirmed by `docs/submission-process-email.md`:**
  (a) "Old versions will not be accepted under any circumstances." (b) "No other staff
  member will be accepting applications." (c) "Carol will not be available for meetings on
  the deadline day." All three should be **restored as sourced copy** — see the ROADMAP.md
  Sprint 29 note for the copy task; this is no longer blocked on the ARC, since the
  office's own email is the source.

## 7. (Recorded, not blocking) Specialist name & title

- **What the source says:** page 1 signs the contact as "Carolmarie Taylor …
  Community DRC Specialist"; page 6 says "Carol Taylor, Sr. Architectural Specialist."
- **Provisional position (shipped):** "CarolMarie Taylor, Sr. Architectural Specialist"
  everywhere (the email address is carolmarie.taylor@…; page 6 is the newer sheet's
  title). Informal "Carol" references in app copy were normalized.
- **Decision requested:** preferred public name + current title, so the packet's contact
  lines are right.
