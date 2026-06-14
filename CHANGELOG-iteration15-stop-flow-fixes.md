# Changelog — iteration 15: stop-flow fixes (local move + rename)

Two fixes on the patient stop flow shipped in iteration 14.

## 1. Section rename (framing)

The dashboard section is now **«מטופלים שביקשו לסיים טיפול»** (was
«מטופלים שהופסקו / סיימו טיפול») — «הפסקת טיפול» creates a **request pending
Vered's confirmation**, not a completed discharge. The toast
(«נשלחה בקשת הפסקה לאישור ורד»), the confirm dialog, and the per-row reason
(«בקשת הפסקה ממתינה לאישור ורד» vs «סיים טיפול (מטופלי חוץ)» for an
already-discharged patient) already used that framing and are unchanged.

## 2. The local move / cancellation didn't happen for mangled phones — fixed

### Root cause

Iteration 13 added **leading-zero recovery** to the READ path (`_readAll`) and the
client load, repairing a phone Sheets had stored as a number (`501234567` for
`"0501234567"`). But the iteration-14 stop backend matches rows by reading the
**raw sheet grid** and calling `_normalizePhoneForMatch` **without**
`_recoverStoredPhone`. So for any patient whose stored phone was mangled — exactly
the data iteration 13 exists for — the canonical key `0501234567` never equalled
the stored `501234567`, and:

- **`_markLocalPatientStopped`** did not find the existing Patients row, so it
  **appended a duplicate** "stopped" row instead of updating in place; and
- **`_cancelFutureBookings`** did not match the patient's Schedule rows, so their
  **future bookings were never cancelled**.

The flagStop POST still succeeded (so the request reached Vered and the success
toast fired), which is why it looked like "sent OK but nothing moved locally."
The pure `stopflow.js` matcher had the same gap (it assumed the caller had already
recovered the phones).

### Fix

- **`Code.gs`** — new `_matchPhone(raw) = _normalizePhoneForMatch(_recoverStoredPhone(raw))`,
  used on **both** sides of every comparison in `_markLocalPatientStopped` and
  `_cancelFutureBookings`. The existing Patients row is now updated **in place**
  (no duplicate) and the patient's future unreported bookings are cancelled, even
  when the stored phone lost its leading zero.
- **`_markLocalPatientStopped`** also no longer declares a helper function inside
  the row loop (poor practice in the V8 runtime) — it finds the row, then writes
  the stop columns.
- **`public/stopflow.js`** — `futureBookingsToCancel` recovers both the key and
  each row's phone (`recoverStored` → `normalizeForMatch`) so the pure matcher is
  correct regardless of whether the caller pre-recovered.
- **`splitStopped`** — new pure partition (`{active, stopped}`) used by
  `activePatients()` / `stoppedPatients()`, making the local move a single tested
  unit.

## Tests

`test/stopflow.test.js` adds: future bookings are cancelled when the stored phone
lost its leading zero (numeric + 9-digit-string forms); `splitStopped` moves
flagged patients and keeps the rest active; a just-flagged patient
(`localStopped:'true'`) classifies as stopped (the move). `npm test` — all passing
(111 with deps installed).

## Deploy

`Code.gs` changed (`_matchPhone` + the two matchers) → **Apps Script redeploy
required** (Manage deployments → Edit → New version). The rename + `stopflow.js`
+ `splitStopped` are frontend-only and ship with the normal web deploy.
