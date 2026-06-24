# Outpatient patch — `recordTreatmentGiven` cross-app WRITE endpoint

**Target repo:** `sandrabrayer/ezone-outpatient` · **File:** `apps-script/Code.gs`
**Status:** NOT YET APPLIED — external dependency of `ezone-therapists`.

This is the **first WRITE** from therapists to a sibling. Every other cross-app
call is a read; this one lets the therapists app record did-it-happen results so
outpatient can drive **therapist pay** and **per-patient billing**. Same
shared-secret auth model as the read endpoints, but on `doPost`.

## Contract

`POST` with `?action=recordTreatmentGiven&secret=<TREATMENT_GIVEN_SECRET>` and a
JSON body of records the therapists app rebuilt from the session's current state:

```jsonc
{
  "records": [
    // per-patient attendance (patient billing is per patient)
    { "treatmentId": "id_abc", "sessionId": "s_1", "therapist": "כנרת",
      "patientName": "דנה", "patientPhone": "0501234567", "date": "2026-07-01",
      "treatmentType": "קבוצה", "location": "ramot", "attendance": "occurred",
      "given": true, "isGroup": true, "isPayment": false, "rate": "group_member" },
    // ... one per patient ...
    // the ONE therapist-payment record for a group (keyed by sessionId)
    { "treatmentId": "s_1", "sessionId": "s_1", "therapist": "כנרת",
      "patientName": "", "patientPhone": "", "date": "2026-07-01",
      "treatmentType": "קבוצה", "location": "ramot", "attendance": "occurred",
      "given": true, "isGroup": true, "isPayment": true, "rate": "group" }
  ]
}
```

For a **non-group** treatment there is one record and it is the payment row
(`isPayment:true`, `rate:"individual"`). For a **group** (קבוצה) there is one
record per patient (`isPayment:false`) **plus exactly one** payment record at the
group rate keyed by `sessionId` — the therapist is paid once for the session, not
per patient, while per-patient attendance is still captured for billing.

### Idempotency + drift (critical)

Every record is keyed by **`treatmentId`** (the patient row id, or the `sessionId`
for the group payment row). The endpoint **upserts by `treatmentId`**, so:

- retries never double-count (the therapists side resends on every change), and
- unmarking / editing a group's attendance resends the whole session, so the
  payment row's `given` and each patient's `given` are corrected in place and
  **downstream pay can't drift**.

Count therapist pay from rows where `isPayment = true AND given = true`. Count
patient attendance/billing from the per-patient rows (`given`).

## Auth

Script Property **`TREATMENT_GIVEN_SECRET`** (separate from the read secrets so
it can be rotated independently). A write must present a matching `?secret=`. If
the property is **unset, reject the write** (`{ ok:false, error:"unauthorized" }`)
— unlike the read endpoints, a write should never be open.

## Sheet — `TreatmentsGiven`

```javascript
var TREATMENTS_GIVEN_HEADERS = [
  'treatmentId', 'sessionId', 'therapist', 'patientName', 'patientPhone',
  'date', 'treatmentType', 'location', 'attendance', 'given',
  'isGroup', 'isPayment', 'rate', 'recordedAt'
];
```

## Code — add to `apps-script/Code.gs`

