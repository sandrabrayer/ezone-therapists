# Outpatient patch — `getTreatmentPlans` cross-app endpoint

**Target repo:** `sandrabrayer/ezone-outpatient` · **File:** `apps-script/Code.gs`
**Status:** NOT YET APPLIED — external dependency of `ezone-therapists`.

The therapists "מטופלי חוץ — תוכנית טיפול" tab needs each outpatient's treatment
plan (service types + sessions/week). `getDebtStatus` deliberately doesn't
expose that, and `getData` would over-expose billing/payer fields. So
outpatient gets a third minimal, read-only, secret-gated projection — the exact
same shape and auth model as `getWinbackSource` and `getDebtStatus`.

## What it returns

```jsonc
{
  "ok": true,
  "clients": [
    { "sourceApp": "ezone-outpatient", "clientId": "c1", "name": "אורי",
      "phone": "050-1234567", "serviceType": "פרטני, פרטני CBT",
      "sessions": "{\"פרטני\":1,\"פרטני CBT\":1}", "status": "פעיל" }
  ]
}
```

`phone` is `treatmentContactPhone` (the patient treated), matching the
`getDebtStatus` contract. **No** `payerName`/`payerPhone`/`paymentLink`/prices/
bundles are included.

## Auth

Script Property **`TREATMENT_PLANS_SECRET`** (separate from `DEBT_STATUS_SECRET`
so the two endpoints can be rotated independently). If set, the request must
pass a matching `?secret=`; if absent, open (URL-only obscurity, same as every
other action). `server.js` already forwards `?secret=` for GET actions, so the
Node proxy needs no change.

## Code — add to `apps-script/Code.gs`

Add near `_getWinbackSource` / `_getDebtStatus`:

```javascript
/* ===== Treatment plans (read-only cross-app endpoint) =====
 *
 * Consumed by E-Zone Therapists to show each outpatient's treatment plan.
 * Minimal projection: clientId, name, phone (treatmentContactPhone),
 * serviceType, sessions (sessionsPerWeek), status. NO billing/payer data.
 *
 * Auth: optional shared secret 'TREATMENT_PLANS_SECRET', same model as
 * getWinbackSource / getDebtStatus.
 */
function _treatmentPlansAuthOk(params) {
  var expected = PropertiesService.getScriptProperties().getProperty('TREATMENT_PLANS_SECRET');
  if (!expected) return true; // not configured -> open
  var got = (params && params.secret) ? String(params.secret) : '';
  return got === expected;
}

function _getTreatmentPlans() {
  var clientsSh = _ensureSheet('Clients', CLIENTS_HEADERS);
  var clients   = _readAll(clientsSh, CLIENTS_HEADERS);
  var out = [];
  for (var c = 0; c < clients.length; c++) {
    var cl = clients[c];
    var id = (cl && cl.id != null) ? String(cl.id) : '';
    if (!id) continue;
    out.push({
      sourceApp:   'ezone-outpatient',
      clientId:    id,
      name:        cl.name || '',
      phone:       cl.treatmentContactPhone || '',
      serviceType: cl.serviceType || '',
      sessions:    cl.sessionsPerWeek || '',
      status:      cl.status || ''
    });
  }
  return { ok: true, clients: out };
}
```

In **`doGet`**, alongside the other action checks:

```javascript
    if (action === 'getTreatmentPlans') {
      if (!_treatmentPlansAuthOk(e && e.parameter)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_getTreatmentPlans());
    }
```

In **`doPost`**, alongside the other action checks:

```javascript
    if (action === 'getTreatmentPlans') {
      var tpParams = (e && e.parameter) || {};
      if (payload && payload.secret) tpParams.secret = payload.secret;
      if (!_treatmentPlansAuthOk(tpParams)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_getTreatmentPlans());
    }
```

## Reference test (add to outpatient `test/`, mirrors `debt-status.test.js`)

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// Pure projection mirror of _getTreatmentPlans for unit coverage.
function projectPlans(clients) {
  return (clients || []).filter(c => c && c.id != null && String(c.id)).map(cl => ({
    sourceApp: 'ezone-outpatient', clientId: String(cl.id), name: cl.name || '',
    phone: cl.treatmentContactPhone || '', serviceType: cl.serviceType || '',
    sessions: cl.sessionsPerWeek || '', status: cl.status || ''
  }));
}

test('treatment plans expose only the plan projection, never payer/billing', () => {
  const rows = projectPlans([
    { id: 'c1', name: 'אורי', treatmentContactPhone: '050-1234567',
      payerPhone: '03-0000000', paymentLink: 'https://x', pricePerSession: 300,
      serviceType: 'פרטני', sessionsPerWeek: '{"פרטני":1}', status: 'פעיל' }
  ]);
  assert.equal(rows[0].phone, '050-1234567');
  assert.equal(rows[0].serviceType, 'פרטני');
  assert.equal('payerPhone' in rows[0], false);
  assert.equal('paymentLink' in rows[0], false);
  assert.equal('pricePerSession' in rows[0], false);
});
```

## Deploy

1. Apply the code above to outpatient `apps-script/Code.gs`.
2. **Redeploy the Apps Script web app** (the new action lives in `Code.gs`).
3. Optionally set the `TREATMENT_PLANS_SECRET` Script Property; set the matching
   `TREATMENT_PLANS_SECRET` env var on the therapists Railway service.
4. No Sheets schema change. No Node/Railway change on the outpatient side.
