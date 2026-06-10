# Dashboard patch — `getAdmittedRoster` cross-app endpoint

**Target repo:** `sandrabrayer/E-Zone-Dashboard` · **File:** `apps-script/Code.gs`
**Status:** NOT YET APPLIED — external dependency of `ezone-therapists`.

## Why this shape (investigation finding)

The therapists "מטופלים באשפוז" tab needs a roster of currently-admitted
patients **with a phone** to use as the canonical matching key. Investigation of
the occupancy (תפוסה) data found:

- Occupancy is computed from the **`Patients`** sheet
  (`PATIENT_COLUMNS = ['houseId','name','date','pay','adv','status','fromLead','exitDate','source','notes']`).
- **The Patients sheet has no phone column.** Phone lives only on `Leads`.
- But a lead-originated patient carries a **stable `fromLead` = lead id**, and
  the originating Leads row **survives** admission (its `stage` becomes
  `entry`). So the phone is recoverable by joining `Patients.fromLead → Leads.id`.
- **Caveat:** patients added directly (`source:'direct_admin'`) have
  `fromLead:''` and therefore no phone. Those are returned with `phone:''`; the
  therapists app flags them (no match key) and the therapist enters the patient
  free-text instead. This is expected and not an error.

"Currently admitted" = a Patients row with a blank `exitDate` (still in
residence; released patients are excluded, consistent with the dashboard's
hide-released-from-occupancy behavior).

## What it returns

```jsonc
{
  "ok": true,
  "patients": [
    { "sourceApp": "ezone-dashboard", "name": "דנה", "phone": "0501234567", "house": "asher" },
    { "sourceApp": "ezone-dashboard", "name": "מאיה", "phone": "",          "house": "ramot" }
  ]
}
```

`phone` is normalized to the canonical form where recoverable (strip
separators; `+972`/`972` → leading `0`); blank when the patient has no
originating lead. Nothing else is exposed — no pay/adv/notes/status.

## Auth

Script Property **`OCCUPANCY_SECRET`**, same model as the outpatient
`getWinbackSource`/`getDebtStatus` endpoints. If set, the request must pass a
matching `?secret=`; if absent, open. `collectParams_` already merges query and
JSON body, so this works for both GET and POST with one dispatch line.

## Code — add to `apps-script/Code.gs`

```javascript
/* ===== Admitted roster (read-only cross-app endpoint) =====
 *
 * Consumed by E-Zone Therapists to back the inpatient tab. Returns every
 * currently-admitted patient (Patients row with blank exitDate) with a phone
 * recovered by joining Patients.fromLead -> Leads.id. Patients added directly
 * (no originating lead) come back with phone:'' and fall back to free-text on
 * the consumer side. Minimal projection: name, phone (canonical), house.
 *
 * Auth: optional shared secret 'OCCUPANCY_SECRET'.
 */
function occupancyAuthOk_(params) {
  var expected = PropertiesService.getScriptProperties().getProperty('OCCUPANCY_SECRET');
  if (!expected) return true; // not configured -> open
  var got = (params && params.secret) ? String(params.secret) : '';
  return got === expected;
}

// Canonical-ish phone normalization (mirror of therapists public/phone.js
// normalizeForMatch): digits only, 972 country code -> leading 0.
function normalizePhone_(raw) {
  if (raw == null) return '';
  var digits = String(raw).replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.indexOf('972') === 0) digits = '0' + digits.slice(3);
  return digits;
}

function getAdmittedRoster_() {
  var patientsSh = getOrCreateSheet_(PATIENTS_SHEET, PATIENT_COLUMNS);
  var leadsSh    = getOrCreateSheet_(LEADS_SHEET, LEAD_COLUMNS);
  var patients   = readSheet_(patientsSh, PATIENT_COLUMNS);
  var leads      = readSheet_(leadsSh, LEAD_COLUMNS);

  var phoneByLeadId = {};
  for (var i = 0; i < leads.length; i++) {
    var l = leads[i];
    if (l && l.id != null) phoneByLeadId[String(l.id)] = l.phone || '';
  }

  var out = [];
  for (var p = 0; p < patients.length; p++) {
    var pt = patients[p];
    if (!pt || !pt.name) continue;
    if (String(pt.exitDate || '').trim() !== '') continue; // released -> not admitted
    var rawPhone = pt.fromLead ? (phoneByLeadId[String(pt.fromLead)] || '') : '';
    out.push({
      sourceApp: 'ezone-dashboard',
      name:      pt.name || '',
      phone:     normalizePhone_(rawPhone),
      house:     pt.houseId || ''
    });
  }
  return { ok: true, patients: out };
}
```

In **`handle_`**, alongside the other action checks (one line covers GET+POST
because `collectParams_` merges both):

```javascript
    if (action === 'getAdmittedRoster') {
      if (!occupancyAuthOk_(params)) return jsonOut_({ ok: false, error: 'unauthorized' });
      return jsonOut_(getAdmittedRoster_());
    }
```

## Reference test (add to dashboard `test/`)

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

function normalizePhone(raw) {
  if (raw == null) return '';
  let d = String(raw).replace(/[^\d]/g, '');
  if (!d) return '';
  if (d.indexOf('972') === 0) d = '0' + d.slice(3);
  return d;
}
function roster(patients, leads) {
  const byId = {};
  (leads || []).forEach(l => { if (l && l.id != null) byId[String(l.id)] = l.phone || ''; });
  return (patients || []).filter(p => p && p.name && String(p.exitDate || '').trim() === '')
    .map(p => ({ sourceApp: 'ezone-dashboard', name: p.name,
      phone: normalizePhone(p.fromLead ? (byId[String(p.fromLead)] || '') : ''),
      house: p.houseId || '' }));
}

test('admitted roster recovers phone via fromLead, normalizes, excludes released', () => {
  const leads = [{ id: 'L1', phone: '050-123-4567' }, { id: 'L2', phone: '+972527654321' }];
  const patients = [
    { name: 'דנה', houseId: 'asher', fromLead: 'L1', exitDate: '' },
    { name: 'מאיה', houseId: 'ramot', fromLead: 'L2', exitDate: '' },
    { name: 'יוסי', houseId: 'asher', fromLead: 'L1', exitDate: '2026-05-01' }, // released
    { name: 'דני', houseId: 'rehab', fromLead: '', source: 'direct_admin', exitDate: '' } // no lead
  ];
  const r = roster(patients, leads);
  assert.equal(r.length, 3);                       // released excluded
  assert.equal(r.find(x => x.name === 'דנה').phone, '0501234567');
  assert.equal(r.find(x => x.name === 'מאיה').phone, '0527654321');
  assert.equal(r.find(x => x.name === 'דני').phone, '');   // direct admit -> no phone
});
```

## Deploy

1. Apply the code above to dashboard `apps-script/Code.gs`.
2. **Redeploy the dashboard Apps Script web app.**
3. Optionally set the `OCCUPANCY_SECRET` Script Property; set the matching
   `OCCUPANCY_SECRET` env var on the therapists Railway service, plus
   `DASHBOARD_SHEETS_URL` = the dashboard `/exec` URL.
4. No Sheets schema change.
