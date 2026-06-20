# Undo a stop request (restore) + delete a patient + clear orphaned StopFlags

## The bug

A stop-treatment request was a one-way door. Once a patient was flagged
«בקשת הפסקה ממתינה לאישור ורד» (local `stopped='true'` on the Patients row +
a StopFlag on Vered's side), there was **no action to reverse it** — no restore,
no resolve, no delete. The patient was stuck off the active list, and an
**orphaned** StopFlag (one whose phone matched no Client, e.g. test patient יעל
showing *"לא נמצא מטופל תואם"* — the same dropped-leading-zero phone-match class
we've fixed elsewhere) could never be confirmed *or* dismissed.

## What's added

### Restore — undo a pending stop (return to active)
- **`restorePatient`** action → `_restorePatient` (`apps-script/Code.gs`). The
  inverse of `_markPatientStopped`, with the **same fail-closed discipline**:
  resolve the outpatient StopFlag FIRST (`_postResolveStopFlag`), then clear the
  local `stopped*` columns (`_clearLocalPatientStop`). The two sides never desync.
- UI: a **«החזר לפעיל»** button on the stopped/discharged card — shown only when
  `StopFlow.canRestore(p)` (a LOCAL pending flag; a real outpatient discharge
  `סיים טיפול` is owned by outpatient and not undone here).
- Does **not** resurrect the future bookings cancelled at stop time (they were
  deleted) — the therapist re-schedules as needed. The confirm dialog says so.

### Delete — test cleanup
- **`removePatient`** action → `_removePatient`. Resolves the StopFlag (fail-closed)
  then deletes the local Patients row (`_deleteLocalPatient`). Double-guarded by a
  naming confirm; offered only on the stopped list (the cleanup surface).
  Assignments / past bookings are left as-is (remove via the existing
  `removeAssignment` / `removeSchedule`).

### Orphaned-flag handling
- Both actions operate **by phone** (not `patientByPhone`, which only sees active
  patients), so an orphaned flag with no active match is still actionable.
- `resolveStopFlag` clears the StopFlag **by phone alone — no Client join**, and is
  idempotent (no flag → `resolved:0`, still ok) and tolerant of a dropped leading
  zero — so יעל's stuck flag clears.

## Sender / receiver

- **`_postResolveStopFlag`** (therapists `Code.gs`) — server-to-server POST to the
  outpatient `/exec`, mirror of `_postFlagStop`, **fail-closed**, **reusing
  `STOP_FLAG_SECRET`** (no new secret).
- **Receiver patch** for the outpatient app: [`docs/outpatient-resolveStopFlag.patch.md`](docs/outpatient-resolveStopFlag.patch.md)
  (remove/resolve the StopFlag by phone, orphan-safe; shared-secret, fail-closed;
  + reference tests + a recommended StopFlags-UI dismiss action). Tracked as dep #7
  in [`docs/DEPENDENCIES.md`](docs/DEPENDENCIES.md).

## Pure, tested logic (`public/stopflow.js`)

- **`buildResolveStopFlagPayload`** — canonical-phone-out, mirror of
  `buildFlagStopPayload`.
- **`canRestore`** — only a LOCAL pending stop is reversible here.
- `test/stopflow.test.js`: +7 tests (payload canonicalization/rejection, restore
  predicate incl. the discharge-is-not-restorable case). Full suite **182/182**.

## ⚠️ Deploy / ops

- **Therapists Apps Script redeploy** required (new `Code.gs` actions
  `restorePatient` / `removePatient` / `_postResolveStopFlag`).
- **Outpatient Apps Script:** apply [`outpatient-resolveStopFlag.patch.md`](docs/outpatient-resolveStopFlag.patch.md)
  and redeploy. Until then, restore/delete are **fail-closed** — they return an
  error and change nothing (no half-states).
- **Secret:** reuses the existing **`STOP_FLAG_SECRET`** on both Apps Scripts.
  **No new secret, no new Railway env var** (server-to-server, reuses
  `OUTPATIENT_SHEETS_URL`).
