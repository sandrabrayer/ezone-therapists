/**
 * E-ZONE Therapists — Apps Script backend (iteration 2: scheduling)
 *
 * Therapists self-schedule follow-up treatments for active outpatients
 * (treatment type + location + date) and later mark whether each happened.
 * This is the THERAPISTS app's OWN sheet. The cross-app debt status that gates
 * scheduling lives in the ezone-outpatient script and is proxied by the Node
 * server (and re-read server-side here for authoritative enforcement).
 *
 * Sheets in this workbook:
 *   - Schedule        one row PER PATIENT PER SESSION (group sessions share a
 *                     sessionId; each row keeps its own gate + attendance).
 *   - Approvals       append-only audit of every debtor approval (Ron/Sandra).
 *   - Patients        per-patient intake record keyed by phone: identity +
 *                     origin (where the patient came from + optional still-
 *                     admitted house). The active-outpatient roster itself comes
 *                     from the outpatient sibling; this sheet only layers local
 *                     extras on top.
 *   - Assignments     one row per (patient, therapist, plan). A patient may have
 *                     MULTIPLE parallel treatments/therapists; therapist + plan
 *                     (type + weekly frequency) stay editable.
 *   - Therapists      editable list {name, active} — feeds the dropdown.
 *   - TreatmentTypes  editable list {name, active, isGroup} — feeds the dropdown.
 *
 * The Therapists / TreatmentTypes lists are ADMIN-EDITABLE with an active flag:
 * retiring a row removes it from the dropdown going forward but NEVER rewrites a
 * Schedule row that already references it by string.
 *
 * Setup:
 *  1. Create a Google Sheet named "E-ZONE Therapists".
 *  2. Extensions → Apps Script → paste this as Code.gs.
 *  3. Project Settings → Script Properties:
 *       OUTPATIENT_SHEETS_URL  = the ezone-outpatient /exec URL
 *       DEBT_STATUS_SECRET     = the shared getDebtStatus secret (debt re-check)
 *       TREATMENT_GIVEN_SECRET = the shared recordTreatmentGiven secret — the
 *                                did-it-happen WRITE-BACK to outpatient. Until set
 *                                (and the outpatient endpoint deployed), marks are
 *                                saved locally and left syncStatus='pending'.
 *  4. Deploy → New deployment → Web app (Execute as: Me; Access: Anyone w/ link).
 *  5. Copy the /exec URL and set it as SHEETS_URL in the Node server env.
 */

/* One row per scheduled treatment, PER PATIENT. `id` is generated on the client
 * and is the upsert key. `sessionId` is shared by every patient row of the same
 * (group) session. Approval columns populate only when a debtor row was approved
 * by Ron/Sandra (gateStatus='approved'). Append-only column rule via _ensureSheet. */
var SCHEDULE_HEADERS = [
  'id', 'sessionId', 'therapist', 'treatmentType', 'location', 'scheduledDate',
  'patientName', 'patientPhone',
  'attendance', 'attendanceMarkedAt',
  'gateStatus', 'gateReason', 'amountOwed',
  'approverId', 'approverName', 'approvalNote', 'approvedAt',
  'created',
  'syncStatus', 'syncedAt',
  'time', 'reason'          // iteration 7 — appended (time-of-day; not-done reason)
];

/* Append-only audit trail of every debtor approval. */
var APPROVALS_HEADERS = [
  'id', 'treatmentId', 'approverId', 'approverName',
  'patientName', 'patientPhone', 'therapist',
  'note', 'amountOwed', 'approvedAt'
];

/* Per-patient intake record keyed by canonical phone: identity + origin (where
 * the patient came from, with an optional "still admitted" + which house). The
 * therapist assignment(s) and treatment plan(s) live in the Assignments sheet —
 * a patient can have MULTIPLE parallel treatments/therapists, all editable. */
var PATIENTS_HEADERS = [
  'phone', 'name',
  'origin', 'stillAdmitted', 'admittedHouse',
  'active', 'updatedBy', 'updated'
];

/* One row per (patient, therapist, treatment plan). A patient may have several
 * active rows — multiple parallel treatments with multiple therapists. `id` is
 * the client-generated upsert key; `patientPhone` links to Patients/roster.
 * Retiring a plan sets active=false (the row stays for history). */
var ASSIGNMENTS_HEADERS = [
  'id', 'patientPhone', 'therapist', 'treatmentType', 'frequencyPerWeek',
  'active', 'updatedBy', 'updated'
];

/* Editable, active-flagged lists. */
var THERAPISTS_HEADERS = ['name', 'active'];
var TREATMENT_TYPES_HEADERS = ['name', 'active', 'isGroup'];

