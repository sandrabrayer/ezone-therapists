# Outpatient patch — `deactivateClient` cross-app endpoint (patient-delete propagation)

**Target repo:** `sandrabrayer/ezone-outpatient` (branch `claude/youthful-volta-laarnk`)
· **File:** `apps-script/Code.gs`
**Status:** NOT YET APPLIED — external dependency of `ezone-therapists` (the
delete-patient feature). The SENDER side (`_postDeactivateClient`) is live in
therapists `Code.gs`; this is the matching RECEIVER. **Ship as a separate PR into
the outpatient repo** — this session can only push to `ezone-therapists`.

## Why

When a patient is deleted in the therapists app (`_removePatient`), the local
`Patients` row is removed — but the matching **outpatient Client** is untouched,
so `getTreatmentPlans` / `getDebtStatus` keep returning them and the therapists
roster build (`public/roster.js`) **re-adds the "deleted" patient as a base
source** (not just an overlay). The delete never sticks.

`deactivateClient` flips the matching Client to **inactive** so it drops out of
the active roster union. We **deactivate, not hard-delete**: it is reversible and
preserves the outpatient billing / session history, and `getTreatmentPlans`
already filters by status — so a deactivated Client simply stops being projected,
without destroying the sibling's source data.

## What it accepts / returns

```jsonc
// POST body (action + secret also on the query string, mirroring setClinicalType)
{ "action": "deactivateClient", "secret": "…",
  "phone": "0501234567", "deactivatedBy": "כנרת", "reason": "patient_deleted" }

// Response
{ "ok": true, "deactivated": 1 }   // N Client rows deactivated (0 = none matched; still ok — orphan-safe)
{ "ok": false, "error": "unauthorized" }
```

**Orphan-safe / idempotent:** a phone matching no Client (or an already-inactive
one) returns `{ ok:true, deactivated:0 }`; matching tolerates a dropped leading
zero. The therapists side is **fail-closed**: any non-2xx or `ok:false` aborts the
local delete, so a patient is never gone here while still active on Vered's side.

## Auth

Uses a **dedicated** `DEACTIVATE_CLIENT_SECRET` Script Property — its OWN secret,
NOT reused from `STOP_FLAG_SECRET`. Deactivating a Client is more destructive than
clearing a stop flag, so least-authority keeps the two domains separate. Fail-
closed: a missing/mismatched secret returns `{ ok:false, error:'unauthorized' }`
and changes nothing.

## Code — add to `apps-script/Code.gs`

Adjust `CLIENTS_SHEET` / `CLIENTS_HEADERS` / the phone + active column names to
match the actual Clients schema on the outpatient side. If the roster's
active/inactive state is a `status` enum rather than a boolean `active` column,
set that column to the value `getTreatmentPlans` treats as "not active" instead.

