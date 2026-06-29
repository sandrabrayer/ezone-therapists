# Assignment tab (שיבוץ מטפלים): therapist-only — days/hours moved to therapist

## Why
Yarden's job is to assign a therapist to each treatment type. The weekly
days/hours belong to the therapist, who sets them per patient in «המטופלים שלי».
The assignment modal previously mixed both (a weekly slots editor per type).

## What changed
- **public/app.js**
  - `assignmentRowHtml()` no longer renders the weekly slots editor. Each row is
    therapist-only: a therapist dropdown + the locked (read-only) treatment type
    and frequency from the approved plan. Any slots already set by the therapist
    are preserved invisibly via a `data-slots` attribute so re-saving here never
    wipes them.
  - `saveAssignments()` no longer reads/validates slot rows. It assigns the
    therapist per type and passes the preserved `data-slots` through unchanged.
    A row with no therapist is skipped (removes an existing assignment for that
    type), matching prior behaviour.
  - Per-type therapist assignment is unchanged: a patient can have a DIFFERENT
    therapist per treatment type (2–3 therapists per patient).
  - Slot helpers (`slotsEditorHtml`/`slotRowHtml`/`readSlotRows`) are retained —
    they move to the therapist's «המטופלים שלי» scheduling in the next step.
- **public/index.html**
  - Assignment modal subtitle updated: assign a therapist per type here; the
    therapist sets the fixed days/hours in «המטופלים שלי».

## Tests
- **test/plan.test.js**: added three cases on `assignmentPayload` — type/freq are
  forced from the plan entry (never from input), existing slots are carried
  through verbatim, and missing slots are tolerated.
- Full suite green except the 2 pre-existing unrelated failures (gate,
  sheets-secret-forwarding).

## Security
- No endpoint or secret change. The plan remains the read-only authority for
  type+frequency; the therapists app never writes type/freq from user input.
