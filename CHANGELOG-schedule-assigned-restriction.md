# Schedule modal — restrict to the therapist's assigned patients + lock the plan type

Closes a generic-toolbar bypass in «קביעת טיפול». The modal opened from
`#mineScheduleBtn` (`openScheduleModal()` with no prefill) let a therapist
autocomplete over the **entire** patient roster and pick **any** treatment type.
Two fixes, both enforced in the UI **and** at submit (never fail open).

## (1) Patient picker restricted to assigned-only — individual AND group

- The schedule-row datalists (`.patient-name-dl` / `pdl{idx}`) are now populated
  from **`assignedPatients()`** — `activePatients()` filtered by
  `p.therapists.indexOf(state.therapist) !== -1` (the same rule `renderMine`
  uses) — instead of the full roster. The intake picker (`#rosterNames`) is left
  on the full roster (Vered registers anyone).
- **Submit validation** (`handleScheduleSubmit`): every entered patient must be in
  the assigned set, matched by canonical phone key. An unassigned patient — even
  one added inside a **group** session — blocks the save with
  «ניתן לקבוע טיפול רק למטופל/ת המשויך/ת אליך». There is **no** group exception.
- **No assigned patients:** the modal shows «אין לך מטופלים משויכים» and the
  submit button is disabled, instead of presenting the full list.
- Picking an assigned patient by name auto-fills their phone, so the gate and the
  assigned-only check key off the right record.

## (2) Treatment type locked to the patient's approved plan (individual path)

The type was an editable, empty dropdown on the generic path (and only *prefilled*,
still editable, on the per-patient path — the "already-locked" machinery the task
referenced did **not** exist; it was built here). For an **individual** session:

- One approved plan type → `#scheduleType` is **locked** read-only to it.
- Several → the dropdown offers **only** that patient's assigned types (never the
  global list).
- None / cannot verify → **blocked** (submit disabled + a `#schedulePlanLock`
  note), never fail open.

`readSession` now reads the type from the live `#scheduleType` element (a disabled
locked select is omitted from `FormData`). **Group sessions are exempt** from the
type lock per product decision — the shared group type stays selectable while the
patient set is still restricted to assigned-only.

## Pure helpers + tests

New framework-free helpers in `public/scheduling.js`, mirrored by the app wiring
and unit-tested in `test/scheduling.test.js` (+8): `assignedToTherapist`,
`assignedTypesForPatient`, `planLockState`, `validateScheduledPatients`. Coverage:
picker restricted to assigned (incl. group), submit blocks an unassigned patient
(incl. inside a group), individual type must match the plan (legacy מרכז יום ↔
ליווי יומי בקהילה relabel honored), no-approved-plan blocks, group is exempt from
the type match. Full suite **221/0**.

## Preserved
Per-patient «+ קביעת טיפול» flow, debt gate, group multi-patient mechanics
(now constrained to the assigned set), phone normalization, therapist-locked-to-
self. **Frontend-only** — no Apps Script, secret, or Railway change; no redeploy
of the backend required (ship the updated `public/`).