/* Seed values. A fresh sheet is seeded with the full list; an existing sheet has
 * any MISSING seed names appended (by name) so additions here reach live sheets
 * too. Retiring an entry sets active=false (the row stays), so a retired name is
 * still "present" and never re-added — only a hard row delete would resurrect a
 * seed name. (דליה appears once; activeNames also de-dupes by name.) */
var THERAPISTS_SEED = [
  'כנרת', 'דליה', 'הילה', 'עידו', 'חנן', 'מעיין', 'איתן',
  'אלה', 'שירן', 'ד"ר שפרינץ', 'דנה', 'רמי', 'ד"ר נטליה',
  'מרים', 'יסמין', 'תמר', 'שחר', 'יפעת'
];
var TREATMENT_TYPES_SEED = [
  { name: 'פרטני כללי', active: 'true', isGroup: 'false' },
  { name: 'פרטני CBT',  active: 'true', isGroup: 'false' },
  { name: 'פרטני EMDR', active: 'true', isGroup: 'false' },
  { name: 'טיפול משפחתי', active: 'true', isGroup: 'false' },
  { name: 'קבוצה',      active: 'true', isGroup: 'true' },
  { name: 'ליווי יומי בקהילה', active: 'true', isGroup: 'false' },
  { name: 'פסיכודינמי', active: 'true', isGroup: 'false' },
  { name: 'פסיכותרפי ממוקד טראומה', active: 'true', isGroup: 'false' },
  { name: 'עיסוי טיפולי', active: 'true', isGroup: 'false' },
  { name: 'מעקב פסיכיאטרי', active: 'true', isGroup: 'false' },
  { name: 'טיפול ממוקד התמכרויות', active: 'true', isGroup: 'false' },
  { name: 'טיפול אינטגרטיבי', active: 'true', isGroup: 'false' }
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
    _forcePhoneTextFormat(sh, headers);
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
  _forcePhoneTextFormat(sh, headers);
  return sh;
}

/* Force a phone column (Patients.phone / Schedule.patientPhone) to PLAIN TEXT
 * ('@') so Sheets keeps the leading zero instead of coercing "0501234567" to the
 * number 501234567 on write. Applied to the whole column so every appended row
 * inherits text format. Idempotent — safe to run on every ensure. (Existing
 * already-stripped values are recovered on READ by _restoreStoredPhone.) */
function _forcePhoneTextFormat(sh, headers) {
  ['phone', 'patientPhone'].forEach(function (h) {
    var idx = headers.indexOf(h);
    if (idx > -1) {
      sh.getRange(1, idx + 1, sh.getMaxRows(), 1).setNumberFormat('@');
    }
  });
}

/* Ensure an editable list sheet exists and APPEND any missing seed names. A
 * fresh sheet gets the full seed; an existing sheet gets only the seed names it
 * doesn't already have (matched case-insensitively by name), so additions to the
 * seed reach live sheets. Existing rows are never modified — an admin's
 * add/retire/reactivate edits always win, and a retired (active=false) name is
 * still "present" so it is never re-added. */
function _ensureSeededList(name, headers, seedRows) {
  var sh = _ensureSheet(name, headers);
  if (!seedRows || !seedRows.length) return sh;
  var have = {};
  _readAll(sh, headers).forEach(function (r) {
    var n = String(r.name == null ? '' : r.name).trim().toLowerCase();
    if (n) have[n] = true;
  });
  var toAdd = [];
  seedRows.forEach(function (r) {
    var n = String(r.name == null ? '' : r.name).trim().toLowerCase();
    if (n && !have[n]) { have[n] = true; toAdd.push(r); }
  });
  if (toAdd.length) {
    var values = toAdd.map(function (r) {
      return headers.map(function (h) {
        var v = r[h];
        return (v === undefined || v === null) ? '' : v;
      });
    });
    sh.getRange(sh.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
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
        // Mirror of public/sheetdate.js formatCell: a time-only cell is stored
        // by Sheets on the epoch day (1899-12-30); format it as HH:mm, not as a
        // date (that produced the bogus "1899-12-30" next to bookings). Real
        // dates → yyyy-MM-dd.
        var tz = Session.getScriptTimeZone() || 'Asia/Jerusalem';
        v = (v.getFullYear() < 1900)
          ? Utilities.formatDate(v, tz, 'HH:mm')
          : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
      }
      obj[headers[c]] = v;
    }
    out.push(obj);
  }
  return out;
}

