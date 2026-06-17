# Iteration 18 (step 2) — three-state session outcome (storage-only)

## What & why

Until now a therapist could only mark a session **happened / didn't-happen**
(`attendance` = `occurred` / `missed`), where "didn't" collapsed two very
different realities into one free-text reason. This step introduces an explicit
**three-state session outcome** the therapist picks per session instance:

| stored token          | Hebrew label             | meaning                          |
| --------------------- | ------------------------ | -------------------------------- |
| `happened`            | התקיים                   | the treatment took place         |
| `therapist_cancelled` | המטפל ביטל / לא הגיע      | the therapist cancelled / no-show |
| `patient_no_show`     | המטופל לא הגיע            | the patient didn't show          |

**Storage-only by design.** Marking an outcome records a stamped row and does
**nothing else** — no debt gate, no pay computation, no outpatient write-back.
Wiring the outcome to therapist pay / the outpatient receiver is **step 3**.

## The stamp

Every outcome is stamped with the full session identity so the stored row is
self-describing: **patient** (`patientName` + `patientPhone`), **therapist**,
**treatmentType**, **date** (`scheduledDate`), **outcome**, and a **timestamp**
(`outcomeAt`, ISO). Identity keys (`id`, `sessionId`) are carried too.

## Where it lives

- **`public/outcome.js`** (new) — the pure, framework-free model: the closed set
  of three values, `isValid` (rejects everything else, incl. the legacy
  `occurred`/`missed` and empty), `labelFor` (Hebrew, display-only), and
  `buildOutcome(row, outcome)` → stamped record. Loaded in `index.html`, used by
  `app.js`, guarded by `test/outcome.test.js`. **Mirrored inline** by
  `apps-script/Code.gs:_setSessionOutcome`; the allowed-value list must stay in
  sync on both sides.
- **`apps-script/Code.gs`** — two new appended columns on `SCHEDULE_HEADERS`
  (`outcome`, `outcomeAt`) and a new `_setSessionOutcome(payload)` action: it
  validates the outcome against the closed set (`invalid_outcome` otherwise),
  materializes a virtual recurring occurrence first (idempotent by id, like the
  report flow), stamps `outcome` + `outcomeAt` on the row, and **returns without
  any `_syncSession` / write-back**. Registered in `doPost` as
  `action: 'setSessionOutcome'`.
- **`public/app.js`** — `normalizeScheduleRow` reads `outcome`/`outcomeAt`;
  `apiSetSessionOutcome` posts the new action; `outcomeChip` renders the stored
  outcome; `markOutcome`/`commitOutcome` do the optimistic one-click record (with
  rollback on failure). In «המטופלים שלי» the two binary buttons are **replaced**
  by a 3-state picker generated from `Outcome.VALUES` (so the UI can't drift from
  the allowed set); the chosen outcome is highlighted. Vered's oversight line now
  shows the outcome chip too.
- **`public/style.css`** — `.outcome-picker` / `.outcome-btn.is-active` styling
  (RTL, dark theme; active color matches the chip: ok / warn / bad).

The legacy `markAttendance` / `writeback.js` / `_syncSession` path is left
**intact and untouched** (its UI buttons are no longer surfaced, but the handler
and functions remain) so **step 3** can wire the outcome to pay and the
outpatient receiver.

## Tests

`test/outcome.test.js` (new): exactly three values accepted and **everything
else rejected** (incl. `occurred`/`missed`/empty); the stamp carries all required
fields; default ISO timestamp; `sessionId` falls back to row id; a session can be
marked and re-marked (last write wins); storage-only (no `given`/`isPayment`/
`rate` fields leak in); Hebrew labels. Full suite stays green
(`npm test` — 147 tests). The existing schedule/assignment/writeback tests are
unaffected.

## Deploy / ops

- **Apps Script redeploy REQUIRED.** `Code.gs` changed (new columns + new
  action), so the therapists Apps Script `/exec` must be redeployed for
  `setSessionOutcome` to exist. The two new columns are appended safely by
  `_ensureSheet` (append-only header rule) — existing rows keep their data and
  get empty `outcome`/`outcomeAt`.
- **No new Railway env vars.** The Node server only proxies actions through to
  Apps Script (`POST /api/sheets`); no server change was needed.
- **No outpatient-side work** in this step (that's step 3).
