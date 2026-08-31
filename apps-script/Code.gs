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
 *   - Therapists      {name, active} — feeds the dropdown. SYNCED from the
 *                     ezone-staffing roster feed on every getData (names are
 *                     edited THERE; `active` is overwritten by every sync).
 *   - TreatmentTypes  editable list {name, active, isGroup} — feeds the dropdown.
 *
 * The TreatmentTypes list is ADMIN-EDITABLE with an active flag: retiring a row
 * removes it from the dropdown going forward but NEVER rewrites a Schedule row
 * that already references it by string. The same never-rewrite rule holds for
 * therapist names: a deactivated therapist drops out of the dropdown only.
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
 *       DEACTIVATE_CLIENT_SECRET = the shared deactivateClient secret — on patient
 *                                delete here, DEACTIVATES the matching outpatient
 *                                Client so it leaves the roster union. FAIL-CLOSED:
 *                                until set (and the outpatient receiver deployed),
 *                                deleting a patient changes nothing locally.
 *       STAFFING_SHEETS_URL    = the ezone-staffing /exec URL — the therapist
 *                                roster feed (the roster's source of truth).
 *       STAFFING_THERAPISTS_SECRET = the shared getTherapistsForTherapists secret
 *                                (= staffing's THERAPISTS_READ_SECRET). Until both
 *                                are set, the roster sync reports 'unconfigured'
 *                                and serves the last-synced sheet (no writes).
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
  'time', 'reason',         // iteration 7 — appended (time-of-day; not-done reason)
  'outcome', 'outcomeAt',   // iteration 18 step 2 — appended (3-state session outcome + stamp)
  'room'                    // appended — treatment room (free text); Yarden fills, visible to all
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
 * a patient can have MULTIPLE parallel treatments/therapists, all editable.
 * The `stopped*` columns (appended) hold a LOCAL stop flag: set when a stop
 * request was sent to outpatient (flagStop) and pending Vered's confirmation. */
var PATIENTS_HEADERS = [
  'phone', 'name',
  'origin', 'stillAdmitted', 'admittedHouse',
  'active', 'updatedBy', 'updated',
  'stopped', 'stoppedBy', 'stoppedAt', 'stopNote'   // local stop flag (append-only)
];

/* One row per (patient, therapist, treatment plan). A patient may have several
 * active rows — multiple parallel treatments with multiple therapists. `id` is
 * the client-generated upsert key; `patientPhone` links to Patients/roster.
 * Retiring a plan sets active=false (the row stays for history). `slots` (appended)
 * is the weekly recurring pattern: JSON [{weekday,time,location}], N = frequencyPerWeek. */
var ASSIGNMENTS_HEADERS = [
  'id', 'patientPhone', 'therapist', 'treatmentType', 'frequencyPerWeek',
  'active', 'updatedBy', 'updated',
  'slots'                                  // weekly recurring pattern (append-only)
];

/* Editable, active-flagged lists. */
var THERAPISTS_HEADERS = ['name', 'active'];
var TREATMENT_TYPES_HEADERS = ['name', 'active', 'isGroup'];

/* Per-patient management panel (ניהול מטופל). APPEND-ONLY headers — mirror of
 * public/patient-mgmt.js NOTES_HEADERS / PATIENT_META_HEADERS. New columns go at
 * the END only; test/patient-mgmt.test.js guards this order on both sides.
 *   Notes       — append-only audit trail; one row per note, newest-first on read.
 *   PatientMeta — ONE editable row per patient (keyed by canonical phone),
 *                 last-writer-wins, stamped with updatedBy/updatedAt on every save. */
var NOTES_HEADERS = ['phone', 'timestamp', 'author', 'type', 'text'];
var PATIENT_META_HEADERS = [
  'phone', 'status', 'statusReason', 'statusDate',
  'contactName', 'contactPhone', 'referral', 'goals',
  'updatedBy', 'updatedAt'
];
/* FollowUps (משימות מעקב) — APPEND-ONLY, mirror of public/patient-mgmt.js
 * FOLLOWUPS_HEADERS. One row per task; `id` is a server-generated timestamp-based
 * unique string; `done` is a 'true'/'' flag flipped by setFollowUpDone. */
var FOLLOWUPS_HEADERS = [
  'phone', 'id', 'createdAt', 'createdBy', 'dueDate', 'text', 'done', 'doneAt', 'doneBy'
];

/* Seed values (TreatmentTypes only). A fresh sheet is seeded with the full list;
 * an existing sheet has any MISSING seed names appended (by name) so additions
 * here reach live sheets too. Retiring an entry sets active=false (the row
 * stays), so a retired name is still "present" and never re-added — only a hard
 * row delete would resurrect a seed name.
 * The Therapists list has NO seed anymore: its source of truth is the
 * ezone-staffing app (workers with role מטפל/ת), synced on every getData by
 * _syncTherapistsFromStaffing — see the staffing roster sync section below. */
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
    _forcePhoneColumnsText(sh, headers);
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
  _forcePhoneColumnsText(sh, headers);
  return sh;
}

// Pin every phone column to the '@' (plain text) number format so future saves
// keep the leading zero instead of being coerced to a number. Covers the whole
// column (all current + future rows). This protects NEW writes; rows already
// mangled into numbers are repaired on read by _recoverStoredPhone.
function _forcePhoneColumnsText(sh, headers) {
  for (var i = 0; i < headers.length; i++) {
    if (_isPhoneHeader(headers[i])) {
      sh.getRange(1, i + 1, sh.getMaxRows(), 1).setNumberFormat('@');
    }
  }
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
      } else if (_isPhoneHeader(headers[c])) {
        // Repair a phone whose leading zero Sheets dropped on storage.
        v = _recoverStoredPhone(v);
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
  // The Therapists list is SYNCED from the ezone-staffing roster feed (no seed).
  // On feed failure the last-synced sheet is served as-is and rosterSource says
  // why, so the frontend can warn without blocking anything.
  var thSync = _syncTherapistsFromStaffing();
  var ttSh = _ensureSeededList('TreatmentTypes', TREATMENT_TYPES_HEADERS, TREATMENT_TYPES_SEED);
  return {
    ok: true,
    schedule: _readAll(schSh, SCHEDULE_HEADERS),
    approvals: _readAll(aSh, APPROVALS_HEADERS),
    patients: _readAll(pSh, PATIENTS_HEADERS),
    assignments: _readAll(asSh, ASSIGNMENTS_HEADERS),
    therapists: _readAll(thSync.sh, THERAPISTS_HEADERS),
    treatmentTypes: _readAll(ttSh, TREATMENT_TYPES_HEADERS),
    rosterSource: thSync.source,
    rosterSyncSummary: thSync.summary
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

// Mirror of public/phone.js recoverStored: READ-side repair of a phone whose
// leading zero Sheets dropped when it stored a canonical number on a numeric
// cell (e.g. the number 501234567 for "0501234567"). A 9-digit run not starting
// with 0 gets its leading 0 restored; everything else is returned as a trimmed
// string, untouched. NOT an entry path — human input is still strictly validated.
function _recoverStoredPhone(raw) {
  if (raw == null) return '';
  var s = String(raw).trim();
  if (!s) return '';
  var digits = s.replace(/[^\d]/g, '');
  if (digits.length === 9 && digits.charAt(0) !== '0') return '0' + digits;
  return s;
}

// Mirror of public/phone.js duplicateOf: the create-time duplicate guard.
// Returns the first existing patient row that already owns `phone` (matched
// tolerantly), or null. Inactive patients still own their phone key.
function _duplicatePatient(phone, patients) {
  var key = _normalizePhoneForMatch(phone);
  if (!key || !patients || !patients.length) return null;
  for (var i = 0; i < patients.length; i++) {
    var p = patients[i];
    if (p && _normalizePhoneForMatch(p.phone) === key) return p;
  }
  return null;
}

// Columns that MUST stay plain text so a leading-zero phone is never coerced to a
// number (the bug that drops the zero). Matched by header name across all sheets.
function _isPhoneHeader(h) { return h === 'phone' || h === 'patientPhone' || h === 'contactPhone'; }

// Match key for a phone read from a RAW grid cell: REPAIR a leading zero Sheets
// dropped (mirror of _recoverStoredPhone), THEN normalize. _readAll already
// recovers on read, but raw-grid scans (the stop flow's row matchers) do not — so
// without this a canonical key never matches a mangled stored phone (501234567).
function _matchPhone(raw) { return _normalizePhoneForMatch(_recoverStoredPhone(raw)); }

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

// Materialize a VIRTUAL recurring occurrence into a real Schedule booking row.
// CREATE-ONLY + idempotent by the deterministic occurrence id: if a row with that
// id already exists (already reported/materialized) it is left untouched, so a
// stale occurrence payload can never wipe a reported row. Ungated — the debt gate
// runs at report time in _markAttendance.
function _materializeOccurrenceRow(sh, occ) {
  var id = String((occ && occ.id) || '');
  if (!id) return;
  var idIdx = SCHEDULE_HEADERS.indexOf('id');
  var lastRow = sh.getLastRow();
  if (lastRow > 1) {
    var ids = sh.getRange(2, idIdx + 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === id) return;   // already a real row — never overwrite
    }
  }
  var canon = _toCanonicalPhone(occ.patientPhone);
  _upsertByKey(sh, SCHEDULE_HEADERS, 'id', {
    id: id,
    sessionId: occ.sessionId || id,
    therapist: occ.therapist || '',
    treatmentType: occ.treatmentType || '',
    location: occ.location || '',
    room: occ.room || '',
    scheduledDate: occ.scheduledDate || '',
    patientName: occ.patientName || '',
    patientPhone: canon || String(occ.patientPhone == null ? '' : occ.patientPhone),
    attendance: '',
    time: occ.time || '',
    created: new Date().toISOString()
  });
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
    // A recurring occurrence is VIRTUAL until reported — materialize its booking
    // row now (create-only, idempotent by the deterministic id) so the rest of
    // this function reports it exactly like any other booking. The debt gate below
    // is the authoritative check; materialization itself is ungated.
    if (payload.occurrence && String(payload.occurrence.id) === String(id)) {
      _materializeOccurrenceRow(sh, payload.occurrence);
    }
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
      // Raw grid read — recover the leading zero a numeric-stored cell dropped
      // (mirror of _readAll/_matchPhone) so the debt-roster match doesn't fail and
      // silently mis-gate a legitimate patient to 'flagged'/'unverified'.
      var phone = _recoverStoredPhone(grid[found][phoneIdx]);
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
        // Raw grid read — recover the dropped leading zero so the audit row keeps
        // the canonical phone, not a mangled 9-digit number.
        patientPhone: _recoverStoredPhone(grid[found][phoneIdx]),
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

/* ===== Session outcome (iteration 18, step 2) =====
 * The therapist marks what actually happened to a scheduled session as exactly
 * ONE of three mutually-exclusive outcomes. STORAGE-ONLY: this records the
 * stamped outcome on the Schedule row and does NOTHING else — no debt gate, no
 * pay computation, no outpatient write-back (that is step 3). The legacy binary
 * `attendance` field + its writeback (_markAttendance / _syncSession) are left
 * deliberately untouched. The token set is CLOSED — mirror of public/outcome.js. */
var OUTCOME_VALUES = ['happened', 'therapist_cancelled', 'patient_no_show'];

function _setSessionOutcome(payload) {
  var id = payload && payload.id;
  if (!id) return { ok: false, error: 'missing_id' };
  var outcome = String(payload.outcome == null ? '' : payload.outcome);
  if (OUTCOME_VALUES.indexOf(outcome) === -1) return { ok: false, error: 'invalid_outcome' };
  var result;
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _ensureSheet('Schedule', SCHEDULE_HEADERS);
    // A recurring occurrence is VIRTUAL until acted on — materialize its booking
    // row now (create-only, idempotent by id) so we stamp a real row, exactly as
    // the report flow does. Materialization itself is ungated.
    if (payload.occurrence && String(payload.occurrence.id) === String(id)) {
      _materializeOccurrenceRow(sh, payload.occurrence);
    }
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: false, error: 'not_found' };
    var idIdx = SCHEDULE_HEADERS.indexOf('id');
    var grid = sh.getRange(2, 1, lastRow - 1, SCHEDULE_HEADERS.length).getValues();
    var found = -1;
    for (var i = 0; i < grid.length; i++) {
      if (String(grid[i][idIdx]) === String(id)) { found = i; break; }
    }
    if (found < 0) return { ok: false, error: 'not_found' };

    function col(name) { return String(grid[found][SCHEDULE_HEADERS.indexOf(name)] || ''); }
    // Phone cells stored numeric (legacy rows pre-dating the '@' text-format pin)
    // come back from this raw grid with their leading zero already dropped. A raw
    // grid read does NOT pass through _readAll, so recover the zero here — exactly
    // as _readAll/_matchPhone do — before the value feeds the canonical-key push
    // (otherwise _toCanonicalPhone rightly rejects the 9-digit number).
    function phoneCol(name) { return _recoverStoredPhone(grid[found][SCHEDULE_HEADERS.indexOf(name)]); }
    function setCol(name, val) {
      var idx = SCHEDULE_HEADERS.indexOf(name);
      if (idx > -1) sh.getRange(found + 2, idx + 1, 1, 1).setValues([[val]]);
    }
    var stampedAt = payload.outcomeAt || new Date().toISOString();
    setCol('outcome', outcome);
    setCol('outcomeAt', stampedAt);
    // The local stamp is now committed. Capture the self-describing row fields so
    // the outpatient pay-sync push can run AFTER the lock releases (below).
    result = {
      ok: true, id: id, outcome: outcome, outcomeAt: stampedAt,
      sessionId: col('sessionId') || id,
      patientName: col('patientName'), patientPhone: phoneCol('patientPhone'),
      therapist: col('therapist'), treatmentType: col('treatmentType'),
      scheduledDate: col('scheduledDate')
    };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
  // Push the outcome to outpatient recordSessionOutcome AFTER the local save and
  // OUTSIDE the lock (no network round-trip held under lock). Fail-open: the
  // outcome is saved regardless; we attach the sync result so the UI can warn
  // when the pay-sync didn't land (never silently swallowed). Fires on all three
  // outcomes — outpatient computes pay/status per outcome. `frequency` is not on
  // the Schedule row; outpatient handles its absence (e.g. for ליווי).
  result.outcomeSync = _postSetSessionOutcome({
    sessionId: result.sessionId,
    phone: result.patientPhone,
    therapist: result.therapist,
    clinicalTreatmentType: result.treatmentType,
    date: result.scheduledDate,
    outcome: result.outcome
  });
  return result;
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
  // 'create' mode rejects a phone that already belongs to a patient (no silent
  // overwrite of someone else's record). 'edit' (default) still upserts by phone.
  var isCreate = String((payload && payload.mode) || '').toLowerCase() === 'create';
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    var sh = _ensureSheet('Patients', PATIENTS_HEADERS);
    var existing = _readAll(sh, PATIENTS_HEADERS);
    var prior = _duplicatePatient(phone, existing);   // same-phone row, if any
    if (isCreate && prior) {
      var nm = String(prior.name || '').trim();
      return {
        ok: false,
        error: 'duplicate_phone',
        existingName: nm,
        message: nm
          ? ('כבר קיים/ת מטופל/ת עם מספר הטלפון הזה: ' + nm)
          : 'כבר קיים/ת מטופל/ת עם מספר הטלפון הזה'
      };
    }
    var rec = {
      phone: phone,
      name: p.name || '',
      origin: p.origin || '',
      stillAdmitted: p.stillAdmitted ? 'true' : '',
      admittedHouse: p.stillAdmitted ? (p.admittedHouse || '') : '',
      active: (p.active === false || p.active === 'false') ? 'false' : 'true',
      updatedBy: p.updatedBy || '',
      updated: p.updated || new Date().toISOString(),
      // PRESERVE the local stop flag — an identity/origin edit must never clear
      // it (the whole row is rebuilt on upsert, so carry the prior values).
      stopped: prior ? (prior.stopped || '') : '',
      stoppedBy: prior ? (prior.stoppedBy || '') : '',
      stoppedAt: prior ? (prior.stoppedAt || '') : '',
      stopNote: prior ? (prior.stopNote || '') : ''
    };
    var res = _upsertByKey(sh, PATIENTS_HEADERS, 'phone', rec);
    return { ok: true, patient: rec, created: !!res.created, updated: !!res.updated };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* ===== Patient stop / discharge flow (SENDER) =====
 * Mirror of public/stopflow.js + the recordTreatmentGiven write-back pattern.
 * "Mark patient stopped" does NOT discharge directly: it POSTs flagStop to
 * outpatient (a pending request Vered confirms there). FAIL-CLOSED — if the flag
 * doesn't reach outpatient, nothing changes locally. On success we set the local
 * stop flag and cancel the patient's future, unreported bookings (past + already
 * reported bookings are kept for the record).
 */

// Today's date as 'yyyy-MM-dd' in the script timezone (mirror of the client's today()).
function _todayStr() {
  var tz = Session.getScriptTimeZone() || 'Asia/Jerusalem';
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
}

// POST flagStop to outpatient with the shared secret (server-to-server, secret
// never reaches the browser). Returns { ok:true } or { ok:false, error }.
// FAIL-CLOSED: unconfigured URL/secret, non-2xx, or ok:false all return ok:false.
function _postFlagStop(body) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('OUTPATIENT_SHEETS_URL');
  var secret = props.getProperty('STOP_FLAG_SECRET');
  if (!url || !secret) return { ok: false, error: 'stop_flag_unconfigured' };
  try {
    var full = url + (url.indexOf('?') > -1 ? '&' : '?') +
      'action=flagStop&secret=' + encodeURIComponent(secret);
    var resp = UrlFetchApp.fetch(full, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify(body),
      muteHttpExceptions: true, followRedirects: true
    });
    var code = resp.getResponseCode();
    if (code < 200 || code >= 300) return { ok: false, error: 'flag_http_' + code };
    var data = JSON.parse(resp.getContentText());
    if (!data || data.ok === false) return { ok: false, error: (data && data.error) || 'flag_rejected' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'flag_unreachable' };
  }
}

