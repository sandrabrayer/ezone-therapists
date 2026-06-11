/**
 * scheduling.js
 * -----------------------------------------------------------------------------
 * Pure helpers for the SCHEDULING model (iteration 2). A therapist schedules a
 * follow-up treatment for a patient, recording therapist / treatment type /
 * location / date, and later marks whether it happened.
 *
 * DATA MODEL — one row PER PATIENT PER SESSION
 * --------------------------------------------
 * A single-patient treatment is a session with one patient row. A group
 * (קבוצה) treatment is ONE session — one therapist, one date, one location —
 * shared by several patient rows via a common `sessionId`. Every patient row
 * carries its OWN debt-gate result and its OWN attendance flag, so:
 *   - the debt gate runs PER PATIENT (a debtor is blocked individually; the
 *     session still proceeds for everyone else), and
 *   - did-it-happen is PER PATIENT (mark exactly who attended).
 *
 * EXTENSIBLE, ACTIVE-FLAGGED LISTS
 * --------------------------------
 * Therapist names and treatment types live in the Sheet as editable rows with
 * an `active` flag. `activeNames` is what feeds the dropdowns; retiring an entry
 * only removes it from that list going forward. Past rows keep whatever
 * therapist/type STRING they were saved with, so deactivation never rewrites or
 * breaks history.
 *
 * Framework-free so it runs in the browser AND under `node --test`.
 * `test/scheduling.test.js` guards every rule here.
 */
