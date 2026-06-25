# Schedule modal — restrict to the therapist's assigned patients + lock the plan type

Closes a generic-toolbar bypass in «קביעת טיפול». The modal opened from
`#mineScheduleBtn` (`openScheduleModal()` with no prefill) let a therapist
autocomplete over the **entire** patient roster and pick **any** treatment type.
Two fixes, both enforced in the UI **and** at submit (never fail open).

> **Rebase note (PR #28 → live).** PR #28 was branched before Iteration 19 (#25)
> merged. This is #28 re-applied on top of the current live branch. Iteration 19's
> **assignment-modal** plan lock is preserved **100%** (`planForPhone`,
> `Plan.assignmentPayload`, the read-only `a-type-lock`/`a-freq-lock` rows). #28's
> schedule-modal type-lock **supersedes the schedule-side `scheduleLockedType`
> only** — that path is removed; the assignment modal is untouched.

## (1) Patient picker restricted to assigned-only — individual AND group

- The schedule-row datalists (`.patient-name-dl` / `pdl{idx}`) are populated from
  **`assignedPatients()`** — `activePatients()` filtered by
  `p.therapists.indexOf(state.therapist) !== -1` (the `renderMine` rule) — instead
  of the full roster. The intake picker (`#rosterNames`) stays full (Vered
  registers anyone).
- **Submit validation** (`handleScheduleSubmit` → `Scheduling.validateScheduledPatients`):
  every entered patient must be in the assigned set, matched by canonical phone
  key. An unassigned patient — even inside a **group** session — blocks the save
  with «ניתן לקבוע טיפול רק למטופל/ת המשויך/ת אליך». No group exception.
- **No assigned patients:** the modal shows «אין לך מטופלים משויכים» and disables
  submit, instead of presenting the full list.
- Picking an assigned patient by name auto-fills their phone.

## (2) Treatment type locked to the patient's approved plan (individual path)

For an **individual** session the schedule type is locked to the patient's
assigned plan types (`Scheduling.assignedTypesForPatient`; on live these mirror
Iteration 19's approved-plan types, since assignments are saved per plan type):

- One type → `#scheduleType` **locked** read-only.
- Several → the dropdown offers **only** those types (never the global list).
- None / cannot verify → **blocked** (submit disabled + `#schedulePlanLock` note),
  never fail open.

`readSession` reads the type from the live `#scheduleType` element (a disabled
locked select is omitted from `FormData`). **Group sessions are exempt** from the
type lock — the shared group type stays selectable while the patient set is still
restricted to assigned-only.

## Pure helpers + tests

New framework-free helpers in `public/scheduling.js`, mirrored by the app wiring
and unit-tested in `test/scheduling.test.js` (+8): `assignedToTherapist`,
`assignedTypesForPatient`, `planLockState`, `validateScheduledPatients`. Coverage:
picker restricted to assigned (incl. group), submit blocks an unassigned patient
(incl. inside a group), individual type must match the plan (legacy מרכז יום ↔
ליווי יומי בקהילה relabel honored), no-approved-plan blocks, group is exempt from
the type match. Full suite **241/0** (Iteration 19's 20 plan tests + the scheduling
tests all green).

## Preserved
Iteration 19's **שיבוץ assignment-modal plan lock** (one locked row per type,
`Plan.assignmentPayload`, `a-type-lock`/`a-freq-lock`), per-patient «+ קביעת טיפול»
flow, debt gate, group multi-patient mechanics (now constrained to the assigned
set), phone normalization, therapist-locked-to-self. **Frontend-only** — no Apps
Script, secret, or Railway change; no backend redeploy.