```javascript
/* ===== recordTreatmentGiven (cross-app WRITE endpoint) =====
 *
 * Written by E-Zone Therapists when a treatment's did-it-happen status changes.
 * Upserts by treatmentId so it is idempotent (no double-count on retry) and
 * drift-free (a resend after unmark/edit corrects the stored row in place).
 *
 * Therapist pay  = rows where isPayment && given.
 * Patient billing = the per-patient rows (given).
 *
 * Auth: REQUIRED shared secret 'TREATMENT_GIVEN_SECRET' (writes are never open).
 */
function _treatmentGivenAuthOk(params) {
  var expected = PropertiesService.getScriptProperties().getProperty('TREATMENT_GIVEN_SECRET');
  if (!expected) return false;                 // writes are never open
  var got = (params && params.secret) ? String(params.secret) : '';
  return got === expected;
}

function _recordTreatmentGiven(payload) {
  var records = payload && payload.records;
  if (!Array.isArray(records) || !records.length) return { ok: false, error: 'missing_records' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _ensureSheet('TreatmentsGiven', TREATMENTS_GIVEN_HEADERS);
    var now = new Date().toISOString();
    var results = records.map(function (r) {
      if (!r || !r.treatmentId) return { ok: false, error: 'missing_treatmentId' };
      var rec = {
        treatmentId: String(r.treatmentId),
        sessionId: r.sessionId || '',
        therapist: r.therapist || '',
        patientName: r.patientName || '',
        patientPhone: r.patientPhone || '',
        date: r.date || '',
        treatmentType: r.treatmentType || '',
        location: r.location || '',
        attendance: r.attendance || '',
        given: r.given ? 'true' : 'false',
        isGroup: r.isGroup ? 'true' : 'false',
        isPayment: r.isPayment ? 'true' : 'false',
        rate: r.rate || '',
        recordedAt: now
      };
      _upsertByKey(sh, TREATMENTS_GIVEN_HEADERS, 'treatmentId', rec); // upsert = idempotent
      return { ok: true, treatmentId: rec.treatmentId };
    });
    return { ok: results.every(function (x) { return x.ok; }), results: results };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}
```

`_upsertByKey` is the same keyed upsert the therapists app uses; if outpatient's
helper is named differently (e.g. `_upsertById`), generalize it to take the key
column, or inline a find-by-`treatmentId`-then-update/append.

In **`doPost`**, alongside the other action checks:

```javascript
    if (action === 'recordTreatmentGiven') {
      var tgParams = (e && e.parameter) || {};
      if (payload && payload.secret) tgParams.secret = payload.secret;
      if (!_treatmentGivenAuthOk(tgParams)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_recordTreatmentGiven(payload));
    }
```

## Reference test (add to outpatient `test/`)

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// In-memory mirror of the keyed upsert to prove idempotency + the pay rule.
function upsert(rows, rec) {
  const i = rows.findIndex(r => r.treatmentId === rec.treatmentId);
  if (i >= 0) rows[i] = rec; else rows.push(rec);
  return rows;
}
const payCount = rows => rows.filter(r => r.isPayment && r.given).length;

test('resending the same records does not double-count therapist pay', () => {
  let rows = [];
  const group = [
    { treatmentId: 'g1', given: true,  isPayment: false },
    { treatmentId: 'g2', given: false, isPayment: false },
    { treatmentId: 's1', given: true,  isPayment: true }  // one group payment row
  ];
  group.forEach(r => upsert(rows, r));
  group.forEach(r => upsert(rows, r));            // retry
  assert.equal(rows.length, 3);                   // no duplicates
  assert.equal(payCount(rows), 1);                // group pays ONCE
});

test('unmarking the group resends given=false and pay drops to 0', () => {
  let rows = [];
  upsert(rows, { treatmentId: 's1', given: true, isPayment: true });
  assert.equal(payCount(rows), 1);
  upsert(rows, { treatmentId: 's1', given: false, isPayment: true }); // resend after unmark
  assert.equal(payCount(rows), 0);                // corrected in place, no drift
});
```

## Deploy

1. Apply the code above to outpatient `apps-script/Code.gs`.
2. **Set the `TREATMENT_GIVEN_SECRET` Script Property** on outpatient, and the
   **same value** as a Script Property on the therapists Apps Script (that is
   where the write originates — see `apps-script/Code.gs` setup notes).
3. **Redeploy the outpatient Apps Script web app.**
4. No Node/Railway change on either side — the write goes Apps Script →
   Apps Script. Until this is deployed, therapists marks save locally and stay
   `syncStatus='pending'`; the therapists app retries via its `syncPending`
   action (the "סנכרן עכשיו" button / on refresh).
