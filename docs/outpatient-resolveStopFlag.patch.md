# Outpatient patch — `resolveStopFlag` cross-app endpoint (UNDO of `flagStop`)

**Target repo:** `sandrabrayer/ezone-outpatient` · **File:** `apps-script/Code.gs`
**Status:** NOT YET APPLIED — external dependency of `ezone-therapists` (the
restore / delete-patient feature). The SENDER side (`_postResolveStopFlag`) is
live in therapists `Code.gs`; this is the matching RECEIVER.

## Why

`flagStop` creates a **StopFlags** row (a stop request pending Vered's
confirmation). There is currently **no way to clear one**:

- a therapist undoing a stop / restoring a patient to active has nothing to call;
- an **orphaned** flag — one whose phone matches no Client (e.g. the phone lost
  its leading zero when Sheets stored it, so the StopFlags UI shows
  *"לא נמצא מטופל תואם"*) — can never be confirmed **or** dismissed, so it sticks
  forever.

`resolveStopFlag` removes the StopFlag matching a phone, **by phone alone — no
Client join required**, so an orphaned flag always clears.

## What it accepts / returns

```jsonc
// POST body (action + secret also on the query string, mirroring flagStop)
{ "action": "resolveStopFlag", "secret": "…",
  "phone": "0501234567", "resolvedBy": "כנרת", "reason": "חזר/ה לטיפול" }

// Response
{ "ok": true, "resolved": 1 }     // N StopFlag rows removed (0 = none matched; still ok — idempotent)
{ "ok": false, "error": "unauthorized" }
```

Idempotent and orphan-safe: resolving a phone with no flag returns
`{ ok:true, resolved:0 }`; matching is tolerant of a dropped leading zero.

## Auth

Reuses the **`STOP_FLAG_SECRET`** Script Property (same stop-flag domain as
`flagStop`, so no new secret to provision). Fail-closed: a missing/mismatched
secret returns `{ ok:false, error:'unauthorized' }` and changes nothing.

## Code — add to `apps-script/Code.gs`

Add beside the existing `flagStop` receiver. Adjust `STOP_FLAGS_SHEET` /
`STOP_FLAGS_HEADERS` / the phone column name to match the actual StopFlags schema
on the outpatient side.

```javascript
/* ===== resolveStopFlag — remove a stop request (UNDO of flagStop) =====
 * Removes the StopFlags row(s) matching `phone`, by phone ALONE (no Client join),
 * so an orphaned flag with no matching Client still clears. Idempotent.
 * Auth: shared 'STOP_FLAG_SECRET' (same as flagStop), fail-closed.
 */
function _resolveStopFlagAuthOk(params) {
  var expected = PropertiesService.getScriptProperties().getProperty('STOP_FLAG_SECRET');
  if (!expected) return false;                       // fail-closed: unset = reject
  var got = (params && params.secret) ? String(params.secret) : '';
  return got === expected;
}

// Tolerant phone key: strip non-digits, restore a dropped leading zero, '972'->0.
function _stopFlagPhoneKey(raw) {
  var d = String(raw == null ? '' : raw).replace(/[^\d]/g, '');
  if (!d) return '';
  if (d.indexOf('972') === 0) d = '0' + d.slice(3);
  if (d.length === 9 && d.charAt(0) !== '0') d = '0' + d;   // recover Sheets-dropped zero
  return d;
}

function _resolveStopFlag(payload) {
  var phone = payload && payload.phone;
  var key = _stopFlagPhoneKey(phone);
  if (!key) return { ok: false, error: 'invalid_phone' };

  var sh = _ensureSheet('StopFlags', STOP_FLAGS_HEADERS);   // existing flagStop sheet
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, resolved: 0 };
  var phoneIdx = STOP_FLAGS_HEADERS.indexOf('phone');       // adjust to real column
  var grid = sh.getRange(2, 1, lastRow - 1, STOP_FLAGS_HEADERS.length).getValues();
  var toDelete = [];
  for (var i = 0; i < grid.length; i++) {
    if (_stopFlagPhoneKey(grid[i][phoneIdx]) === key) toDelete.push(i + 2);
  }
  for (var j = toDelete.length - 1; j >= 0; j--) sh.deleteRow(toDelete[j]);   // bottom-up
  return { ok: true, resolved: toDelete.length };
}
```

In **`doPost`**, alongside the `flagStop` dispatch:

```javascript
    if (action === 'resolveStopFlag') {
      var rsfParams = (e && e.parameter) || {};
      if (payload && payload.secret) rsfParams.secret = payload.secret;
      if (!_resolveStopFlagAuthOk(rsfParams)) return _json({ ok: false, error: 'unauthorized' });
      return _json(_resolveStopFlag(payload));
    }
```

> Prefer a soft delete? Instead of `deleteRow`, set a `status: 'resolved'` +
> `resolvedBy` / `resolvedAt` / `reason` column so the StopFlags tab keeps the
> history. The therapists side only needs `{ ok:true }` either way.

## Reference test (add to outpatient `test/`)

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

function resolveStopFlag(rows, phone) {           // pure mirror of _resolveStopFlag
  const key = String(phone || '').replace(/[^\d]/g, '')
    .replace(/^972/, '0').replace(/^(\d{9})$/, (m, d) => d[0] === '0' ? d : '0' + d);
  const keep = rows.filter(r => String(r.phone).replace(/[^\d]/g, '')
    .replace(/^972/, '0').replace(/^(\d{9})$/, (m, d) => d[0] === '0' ? d : '0' + d) !== key);
  return { ok: true, resolved: rows.length - keep.length, kept: keep };
}

test('resolveStopFlag removes the matching flag, even an orphan (zero-dropped phone)', () => {
  const rows = [{ phone: 523659865, name: 'יעל' }, { phone: '0501234567', name: 'אורי' }];
  const r = resolveStopFlag(rows, '0523659865');   // canonical; stored lost its zero
  assert.equal(r.resolved, 1);
  assert.equal(r.kept.length, 1);
  assert.equal(r.kept[0].name, 'אורי');
});

test('resolveStopFlag is idempotent — no matching flag returns resolved:0', () => {
  assert.equal(resolveStopFlag([{ phone: '0501234567' }], '0529999999').resolved, 0);
});
```

## Recommended outpatient UI follow-up (separate)

In the StopFlags tab, render a **"בטל בקשה"** (dismiss) action even on a row that
matches no Client (`לא נמצא מטופל תואם`), wired to `_resolveStopFlag` — so Vered
can clear an orphaned flag from her side too, not only via the therapists app.

## Deploy

1. Apply the code above to outpatient `apps-script/Code.gs` (adjust the StopFlags
   sheet/column names).
2. **Redeploy the Apps Script web app** (the new action lives in `Code.gs`).
3. `STOP_FLAG_SECRET` is already provisioned for `flagStop` — no new secret.
4. No Sheets schema change (unless you choose the soft-delete columns).
