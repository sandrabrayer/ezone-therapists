# Iteration 19 — lock שיבוץ + scheduling to Vered's approved outpatient plan (PER TREATMENT TYPE)

## Summary

The therapists app is now **fully READ-ONLY on the treatment plan**. The
**approved outpatient plan** (`getTreatmentPlans` → `state.plans`) is the
**single source of truth** for a patient's **treatment types** and their
**per-type weekly frequency**. A patient's plan can hold **several treatment
types**, each with its **own weekly frequency** and assignable to a **different
therapist** — the `sessions` JSON-blob **keys ARE the treatment types**
(e.g. `{"מרכז יום":3,"טיפול משפחתי":1}` = two types). The plan is therefore
projected as a **LIST of `{treatmentType, frequencyPerWeek}`** and the שיבוץ modal
renders **one locked row per type**. Neither Yarden (assignment) nor a therapist
(scheduling) can pick or edit type/frequency; both flows **BLOCK** (never fail
open) when there is no single approved plan to read.

This is a **`public/` + tests change only**. The Apps Script backend needs **no
change**: `_saveAssignment` already persists whatever `treatmentType` /
`frequencyPerWeek` the payload carries — now the frontend sends the
**plan-sourced** values. Deploys via Railway on commit; **no Apps Script
redeploy**.

## New module — `public/plan.js`

Pure, framework-free, UMD (browser global `Plan` + `require` under `node --test`),
mirroring `roster.js` / `recurring.js`:

- **`typesFromSessions(sessions, serviceType)`** → `Array<{treatmentType,
  frequencyPerWeek}>`. A JSON-blob `type→count` map (object or `"{...}"` string) →
  **one entry per key** (the keys are the types; a multi-type plan yields multiple
  entries, **never summed/collapsed**). A **scalar** `sessions` + a `serviceType` →
  a single entry for that type. Empty / unparseable / scalar-without-serviceType →
  `[]`.
- **`forPhone({ phone, plans, plansOk })`** → the **array** of per-type entries for
  the one plan matching `phone`, or `null` — "cannot verify, must BLOCK" — for **no
  match**, an **ambiguous multi-match**, **`!plansOk`**, or a matched plan that
  yields **zero types**. Matches the **raw** `plans` list (so multi-match is
  detectable). **Never fails open.**
- **`blockMessage(plan, plansOk)`** → the Hebrew block copy: **no approved plan**
  (`אין תוכנית טיפול מאושרת — על ורד להגדיר תחילה תוכנית במערכת הקליטה`) when plans
  are available, **cannot verify** (`לא ניתן לאמת את תוכנית הטיפול כעת …`) when they
  are down; `null` when a (non-empty) plan is present.
- **`assignmentPayload({ entry, id, patientPhone, therapist, slots, updatedBy })`**
  → an assignment row whose `treatmentType` + `frequencyPerWeek` are **FORCED** from
  the given **plan-type `entry`**. The function takes **no** type/freq argument of
  its own, so a saved row can never carry a user-entered value.

`app.js` adds thin wrappers `planForPhone(phone)` / `planBlockMessage(plan)`.

## Change 1 — שיבוץ assignment modal

- `openAssignmentsModal` renders **one locked row per plan type** from `forPhone`.
  Each row shows that type + its frequency **read-only** (`svc()`-relabeled), a
  `.a-therapist` select, and a slot editor sized to **that type's** frequency. An
  existing assignment is matched to its plan type **by `treatmentType`** to pre-fill
  therapist + slots; unassigned types render empty. **No `+ הוסף שיבוץ` free-add**
  and **no per-row remove** — the rows are **exactly** the plan's types. `data-type`
  pins each row to its plan type.
- `saveAssignments` builds **one payload per type row** via
  `Plan.assignmentPayload(thatTypeEntry, …)`; slot validation uses **that type's**
  locked frequency (`Recurring.validateSlots(filled, planFreq)`). A type left
  unassigned (blank therapist, no slots) is skipped → its existing assignment is
  removed by the unchanged removal logic; `clinicalSync` warnings unchanged.
- **BLOCK rule:** `openAssignmentsModal` (+ defensive re-check in `saveAssignments`)
  block when `planForPhone` is `null`. The dead `syncSlotEditor` / `addAssignmentRow`
  / `freqOptions` and the `.a-freq` / `.remove-assignment` / add-button wiring were
  removed.

## Change 2 — "המטופלים שלי" scheduling (`+ קביעת טיפול`)

- The treatment **type + frequency** are **LOCKED** to the **specific plan type the
  therapist is working**: the per-patient button prefills the assignment held by
  `state.therapist` (falling back to the first), and `openScheduleModal` locks the
  type to that plan-type entry (`#scheduleType` disabled; a `#schedulePlanLock` note
  shows the approved type + frequency). The therapist enters **only** day/date +
  time + location.
- `readSession` derives the type from the locked entry (`scheduleLockedType`);
  `handleScheduleSubmit` enforces, **per patient**, that the session type is **one
  of that patient's approved plan types**, else **BLOCK** (same messages). This also
  covers the generic toolbar entry where the type select stays editable.
- The existing "המטופלים שלי" patient filter (`state.therapist`'s assigned
  patients) is **preserved exactly** — not widened.

## Preserved (constraints)

All cross-app wiring intact: `apiSaveAssignment`, clinical-type sync
(`clinicalSyncWarning`), the debt gate + per-patient approval, phone
normalization, and the Apps Script server-authoritative re-checks. No backend
change.

## Tests — `test/plan.test.js` (+20)

`forPhone` (single-type / multi-type per-type counts / no-match / ambiguous
multi-match / scalar+serviceType / zero-types / `!plansOk` / blank),
`typesFromSessions` (single + multi-type / scalar±serviceType / empty),
`blockMessage` (no-plan vs cannot-verify vs none — the block in both flows),
`assignmentPayload` (type+freq forced from ONE entry; a stray type/freq field
cannot leak in; zero-frequency → empty), and a **2-type plan → 2
independently-assignable rows** with different therapists + per-type frequency.