// POST resolveStopFlag to outpatient — the UNDO of flagStop. Removes the StopFlag
// matching this phone (even an ORPHANED one with no Client match), so a stuck
// flag always clears. Same server-to-server, fail-closed pattern + secret as
// _postFlagStop. Idempotent: resolving a non-existent flag returns ok. Returns
// { ok:true } or { ok:false, error }.
function _postResolveStopFlag(body) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('OUTPATIENT_SHEETS_URL');
  var secret = props.getProperty('STOP_FLAG_SECRET');
  if (!url || !secret) return { ok: false, error: 'stop_flag_unconfigured' };
  try {
    var full = url + (url.indexOf('?') > -1 ? '&' : '?') +
      'action=resolveStopFlag&secret=' + encodeURIComponent(secret);
    var resp = UrlFetchApp.fetch(full, {
      method: 'post', contentType: 'application/json',
     payload: JSON.stringify(Object.assign({ action: 'resolveStopFlag', secret: secret }, body || {})),
      muteHttpExceptions: true, followRedirects: true
    });
    var code = resp.getResponseCode();
    if (code < 200 || code >= 300) return { ok: false, error: 'resolve_http_' + code };
    var data = JSON.parse(resp.getContentText());
    if (!data || data.ok === false) return { ok: false, error: (data && data.error) || 'resolve_rejected' };
    return { ok: true, resolved: data.resolved };
  } catch (e) {
    return { ok: false, error: 'resolve_unreachable' };
  }
}

/* ===== Cross-app patient delete propagation (SENDER) =====
 * When a patient is deleted here (_removePatient), the matching outpatient Client
 * must stop appearing in the roster union — otherwise getTreatmentPlans /
 * getDebtStatus keep returning them and roster.js re-adds the "deleted" patient
 * (a base source, not just an overlay). We DEACTIVATE rather than hard-delete on
 * the outpatient side: it is reversible and preserves billing/session history,
 * and getTreatmentPlans already filters by status — so a deactivated Client drops
 * out of the active roster without losing the record.
 *
 * Server-to-server like _postFlagStop / _postResolveStopFlag: UrlFetchApp + the
 * OUTPATIENT_SHEETS_URL and a dedicated shared secret (DEACTIVATE_CLIENT_SECRET,
 * its OWN secret — deactivating a client is more destructive than clearing a stop
 * flag, so least-authority keeps it off the stop-flag secret). The secret NEVER
 * reaches the browser.
 *
 * FAIL-CLOSED on transport/config/auth (returns ok:false → the caller aborts the
 * local delete), but ORPHAN-SAFE: a phone matching no Client comes back
 * { ok:true, deactivated:0 } (idempotent, nothing to crash on), so deleting a
 * patient who was never an outpatient still succeeds and removes the local row.
 * Canonical phone is sent so it matches outpatient's phone matching.
 */
