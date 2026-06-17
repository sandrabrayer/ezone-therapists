# Outpatient patch — `setClinicalType` cross-app WRITE endpoint

**Target repo:** `sandrabrayer/ezone-outpatient` · **File:** `apps-script/Code.gs`
**Status:** NOT YET APPLIED — external dependency of `ezone-therapists`.

When ירדן saves an assignment in the therapists app, the patient's chosen
**clinical treatment type** is pushed here so outpatient's per-patient billing
rate follows the clinical plan. Same shared-secret, server-to-server model as
`recordTreatmentGiven` / `flagStop`, on `doPost`.

## Contract

`POST` with `?action=setClinicalType&secret=<CLINICAL_TYPE_SECRET>`. The full
object is **also** sent in the JSON body (the therapists sender mirrors both, so
the receiver can read from `e.parameter` or the body):

```jsonc
{
  "action": "setClinicalType",
  "secret": "<CLINICAL_TYPE_SECRET>",
  "phone": "0501234567",                 // canonical 10-digit leading-zero key
  "clinicalTreatmentType": "פסיכודינמי"  // the specific clinical name, not 'פרטני'
}
```

### Response — the therapists side keys off this exactly (never fail-open)

| Response | Meaning | Therapists UI |
| -------- | ------- | ------------- |
| `{ ok:true,  matched:1 }` | exactly one patient matched + updated | proceeds silently |
| `{ ok:false, reason:"no_match" }` | no patient with that phone | save kept locally, **warns** |
| `{ ok:false, reason:"multi_match" }` | the phone matched >1 record | save kept locally, **warns** |
| `{ ok:false, reason:"unknown_type" }` | type is not a billable clinical type | save kept locally, **warns** |
| `{ ok:false, error:"unauthorized" }` | missing/!match secret | surfaced as a flag |

The match must be **exactly one** (`matched:1`). `matched:0` → `no_match`;
`matched>1` → `multi_match`. Match phones **tolerantly** (strip separators,
`+972`→`0`) against the outpatient client roster — the therapists key is already
canonical, but legacy outpatient phones are free-form.

`unknown_type` is returned when `clinicalTreatmentType` is not one of the
billable clinical types outpatient recognises — outpatient is the **authority**
on that list, so the therapists side never guesses; it just surfaces the flag.

## Auth

Script Property **`CLINICAL_TYPE_SECRET`** (separate from the other secrets so it
rotates independently). Reject the write when the property is unset or the
`?secret=` doesn't match (`{ ok:false, error:"unauthorized" }`) — writes are
never open.

## Code — add to `apps-script/Code.gs`

```javascript
/* ===== setClinicalType (cross-app WRITE endpoint) =====
 * Written by E-Zone Therapists on assignment save. Sets the patient's clinical
 * treatment type so per-patient billing follows the clinical plan.
 * Auth: REQUIRED shared secret 'CLINICAL_TYPE_SECRET' (writes are never open).
 */
function _clinicalTypeAuthOk(params) {
  var expected = PropertiesService.getScriptProperties().getProperty('CLINICAL_TYPE_SECRET');
  if (!expected) return false;                 // writes are never open
  var got = (params && params.secret) ? String(params.secret) : '';
  return got === expected;
}

// The billable clinical types outpatient recognises. Anything else → unknown_type.
var CLINICAL_BILLING_TYPES = {
  'פסיכודינמי': true, 'פסיכותרפי ממוקד טראומה': true, 'עיסוי טיפולי': true,
  'טיפול ממוקד התמכרויות': true, 'טיפול אינטגרטיבי': true
  // extend with any other individually-billable clinical types as needed
};

function _setClinicalType(payload) {
  var phone = payload && payload.phone;
  var type = String((payload && payload.clinicalTreatmentType) || '').trim();
  if (!phone) return { ok: false, reason: 'no_match' };
  if (!type) return { ok: false, reason: 'unknown_type' };
  if (!CLINICAL_BILLING_TYPES[type]) return { ok: false, reason: 'unknown_type' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _ensureSheet('Clients', CLIENTS_HEADERS);   // outpatient's client roster
    var phoneIdx = CLIENTS_HEADERS.indexOf('phone');
    var typeIdx  = CLIENTS_HEADERS.indexOf('clinicalTreatmentType'); // add this column
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: false, reason: 'no_match' };
    var grid = sh.getRange(2, 1, lastRow - 1, CLIENTS_HEADERS.length).getValues();
    var key = _normalizePhoneForMatch(phone);            // tolerant match (mirror of therapists)
    var hits = [];
    for (var i = 0; i < grid.length; i++) {
      if (_normalizePhoneForMatch(grid[i][phoneIdx]) === key) hits.push(i);
    }
    if (hits.length === 0) return { ok: false, reason: 'no_match' };
    if (hits.length > 1)  return { ok: false, reason: 'multi_match' };
    sh.getRange(hits[0] + 2, typeIdx + 1, 1, 1).setValues([[type]]);
    return { ok: true, matched: 1 };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}
```

In **`doPost`**, alongside the other action checks:

```javascript
    if (action === 'setClinicalType') {
      var ctParams = (e && e.parameter) || {};
      if (payload && payload.secret) ctParams.secret = payload.secret;
      if (!_clinicalTypeAuthOk(ctParams)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_setClinicalType(payload));
    }
```

Adjust `CLIENTS_HEADERS` / sheet name to the actual outpatient client roster, and
add a `clinicalTreatmentType` column if it doesn't already exist. Reuse
outpatient's own tolerant phone-normalizer if it differs from
`_normalizePhoneForMatch`.

## Reference test (add to outpatient `test/`)

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// In-memory mirror of the match-and-set rule.
function setClinicalType(clients, phone, type) {
  const norm = s => String(s||'').replace(/[^\d]/g,'').replace(/^972/,'0');
  if (!type) return { ok:false, reason:'unknown_type' };
  const hits = clients.filter(c => norm(c.phone) === norm(phone));
  if (hits.length === 0) return { ok:false, reason:'no_match' };
  if (hits.length > 1)  return { ok:false, reason:'multi_match' };
  hits[0].clinicalTreatmentType = type;
  return { ok:true, matched:1 };
}

test('one match → matched:1 and the type is written', () => {
  const clients = [{ phone:'0501234567' }];
  assert.deepEqual(setClinicalType(clients, '0501234567', 'פסיכודינמי'), { ok:true, matched:1 });
  assert.equal(clients[0].clinicalTreatmentType, 'פסיכודינמי');
});
test('no match / multi match are flagged, never silently ok', () => {
  assert.equal(setClinicalType([], '0501234567', 'פסיכודינמי').reason, 'no_match');
  const two = [{ phone:'0501234567' }, { phone:'050-123-4567' }];
  assert.equal(setClinicalType(two, '0501234567', 'פסיכודינמי').reason, 'multi_match');
});
```

## Deploy

1. Apply the code above to outpatient `apps-script/Code.gs` (+ the
   `clinicalTreatmentType` column on the client roster).
2. **Set the `CLINICAL_TYPE_SECRET` Script Property** on outpatient, and the
   **same value** as a Script Property on the therapists Apps Script (where the
   write originates).
3. **Redeploy the outpatient Apps Script web app.**
4. No Node/Railway change is required for the push itself — it goes Apps Script →
   Apps Script. Until this is deployed (or the secret is unset), therapists saves
   the assignment locally and **warns** that billing-type sync failed
   (`unconfigured` / `http_*` / `unreachable`); the local save is never lost.
