# Outpatient patch — `recordSessionOutcome` cross-app WRITE endpoint

**Target repo:** `sandrabrayer/ezone-outpatient` · **File:** `apps-script/Code.gs`
**Status:** therapists **SENDER is live** (this PR). The only remaining work is on
the **outpatient** side: implement/confirm the `recordSessionOutcome` receiver
below, set `SESSION_OUTCOME_SECRET` (same value as the therapists Script
Property) and redeploy the outpatient Apps Script.

When a therapist marks what actually happened to a session in the therapists app
(«המטופלים שלי» → outcome), the marked **session outcome** is pushed here so
outpatient computes the therapist **pay / session status per outcome**. Same
shared-secret, server-to-server model as `setClinicalType` / `recordTreatmentGiven`
/ `flagStop`, on `doPost`.

## Contract

`POST` with `?action=recordSessionOutcome&secret=<SESSION_OUTCOME_SECRET>`. The
full object is **also** sent in the JSON body (the therapists sender mirrors both,
so the receiver can read from `e.parameter` or the body):

```jsonc
{
  "action": "recordSessionOutcome",
  "secret": "<SESSION_OUTCOME_SECRET>",
  "sessionId": "sess-abc123",            // upsert key — re-marking re-sends the same id
  "phone": "0501234567",                 // canonical 10-digit leading-zero key
  "therapist": "דנה",                    // session therapist (for pay)
  "clinicalTreatmentType": "פסיכודינמי", // the session's clinical type
  "date": "2026-06-18",                  // scheduledDate (yyyy-MM-dd)
  "outcome": "happened"                  // one of the three closed tokens (below)
}
```

The `outcome` is exactly one of the **closed** three-state tokens:

| token                 | meaning                           |
| --------------------- | --------------------------------- |
| `happened`            | the treatment took place          |
| `therapist_cancelled` | the therapist cancelled / no-show |
| `patient_no_show`     | the patient didn't show           |

**`frequency` is intentionally NOT sent.** The therapists Schedule row doesn't
carry it (weekly frequency lives on the Assignment, not the booking), so for a
ליווי-style outcome where pay would depend on frequency, **outpatient handles its
absence** — the therapists side never invents it.

### Response — the therapists side keys off this exactly (never fail-open)

| Response | Meaning | Therapists UI |
| -------- | ------- | ------------- |
| `{ ok:true }` | outcome recorded, pay/status computed | proceeds silently |
| `{ ok:false, reason:"unknown_therapist" }` | therapist not recognised | outcome kept locally, **warns** |
| `{ ok:false, reason:"unknown_type" }` | type not a billable clinical type | outcome kept locally, **warns** |
| `{ ok:false, error:"unauthorized" }` | missing/!match secret | outcome kept locally, **warns** |

Only an explicit `{ ok:true }` is success (there is no `matched` count — outpatient
**upserts by `sessionId`**). Anything else — `ok:false`, a non-2xx status, an
unreachable endpoint, or an unset secret — is surfaced to the therapist as a
Hebrew flag (`unconfigured` / `http_<code>` / `unreachable` / `non_ok`). The local
outcome **always stands**; only the pay-sync is flagged.

**Idempotent:** re-marking the same session re-sends the same `sessionId`;
outpatient **upserts** on it, so a corrected outcome overwrites the prior pay
computation. No therapists-side dedupe.

## Auth

Script Property **`SESSION_OUTCOME_SECRET`** (separate from the other secrets so
it rotates independently). Reject the write when the property is unset or the
`?secret=` doesn't match (`{ ok:false, error:"unauthorized" }`) — writes are
never open.

## Code — add to `apps-script/Code.gs`