function _postDeactivateClient(body) {
  var canon = _toCanonicalPhone(body && body.phone);
  if (!canon) return { ok: false, error: 'invalid_phone' };
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('OUTPATIENT_SHEETS_URL');
  var secret = props.getProperty('DEACTIVATE_CLIENT_SECRET');
  if (!url || !secret) return { ok: false, error: 'deactivate_unconfigured' };
  try {
    var full = url + (url.indexOf('?') > -1 ? '&' : '?') +
      'action=deactivateClient&secret=' + encodeURIComponent(secret);
    var resp = UrlFetchApp.fetch(full, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({
        action: 'deactivateClient',
        secret: secret,
        phone: canon,
        deactivatedBy: String(body && body.deactivatedBy == null ? '' : body.deactivatedBy).trim(),
        reason: String(body && body.reason == null ? '' : body.reason).trim() || 'patient_deleted'
      }),
      muteHttpExceptions: true, followRedirects: true
    });
    var code = resp.getResponseCode();
    if (code < 200 || code >= 300) return { ok: false, error: 'deactivate_http_' + code };
    var data = JSON.parse(resp.getContentText());
    if (!data || data.ok === false) return { ok: false, error: (data && data.error) || 'deactivate_rejected' };
    return { ok: true, deactivated: data.deactivated };
  } catch (e) {
    return { ok: false, error: 'deactivate_unreachable' };
  }
}

/* ===== Over-package extra-session request (SENDER) =====
 * When Yarden schedules beyond a patient's monthly package (soft-warn), the
 * therapists app records an approval request on the outpatient side so Vered
 * sees it and can approve. Server-to-server, same secured shared-secret pattern
 * as _postDeactivateClient: action + secret carried in the JSON body. */
function _postRequestExtraSession(body) {
  var canon = _toCanonicalPhone(body && body.phone);
  if (!canon) return { ok: false, error: 'invalid_phone' };
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('OUTPATIENT_SHEETS_URL');
  var secret = props.getProperty('EXTRA_SESSION_SECRET');
  if (!url || !secret) return { ok: false, error: 'extra_session_unconfigured' };
  try {
    var full = url + (url.indexOf('?') > -1 ? '&' : '?') +
      'action=requestExtraSession&secret=' + encodeURIComponent(secret);
    var resp = UrlFetchApp.fetch(full, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({
        action: 'requestExtraSession',
        secret: secret,
        phone: canon,
        patientName: String(body && body.patientName == null ? '' : body.patientName).trim(),
        treatmentType: String(body && body.treatmentType == null ? '' : body.treatmentType).trim(),
        therapist: String(body && body.therapist == null ? '' : body.therapist).trim(),
        monthKey: String(body && body.monthKey == null ? '' : body.monthKey).trim(),
        quota: Number(body && body.quota) || 0,
        used: Number(body && body.used) || 0,
        requestedBy: String(body && body.requestedBy == null ? '' : body.requestedBy).trim(),
        note: String(body && body.note == null ? '' : body.note).trim()
      }),
      muteHttpExceptions: true, followRedirects: true
    });
    var code = resp.getResponseCode();
    if (code < 200 || code >= 300) return { ok: false, error: 'extra_session_http_' + code };
    var data = JSON.parse(resp.getContentText());
    if (!data || data.ok === false) return { ok: false, error: (data && data.error) || 'extra_session_rejected' };
    return { ok: true, requestId: data.requestId };
  } catch (e) {
    return { ok: false, error: 'extra_session_unreachable' };
  }
}

/*
 * On assignment save, push the patient's clinical treatment type to outpatient
 * so its per-patient billing rate follows the clinical plan chosen here. Mirror
 * of public/clinical-sync.js (buildPayload + interpretResponse). Same server-to-
 * server pattern as _postFlagStop / _postTreatmentsGiven: UrlFetchApp
 * + the OUTPATIENT_SHEETS_URL and a shared secret read from Script Properties
 * (CLINICAL_TYPE_SECRET) — the secret NEVER reaches the browser.
 *
 * FAIL-OPEN-WITH-FLAG (deliberately NOT fail-closed like the stop flow): the
 * assignment is already saved locally by the time we call this, so the push
 * never throws and never blocks the save. Instead it returns a structured
 * outcome the caller attaches to the response, so the UI can WARN the user when
 * the billing-type sync didn't land — we never silently swallow a mismatch.
 *   { ok:true,  matched:1 }                                  → synced silently
 *   { ok:false, reason:'no_match' | 'multi_match' |
 *               'unknown_type' | 'unconfigured' |
 *               'invalid_phone' | 'http_<code>' |
 *               'non_ok' | 'unreachable' }                   → surfaced to user
 *
 * The outpatient endpoint is the authority on which types are billable clinical
 * types; a non-clinical type (e.g. a group session) comes back as 'unknown_type'
 * and is flagged rather than guessed at here.
 */
function _postSetClinicalType(phone, clinicalTreatmentType) {
  // Push the canonical key so it matches outpatient's phone matching.
  var canon = _toCanonicalPhone(phone);
  if (!canon) return { ok: false, reason: 'invalid_phone' };
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('OUTPATIENT_SHEETS_URL');
  var secret = props.getProperty('CLINICAL_TYPE_SECRET');
  if (!url || !secret) return { ok: false, reason: 'unconfigured' };
  var type = String(clinicalTreatmentType == null ? '' : clinicalTreatmentType).trim();
  try {
    // action + secret on the query string mirrors the existing outbound calls;
    // the full {action,secret,phone,clinicalTreatmentType} object is ALSO sent in
    // the JSON body per the setClinicalType contract, so the receiver can read
    // either. The secret stays server-to-server (never echoed to the browser).
    var full = url + (url.indexOf('?') > -1 ? '&' : '?') +
      'action=setClinicalType&secret=' + encodeURIComponent(secret);
    var resp = UrlFetchApp.fetch(full, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({
        action: 'setClinicalType',
        secret: secret,
        phone: canon,
        clinicalTreatmentType: type
      }),
      muteHttpExceptions: true, followRedirects: true
    });
    var code = resp.getResponseCode();
    if (code < 200 || code >= 300) return { ok: false, reason: 'http_' + code };
    var data = JSON.parse(resp.getContentText());
    if (data && data.ok === true && (data.matched === 1 || data.matched === '1')) {
      return { ok: true, matched: 1 };
    }
    // Surface the outpatient-supplied reason verbatim (no_match / multi_match /
    // unknown_type) so the user sees WHY; fall back to a generic non_ok.
    var reason = (data && (data.reason || data.error)) ? String(data.reason || data.error) : 'non_ok';
    return { ok: false, reason: reason };
  } catch (e) {
    return { ok: false, reason: 'unreachable' };
  }
}

/* ===== Session-outcome push (SENDER) — iteration 18, step 3 =====
 * On a successful outcome save (_setSessionOutcome), push the marked outcome to
 * outpatient's recordSessionOutcome endpoint so it computes therapist pay /
 * session status per outcome. Mirror of public/outcome-sync.js (buildPayload +
 * interpretResponse). Same server-to-server pattern as _postSetClinicalType /
 * _postFlagStop: UrlFetchApp + the OUTPATIENT_SHEETS_URL and a shared secret read
 * from Script Properties (SESSION_OUTCOME_SECRET) — the secret NEVER reaches the
 * browser.
 *
 * FAIL-OPEN-WITH-FLAG (like the clinical-type sender, NOT fail-closed like the
 * stop flow): the outcome is already saved locally by the time we call this, so
 * the push never throws and never blocks the save. It returns a structured
 * outcome the caller attaches to the response (outcomeSync) so the UI can WARN
 * when the pay-sync didn't land — the outcome stands locally either way; only the
 * pay-sync is flagged.
 *   { ok:true }                                              → synced silently
 *   { ok:false, reason:'unknown_therapist' | 'unknown_type' |
 *               'unauthorized' | 'unconfigured' |
 *               'invalid_phone' | 'http_<code>' |
 *               'non_ok' | 'unreachable' }                   → surfaced to user
 *
 * Fires on all THREE outcomes (happened / therapist_cancelled / patient_no_show)
 * — outpatient computes pay/status per outcome. `frequency` is NOT sent (the
 * Schedule row doesn't carry it; outpatient handles its absence, e.g. for ליווי).
 * Idempotent by design: re-marking re-sends the same sessionId; outpatient
 * upserts on it (no therapists-side dedupe).
 */
function _postSetSessionOutcome(o) {
  o = o || {};
  // Push the canonical key so it matches outpatient's phone matching.
  var canon = _toCanonicalPhone(o.phone);
  if (!canon) return { ok: false, reason: 'invalid_phone' };
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('OUTPATIENT_SHEETS_URL');
  var secret = props.getProperty('SESSION_OUTCOME_SECRET');
  if (!url || !secret) return { ok: false, reason: 'unconfigured' };
  try {
    // action + secret on the query string mirrors the existing outbound calls;
    // the full object is ALSO sent in the JSON body per the recordSessionOutcome
    // contract, so the receiver can read either. The secret stays server-to-
    // server (never echoed to the browser).
    var full = url + (url.indexOf('?') > -1 ? '&' : '?') +
      'action=recordSessionOutcome&secret=' + encodeURIComponent(secret);
    var resp = UrlFetchApp.fetch(full, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({
        action: 'recordSessionOutcome',
        secret: secret,
        sessionId: String(o.sessionId == null ? '' : o.sessionId),
        phone: canon,
        therapist: String(o.therapist == null ? '' : o.therapist),
        clinicalTreatmentType: String(o.clinicalTreatmentType == null ? '' : o.clinicalTreatmentType),
        date: String(o.date == null ? '' : o.date),
        outcome: String(o.outcome == null ? '' : o.outcome)
      }),
      muteHttpExceptions: true, followRedirects: true
    });
    var code = resp.getResponseCode();
    if (code < 200 || code >= 300) return { ok: false, reason: 'http_' + code };
    var data = JSON.parse(resp.getContentText());
    if (data && data.ok === true) return { ok: true };
    // Surface the outpatient-supplied reason verbatim (unknown_therapist /
    // unknown_type / unauthorized …) so the user sees WHY; fall back to non_ok.
    var reason = (data && (data.reason || data.error)) ? String(data.reason || data.error) : 'non_ok';
    return { ok: false, reason: reason };
  } catch (e) {
    return { ok: false, reason: 'unreachable' };
  }
}