function _upsertByKey(sh, headers, keyName, obj) {
  var keyIdx = headers.indexOf(keyName);
  var lastRow = sh.getLastRow();
  var row = headers.map(function (h) {
    var v = obj[h];
    return (v === undefined || v === null) ? '' : v;
  });
  if (lastRow > 1) {
    var keys = sh.getRange(2, keyIdx + 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0]) === String(obj[keyName])) {
        sh.getRange(i + 2, 1, 1, headers.length).setValues([row]);
        return { updated: true };
      }
    }
  }
  sh.appendRow(row);
  return { created: true };
}

function _getData() {
  var schSh = _ensureSheet('Schedule', SCHEDULE_HEADERS);
  var aSh = _ensureSheet('Approvals', APPROVALS_HEADERS);
  var pSh = _ensureSheet('Patients', PATIENTS_HEADERS);
  var asSh = _ensureSheet('Assignments', ASSIGNMENTS_HEADERS);
  var thSh = _ensureSeededList('Therapists', THERAPISTS_HEADERS,
    THERAPISTS_SEED.map(function (n) { return { name: n, active: 'true' }; }));
  var ttSh = _ensureSeededList('TreatmentTypes', TREATMENT_TYPES_HEADERS, TREATMENT_TYPES_SEED);
  // Recover any leading zero Sheets dropped from a stored phone, so the matching
  // key + display are intact for existing (pre-text-format) rows.
  var schedule = _readAll(schSh, SCHEDULE_HEADERS).map(function (r) {
    r.patientPhone = _restoreStoredPhone(r.patientPhone); return r;
  });
  var patients = _readAll(pSh, PATIENTS_HEADERS).map(function (r) {
    r.phone = _restoreStoredPhone(r.phone); return r;
  });
  return {
    ok: true,
    schedule: schedule,
    approvals: _readAll(aSh, APPROVALS_HEADERS),
    patients: patients,
    assignments: _readAll(asSh, ASSIGNMENTS_HEADERS),
    therapists: _readAll(thSh, THERAPISTS_HEADERS),
    treatmentTypes: _readAll(ttSh, TREATMENT_TYPES_HEADERS)
  };
}

/* ===== Server-authoritative gate enforcement =====
 * Inline mirror of public/treatment-guard.js + public/debt-gate.js +
 * public/phone.js. Apps Script can't import those modules; any change to the
 * policy or the matching rule MUST update both sides. Unit-tested via
 * test/treatment-guard.test.js / test/debt-gate.test.js (the pure modules).
 *
 * Runs PER PATIENT ROW: a group session is a set of independent gate decisions,
 * so a forged 'clear' for one debtor is rejected without affecting the others.
 */

var ALLOWED_APPROVERS = { ron: 'רון', sandra: 'סנדרה' };
function _resolveApproverId(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (ALLOWED_APPROVERS[s.toLowerCase()]) return s.toLowerCase();
  for (var id in ALLOWED_APPROVERS) { if (ALLOWED_APPROVERS[id] === s) return id; }
  return '';
}
function _isAllowedApprover(v) { return !!_resolveApproverId(v); }

// Mirror of TreatmentGuard.decideSave — see that file for the full contract.
function _decideSave(input) {
  input = input || {};
  var gateStatus = String(input.gateStatus || '').toLowerCase();
  var v = String(input.verification || 'unconfigured').toLowerCase();
  if (gateStatus === 'flagged') return { ok: true };
  if (gateStatus === 'approved') {
    if (!_isAllowedApprover(input.approverId)) return { ok: false, error: 'invalid_approver' };
    if (v === 'block') return { ok: true };
    if (v === 'allow') return { ok: true };
    if (v === 'unconfigured') return { ok: false, error: 'debt_verification_unconfigured' };
    if (v === 'unavailable') return { ok: false, error: 'debt_verification_unavailable' };
    return { ok: false, error: 'debt_verification_failed' };
  }
  if (gateStatus === 'clear' || gateStatus === '') {
    if (v === 'allow') return { ok: true };
    if (v === 'unconfigured') return { ok: false, error: 'debt_verification_unconfigured' };
    if (v === 'unavailable') return { ok: false, error: 'debt_verification_unavailable' };
    return { ok: false, error: 'debt_verification_failed' };
  }
  return { ok: false, error: 'invalid_gate_status' };
}

// Mirror of public/phone.js normalizeForMatch.
function _normalizePhoneForMatch(raw) {
  if (raw == null) return '';
  var digits = String(raw).replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.indexOf('972') === 0) digits = '0' + digits.slice(3);
  return digits;
}

