# Sub-step 3b: therapist weekly fixed-schedule + patient time-collision block

## Why
The therapist sets the fixed weekly days/hours (and location/room) for their own
patients, in «המטופלים שלי». A patient can't be in two treatments at once, so a
slot that lands on a weekday+time already taken by another of the patient's
assignments must be blocked.

## What changed
- **public/recurring.js**
  - New `patientSlotConflict({candidateSlots, otherAssignments})`: blocks any
    candidate slot whose weekday+time matches a slot on ANOTHER of the patient's
    assignments, and also blocks duplicates within the candidate set itself.
    Returns the offending weekday+time. Exported on the Recurring API.
- **public/app.js**
  - `myPatientsRow`: added a «לוז שבועי קבוע» button per patient.
  - New weekly-schedule modal flow: `openWeeklyModal` renders the signed-in
    therapist's own assignment(s) for the patient, each with a slot editor sized
    to the approved plan frequency (day/time/location/room). `saveWeekly`
    validates each block (`Recurring.validateSlots`), runs `patientSlotConflict`
    against the patient's OTHER assignments, then persists slots on the
    assignment via `saveAssignment`. Single-session postpone remains via «עריכה»
    on a materialized occurrence.
  - Wired `data-weekly-patient`, `#weeklySave`, and `closeWeeklyModal`.
- **public/index.html**: added the `#weeklyModal` markup.
- **public/style.css**: styles for the weekly blocks and the slot room input.

## Tests
- **test/recurring.test.js**: 5 cases on `patientSlotConflict` — same weekday+time
  on another assignment blocked; different time or weekday allowed; duplicate
  within the candidate set blocked; no-others always ok. Full suite green except
  the 2 pre-existing unrelated failures.

## Security
- No endpoint/secret change. Frontend validates collisions; the plan stays the
  read-only authority for type/frequency. (Server-side collision enforcement can
  be added later if needed; the assignment write itself is already gated.)

## Deploy note
- Frontend only — Railway auto-deploy. No Apps Script redeploy needed.