// Persist the LOCAL stop flag on the Patients row (create a minimal row if the
// patient is only in the outpatient roster). Phone matched tolerantly.
function _markLocalPatientStopped(sh, canonPhone, name, reportedBy, note) {
  var now = new Date().toISOString();
  var key = _matchPhone(canonPhone);
  var phoneIdx = PATIENTS_HEADERS.indexOf('phone');
  var nameIdx = PATIENTS_HEADERS.indexOf('name');
  var lastRow = sh.getLastRow();
  if (lastRow > 1) {
    var grid = sh.getRange(2, 1, lastRow - 1, PATIENTS_HEADERS.length).getValues();
    for (var i = 0; i < grid.length; i++) {
      if (_matchPhone(grid[i][phoneIdx]) !== key) continue;
      // Found the existing row — update its stop columns IN PLACE (no duplicate).
      var rowNum = i + 2;
      var keepName = name && !String(grid[i][nameIdx] || '').trim() ? name : grid[i][nameIdx];
      var update = {};
      update.stopped = 'true';
      update.stoppedBy = reportedBy || '';
      update.stoppedAt = now;
      update.stopNote = note || '';
      update.name = keepName;
      for (var h = 0; h < PATIENTS_HEADERS.length; h++) {
        var col = PATIENTS_HEADERS[h];
        if (update.hasOwnProperty(col)) sh.getRange(rowNum, h + 1, 1, 1).setValues([[update[col]]]);
      }
      return;
    }
  }
  // No local row yet — append a minimal stopped record.
  _upsertByKey(sh, PATIENTS_HEADERS, 'phone', {
    phone: canonPhone, name: name || '', origin: '', stillAdmitted: '', admittedHouse: '',
    active: 'true', updatedBy: reportedBy || '', updated: now,
    stopped: 'true', stoppedBy: reportedBy || '', stoppedAt: now, stopNote: note || ''
  });
}

// Delete the patient's FUTURE, unreported bookings (today forward). Past and
// already-reported rows are kept. Mirror of stopflow.js futureBookingsToCancel.
// Returns the number of cancelled rows.
function _cancelFutureBookings(sh, canonPhone) {
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;
  var tz = Session.getScriptTimeZone() || 'Asia/Jerusalem';
  var today = _todayStr();
  var key = _matchPhone(canonPhone);
  var phoneIdx = SCHEDULE_HEADERS.indexOf('patientPhone');
  var attIdx = SCHEDULE_HEADERS.indexOf('attendance');
  var dateIdx = SCHEDULE_HEADERS.indexOf('scheduledDate');
  var grid = sh.getRange(2, 1, lastRow - 1, SCHEDULE_HEADERS.length).getValues();
  var toDelete = [];
  for (var i = 0; i < grid.length; i++) {
    if (_matchPhone(grid[i][phoneIdx]) !== key) continue;
    if (String(grid[i][attIdx] || '') !== '') continue;        // reported → keep
    var dcell = grid[i][dateIdx];
    var d = (dcell instanceof Date)
      ? Utilities.formatDate(dcell, tz, 'yyyy-MM-dd')
      : String(dcell || '');
    if (d.indexOf('T') !== -1) d = d.split('T')[0];
    if (d && d >= today) toDelete.push(i + 2);                  // sheet row number
  }
  for (var j = toDelete.length - 1; j >= 0; j--) sh.deleteRow(toDelete[j]);  // bottom-up
  return toDelete.length;
}