// Mirror of public/phone.js toCanonical: normalize then validate. Returns the
// canonical 10-digit (leading-zero) phone, or '' when it can't be made canonical.
// Server-side enforcement so no badly-formatted number is ever stored.
var _CANONICAL_PHONE_RE = /^0\d{9}$/;
function _toCanonicalPhone(raw) {
  var norm = _normalizePhoneForMatch(raw);
  return _CANONICAL_PHONE_RE.test(norm) ? norm : '';
}

// Mirror of public/phone.js restoreStored: recover the leading zero Sheets
// dropped from a STORED phone (a canonical 0XXXXXXXXX coerced to the 9-digit
// number XXXXXXXXX). Normalize, and if exactly 9 digits — the lost-zero
// signature — prepend the 0; return canonical when recovery yields one, else the
// original string untouched. Recovery of data corrupted at rest, NOT the entry
// path (a human-typed no-leading-zero number is still rejected on save).
function _restoreStoredPhone(raw) {
  if (raw == null) return '';
  var s = String(raw).trim();
  if (!s) return '';
  var digits = _normalizePhoneForMatch(s);
  if (digits.length === 9) digits = '0' + digits;
  return _CANONICAL_PHONE_RE.test(digits) ? digits : s;
}

// Mirror of public/debt-gate.js evaluate(), returning only 'allow'|'block'|'flag'.
function _authoritativeGate(phone, roster) {
  var key = _normalizePhoneForMatch(phone);
  if (!key || !roster || !roster.length) return 'flag';
  var hits = [];
  for (var i = 0; i < roster.length; i++) {
    var c = roster[i];
    if (c && _normalizePhoneForMatch(c.phone) === key) hits.push(c);
  }
  if (hits.length !== 1) return 'flag';
  var status = String(hits[0].debtStatus || '').toLowerCase();
  if (status === 'debt') return 'block';
  if (status === 'clear') return 'allow';
  return 'flag';
}

// One live fetch of the outpatient debt roster, cached per execution so a group
// save re-checks every patient against the SAME live snapshot with one network
// call. Returns { status:'ok', clients:[...] } or { status:'unconfigured' } /
// { status:'unavailable' } (fail closed).
var _debtRosterCache = null;
function _liveDebtRoster() {
  if (_debtRosterCache) return _debtRosterCache;
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('OUTPATIENT_SHEETS_URL');
  var secret = props.getProperty('DEBT_STATUS_SECRET');
  if (!url) { _debtRosterCache = { status: 'unconfigured' }; return _debtRosterCache; }
  try {
    var full = url + (url.indexOf('?') > -1 ? '&' : '?') + 'action=getDebtStatus' +
      (secret ? '&secret=' + encodeURIComponent(secret) : '');
    var resp = UrlFetchApp.fetch(full, { muteHttpExceptions: true, followRedirects: true });
    var code = resp.getResponseCode();
    if (code < 200 || code >= 300) { _debtRosterCache = { status: 'unavailable' }; return _debtRosterCache; }
    var data = JSON.parse(resp.getContentText());
    if (!data || data.ok === false || !Array.isArray(data.clients)) {
      _debtRosterCache = { status: 'unavailable' }; return _debtRosterCache;
    }
    _debtRosterCache = { status: 'ok', clients: data.clients };
    return _debtRosterCache;
  } catch (e) {
    _debtRosterCache = { status: 'unavailable' };
    return _debtRosterCache;
  }
}

// Authoritative verification string for one patient row: 'unconfigured',
// 'unavailable', or the gate ('allow'|'block'|'flag').
function _verifyPatientDebt(phone) {
  var roster = _liveDebtRoster();
  if (roster.status !== 'ok') return roster.status;   // unconfigured | unavailable
  return _authoritativeGate(phone, roster.clients);
}

