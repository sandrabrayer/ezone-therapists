# Fix — session-outcome push failing `invalid_phone` on numeric-stored phones

## The bug

Marking a session outcome on a `Schedule` row whose `patientPhone` was stored as
a **number** (a legacy cell pre-dating the `'@'` text-format pin, e.g. the
9-digit `523659865` for `0523659865`) made the outpatient pay-sync push fail with
`invalid_phone`. The outcome still saved locally, but the pay-sync was silently
flagged every time.

## Root cause

`_recoverStoredPhone` (mirror of `Phone.recoverStored`) restores the leading zero
Sheets drops when it coerces a canonical phone onto a numeric cell — but it is
only applied automatically inside **`_readAll`**. `_setSessionOutcome` captures
the phone with a **raw-grid read** (`String(grid[found][...])` via its `col()`
helper) that **bypasses `_readAll`**, so the value reached the push as the
9-digit, zero-already-dropped string. The push's canonicalizer
`_toCanonicalPhone` correctly rejects anything not matching `^0\d{9}$`, so it
returned `''` → `invalid_phone`.

The validator is **not** the place to fix this: `_toCanonicalPhone` is the strict
"never send/store a non-canonical number" guard, and `_recoverStoredPhone`'s own
contract is *read-side recovery only, never an entry path*. The fix belongs at
the **read point**, consistent with how `_readAll` and `_matchPhone` already
handle raw cells.

## The fix (one scoped change — recovery-on-read for phone raw-grid reads)

In `apps-script/Code.gs`, route every **raw-grid** phone read through
`_recoverStoredPhone` before use:

- **`_setSessionOutcome`** — new `phoneCol()` helper recovers the dropped zero;
  `patientPhone` now uses it, so `_postSetSessionOutcome` receives the canonical
  key and the push succeeds.
- **`_markAttendance`** (same raw-grid pattern, fixed for consistency):
  - debt re-check — `_verifyPatientDebt(phone)` now gets the recovered phone, so a
    numeric-stored number no longer fails the roster match and **mis-gates a
    legitimate patient to `flagged`/`unverified`**.
  - approvals audit write — the `Approvals` row now records the recovered
    canonical phone instead of a mangled 9-digit number.

`_toCanonicalPhone` is **untouched** — the validator stays strict.

### Not affected

`_postSetClinicalType` shares the same validator but its only caller
(`_saveAssignment`) feeds a **client-supplied** `patientPhone` (sourced from
`_readAll`-recovered roster data), not a raw-grid read — so it was not failing
this way. No change needed there.

## Tests

`test/outcome-sync.test.js` — regression locks via the shared mirrors
(`Phone.recoverStored` + `OutcomeSync.buildPayload`, which `Code.gs` mirrors):

- a numeric-stored `523659865` recovers to `0523659865` and builds a **valid**
  push payload with the canonical phone;
- without recovery, `String(523659865)` is rejected `invalid_phone` (proves the
  bug);
- recovery does **not** rescue genuinely invalid input (`'12345'` stays flagged) —
  the validator remains strict.

Full suite: **166 pass / 0 fail**.

## Deploy

`apps-script/Code.gs` changed — **requires an Apps Script redeploy** after merge
for the fix to take effect. No data migration: existing mangled rows are repaired
on read; the `'@'` text-format pin already keeps new writes canonical.