(function (root, factory) {
  var DebtGate = (typeof module === 'object' && module.exports)
    ? require('./debt-gate')
    : root.DebtGate;
  var api = factory(DebtGate);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / tests
  } else {
    root.Scheduling = api;           // browser global
  }
})(typeof self !== 'undefined' ? self : this, function (DebtGate) {
  'use strict';

  // Attendance is a tri-state: not-yet-marked, attended, or did-not-attend.
  var ATTENDANCE = { PENDING: '', OCCURRED: 'occurred', MISSED: 'missed' };

  // The treatment type that means "group session" by default. The Sheet's
  // TreatmentTypes list can also flag a row `isGroup` explicitly (robust to
  // renames); this name is the fallback when no flag is present.
  var GROUP_TYPE_NAME = 'קבוצה';

  function isActive(entry) {
    if (!entry || typeof entry !== 'object') return false;
    // Absent/empty `active` defaults to ACTIVE; only an explicit falsey flag
    // ('false', false, 0, 'no') retires the entry.
    var v = entry.active;
    if (v === undefined || v === null || v === '') return true;
    var s = String(v).trim().toLowerCase();
    return !(s === 'false' || s === '0' || s === 'no' || s === 'inactive' || s === 'לא');
  }

  /**
   * Names to show in a dropdown: active entries only, de-duplicated, original
   * order preserved. Retired entries drop out here but remain valid on any old
   * record that already references them by string.
   * @param {Array} list rows like [{name, active}]
   * @returns {string[]}
   */
  function activeNames(list) {
    if (!Array.isArray(list)) return [];
    var seen = {};
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      var name = e && (typeof e === 'string' ? e : e.name);
      name = String(name == null ? '' : name).trim();
      if (!name) continue;
      var active = (typeof e === 'string') ? true : isActive(e);
      if (!active) continue;
      if (seen[name]) continue;
      seen[name] = true;
      out.push(name);
    }
    return out;
  }

  /**
   * Is `typeName` the group type? Prefers an explicit `isGroup` flag on the
   * matching TreatmentTypes row; falls back to the canonical group name so a
   * code-only setup still works.
   * @param {string} typeName
   * @param {Array} [treatmentTypes] rows like [{name, active, isGroup}]
   * @returns {boolean}
   */
  function isGroupType(typeName, treatmentTypes) {
    var name = String(typeName == null ? '' : typeName).trim();
    if (!name) return false;
    if (Array.isArray(treatmentTypes)) {
      for (var i = 0; i < treatmentTypes.length; i++) {
        var t = treatmentTypes[i];
        if (t && String(t.name == null ? '' : t.name).trim() === name) {
          if (t.isGroup !== undefined && t.isGroup !== null && t.isGroup !== '') {
            var s = String(t.isGroup).trim().toLowerCase();
            return s === 'true' || s === '1' || s === 'yes' || s === 'כן';
          }
          return name === GROUP_TYPE_NAME;
        }
      }
    }
    return name === GROUP_TYPE_NAME;
  }

  /**
   * Validate the session-level fields shared by every patient row.
   * @param {object} s {therapist, treatmentType, location, scheduledDate}
   * @returns {{ok:boolean, error?:string}}
   */
  function validateSession(s) {
    s = s || {};
    if (!String(s.therapist || '').trim()) return { ok: false, error: 'חסר שם מטפל/ת' };
    if (!String(s.treatmentType || '').trim()) return { ok: false, error: 'יש לבחור סוג טיפול' };
    if (!String(s.location || '').trim()) return { ok: false, error: 'יש לבחור מיקום' };
    if (!String(s.scheduledDate || '').trim()) return { ok: false, error: 'יש לבחור תאריך' };
    return { ok: true };
  }

  function validateAttendance(v) {
    var s = String(v == null ? '' : v);
    return s === ATTENDANCE.PENDING || s === ATTENDANCE.OCCURRED || s === ATTENDANCE.MISSED;
  }

  /**
   * Build the persisted rows for a session: one per patient, all sharing
   * `sessionId`. Each patient supplies its own gate fields (decided per patient,
   * see evaluateGroup). Pure: ids/sessionId/timestamps are injected so tests are
   * deterministic.
   *
   * @param {object} session {therapist, treatmentType, location, scheduledDate}
   * @param {Array}  patients [{name, phone, gateStatus, gateReason, amountOwed,
   *                            approverId, approverName, approvalNote, approvedAt}]
   * @param {object} [opts] {sessionId, idFn, now}
   * @returns {Array} rows ready to upsert
   */
  function buildSessionRows(session, patients, opts) {
    session = session || {};
    opts = opts || {};
    var sessionId = opts.sessionId || ('s_' + Math.random().toString(36).slice(2));
    var idFn = typeof opts.idFn === 'function'
      ? opts.idFn
      : function () { return 'r_' + Math.random().toString(36).slice(2); };
    var created = opts.now || '';
    var list = Array.isArray(patients) ? patients : [];
    return list.map(function (p) {
      p = p || {};
      return {
        id: p.id || idFn(p),
        sessionId: sessionId,
        therapist: String(session.therapist || '').trim(),
        treatmentType: String(session.treatmentType || '').trim(),
        location: String(session.location || '').trim(),
        scheduledDate: String(session.scheduledDate || '').trim(),
        patientName: String(p.name == null ? '' : p.name).trim(),
        patientPhone: String(p.phone == null ? '' : p.phone).trim(),
        attendance: (p.attendance && validateAttendance(p.attendance)) ? p.attendance : ATTENDANCE.PENDING,
        attendanceMarkedAt: p.attendanceMarkedAt || '',
        gateStatus: p.gateStatus || '',
        gateReason: p.gateReason || '',
        amountOwed: Number(p.amountOwed) || 0,
        approverId: p.approverId || '',
        approverName: p.approverName || '',
        approvalNote: p.approvalNote || '',
        approvedAt: p.approvedAt || '',
        created: created
      };
    });
  }

  /**
   * Run the debt gate INDEPENDENTLY for every patient in a (possibly group)
   * session. One debtor never lets the rest pass and the rest never let a debtor
   * pass — each gets its own decision. This is just DebtGate.evaluate mapped per
   * patient, made explicit so group handling can't accidentally check the group
   * "as a whole".
   *
   * @param {object} input {patients:[{name,phone}], roster, rosterOk}
   * @param {object} [phoneApi]
   * @returns {Array} [{name, phone, gate}] gate = DebtGate.evaluate result
   */
  function evaluateGroup(input, phoneApi) {
    input = input || {};
    var patients = Array.isArray(input.patients) ? input.patients : [];
    return patients.map(function (p) {
      p = p || {};
      var gate = DebtGate.evaluate({
        phone: p.phone,
        roster: input.roster,
        rosterOk: input.rosterOk
      }, phoneApi);
      return { name: p.name, phone: p.phone, gate: gate };
    });
  }

  return {
    ATTENDANCE: ATTENDANCE,
    GROUP_TYPE_NAME: GROUP_TYPE_NAME,
    isActive: isActive,
    activeNames: activeNames,
    isGroupType: isGroupType,
    validateSession: validateSession,
    validateAttendance: validateAttendance,
    buildSessionRows: buildSessionRows,
    evaluateGroup: evaluateGroup
  };
});