// Save ONE schedule row with server-authoritative per-patient gate enforcement.
// A 'clear'/'approved'/'' claim is re-verified against live debt and fails
// CLOSED; 'flagged' rows persist as-is for manual resolution.
function _saveScheduleRow(t, schSh, aSh) {
  if (!t || typeof t !== 'object') return { ok: false, error: 'missing_row' };
  if (!t.id) return { ok: false, error: 'missing_id' };

  // Normalize + validate the phone; never store a non-canonical number.
  var canon = _toCanonicalPhone(t.patientPhone);
  if (!canon) return { ok: false, error: 'invalid_phone' };
  t.patientPhone = canon;

  var verification = 'unconfigured';
  var needsVerify = (t.gateStatus === 'clear' || t.gateStatus === 'approved' || !t.gateStatus);
  if (needsVerify) verification = _verifyPatientDebt(t.patientPhone);
  var guard = _decideSave({
    gateStatus: t.gateStatus,
    approverId: t.approverId,
    verification: verification
  });
  if (!guard.ok) return { ok: false, error: guard.error };

  var res = _upsertByKey(schSh, SCHEDULE_HEADERS, 'id', t);

  if (t.gateStatus === 'approved' && t.approverId) {
    _upsertByKey(aSh, APPROVALS_HEADERS, 'id', {
      id: t.id,
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
  return { ok: true, id: t.id, created: !!res.created, updated: !!res.updated };
}

// Save a whole session: 1+ patient rows that share a sessionId. Each row is
// verified and saved INDEPENDENTLY; a per-row failure (e.g. a forged debtor
// claim) rejects that row only, leaving the rest of the group saved. Overall
// ok is true when every row saved.
function _saveSession(payload) {
  var rows = payload && (payload.rows || (payload.row ? [payload.row] : null));
  if (!Array.isArray(rows) || !rows.length) return { ok: false, error: 'missing_rows' };
  _debtRosterCache = null;            // fresh live snapshot per session save
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    var schSh = _ensureSheet('Schedule', SCHEDULE_HEADERS);
    var aSh = _ensureSheet('Approvals', APPROVALS_HEADERS);
    var results = rows.map(function (t) {
      var r = _saveScheduleRow(t, schSh, aSh);
      return { id: t && t.id, ok: r.ok, error: r.error || '', created: !!r.created, updated: !!r.updated };
    });
    var allOk = results.every(function (r) { return r.ok; });
    return { ok: allOk, results: results };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// Post-treatment report (per patient row). 'missed' records a reason. 'happened'
// is DEBT-GATED, authoritatively (server re-reads live debt): a CONFIRMED debtor
// is BLOCKED unless Ron/Sandra approve inline (audit-stamped). When debt can't be
// determined (endpoint unconfigured/unavailable, or no/ambiguous match) the
// report is recorded but FLAGGED for manual resolution — never silently 'clear'.
function _markAttendance(payload) {
  var id = payload && payload.id;
  if (!id) return { ok: false, error: 'missing_id' };
  var attendance = String(payload.attendance == null ? '' : payload.attendance);
  if (attendance !== '' && attendance !== 'occurred' && attendance !== 'missed') {
    return { ok: false, error: 'invalid_attendance' };
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _ensureSheet('Schedule', SCHEDULE_HEADERS);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: false, error: 'not_found' };
    var idIdx = SCHEDULE_HEADERS.indexOf('id');
    var sidIdx = SCHEDULE_HEADERS.indexOf('sessionId');
    var phoneIdx = SCHEDULE_HEADERS.indexOf('patientPhone');
    var grid = sh.getRange(2, 1, lastRow - 1, SCHEDULE_HEADERS.length).getValues();
    var found = -1;
    for (var i = 0; i < grid.length; i++) {
      if (String(grid[i][idIdx]) === String(id)) { found = i; break; }
    }
    if (found < 0) return { ok: false, error: 'not_found' };

    // Default gate fields for this report.
    var gateStatus = '', gateReason = '', amountOwed = 0;
    var appr = payload.approval || null;

    // happened → authoritative debt re-check (the payment-driving action).
    if (attendance === 'occurred') {
      var phone = _restoreStoredPhone(grid[found][phoneIdx]);
      var verification = _verifyPatientDebt(phone);   // allow|block|flag|unconfigured|unavailable
      if (verification === 'allow') {
        gateStatus = 'clear';
      } else if (verification === 'block') {
        if (!appr || !_isAllowedApprover(appr.approverId)) {
          return { ok: false, error: 'debt_block' };   // BLOCK — needs Ron/Sandra
        }
        gateStatus = 'approved';
        amountOwed = Number(appr.amountOwed) || 0;
      } else {
        // flag / unconfigured / unavailable — record but FLAG (never 'clear').
        gateStatus = 'flagged';
        gateReason = String(payload.gateReason || verification || 'unverified');
      }
    }

    // LOCAL SAVE IS THE SOURCE OF TRUTH — persist the report fields.
    function setCol(name, val) {
      var idx = SCHEDULE_HEADERS.indexOf(name);
      if (idx > -1) sh.getRange(found + 2, idx + 1, 1, 1).setValues([[val]]);
    }
    setCol('attendance', attendance);
    setCol('attendanceMarkedAt', payload.markedAt || new Date().toISOString());
    setCol('reason', attendance === 'missed' ? String(payload.reason || '') : '');
    setCol('gateStatus', gateStatus);
    setCol('gateReason', gateReason);
    if (gateStatus === 'approved') {
      setCol('amountOwed', amountOwed);
      setCol('approverId', appr.approverId || '');
      setCol('approverName', appr.approverName || '');
      setCol('approvalNote', appr.note || '');
      setCol('approvedAt', appr.approvedAt || new Date().toISOString());
      // Append to the debtor-approval audit trail.
      _upsertByKey(_ensureSheet('Approvals', APPROVALS_HEADERS), APPROVALS_HEADERS, 'id', {
        id: 'rep_' + id, treatmentId: id, approverId: appr.approverId || '',
        approverName: appr.approverName || '',
        patientName: String(grid[found][SCHEDULE_HEADERS.indexOf('patientName')] || ''),
        patientPhone: String(grid[found][phoneIdx] || ''),
        therapist: String(grid[found][SCHEDULE_HEADERS.indexOf('therapist')] || ''),
        note: appr.note || '', amountOwed: amountOwed, approvedAt: appr.approvedAt || new Date().toISOString()
      });
    }

    // Then sync the whole session to outpatient (best-effort). Any failure
    // leaves the row(s) 'pending' for a later retry — never dropped.
    var sessionId = String(grid[found][sidIdx] || id);
    var status = _syncSession(sh, sessionId);
    return { ok: true, id: id, attendance: attendance, gateStatus: gateStatus, syncStatus: status };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* ===== Outpatient write-back (TreatmentsGiven) =====
 * When attendance changes, sync the ENTIRE session to outpatient so the
 * idempotent records reflect the current truth. Mirrors public/writeback.js
 * (buildSessionWriteback); any change MUST update both. Therapist pay: one
 * record per non-group patient, but ONE record at the group rate for a קבוצה
 * session (keyed by sessionId), with per-patient attendance still captured. */

function _isGroupTypeName(typeName) {
  var name = String(typeName == null ? '' : typeName).trim();
  if (!name) return false;
  var ttSh = _ensureSeededList('TreatmentTypes', TREATMENT_TYPES_HEADERS, TREATMENT_TYPES_SEED);
  var rows = _readAll(ttSh, TREATMENT_TYPES_HEADERS);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].name == null ? '' : rows[i].name).trim() === name) {
      var f = rows[i].isGroup;
      if (f !== undefined && f !== null && f !== '') {
        var s = String(f).trim().toLowerCase();
        return s === 'true' || s === '1' || s === 'yes' || s === 'כן';
      }
      return name === 'קבוצה';
    }
  }
  return name === 'קבוצה';
}

// Mirror of public/writeback.js buildSessionWriteback.
function _buildSessionWriteback(rows, isGroup) {
  rows = (rows || []).filter(function (r) { return r; });
  if (!rows.length) return null;
  var head = rows[0];
  var sessionId = head.sessionId || head.id;
  var anyGiven = rows.some(function (r) { return String(r.attendance || '') === 'occurred'; });
  var records = rows.map(function (r) {
    return {
      treatmentId: r.id, sessionId: sessionId, therapist: head.therapist,
      patientName: r.patientName, patientPhone: r.patientPhone, date: r.scheduledDate,
      treatmentType: head.treatmentType, location: head.location,
      attendance: String(r.attendance || ''), given: String(r.attendance || '') === 'occurred',
      isGroup: isGroup, isPayment: !isGroup, rate: isGroup ? 'group_member' : 'individual'
    };
  });
  if (isGroup) {
    records.push({
      treatmentId: sessionId, sessionId: sessionId, therapist: head.therapist,
      patientName: '', patientPhone: '', date: head.scheduledDate,
      treatmentType: head.treatmentType, location: head.location,
      attendance: anyGiven ? 'occurred' : '', given: anyGiven,
      isGroup: true, isPayment: true, rate: 'group'
    });
  }
  return { sessionId: sessionId, isGroup: isGroup, records: records };
}

// POST the records to the outpatient recordTreatmentGiven endpoint with the
// shared secret. Idempotent on the outpatient side (upsert by treatmentId).
// Returns 'synced' or 'pending' (never throws). Fails to 'pending' when the
// endpoint is unconfigured or unreachable so the local mark is never lost.
function _postTreatmentsGiven(records) {
  if (!records || !records.length) return 'synced';
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('OUTPATIENT_SHEETS_URL');
  var secret = props.getProperty('TREATMENT_GIVEN_SECRET');
  if (!url || !secret) return 'pending';
  try {
    var full = url + (url.indexOf('?') > -1 ? '&' : '?') +
      'action=recordTreatmentGiven&secret=' + encodeURIComponent(secret);
    var resp = UrlFetchApp.fetch(full, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ records: records }),
      muteHttpExceptions: true, followRedirects: true
    });
    var code = resp.getResponseCode();
    if (code < 200 || code >= 300) return 'pending';
    var data = JSON.parse(resp.getContentText());
    if (!data || data.ok === false) return 'pending';
    return 'synced';
  } catch (e) {
    return 'pending';
  }
}