```javascript
/* ===== recordSessionOutcome (cross-app WRITE endpoint) =====
 * Written by E-Zone Therapists when a therapist marks a session outcome.
 * Computes therapist pay / session status PER OUTCOME and upserts by sessionId.
 * Auth: REQUIRED shared secret 'SESSION_OUTCOME_SECRET' (writes are never open).
 */
function _sessionOutcomeAuthOk(params) {
  var expected = PropertiesService.getScriptProperties().getProperty('SESSION_OUTCOME_SECRET');
  if (!expected) return false;                 // writes are never open
  var got = (params && params.secret) ? String(params.secret) : '';
  return got === expected;
}

var SESSION_OUTCOME_VALUES = { happened: true, therapist_cancelled: true, patient_no_show: true };

// The billable clinical types outpatient recognises. Anything else → unknown_type.
var CLINICAL_BILLING_TYPES = {
  'פסיכודינמי': true, 'פסיכותרפי ממוקד טראומה': true, 'עיסוי טיפולי': true,
  'טיפול ממוקד התמכרויות': true, 'טיפול אינטגרטיבי': true
};

function _recordSessionOutcome(payload) {
  var sessionId = String((payload && payload.sessionId) || '').trim();
  var outcome   = String((payload && payload.outcome) || '').trim();
  var therapist = String((payload && payload.therapist) || '').trim();
  var type      = String((payload && payload.clinicalTreatmentType) || '').trim();
  if (!sessionId) return { ok: false, reason: 'non_ok' };
  if (!SESSION_OUTCOME_VALUES[outcome]) return { ok: false, reason: 'non_ok' };
  if (!_isKnownTherapist(therapist)) return { ok: false, reason: 'unknown_therapist' };
  // `frequency` is NOT sent; derive pay without it (ליווי handles absence here).
  if (type && !CLINICAL_BILLING_TYPES[type]) return { ok: false, reason: 'unknown_type' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // Compute pay/status per outcome (happened → pay; cancelled/no_show → your
    // policy) and UPSERT the session-outcome record keyed by sessionId.
    _upsertSessionOutcome({
      sessionId: sessionId, phone: payload.phone, therapist: therapist,
      clinicalTreatmentType: type, date: payload.date, outcome: outcome
    });
    return { ok: true };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}
```

In **`doPost`**, alongside the other action checks:

```javascript
    if (action === 'recordSessionOutcome') {
      var soParams = (e && e.parameter) || {};
      if (payload && payload.secret) soParams.secret = payload.secret;
      if (!_sessionOutcomeAuthOk(soParams)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_recordSessionOutcome(payload));
    }
```

Wire `_isKnownTherapist` / `_upsertSessionOutcome` and the pay rule to the actual
outpatient model; the contract above is what the therapists sender depends on.

## Reference test (add to outpatient `test/`)

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const VALUES = { happened: 1, therapist_cancelled: 1, patient_no_show: 1 };
function record(known, sessionId, therapist, outcome) {
  if (!sessionId || !VALUES[outcome]) return { ok: false, reason: 'non_ok' };
  if (!known[therapist]) return { ok: false, reason: 'unknown_therapist' };
  return { ok: true };
}

test('each of the three outcomes records ok for a known therapist', () => {
  const known = { 'דנה': 1 };
  ['happened', 'therapist_cancelled', 'patient_no_show'].forEach((o) => {
    assert.deepEqual(record(known, 'sess-1', 'דנה', o), { ok: true });
  });
});
test('unknown therapist / bad outcome are flagged, never silently ok', () => {
  assert.equal(record({}, 'sess-1', 'מי-זה', 'happened').reason, 'unknown_therapist');
  assert.equal(record({ 'דנה': 1 }, 'sess-1', 'דנה', 'maybe').reason, 'non_ok');
});
```

## Deploy

1. Apply the code above to outpatient `apps-script/Code.gs` (pay rule per outcome
   + upsert-by-`sessionId`).
2. **Set the `SESSION_OUTCOME_SECRET` Script Property** on outpatient, and the
   **same value** as a Script Property on the **therapists** Apps Script (where
   the write originates — Apps Script editor → Project Settings → Script
   Properties). The secret is read from config server-side and **never reaches
   the browser**.
3. **Redeploy the outpatient Apps Script web app.**
4. No Node/Railway change is required for the push itself — it goes Apps Script →
   Apps Script. Until this is deployed (or the secret is unset), the therapist's
   outcome **saves locally** and the UI **warns** that the pay-sync failed
   (`unconfigured` / `http_*` / `unreachable`); the local outcome is never lost.