```javascript
/* ===== deactivateClient — soft-deactivate a Client (therapists delete propagation) =====
 * Sets the matching Client(s) to INACTIVE by phone ALONE (no extra join), so the
 * client leaves getTreatmentPlans / getDebtStatus and stops re-appearing in the
 * therapists roster union. Orphan-safe + idempotent: no match (or already
 * inactive) returns deactivated:0. Auth: dedicated 'DEACTIVATE_CLIENT_SECRET',
 * fail-closed. DEACTIVATE (not deleteRow) so billing/session history is preserved.
 */
function _deactivateClientAuthOk(params) {
  var expected = PropertiesService.getScriptProperties().getProperty('DEACTIVATE_CLIENT_SECRET');
  if (!expected) return false;                       // fail-closed: unset = reject
  var got = (params && params.secret) ? String(params.secret) : '';
  return got === expected;
}

// Tolerant phone key: strip non-digits, restore a dropped leading zero, '972'->0.
function _deactivateClientPhoneKey(raw) {
  var d = String(raw == null ? '' : raw).replace(/[^\d]/g, '');
  if (!d) return '';
  if (d.indexOf('972') === 0) d = '0' + d.slice(3);
  if (d.length === 9 && d.charAt(0) !== '0') d = '0' + d;   // recover Sheets-dropped zero
  return d;
}

function _deactivateClient(payload) {
  var key = _deactivateClientPhoneKey(payload && payload.phone);
  if (!key) return { ok: false, error: 'invalid_phone' };

  var sh = _ensureSheet('Clients', CLIENTS_HEADERS);        // adjust to the real Clients sheet
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, deactivated: 0 };     // orphan-safe: nothing to do
  var phoneIdx  = CLIENTS_HEADERS.indexOf('phone');         // adjust to real columns
  var activeIdx = CLIENTS_HEADERS.indexOf('active');
  var grid = sh.getRange(2, 1, lastRow - 1, CLIENTS_HEADERS.length).getValues();
  var n = 0;
  for (var i = 0; i < grid.length; i++) {
    if (_deactivateClientPhoneKey(grid[i][phoneIdx]) === key && String(grid[i][activeIdx]) !== 'false') {
      sh.getRange(i + 2, activeIdx + 1, 1, 1).setValues([['false']]);   // soft-deactivate, keep the row
      n++;
    }
  }
  return { ok: true, deactivated: n };
}
```

In **`doPost`**, alongside the `setClinicalType` / `flagStop` dispatch:

```javascript
    if (action === 'deactivateClient') {
      var dcParams = (e && e.parameter) || {};
      if (payload && payload.secret) dcParams.secret = payload.secret;
      if (!_deactivateClientAuthOk(dcParams)) return _json({ ok: false, error: 'unauthorized' });
      return _json(_deactivateClient(payload));
    }
```

> **Make sure `getTreatmentPlans` / `getDebtStatus` exclude `active === 'false'`
> Clients** (or filter on whatever status column you set). If they currently
> return all rows, the roster union won't drop the deactivated patient — the whole
> point of this endpoint. Add the filter in the same PR.

## Reference test (add to outpatient `test/`)

Mirrors the pure receiver test already in therapists `test/delete-sync.test.js`.

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

function key(raw) {
  let d = String(raw == null ? '' : raw).replace(/[^\d]/g, '');
  if (!d) return '';
  if (d.indexOf('972') === 0) d = '0' + d.slice(3);
  if (d.length === 9 && d.charAt(0) !== '0') d = '0' + d;
  return d;
}
function deactivateClient(clients, phone) {        // pure mirror of _deactivateClient
  const k = key(phone);
  if (!k) return { ok: false, error: 'invalid_phone' };
  let n = 0;
  const out = clients.map((c) => {
    if (key(c.phone) === k && String(c.active) !== 'false') { n++; return Object.assign({}, c, { active: 'false' }); }
    return c;
  });
  return { ok: true, deactivated: n, clients: out };
}

test('deactivateClient soft-deactivates the match, even an orphan (zero-dropped phone)', () => {
  const r = deactivateClient([{ phone: 501234567, name: 'רון מנחם', active: 'true' }], '0501234567');
  assert.equal(r.deactivated, 1);
  assert.equal(r.clients[0].active, 'false');
});

test('deactivateClient is orphan-safe — no match returns deactivated:0', () => {
  assert.equal(deactivateClient([{ phone: '0529999999', active: 'true' }], '0501234567').deactivated, 0);
});
```

## Deploy

1. Apply the code above to outpatient `apps-script/Code.gs` (adjust the Clients
   sheet/column names) **and** make `getTreatmentPlans` / `getDebtStatus` exclude
   inactive Clients.
2. **Redeploy the Apps Script web app** (the new action lives in `Code.gs`).
3. Provision a NEW shared secret `DEACTIVATE_CLIENT_SECRET` (Script Property) on
   **both** Apps Scripts — outpatient (receiver) and therapists (sender) — with the
   same value. **No Node/Railway env var** (the write goes Apps Script → Apps
   Script, never via the browser).
4. No Sheets schema change (reuses the existing Clients active/status column).