// Build + send the write-back for one session and stamp syncStatus/syncedAt on
// every row of that session. Returns the status. `sh` is the open Schedule sheet.
function _syncSession(sh, sessionId) {
  var rows = _readAll(sh, SCHEDULE_HEADERS).filter(function (r) {
    return String(r.sessionId || r.id) === String(sessionId);
  });
  if (!rows.length) return 'synced';
  var isGroup = _isGroupTypeName(rows[0].treatmentType);
  var wb = _buildSessionWriteback(rows, isGroup);
  var status = _postTreatmentsGiven(wb ? wb.records : []);
  _stampSessionSync(sh, sessionId, status);
  return status;
}

// Set syncStatus + syncedAt on every Schedule row of the session.
function _stampSessionSync(sh, sessionId, status) {
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return;
  var sidIdx = SCHEDULE_HEADERS.indexOf('sessionId');
  var idIdx = SCHEDULE_HEADERS.indexOf('id');
  var ssIdx = SCHEDULE_HEADERS.indexOf('syncStatus');
  var saIdx = SCHEDULE_HEADERS.indexOf('syncedAt');
  var grid = sh.getRange(2, 1, lastRow - 1, SCHEDULE_HEADERS.length).getValues();
  var now = new Date().toISOString();
  for (var i = 0; i < grid.length; i++) {
    var sid = String(grid[i][sidIdx] || grid[i][idIdx]);
    if (sid === String(sessionId)) {
      sh.getRange(i + 2, ssIdx + 1, 1, 1).setValues([[status]]);
      if (status === 'synced') sh.getRange(i + 2, saIdx + 1, 1, 1).setValues([[now]]);
    }
  }
}