// Mark a patient stopped: flag outpatient (fail-closed) → local flag + cancel
// future bookings. Does NOT discharge the patient directly.
function _markPatientStopped(payload) {
  var p = payload || {};
  var canon = _toCanonicalPhone(p.phone);
  if (!canon) return { ok: false, error: 'invalid_phone' };

  // 1) Send the stop flag FIRST. If it doesn't reach Vered, change nothing.
  var flag = _postFlagStop({
    phone: canon,
    name: String(p.name == null ? '' : p.name).trim(),
    reportedBy: String(p.reportedBy == null ? '' : p.reportedBy).trim(),
    note: String(p.note == null ? '' : p.note).trim()
  });
  if (!flag.ok) return { ok: false, error: flag.error || 'flag_failed' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // 2) Persist the local stop flag.
    var pSh = _ensureSheet('Patients', PATIENTS_HEADERS);
    _markLocalPatientStopped(pSh, canon,
      String(p.name == null ? '' : p.name).trim(),
      String(p.reportedBy == null ? '' : p.reportedBy).trim(),
      String(p.note == null ? '' : p.note).trim());
    // 3) Cancel future, unreported bookings (keep past + reported).
    var schSh = _ensureSheet('Schedule', SCHEDULE_HEADERS);
    var cancelled = _cancelFutureBookings(schSh, canon);
    return { ok: true, flagged: true, phone: canon, cancelled: cancelled };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// Clear the LOCAL stop flag on the Patients row matching canonPhone (the inverse
// of _markLocalPatientStopped). Phone matched tolerantly (recovers a dropped
// zero). Returns true if a row was found and cleared. A patient with no local row
// (an outpatient-only / orphaned flag) is simply a no-op here — the outpatient
// resolve is what clears that case.
function _clearLocalPatientStop(sh, canonPhone) {
  var key = _matchPhone(canonPhone);
  var phoneIdx = PATIENTS_HEADERS.indexOf('phone');
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return false;
  var grid = sh.getRange(2, 1, lastRow - 1, PATIENTS_HEADERS.length).getValues();
  var cleared = { stopped: '', stoppedBy: '', stoppedAt: '', stopNote: '' };
  for (var i = 0; i < grid.length; i++) {
    if (_matchPhone(grid[i][phoneIdx]) !== key) continue;
    for (var h = 0; h < PATIENTS_HEADERS.length; h++) {
      var col = PATIENTS_HEADERS[h];
      if (cleared.hasOwnProperty(col)) sh.getRange(i + 2, h + 1, 1, 1).setValues([[cleared[col]]]);
    }
    return true;
  }
  return false;
}

// Delete the Patients row(s) matching canonPhone outright (test cleanup). Phone
// matched tolerantly. Returns the number of rows removed. Bottom-up so row
// indices stay valid.
function _deleteLocalPatient(sh, canonPhone) {
  var key = _matchPhone(canonPhone);
  var phoneIdx = PATIENTS_HEADERS.indexOf('phone');
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;
  var grid = sh.getRange(2, 1, lastRow - 1, PATIENTS_HEADERS.length).getValues();
  var toDelete = [];
  for (var i = 0; i < grid.length; i++) {
    if (_matchPhone(grid[i][phoneIdx]) === key) toDelete.push(i + 2);
  }
  for (var j = toDelete.length - 1; j >= 0; j--) sh.deleteRow(toDelete[j]);
  return toDelete.length;
}

/* ===== Undo a stop request — restore a patient to ACTIVE =====
 * The inverse of _markPatientStopped. FAIL-CLOSED like the stop itself: resolve
 * the outpatient StopFlag FIRST (server-to-server) and only on success clear the
 * local flag — so the two sides never desync (a patient is never shown active
 * here while Vered still holds a pending flag). Resolving is idempotent and
 * orphan-safe: a flag with no Client match still clears by phone, and a patient
 * with no outpatient flag (resolved:0) still returns ok. Does NOT resurrect the
 * future bookings cancelled at stop time — the therapist re-schedules as needed. */
function _restorePatient(payload) {
  var p = payload || {};
  var canon = _toCanonicalPhone(p.phone);
  if (!canon) return { ok: false, error: 'invalid_phone' };

  // 1) Resolve (remove) the outpatient StopFlag FIRST. If it can't reach Vered,
  //    change nothing locally.
  var resolve = _postResolveStopFlag({
    phone: canon,
    resolvedBy: String(p.reportedBy == null ? '' : p.reportedBy).trim(),
    reason: String(p.note == null ? '' : p.note).trim()
  });
  if (!resolve.ok) return { ok: false, error: resolve.error || 'resolve_failed' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var pSh = _ensureSheet('Patients', PATIENTS_HEADERS);
    var cleared = _clearLocalPatientStop(pSh, canon);
    return { ok: true, restored: true, phone: canon, clearedLocal: cleared, resolved: resolve.resolved };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* ===== Delete a patient entirely (test cleanup) =====
 * Removes this app's local Patients record AND (1) resolves any outpatient StopFlag
 * for the phone (so no orphaned flag is left pointing at a deleted patient) and
 * (2) DEACTIVATES the matching outpatient Client, so getTreatmentPlans /
 * getDebtStatus stop returning them and the roster union (roster.js) can't re-add
 * the deleted patient as a base source. FAIL-CLOSED on BOTH cross-app calls, same
 * discipline as restore: if either can't reach Vered's side, the local record is
 * NOT deleted (no half-state). Both are orphan-safe — a phone matching no flag /
 * no Client still succeeds (resolved:0 / deactivated:0). Assignments and past
 * bookings are left as-is (remove them via removeAssignment / removeSchedule if
 * needed). */
function _removePatient(payload) {
  var p = payload || {};
  var canon = _toCanonicalPhone(p.phone);
  if (!canon) return { ok: false, error: 'invalid_phone' };

  var resolve = _postResolveStopFlag({
    phone: canon,
    resolvedBy: String(p.reportedBy == null ? '' : p.reportedBy).trim(),
    reason: String(p.note == null ? '' : p.note).trim() || 'patient_deleted'
  });
  if (!resolve.ok) return { ok: false, error: resolve.error || 'resolve_failed' };

  // Propagate the delete to outpatient: DEACTIVATE the matching Client so it drops
  // out of the roster union (getTreatmentPlans / getDebtStatus) and roster.js can't
  // re-add the deleted patient. FAIL-CLOSED, same discipline as the resolve above —
  // if outpatient can't be reached/authed, change NOTHING locally (no half-state
  // where the patient is gone here but still active on Vered's side). Orphan-safe:
  // no matching Client returns ok with deactivated:0, so the local delete proceeds.
  var deactivate = _postDeactivateClient({
    phone: canon,
    deactivatedBy: String(p.reportedBy == null ? '' : p.reportedBy).trim(),
    reason: String(p.note == null ? '' : p.note).trim() || 'patient_deleted'
  });
  if (!deactivate.ok) return { ok: false, error: deactivate.error || 'deactivate_failed' };

 var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var pSh = _ensureSheet('Patients', PATIENTS_HEADERS);
    var removed = _deleteLocalPatient(pSh, canon);
    // Cancel the deleted patient's FUTURE, unreported bookings (same rule as the
    // stop flow): reported/past sessions are KEPT for the pay record; only
    // today-or-later unreported rows are removed. Without this, a deleted patient
    // keeps showing scheduled treatments (the מריסה נשרי case).
    var schSh = _ensureSheet('Schedule', SCHEDULE_HEADERS);
    var cancelled = _cancelFutureBookings(schSh, canon);
    return { ok: true, removed: removed, cancelled: cancelled, phone: canon, resolved: resolve.resolved, deactivated: deactivate.deactivated };
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
  // Canonicalize the phone exactly like _savePatient: an assignment row must key
  // by the SAME canonical phone as the patient it links to, or the roster union
  // (roster.js, normalized by phone) silently splits one patient into two — the
  // רון מנחם bug. Reject empty (missing_phone) then non-canonical (invalid_phone);
  // never store a raw/non-canonical patientPhone.
  if (String(a.patientPhone == null ? '' : a.patientPhone).trim() === '') return { ok: false, error: 'missing_phone' };
  var phone = _toCanonicalPhone(a.patientPhone);
  if (!phone) return { ok: false, error: 'invalid_phone' };
  var rec, res;
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    var sh = _ensureSheet('Assignments', ASSIGNMENTS_HEADERS);
    rec = {
      id: String(a.id),
      patientPhone: phone,
      therapist: a.therapist || '',
      treatmentType: a.treatmentType || '',
      frequencyPerWeek: (a.frequencyPerWeek === 0 || a.frequencyPerWeek) ? String(a.frequencyPerWeek) : '',
      active: (a.active === false || a.active === 'false') ? 'false' : 'true',
      updatedBy: a.updatedBy || '',
      updated: a.updated || new Date().toISOString(),
      // Weekly recurring pattern: store the JSON string as-is (already a string
      // from the client, or stringify a passed array). Empty = no recurrence.
      slots: (a.slots == null || a.slots === '') ? ''
        : (typeof a.slots === 'string' ? a.slots : JSON.stringify(a.slots))
    };
    res = _upsertByKey(sh, ASSIGNMENTS_HEADERS, 'id', rec);
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
  var result = { ok: true, assignment: rec, created: !!res.created, updated: !!res.updated };
  // Push the clinical treatment type to outpatient billing AFTER the local save
  // and OUTSIDE the lock (no network round-trip held under lock). Fail-open: the
  // assignment is saved regardless; we attach the sync outcome so the UI can warn
  // when billing-type sync didn't land (never silently swallowed). Skip the push
  // for a blank type — there is nothing to bill against.
  if (rec.treatmentType) {
    result.clinicalSync = _postSetClinicalType(rec.patientPhone, rec.treatmentType);
  }
  return result;
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
    if (payload.room != null) setCol('room', String(payload.room));

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

/* ===== Therapist name migration (short → full / future renames) =====
 * Mirror of public/therapist-migration.js (SHORT_TO_FULL, migrateName,
 * normalizeKey; the roster is the live Therapists sheet — synced from staffing —
 * not a hard-coded list). Renames the therapist field on
 * existing Assignment + Schedule rows from the old SHORT names to the FINAL full
 * names, so pay/credit matching lines up with the new roster. ONLY the explicit
 * mapping is applied — no mapping is invented; a name with no full equivalent is
 * left as-is and reported. IDEMPOTENT: a full name (or any non-short name) is
 * returned unchanged, so re-running rewrites nothing. Approvals (audit trail) is
 * intentionally NOT migrated. */
var _THERAPIST_SHORT_TO_FULL = {
  'רמי': 'רמי רום',
  'כנרת': 'כנרת זיידן',
  'הילה': 'הילה תבור',
  'אלה': 'אלה שפירא',
  'שירן': 'שירן כהן',
  'דנה': 'דנה דרוקר',
  'יפעת': 'יפעת רומנו',
  'איתן דשה': 'איתן דשא',
  'דליה': 'דליה מלמד',
  'מעיין': 'מעיין דלומי',
  'תמר': 'תמר גנץ',
  'עידו': 'עידו בוזגלו',
  'ד״ר שפרינץ': 'ד"ר מיכאל שפרינץ',
  'ד"ר שפרינץ': 'ד"ר מיכאל שפרינץ',
  'ד״ר נטליה': 'ד"ר נטליה סדוגין',
  'ד"ר נטליה': 'ד"ר נטליה סדוגין',
  'ד״ר דנגור': 'ד"ר יצחק דנגור',
  'ד"ר דנגור': 'ד"ר יצחק דנגור'
};
function _migrateTherapistName(name) {
  var t = String(name == null ? '' : name).trim();
  return _THERAPIST_SHORT_TO_FULL.hasOwnProperty(t) ? _THERAPIST_SHORT_TO_FULL[t] : t;
}
// Punctuation-only key (drop gershayim/geresh + ASCII quotes, collapse spaces) so
// ד״ר vs ד"ר count as the same name for roster membership.
function _normalizeTherapistKey(name) {
  return String(name == null ? '' : name).trim().replace(/[״׳"']/g, '').replace(/\s+/g, ' ');
}
// The membership roster is the LIVE Therapists sheet (synced from staffing) —
// there is no hard-coded seed anymore.
function _rosterKeySet() {
  var rows = _readAll(_ensureSheet('Therapists', THERAPISTS_HEADERS), THERAPISTS_HEADERS);
  var exact = {}, norm = {};
  for (var i = 0; i < rows.length; i++) {
    var n = String(rows[i].name == null ? '' : rows[i].name).trim();
    if (!n) continue;
    exact[n] = true;
    norm[_normalizeTherapistKey(n)] = true;
  }
  return { exact: exact, norm: norm };
}

// Rewrite the `therapist` column of one sheet in place. Returns the per-row
// changes plus the distinct post-migration names that are unknown / quote-variant.
function _migrateTherapistColumn(sheetName, headers) {
  var roster = _rosterKeySet();
  var sh = _ensureSheet(sheetName, headers);
  var thIdx = headers.indexOf('therapist');
  var idIdx = headers.indexOf('id');
  var lastRow = sh.getLastRow();
  var out = { scanned: 0, migrated: 0, changes: [], unmapped: {}, punctuationVariants: {} };
  if (thIdx < 0 || lastRow < 2) return out;
  var grid = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
  for (var i = 0; i < grid.length; i++) {
    var from = String(grid[i][thIdx] == null ? '' : grid[i][thIdx]).trim();
    if (!from) continue;
    out.scanned++;
    var to = _migrateTherapistName(from);
    if (to !== from) {
      sh.getRange(i + 2, thIdx + 1, 1, 1).setValues([[to]]);   // write back only changed cells
      out.migrated++;
      out.changes.push({ sheet: sheetName, id: idIdx > -1 ? String(grid[i][idIdx]) : '', from: from, to: to });
    }
    // Classify the POST-migration name for the report.
    if (!roster.norm[_normalizeTherapistKey(to)]) out.unmapped[to] = (out.unmapped[to] || 0) + 1;
    else if (!roster.exact[to]) out.punctuationVariants[to] = (out.punctuationVariants[to] || 0) + 1;
  }
  return out;
}

// The migration action — safe to run repeatedly (idempotent). Returns a full
// report: what was renamed, and which therapist names are NOT in the current
// roster (so a human decides), incl. ד״ר-quote variants surfaced separately.
function _migrateTherapistNames() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var a = _migrateTherapistColumn('Assignments', ASSIGNMENTS_HEADERS);
    var s = _migrateTherapistColumn('Schedule', SCHEDULE_HEADERS);
    function keys(o1, o2) {
      var m = {}; [o1, o2].forEach(function (o) { Object.keys(o).forEach(function (k) { m[k] = (m[k] || 0) + o[k]; }); });
      return Object.keys(m).map(function (k) { return { name: k, rows: m[k] }; });
    }
    return {
      ok: true,
      assignments: { scanned: a.scanned, migrated: a.migrated },
      schedule: { scanned: s.scanned, migrated: s.migrated },
      changes: a.changes.concat(s.changes),
      unmapped: keys(a.unmapped, s.unmapped),                       // unknown names — decide manually
      punctuationVariants: keys(a.punctuationVariants, s.punctuationVariants)   // ד״ר vs ד"ר, left as-is
    };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// Run this straight from the Apps Script editor (Run ▸ migrateTherapistNamesNow)
// for a one-time, in-place migration; the full report is logged. Idempotent.
function migrateTherapistNamesNow() {
  var report = _migrateTherapistNames();
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

/* ===== One-time admin cleanup: orphaned scheduled sessions =====
 * Test patients were deleted (their Patients rows removed by _removePatient), but
 * their Schedule rows remain and still render under "טיפולים שנקבעו". This removes
 * the leftovers.
 *
 * A Schedule row is ORPHANED when its patientPhone matches NO patient in the
 * Patients sheet, using the SAME tolerant match as everywhere else (_matchPhone:
 * recover a Sheets-dropped leading zero, then normalize). Decision per row:
 *   - exactly ONE matching patient  → KEEP (a live patient — never delete).
 *   - MORE THAN ONE matching patient → KEEP and FLAG in the log (ambiguous →
 *     never fail open, never delete).
 *   - an EMPTY / unparseable phone   → KEEP and FLAG (cannot classify → don't
 *     delete something we can't positively call an orphan).
 *   - ZERO matching patients (valid phone) → DELETE (orphaned).
 *
 * Deletes by ORPHANED-PATIENT match ONLY — never by date or by "scheduled" status
 * — so a live patient's real future sessions are never touched. Every deleted row
 * is logged (patient, therapist, date, phone) BEFORE deletion; ambiguous/empty
 * rows are logged as FLAG. Returns the count of deleted rows. Idempotent: a second
 * run finds nothing. Run ONCE from the Apps Script editor.
 */
function cleanupOrphanedScheduledSessions() {
  var schSh = _ensureSheet('Schedule', SCHEDULE_HEADERS);
  var pSh = _ensureSheet('Patients', PATIENTS_HEADERS);

  // Live-patient phone keys → how many patient rows own each (tolerant match). A
  // key owned by >1 row is ambiguous, so any Schedule row matching it is flagged.
  var pPhoneIdx = PATIENTS_HEADERS.indexOf('phone');
  var pLast = pSh.getLastRow();
  var patientCount = {};
  if (pLast >= 2) {
    var pGrid = pSh.getRange(2, 1, pLast - 1, PATIENTS_HEADERS.length).getValues();
    for (var i = 0; i < pGrid.length; i++) {
      var pk = _matchPhone(pGrid[i][pPhoneIdx]);
      if (pk) patientCount[pk] = (patientCount[pk] || 0) + 1;
    }
  }

  var sLast = schSh.getLastRow();
  if (sLast < 2) { Logger.log('cleanupOrphanedScheduledSessions: no Schedule rows.'); return 0; }
  var phoneIdx = SCHEDULE_HEADERS.indexOf('patientPhone');
  var nameIdx = SCHEDULE_HEADERS.indexOf('patientName');
  var therIdx = SCHEDULE_HEADERS.indexOf('therapist');
  var dateIdx = SCHEDULE_HEADERS.indexOf('scheduledDate');
  var grid = schSh.getRange(2, 1, sLast - 1, SCHEDULE_HEADERS.length).getValues();

  function rowDesc(r) {
    return 'patient=' + grid[r][nameIdx] + ' therapist=' + grid[r][therIdx] +
      ' date=' + grid[r][dateIdx] + ' phone=' + grid[r][phoneIdx];
  }

  var toDelete = [];   // 1-based sheet row numbers
  var flagged = 0;
  for (var r = 0; r < grid.length; r++) {
    var key = _matchPhone(grid[r][phoneIdx]);
    if (!key) {                                   // unclassifiable → KEEP + FLAG
      flagged++;
      Logger.log('FLAG (empty/invalid phone, kept): ' + rowDesc(r));
      continue;
    }
    var matches = patientCount[key] || 0;
    if (matches === 1) continue;                  // live patient → KEEP
    if (matches > 1) {                            // ambiguous → KEEP + FLAG
      flagged++;
      Logger.log('FLAG (multi-match ' + matches + ', kept): ' + rowDesc(r));
      continue;
    }
    Logger.log('DELETE (orphaned): ' + rowDesc(r));   // log BEFORE deletion
    toDelete.push(r + 2);
  }
  // Delete bottom-up so earlier row numbers stay valid as rows are removed.
  for (var d = toDelete.length - 1; d >= 0; d--) schSh.deleteRow(toDelete[d]);

  Logger.log('cleanupOrphanedScheduledSessions: deleted ' + toDelete.length +
    ' orphaned row(s); kept ' + flagged + ' flagged (ambiguous/empty) row(s).');
  return toDelete.length;
}

/* ===== Staffing roster sync =====
 * The Therapists roster's source of truth IS the ezone-staffing app (workers
 * with role מטפל/ת). This section holds the live fetch of the staffing feed,
 * the pure sync planner, the read-only `previewStaffingRosterSync` action, and
 * the WRITE path `_syncTherapistsFromStaffing` that _getData runs on every load
 * (replacing the old hard-coded seeding — the Therapists list has no seed).
 * The sync upserts by name and flips only `active`; it NEVER deletes a row,
 * NEVER renames one, and NEVER touches Assignments/Schedule/Approvals.
 *
 * Script Properties (same pattern as OUTPATIENT_SHEETS_URL/DEBT_STATUS_SECRET):
 *   STAFFING_SHEETS_URL         the ezone-staffing Apps Script /exec URL
 *   STAFFING_THERAPISTS_SECRET  shared secret for getTherapistsForTherapists
 */

// One live fetch of the STAFFING therapist roster, cached per execution (copy
// of the _liveDebtRoster shape: Script Properties + muteHttpExceptions +
// FAIL-CLOSED). Returns { status:'ok', therapists:[{name, active}, …] } or
// { status:'unconfigured' } / { status:'unavailable' }. The shape is validated
// strictly — anything but an array of {name:string, active:boolean} entries is
// 'unavailable', never a half-parsed roster.
var _staffingRosterCache = null;
function _staffingRoster() {
  if (_staffingRosterCache) return _staffingRosterCache;
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('STAFFING_SHEETS_URL');
  var secret = props.getProperty('STAFFING_THERAPISTS_SECRET');
  if (!url) { _staffingRosterCache = { status: 'unconfigured' }; return _staffingRosterCache; }
  try {
    var full = url + (url.indexOf('?') > -1 ? '&' : '?') + 'action=getTherapistsForTherapists' +
      (secret ? '&secret=' + encodeURIComponent(secret) : '');
    var resp = UrlFetchApp.fetch(full, { muteHttpExceptions: true, followRedirects: true });
    var code = resp.getResponseCode();
    if (code < 200 || code >= 300) { _staffingRosterCache = { status: 'unavailable' }; return _staffingRosterCache; }
    var data = JSON.parse(resp.getContentText());
    if (!data || data.ok === false || !Array.isArray(data.therapists)) {
      _staffingRosterCache = { status: 'unavailable' }; return _staffingRosterCache;
    }
    for (var i = 0; i < data.therapists.length; i++) {
      var t = data.therapists[i];
      if (!t || typeof t.name !== 'string' || typeof t.active !== 'boolean') {
        _staffingRosterCache = { status: 'unavailable' }; return _staffingRosterCache;
      }
    }
    _staffingRosterCache = { status: 'ok', therapists: data.therapists };
    return _staffingRosterCache;
  } catch (e) {
    _staffingRosterCache = { status: 'unavailable' };
    return _staffingRosterCache;
  }
}

/* === BEGIN roster-sync core — MIRROR: public/roster-sync.js ⇄ apps-script/Code.gs; keep BYTE-IDENTICAL (guarded by test/roster-sync.test.js) === */

function _rosterSyncTrim(name) { return String(name == null ? '' : name).trim(); }

// Normalization used ONLY to surface nearMatches — NEVER to match or merge.
// Gershayim (״) → ASCII quote ("), trim, collapse whitespace runs.
function _rosterSyncNormalize(name) {
  return _rosterSyncTrim(name).replace(/״/g, '"').replace(/\s+/g, ' ');
}

// Tolerant active-flag reader: the sheet stores 'true'/'false' strings, the
// staffing feed sends booleans. Same semantics as public/scheduling.js
// isActive — only an explicit negative retires; blank means active.
function _rosterSyncIsActive(v) {
  if (v === true) return true;
  if (v === false) return false;
  if (v === undefined || v === null || v === '') return true;
  var s = String(v).trim().toLowerCase();
  return !(s === 'false' || s === '0' || s === 'no' || s === 'inactive' || s === 'לא');
}

function _rosterSyncFirstToken(name) {
  return _rosterSyncTrim(name).split(/\s+/)[0] || '';
}

// Why a nearMatch pair differs: 'whitespace' (edge or internal spacing only),
// 'gershayim' (״ vs " only), or 'gershayim+whitespace' (both needed).
function _rosterSyncNearReason(a, b) {
  var ta = _rosterSyncTrim(a), tb = _rosterSyncTrim(b);
  if (ta === tb) return 'whitespace';
  if (ta.replace(/״/g, '"') === tb.replace(/״/g, '"')) return 'gershayim';
  if (ta.replace(/\s+/g, ' ') === tb.replace(/\s+/g, ' ')) return 'whitespace';
  return 'gershayim+whitespace';
}

// De-dupe + index one side's rows: [{raw, key, active}], first occurrence wins
// (same rule as Scheduling.activeNames). key = trim(name); raw is kept verbatim
// so a whitespace-only difference is still visible in nearMatches.
function _rosterSyncIndex(rows) {
  var list = [], seen = {};
  (Array.isArray(rows) ? rows : []).forEach(function (r) {
    var raw = (r && r.name != null) ? String(r.name) : '';
    var key = _rosterSyncTrim(raw);
    if (!key || seen[key]) return;
    seen[key] = true;
    list.push({ raw: raw, key: key, active: _rosterSyncIsActive(r.active) });
  });
  return list;
}

/**
 * Plan the staffing→Therapists roster sync. Pure — no I/O.
 * @param {Array} sheetRows current Therapists sheet rows [{name, active}]
 * @param {Array} feedRows  staffing feed rows [{name, active}]
 * @returns {{add:string[], deactivate:string[], reactivate:string[],
 *            unchanged:number, nearMatches:Array, possibleRenames:Array,
 *            unknownInSheet:string[]}}
 */
function planRosterSync(sheetRows, feedRows) {
  var plan = { add: [], deactivate: [], reactivate: [], unchanged: 0,
               nearMatches: [], possibleRenames: [], unknownInSheet: [] };
  var sheet = _rosterSyncIndex(sheetRows);
  var feed = _rosterSyncIndex(feedRows);
  var sheetByKey = {}, feedByKey = {};
  sheet.forEach(function (s) { sheetByKey[s.key] = s; });
  feed.forEach(function (f) { feedByKey[f.key] = f; });

  sheet.forEach(function (s) {
    var f = feedByKey[s.key];
    if (!f) {
      // Absent from the feed: report it, and (if currently active) deactivate.
      plan.unknownInSheet.push(s.key);
      if (s.active) plan.deactivate.push(s.key);
      return;
    }
    if (s.raw !== f.raw) {
      // Matched by trimmed key but not byte-equal raw (edge whitespace).
      plan.nearMatches.push({ sheet: s.raw, feed: f.raw, reason: _rosterSyncNearReason(s.raw, f.raw) });
    }
    if (s.active && !f.active) plan.deactivate.push(s.key);
    else if (!s.active && f.active) plan.reactivate.push(s.key);
    else plan.unchanged++;
  });
  feed.forEach(function (f) {
    if (!sheetByKey[f.key]) plan.add.push(f.key);
  });

  // nearMatches across the UNMATCHED names: same after normalization, not
  // byte-equal. These pairs are ALSO left in add/deactivate on purpose — the
  // human fixes the spelling at the source; nothing is auto-merged.
  var sheetOnly = sheet.filter(function (s) { return !feedByKey[s.key]; });
  var feedOnly = feed.filter(function (f) { return !sheetByKey[f.key]; });
  var nearPair = {};
  sheetOnly.forEach(function (s) {
    feedOnly.forEach(function (f) {
      if (_rosterSyncNormalize(s.key) === _rosterSyncNormalize(f.key)) {
        plan.nearMatches.push({ sheet: s.raw, feed: f.raw, reason: _rosterSyncNearReason(s.raw, f.raw) });
        nearPair[s.key + '\n' + f.key] = true;
      }
    });
  });

  // possibleRenames heuristic: a first token owned by EXACTLY one sheet-only
  // name and EXACTLY one feed-only name (and not already a nearMatch pair)
  // looks like a rename (שירן → שירן כהן). Report-only — never applied.
  var byToken = {};
  sheetOnly.forEach(function (s) {
    var t = _rosterSyncFirstToken(s.key);
    (byToken[t] = byToken[t] || { s: [], f: [] }).s.push(s.key);
  });
  feedOnly.forEach(function (f) {
    var t = _rosterSyncFirstToken(f.key);
    (byToken[t] = byToken[t] || { s: [], f: [] }).f.push(f.key);
  });
  Object.keys(byToken).forEach(function (t) {
    var g = byToken[t];
    if (g.s.length === 1 && g.f.length === 1 && !nearPair[g.s[0] + '\n' + g.f[0]]) {
      plan.possibleRenames.push({ from: g.s[0], to: g.f[0] });
    }
  });
  return plan;
}

/**
 * Turn a plan into the Therapists-sheet row writes: [{name, active}] where
 * active is the sheet's 'true'/'false' string convention (upsert by name;
 * missing names are appended). NEVER emits a delete, NEVER a rename;
 * deactivation only when explicitly allowed.
 * @param {Object} plan a planRosterSync result
 * @param {{allowDeactivate:boolean}} opts
 * @returns {Array<{name:string, active:string}>}
 */
function applyPlan(plan, opts) {
  var allowDeactivate = !!(opts && opts.allowDeactivate);
  var writes = [];
  if (!plan) return writes;
  (plan.add || []).forEach(function (n) { writes.push({ name: n, active: 'true' }); });
  (plan.reactivate || []).forEach(function (n) { writes.push({ name: n, active: 'true' }); });
  if (allowDeactivate) {
    (plan.deactivate || []).forEach(function (n) { writes.push({ name: n, active: 'false' }); });
  }
  return writes;
}

/* === END roster-sync core === */

// READ-ONLY preview: fetch the staffing roster, diff it against the Therapists
// sheet, return the plan. Writes NOTHING (guarded by test/roster-sync.test.js:
// zero setValues/appendRow/clearContent calls). Rides the existing app-password
// gate like every other action — it exposes only names + active flags.
function _previewStaffingRosterSync() {
  var roster = _staffingRoster();
  if (roster.status !== 'ok') return { ok: true, source: roster.status, plan: null };
  var sh = _ensureSheet('Therapists', THERAPISTS_HEADERS);
  var rows = _readAll(sh, THERAPISTS_HEADERS);
  return { ok: true, source: 'ok', plan: planRosterSync(rows, roster.therapists) };
}

// Run straight from the Apps Script editor (Run ▸ previewStaffingRosterSyncNow)
// to read the live plan in the log (same convention as migrateTherapistNamesNow).
function previewStaffingRosterSyncNow() {
  var report = _previewStaffingRosterSync();
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

// The WRITE path, run by _getData on every load. Ensures the Therapists sheet,
// fetches the staffing feed, and applies planRosterSync with
// allowDeactivate:true — upsert by name (only the `active` cell of an existing
// row is written; new names are appended with active='true'). Row deletes and
// renames NEVER happen here (see applyPlan). FAIL-SOFT: when the feed is
// unconfigured/unavailable nothing is written and the last-synced sheet is
// served as-is, with `source` saying why so the frontend can warn.
// A successful sync is cached in CacheService for 120s (key
// 'staffingRosterSync', same TTL as outpatient TherapistRates) so a burst of
// getData calls doesn't refetch/rewrite; the cached value is the last summary,
// echoed back so the console still sees it.
function _syncTherapistsFromStaffing() {
  var sh = _ensureSheet('Therapists', THERAPISTS_HEADERS);
  var cache = CacheService.getScriptCache();
  var hit = cache.get('staffingRosterSync');
  if (hit) {
    var cachedSummary = null;
    try { cachedSummary = JSON.parse(hit); } catch (_) {}
    return { sh: sh, source: 'staffing', summary: cachedSummary };
  }
  var roster = _staffingRoster();
  if (roster.status !== 'ok') return { sh: sh, source: roster.status, summary: null };

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var rows = _readAll(sh, THERAPISTS_HEADERS);
    var plan = planRosterSync(rows, roster.therapists);
    var writes = applyPlan(plan, { allowDeactivate: true });

    // Index existing rows by trimmed name (first occurrence wins — the same
    // rule planRosterSync used to build the plan), then write ONLY changed
    // cells: the `active` cell for an existing row, an appended row otherwise.
    var nameCol = THERAPISTS_HEADERS.indexOf('name');
    var activeCol = THERAPISTS_HEADERS.indexOf('active');
    var lastRow = sh.getLastRow();
    var grid = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, THERAPISTS_HEADERS.length).getValues() : [];
    var rowByName = {};
    for (var i = 0; i < grid.length; i++) {
      var key = String(grid[i][nameCol] == null ? '' : grid[i][nameCol]).trim();
      if (key && rowByName[key] === undefined) rowByName[key] = i;
    }
    var appends = [];
    writes.forEach(function (w) {
      var at = rowByName[w.name];
      if (at === undefined) appends.push([w.name, w.active]);
      else sh.getRange(at + 2, activeCol + 1, 1, 1).setValues([[w.active]]);
    });
    if (appends.length) {
      sh.getRange(lastRow + 1, 1, appends.length, THERAPISTS_HEADERS.length).setValues(appends);
    }

    var summary = {
      added: plan.add.length,
      deactivated: plan.deactivate.length,
      reactivated: plan.reactivate.length
    };
    cache.put('staffingRosterSync', JSON.stringify(summary), 120);
    return { sh: sh, source: 'staffing', summary: summary };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* ===== Per-patient management panel (ניהול מטופל) =====
 * Notes log + editable patient meta. All four actions are gated by a shared
 * secret PATIENT_MGMT_SECRET (Script Properties) — FAIL-CLOSED: a missing
 * property, or a missing/wrong provided secret, is an error and NEVER an open
 * read/write. The secret is injected server-side by the Node proxy and never
 * reaches the browser (same pattern as the cross-app read secrets).
 *
 * Validation (phone canonical /^0\d{9}$/, note type enum, non-empty text,
 * status enum, canonical-or-empty contactPhone) is an inline MIRROR of
 * public/patient-mgmt.js — keep both in sync; test/patient-mgmt.test.js guards
 * the pure module and the header order on both sides. */

var _NOTE_TYPES = { clinical: true, admin: true, family: true, other: true };
var _PATIENT_STATUSES = { active: true, continuing: true, frozen: true, ended: true };

// Fail-closed secret gate. Returns null when authorized, or an error object to
// return verbatim when not. Missing property ⇒ unconfigured (never open).
function _requirePatientMgmtSecret(provided) {
  var configured = PropertiesService.getScriptProperties().getProperty('PATIENT_MGMT_SECRET');
  if (!configured) return { ok: false, error: 'patient_mgmt_secret_unconfigured' };
  if (!provided || String(provided) !== String(configured)) return { ok: false, error: 'unauthorized' };
  return null;
}

// Mirror of public/patient-mgmt.js validateNote (server owns the timestamp).
function _validatePatientNote(input) {
  input = input || {};
  var phone = _toCanonicalPhone(input.phone);
  if (!phone) return { ok: false, error: 'invalid_phone' };
  if (!_NOTE_TYPES[String(input.type == null ? '' : input.type)]) return { ok: false, error: 'invalid_type' };
  var text = String(input.text == null ? '' : input.text).trim();
  if (!text) return { ok: false, error: 'empty_text' };
  return { ok: true, value: { phone: phone, type: String(input.type), text: text,
    author: String(input.author == null ? '' : input.author).trim() } };
}

// Mirror of public/patient-mgmt.js validateMeta (writer stamps updatedBy/At).
function _validatePatientMeta(input) {
  input = input || {};
  var phone = _toCanonicalPhone(input.phone);
  if (!phone) return { ok: false, error: 'invalid_phone' };
  var fields = input.fields || {};
  var status = String(fields.status == null ? '' : fields.status).trim() || 'active';
  if (!_PATIENT_STATUSES[status]) return { ok: false, error: 'invalid_status' };
  var contactPhone = String(fields.contactPhone == null ? '' : fields.contactPhone).trim();
  if (contactPhone && !_toCanonicalPhone(contactPhone)) return { ok: false, error: 'invalid_contact_phone' };
  function s(v) { return v == null ? '' : String(v); }
  return { ok: true, value: {
    phone: phone, status: status,
    statusReason: s(fields.statusReason), statusDate: s(fields.statusDate),
    contactName: s(fields.contactName), contactPhone: contactPhone,
    referral: s(fields.referral), goals: s(fields.goals)
  } };
}

// getPatientNotes(phone) → { ok, notes: [...] } newest-first. Append-only sheet,
// so we read all rows for the phone and sort by timestamp descending.
function _getPatientNotes(params) {
  var gate = _requirePatientMgmtSecret(params && params.secret);
  if (gate) return gate;
  var phone = _toCanonicalPhone(params && params.phone);
  if (!phone) return { ok: false, error: 'invalid_phone' };
  var sh = _ensureSheet('Notes', NOTES_HEADERS);
  var key = _normalizePhoneForMatch(phone);
  var rows = _readAll(sh, NOTES_HEADERS).filter(function (r) {
    return _normalizePhoneForMatch(r.phone) === key;
  });
  rows.sort(function (a, b) {
    var ta = String(a.timestamp || ''), tb = String(b.timestamp || '');
    return ta < tb ? 1 : (ta > tb ? -1 : 0);   // ISO strings sort chronologically
  });
  return { ok: true, notes: rows };
}

// addPatientNote(phone, author, type, text) → appends ONE row. The server sets
// the timestamp (ISO) — a client clock is never trusted for the audit trail.
function _addPatientNote(payload) {
  var gate = _requirePatientMgmtSecret(payload && payload.secret);
  if (gate) return gate;
  var v = _validatePatientNote(payload);
  if (!v.ok) return v;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = _ensureSheet('Notes', NOTES_HEADERS);
    var note = {
      phone: v.value.phone,
      timestamp: new Date().toISOString(),
      author: v.value.author,
      type: v.value.type,
      text: v.value.text
    };
    sh.appendRow(NOTES_HEADERS.map(function (h) { return note[h] == null ? '' : note[h]; }));
    return { ok: true, note: note };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// getPatientMeta(phone) → { ok, meta } — the single row, or empty defaults
// (status:'active') when the patient has no meta row yet.
function _getPatientMeta(params) {
  var gate = _requirePatientMgmtSecret(params && params.secret);
  if (gate) return gate;
  var phone = _toCanonicalPhone(params && params.phone);
  if (!phone) return { ok: false, error: 'invalid_phone' };
  var sh = _ensureSheet('PatientMeta', PATIENT_META_HEADERS);
  var key = _normalizePhoneForMatch(phone);
  var rows = _readAll(sh, PATIENT_META_HEADERS);
  for (var i = 0; i < rows.length; i++) {
    if (_normalizePhoneForMatch(rows[i].phone) === key) return { ok: true, meta: rows[i] };
  }
  return { ok: true, meta: {
    phone: phone, status: 'active', statusReason: '', statusDate: '',
    contactName: '', contactPhone: '', referral: '', goals: '',
    updatedBy: '', updatedAt: ''
  } };
}

// setPatientMeta(phone, fields, updatedBy) → UPSERT the single row by phone
// (single-row write via _upsertByKey, not a full-sheet rewrite). Last-writer-wins;
// updatedBy/updatedAt are stamped on every save. LockService guards the upsert.
function _setPatientMeta(payload) {
  var gate = _requirePatientMgmtSecret(payload && payload.secret);
  if (gate) return gate;
  var v = _validatePatientMeta(payload);
  if (!v.ok) return v;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = _ensureSheet('PatientMeta', PATIENT_META_HEADERS);
    var row = v.value;
    row.updatedBy = String(payload.updatedBy == null ? '' : payload.updatedBy).trim();
    row.updatedAt = new Date().toISOString();
    _upsertByKey(sh, PATIENT_META_HEADERS, 'phone', row);
    return { ok: true, meta: row };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* ===== Follow-up tasks (משימות מעקב) — phase 2 ==========================
 * Same secret gate + patterns as the notes/meta actions above. Validation
 * (canonical phone, non-empty text, valid ISO dueDate, overdue boundary, counts
 * aggregation) is an inline MIRROR of public/patient-mgmt.js — keep both in sync;
 * test/patient-mgmt.test.js guards the pure module + the FOLLOWUPS header order. */

var _ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function _isISODate(s) {
  var v = String(s == null ? '' : s).trim();
  if (!_ISO_DATE_RE.test(v)) return false;
  var y = +v.slice(0, 4), m = +v.slice(5, 7), d = +v.slice(8, 10);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  var dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function _isFollowUpDone(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}
// Overdue = due strictly BEFORE today AND not done (due today is NOT overdue).
function _isFollowUpOverdue(dueDate, today, done) {
  if (_isFollowUpDone(done)) return false;
  var d = String(dueDate == null ? '' : dueDate).trim(), t = String(today == null ? '' : today).trim();
  if (!_ISO_DATE_RE.test(d) || !_ISO_DATE_RE.test(t)) return false;
  return d < t;
}
// Mirror of public/patient-mgmt.js validateFollowUp.
function _validateFollowUp(input) {
  input = input || {};
  var phone = _toCanonicalPhone(input.phone);
  if (!phone) return { ok: false, error: 'invalid_phone' };
  var text = String(input.text == null ? '' : input.text).trim();
  if (!text) return { ok: false, error: 'empty_text' };
  var dueDate = String(input.dueDate == null ? '' : input.dueDate).trim();
  if (!_isISODate(dueDate)) return { ok: false, error: 'invalid_due_date' };
  return { ok: true, value: { phone: phone, text: text, dueDate: dueDate,
    createdBy: String(input.createdBy == null ? '' : input.createdBy).trim() } };
}

// getFollowUps(phone) → { ok, open:[...], done:[...] }. Open sorted by dueDate
// ascending (soonest first); done sorted by doneAt descending (most recent first).
function _getFollowUps(params) {
  var gate = _requirePatientMgmtSecret(params && params.secret);
  if (gate) return gate;
  var phone = _toCanonicalPhone(params && params.phone);
  if (!phone) return { ok: false, error: 'invalid_phone' };
  var sh = _ensureSheet('FollowUps', FOLLOWUPS_HEADERS);
  var key = _normalizePhoneForMatch(phone);
  var rows = _readAll(sh, FOLLOWUPS_HEADERS).filter(function (r) {
    return _normalizePhoneForMatch(r.phone) === key;
  });
  var open = [], done = [];
  rows.forEach(function (r) { (_isFollowUpDone(r.done) ? done : open).push(r); });
  open.sort(function (a, b) {
    var da = String(a.dueDate || ''), db = String(b.dueDate || '');
    return da < db ? -1 : (da > db ? 1 : 0);
  });
  done.sort(function (a, b) {
    var da = String(a.doneAt || ''), db = String(b.doneAt || '');
    return da < db ? 1 : (da > db ? -1 : 0);
  });
  return { ok: true, open: open, done: done };
}

// addFollowUp(phone, createdBy, dueDate, text) → appends ONE row. The server sets
// id (timestamp-based unique), createdAt (ISO), and done=''.
function _addFollowUp(payload) {
  var gate = _requirePatientMgmtSecret(payload && payload.secret);
  if (gate) return gate;
  var v = _validateFollowUp(payload);
  if (!v.ok) return v;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = _ensureSheet('FollowUps', FOLLOWUPS_HEADERS);
    var now = new Date();
    var id = 'fu_' + now.getTime().toString(36) + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    var row = {
      phone: v.value.phone, id: id, createdAt: now.toISOString(), createdBy: v.value.createdBy,
      dueDate: v.value.dueDate, text: v.value.text, done: '', doneAt: '', doneBy: ''
    };
    sh.appendRow(FOLLOWUPS_HEADERS.map(function (h) { return row[h] == null ? '' : row[h]; }));
    return { ok: true, followup: row };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// setFollowUpDone(phone, id, done, doneBy) → single-row update by id. Sets done +
// doneAt (ISO when done, cleared when un-done) + doneBy. LockService-guarded.
function _setFollowUpDone(payload) {
  var gate = _requirePatientMgmtSecret(payload && payload.secret);
  if (gate) return gate;
  var p = payload || {};
  var phone = _toCanonicalPhone(p.phone);
  if (!phone) return { ok: false, error: 'invalid_phone' };
  var id = String(p.id == null ? '' : p.id).trim();
  if (!id) return { ok: false, error: 'missing_id' };
  var done = _isFollowUpDone(p.done);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = _ensureSheet('FollowUps', FOLLOWUPS_HEADERS);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: false, error: 'not_found' };
    var idIdx = FOLLOWUPS_HEADERS.indexOf('id');
    var ids = sh.getRange(2, idIdx + 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === id) {
        var rowNum = i + 2;
        var current = sh.getRange(rowNum, 1, 1, FOLLOWUPS_HEADERS.length).getValues()[0];
        var obj = {};
        FOLLOWUPS_HEADERS.forEach(function (h, c) { obj[h] = current[c]; });
        obj.done = done ? 'true' : '';
        obj.doneAt = done ? new Date().toISOString() : '';
        obj.doneBy = done ? String(p.doneBy == null ? '' : p.doneBy).trim() : '';
        sh.getRange(rowNum, 1, 1, FOLLOWUPS_HEADERS.length)
          .setValues([FOLLOWUPS_HEADERS.map(function (h) { return obj[h] == null ? '' : obj[h]; })]);
        return { ok: true, followup: obj };
      }
    }
    return { ok: false, error: 'not_found' };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// getOpenFollowUpCounts() → { ok, counts: { "<phone>": {open, overdue} } } for
// ALL patients in ONE read (the per-card badge source — no N per-card calls).
function _getOpenFollowUpCounts(params) {
  var gate = _requirePatientMgmtSecret(params && params.secret);
  if (gate) return gate;
  var sh = _ensureSheet('FollowUps', FOLLOWUPS_HEADERS);
  var rows = _readAll(sh, FOLLOWUPS_HEADERS);
  var today = _todayStr();
  var counts = {};
  rows.forEach(function (r) {
    if (!r || _isFollowUpDone(r.done)) return;
    var key = _normalizePhoneForMatch(r.phone);
    if (!key) return;
    if (!counts[key]) counts[key] = { open: 0, overdue: 0 };
    counts[key].open++;
    if (_isFollowUpOverdue(r.dueDate, today, r.done)) counts[key].overdue++;
  });
  return { ok: true, counts: counts };
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
    if (action === 'getPatientNotes') return _json(_getPatientNotes(e.parameter));
    if (action === 'getPatientMeta') return _json(_getPatientMeta(e.parameter));
    if (action === 'getFollowUps') return _json(_getFollowUps(e.parameter));
    if (action === 'getOpenFollowUpCounts') return _json(_getOpenFollowUpCounts(e.parameter));
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
    if (action === 'setSessionOutcome') return _json(_setSessionOutcome(payload));
    if (action === 'syncPending') return _json(_syncPending());
    if (action === 'savePatient') return _json(_savePatient(payload));
    if (action === 'markPatientStopped') return _json(_markPatientStopped(payload));
    if (action === 'restorePatient') return _json(_restorePatient(payload));
    if (action === 'removePatient') return _json(_removePatient(payload));
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
    if (action === 'migrateTherapistNames') return _json(_migrateTherapistNames());
    if (action === 'previewStaffingRosterSync') return _json(_previewStaffingRosterSync());
    if (action === 'requestExtraSession') return _json(_postRequestExtraSession(payload));
    if (action === 'getPatientNotes') return _json(_getPatientNotes(payload));
    if (action === 'addPatientNote') return _json(_addPatientNote(payload));
    if (action === 'getPatientMeta') return _json(_getPatientMeta(payload));
    if (action === 'setPatientMeta') return _json(_setPatientMeta(payload));
    if (action === 'getFollowUps') return _json(_getFollowUps(payload));
    if (action === 'addFollowUp') return _json(_addFollowUp(payload));
    if (action === 'setFollowUpDone') return _json(_setFollowUpDone(payload));
    if (action === 'getOpenFollowUpCounts') return _json(_getOpenFollowUpCounts(payload));
    return _json({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}
