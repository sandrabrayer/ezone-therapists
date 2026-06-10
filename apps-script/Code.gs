/**
 * E-ZONE Therapists — Apps Script backend
 *
 * Stores the treatment logs therapists create (outpatient + inpatient) and the
 * debtor-approval audit trail. This is the THERAPISTS app's own sheet; the
 * cross-app reads (outpatient debt status / treatment plans, dashboard admitted
 * roster) live in their respective sibling scripts and are proxied by the Node
 * server — they are NOT part of this file.
 *
 * Setup:
 *  1. Create a Google Sheet named "E-ZONE Therapists".
 *  2. Extensions → Apps Script → paste this as Code.gs.
 *  3. Deploy → New deployment → Web app
 *       - Execute as: Me
 *       - Who has access: Anyone (with link)
 *  4. Copy the /exec URL and set it as SHEETS_URL in the Node server env.
 */

/* One row per logged treatment. `id` is generated on the client and used as
 * the upsert key, so editing a log updates its row instead of duplicating.
 * Approval columns are populated only when a debtor treatment was approved by
 * Ron/Sandra (gateStatus='approved'). New columns are appended at the end per
 * the _ensureSheet append-only rule. */
var TREATMENTS_HEADERS = [
  'id', 'kind', 'therapist', 'patientName', 'patientPhone',
  'serviceType', 'treatmentDate', 'note',
  'gateStatus', 'gateReason', 'amountOwed', 'house',
  'approverId', 'approverName', 'approvalNote', 'approvedAt',
  'created'
];

/* Append-only audit trail of every debtor approval. Mirrors the approval stamp
 * built in public/approval.js, plus the treatment it unblocked. */
var APPROVALS_HEADERS = [
  'id', 'treatmentId', 'approverId', 'approverName',
  'patientName', 'patientPhone', 'therapist',
  'note', 'amountOwed', 'approvedAt'
];

function _ss() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function _ensureSheet(name, headers) {
  var ss = _ss();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    return sh;
  }
  var lastCol = Math.max(sh.getLastColumn(), headers.length);
  var existing = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var needsHeader = false;
  for (var i = 0; i < headers.length; i++) {
    if (existing[i] !== headers[i]) { needsHeader = true; break; }
  }
  if (needsHeader) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function _readAll(sh, headers) {
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    if (row.every(function (c) { return c === '' || c === null; })) continue;
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      var v = row[c];
      if (v instanceof Date) {
        v = Utilities.formatDate(v, Session.getScriptTimeZone() || 'Asia/Jerusalem', 'yyyy-MM-dd');
      }
      obj[headers[c]] = v;
    }
    out.push(obj);
  }
  return out;
}

function _upsertById(sh, headers, obj) {
  var idIdx = headers.indexOf('id');
  var lastRow = sh.getLastRow();
  var row = headers.map(function (h) {
    var v = obj[h];
    return (v === undefined || v === null) ? '' : v;
  });
  if (lastRow > 1) {
    var ids = sh.getRange(2, idIdx + 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(obj.id)) {
        sh.getRange(i + 2, 1, 1, headers.length).setValues([row]);
        return { updated: true };
      }
    }
  }
  sh.appendRow(row);
  return { created: true };
}

function _getData() {
  var tSh = _ensureSheet('Treatments', TREATMENTS_HEADERS);
  var aSh = _ensureSheet('Approvals', APPROVALS_HEADERS);
  return {
    ok: true,
    treatments: _readAll(tSh, TREATMENTS_HEADERS),
    approvals: _readAll(aSh, APPROVALS_HEADERS)
  };
}

function _saveTreatment(payload) {
  var t = payload && payload.treatment;
  if (!t || typeof t !== 'object') return { ok: false, error: 'missing_treatment' };
  if (!t.id) return { ok: false, error: 'missing_id' };
  // A flagged log must never masquerade as a clean one, and a debtor log must
  // carry an approval. Guard server-side so a malformed client can't bypass.
  if (t.gateStatus === 'approved' && !(t.approverId && t.approvedAt)) {
    return { ok: false, error: 'approval_required' };
  }

  var lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    var tSh = _ensureSheet('Treatments', TREATMENTS_HEADERS);
    var res = _upsertById(tSh, TREATMENTS_HEADERS, t);

    // Mirror an approval into the audit sheet (append-only; one row per save).
    if (t.gateStatus === 'approved' && t.approverId) {
      var aSh = _ensureSheet('Approvals', APPROVALS_HEADERS);
      _upsertById(aSh, APPROVALS_HEADERS, {
        id: t.id,                 // keyed by treatment id (one approval per log)
        treatmentId: t.id,
        approverId: t.approverId,
        approverName: t.approverName || '',
        patientName: t.patientName || '',
        patientPhone: t.patientPhone || '',
        therapist: t.therapist || '',
        note: t.approvalNote || '',
        amountOwed: t.amountOwed || 0,
        approvedAt: t.approvedAt || ''
      });
    }
    return { ok: true, treatment: t, created: !!res.created, updated: !!res.updated };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function _removeTreatment(id) {
  if (!id) return { ok: false, error: 'missing_id' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _ensureSheet('Treatments', TREATMENTS_HEADERS);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: false, error: 'not_found' };
    var idIdx = TREATMENTS_HEADERS.indexOf('id');
    var ids = sh.getRange(2, idIdx + 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(id)) {
        sh.deleteRow(i + 2);
        return { ok: true, removed: true, id: id };
      }
    }
    return { ok: false, error: 'not_found' };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'getData';
    if (action === 'getData') return _json(_getData());
    return _json({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'saveTreatment';
    var payload = {};
    if (e.postData && e.postData.contents) {
      try { payload = JSON.parse(e.postData.contents); } catch (err) {}
      if (payload && payload.action) action = payload.action;
    }
    if (action === 'getData') return _json(_getData());
    if (action === 'saveTreatment') return _json(_saveTreatment(payload));
    if (action === 'removeTreatment') {
      var id = payload.id || (payload.treatment && payload.treatment.id) || '';
      return _json(_removeTreatment(id));
    }
    return _json({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}