// Retry every session that still has a 'pending' row. Idempotent.
function _syncPending() {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    var sh = _ensureSheet('Schedule', SCHEDULE_HEADERS);
    var rows = _readAll(sh, SCHEDULE_HEADERS);
    var seen = {};
    var sessions = [];
    rows.forEach(function (r) {
      if (String(r.syncStatus || '') === 'pending') {
        var sid = String(r.sessionId || r.id);
        if (!seen[sid]) { seen[sid] = true; sessions.push(sid); }
      }
    });
    var results = sessions.map(function (sid) { return { sessionId: sid, status: _syncSession(sh, sid) }; });
    var stillPending = results.filter(function (r) { return r.status === 'pending'; }).length;
    return { ok: true, attempted: sessions.length, stillPending: stillPending, results: results };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// Upsert a patient intake record, keyed by canonical phone: identity + origin.
// The therapist assignment(s) + treatment plan(s) live in Assignments, so this
// no longer carries a single assignedTherapist/plan. Not debt-gated.
function _savePatient(payload) {
  var p = payload && payload.patient;
  if (!p || typeof p !== 'object') return { ok: false, error: 'missing_patient' };
  if (String(p.phone == null ? '' : p.phone).trim() === '') return { ok: false, error: 'missing_phone' };
  var phone = _toCanonicalPhone(p.phone);   // normalize + validate; never store non-canonical
  if (!phone) return { ok: false, error: 'invalid_phone' };
  var mode = String(payload.mode || '');
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    var sh = _ensureSheet('Patients', PATIENTS_HEADERS);
    // One record per canonical phone — on CREATE, block a duplicate (mirror of
    // public/patient-dedupe.js isDuplicateCreate). Edit (mode !== 'create')
    // upserts the same row; multiple assignments per patient are unaffected.
    if (mode === 'create') {
      var existing = _readAll(sh, PATIENTS_HEADERS);
      for (var i = 0; i < existing.length; i++) {
        if (_toCanonicalPhone(_restoreStoredPhone(existing[i].phone)) === phone) {
          return { ok: false, error: 'duplicate_phone', existingName: existing[i].name || '' };
        }
      }
    }
    var rec = {
      phone: phone,
      name: p.name || '',
      origin: p.origin || '',
      stillAdmitted: p.stillAdmitted ? 'true' : '',
      admittedHouse: p.stillAdmitted ? (p.admittedHouse || '') : '',
      active: (p.active === false || p.active === 'false') ? 'false' : 'true',
      updatedBy: p.updatedBy || '',
      updated: p.updated || new Date().toISOString()
    };
    var res = _upsertByKey(sh, PATIENTS_HEADERS, 'phone', rec);
    return { ok: true, patient: rec, created: !!res.created, updated: !!res.updated };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// Upsert one assignment (patient ↔ therapist ↔ plan), keyed by id. A patient can
// have several active assignments — multiple parallel treatments/therapists.
// Both the therapist and the plan (type + weekly frequency) stay editable.
function _saveAssignment(payload) {
  var a = payload && payload.assignment;
  if (!a || typeof a !== 'object') return { ok: false, error: 'missing_assignment' };
  if (!a.id) return { ok: false, error: 'missing_id' };
  var phone = String(a.patientPhone == null ? '' : a.patientPhone).trim();
  if (!phone) return { ok: false, error: 'missing_phone' };
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    var sh = _ensureSheet('Assignments', ASSIGNMENTS_HEADERS);
    var rec = {
      id: String(a.id),
      patientPhone: phone,
      therapist: a.therapist || '',
      treatmentType: a.treatmentType || '',
      frequencyPerWeek: (a.frequencyPerWeek === 0 || a.frequencyPerWeek) ? String(a.frequencyPerWeek) : '',
      active: (a.active === false || a.active === 'false') ? 'false' : 'true',
      updatedBy: a.updatedBy || '',
      updated: a.updated || new Date().toISOString()
    };
    var res = _upsertByKey(sh, ASSIGNMENTS_HEADERS, 'id', rec);
    return { ok: true, assignment: rec, created: !!res.created, updated: !!res.updated };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function _removeAssignment(id) {
  if (!id) return { ok: false, error: 'missing_id' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _ensureSheet('Assignments', ASSIGNMENTS_HEADERS);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: false, error: 'not_found' };
    var idIdx = ASSIGNMENTS_HEADERS.indexOf('id');
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

// Edit an existing booking's day / time / location (by id). Debt is per-patient,
// not per-slot, so this does NOT re-run the gate. If the booking was already
// reported (attendance set), re-sync the session so outpatient gets the corrected
// date/time (idempotent by treatmentId); an unreported booking isn't synced yet.
function _updateBooking(payload) {
  var id = payload && payload.id;
  if (!id) return { ok: false, error: 'missing_id' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _ensureSheet('Schedule', SCHEDULE_HEADERS);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: false, error: 'not_found' };
    var idIdx = SCHEDULE_HEADERS.indexOf('id');
    var sidIdx = SCHEDULE_HEADERS.indexOf('sessionId');
    var attIdx = SCHEDULE_HEADERS.indexOf('attendance');
    var grid = sh.getRange(2, 1, lastRow - 1, SCHEDULE_HEADERS.length).getValues();
    var found = -1;
    for (var i = 0; i < grid.length; i++) {
      if (String(grid[i][idIdx]) === String(id)) { found = i; break; }
    }
    if (found < 0) return { ok: false, error: 'not_found' };
    function setCol(name, val) {
      var idx = SCHEDULE_HEADERS.indexOf(name);
      if (idx > -1) sh.getRange(found + 2, idx + 1, 1, 1).setValues([[val]]);
    }
    if (payload.scheduledDate != null) setCol('scheduledDate', String(payload.scheduledDate));
    if (payload.time != null) setCol('time', String(payload.time));
    if (payload.location != null) setCol('location', String(payload.location));

    var status = '';
    if (String(grid[found][attIdx] || '') !== '') {   // already reported → re-sync the correction
      status = _syncSession(sh, String(grid[found][sidIdx] || id));
    }
    return { ok: true, id: id, syncStatus: status };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function _removeSchedule(id) {
  if (!id) return { ok: false, error: 'missing_id' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _ensureSheet('Schedule', SCHEDULE_HEADERS);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: false, error: 'not_found' };
    var idIdx = SCHEDULE_HEADERS.indexOf('id');
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
    var action = (e && e.parameter && e.parameter.action) || 'saveSession';
    var payload = {};
    if (e.postData && e.postData.contents) {
      try { payload = JSON.parse(e.postData.contents); } catch (err) {}
      if (payload && payload.action) action = payload.action;
    }
    if (action === 'getData') return _json(_getData());
    if (action === 'saveSession') return _json(_saveSession(payload));
    if (action === 'markAttendance') return _json(_markAttendance(payload));
    if (action === 'syncPending') return _json(_syncPending());
    if (action === 'savePatient') return _json(_savePatient(payload));
    if (action === 'saveAssignment') return _json(_saveAssignment(payload));
    if (action === 'updateBooking') return _json(_updateBooking(payload));
    if (action === 'removeAssignment') {
      var aid = payload.id || (payload.assignment && payload.assignment.id) || '';
      return _json(_removeAssignment(aid));
    }
    if (action === 'removeSchedule') {
      var id = payload.id || (payload.row && payload.row.id) || '';
      return _json(_removeSchedule(id));
    }
    return _json({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}
