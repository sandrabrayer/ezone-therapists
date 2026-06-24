# Iteration 19 — lock שיבוץ + scheduling to Vered's approved outpatient plan

## Summary

The therapists app is now **fully READ-ONLY on the treatment plan**. The
**approved outpatient plan** (`getTreatmentPlans` → `state.plans` →
`Roster.build`) is the **single source of truth** for a patient's **treatment
type** and **weekly frequency**. Neither Yarden (assignment) nor a therapist
(scheduling) can pick or edit those values anymore — they are projected from the
plan and locked. When there is **no single approved plan to read**, both flows
**BLOCK** rather than fail open.

This is a **`public/` + tests change only**. The Apps Script backend needs **no
change**: `_saveAssignment` already persists whatever `treatmentType` /
`frequencyPerWeek` the payload carries — now the frontend sends the
**plan-sourced** values. Deploys via Railway on commit; **no Apps Script
redeploy**.

## New module — `public/plan.js`

Pure, framework-free, UMD (browser global `Plan` + `require` under `node --test`),
mirroring `roster.js` / `recurring.js`:

- **`forPhone({ phone, plans, plansOk })`** → `{ serviceType, frequency }` or
  `null`. Normalizes `phone` via `Phone.normalizeForMatch`, matches against the
  **raw** `plans` list (not the deduped roster, so an **ambiguous multi-match** is
  detectable). Returns `null` — "cannot verify, must BLOCK" — for **no match**,
  **multi-match**, or **`!plansOk`** (plans endpoint down). **Never fails open.**
- **`freqFromSessions(sessions)`** → number. A JSON-blob `type→count` map (object
  or `"{...}"` string) is **SUMMED across all types** so a **multi-type** plan
  keeps every weekly session (it is **not collapsed** to one type); a scalar is
  taken as-is; empty/garbage → `0`.
- **`blockMessage(plan, plansOk)`** → the Hebrew block copy: **no approved plan**
  (`אין תוכנית טיפול מאושרת — על ורד להגדיר תחילה תוכנית במערכת הקליטה`) when plans
  are available, **cannot verify** (`לא ניתן לאמת את תוכנית הטיפול כעת …`) when they
  are down; `null` when a plan is present.
- **`assignmentPayload({ plan, id, patientPhone, therapist, slots, updatedBy })`**
  → an assignment row whose `treatmentType` + `frequencyPerWeek` are **FORCED**
  from the plan. The function takes **no** type/freq argument **by design**, so a
  saved row can never carry a user-entered value.

`app.js` adds thin wrappers `planForPhone(phone)` / `planBlockMessage(plan)` that
inject `state.plans` / `state.plansOk`.

## Change 1 — שיבוץ assignment modal

- `assignmentRowHtml` **removes** the `.a-type` and `.a-freq` `<select>`s. The
  approved **type + frequency** are shown **read-only** (`svc()`-relabeled), and
  the plan frequency drives the weekly slot count (`slotsEditorHtml(slots, freq)`).
- Yarden edits **only** `.a-therapist` and the weekly slots.
- `syncSlotEditor` no longer reads `.a-freq` — it reads the **locked plan
  frequency** (`assignmentsCtx.plan.frequency`).
- `saveAssignments` sets `treatmentType` / `frequencyPerWeek` from the plan via
  `Plan.assignmentPayload` (not from any input). Existing slot validation
  (`Recurring.validateSlots(filled, planFreq)`), the multi-row remove logic, and
  the `clinicalSync` warning handling are **untouched**.
- **BLOCK rule:** `openAssignmentsModal` (and, defensively, `saveAssignments`)
  block when `planForPhone` is `null` — the no-plan message when `state.plansOk`,
  the cannot-verify message when `!state.plansOk`. Save + "add row" are disabled.

## Change 2 — "המטופלים שלי" scheduling (`+ קביעת טיפול`)

- The treatment **type + frequency** are **LOCKED** from `planForPhone(patient.phone)`
  and shown read-only (`#scheduleType` disabled; a `#schedulePlanLock` note shows
  the approved type + frequency). The therapist enters **only** day/date + time +
  location.
- `readSession` derives the type from the patient's plan (never the cosmetic,
  disabled field — same pattern as the already-locked therapist field).
- `handleScheduleSubmit` enforces the plan **per patient** before the debt gate:
  every patient must have a verifiable plan, else **BLOCK** (same messages as
  Change 1). This also covers the generic toolbar entry where the type select has
  no patient yet. The saved schedule rows carry the **plan-sourced** type.
- The existing "המטופלים שלי" patient filter (`state.therapist`'s assigned
  patients) is **preserved exactly** — not widened.

## Preserved (constraints)

All cross-app wiring intact: `apiSaveAssignment`, clinical-type sync
(`clinicalSyncWarning`), the debt gate + per-patient approval, phone
normalization, and the Apps Script server-authoritative re-checks. No backend
change.

## Tests — `test/plan.test.js` (+17)

`forPhone` (match / no-match / ambiguous multi-match / JSON-blob multi-type SUM /
`!plansOk` / blank), `freqFromSessions` (single + multi-type sum / scalar /
empty), `blockMessage` (no-plan vs cannot-verify vs none — the block in both
flows), and `assignmentPayload` (type+freq forced from the plan; a stray
type/freq field cannot leak in; zero-frequency → empty).
