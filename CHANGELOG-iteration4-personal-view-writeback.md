# Changelog — iteration 4: personal view + did-it-happen + outpatient write-back

Adds a third tab, the treatment-completion flow, the first cross-app **write**,
and four fixes. All existing cross-app wiring, the debt gate, phone
normalization, the Ron/Sandra approval + audit, and conventions are preserved.

## New tab «המטפל שלי»

A therapist picks their name from the Therapists dropdown — **no PIN** (friendly
entry; the per-patient payment check deters false reporting, and *no mark = no
pay*). Shows only that therapist's treatments, bucketed into **past-due-to-mark
/ this week / upcoming**, each markable happened / didn't-happen. Marking is open
to viewers too (this is the self-service view); the editor-only attendance
buttons in שיבוץ are unchanged.

## Did-it-happen → outpatient write-back

Marking saves locally first (**source of truth**), then the therapists Apps
Script syncs the whole session to outpatient's new `recordTreatmentGiven`
endpoint (shared secret `TREATMENT_GIVEN_SECRET`).

- **Idempotent by treatment id** — re-sending on retry never double-counts.
- **Group (קבוצה) = ONE therapist-payment record at the group rate**, not one per
  patient, while per-patient attendance is still captured (patient billing is per
  patient). The whole session is rebuilt on every mark, so **unmark/edit can't
  drift** downstream pay.
- **Reliability** — local mark is never dropped; if outpatient is unreachable the
  row is left `syncStatus='pending'`, surfaced as "ממתין לסנכרון" with a
  **«סנכרן עכשיו»** retry (`syncPending` action) that also runs on refresh.

New pure module `public/writeback.js` builds the payload and is mirrored inline
by `apps-script/Code.gs` (`_buildSessionWriteback`). The outpatient side is a
documented patch:
[`docs/outpatient-recordTreatmentGiven.patch.md`](docs/outpatient-recordTreatmentGiven.patch.md)
(new `TreatmentsGiven` sheet + required-secret POST action). Registered as
dependency #4 in `docs/DEPENDENCIES.md`.

### Backend

- `Schedule` sheet += `syncStatus`, `syncedAt`. `markAttendance` saves locally
  then calls `_syncSession` (build → POST → stamp status on every session row).
  New `syncPending` action retries all pending sessions.

## Four fixes

1. **«ליווי יומי בקהילה» missing as a plan option** — root cause: the relabel
   (מרכז יום → ליווי יומי בקהילה) is display-only and the new term wasn't in the
   `TreatmentTypes` list, so it wasn't selectable. Fixed by seeding
   «ליווי יומי בקהילה», relabeling the type-dropdown *labels* (value preserved),
   and resolving a legacy/roster `מרכז יום` to the selectable option on the edit
   form.
2. **New-patient registration didn't flow to שיבוץ מטפלים** — שיבוץ now renders a
   patient list (assign + schedule), sharing the dashboard's delegated handler,
   so a just-registered patient is actionable there immediately.
3. **Filter treatments by therapist AND by patient** — added a therapist filter
   to שיבוץ (applies to the patient list and the scheduled treatments) alongside
   the existing patient-name search.
4. **Did-it-happen** — delivered by tab 3 (above).

## Tests

`npm test` — 65 passing. New `test/writeback.test.js` covers: group = one
therapist-payment record (per-patient attendance still captured), idempotency by
treatment id, unmark adjusting the group payment (no drift), and offline-sync
(`sessionsNeedingSync`). All prior tests still pass.
