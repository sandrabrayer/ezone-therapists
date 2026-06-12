/**
 * writeback.js
 * -----------------------------------------------------------------------------
 * Builds the OUTPATIENT write-back payload from a scheduled session's rows
 * (iteration 4). When a treatment is marked happened/didn't-happen, the local
 * Schedule row is the SOURCE OF TRUTH; this turns the session's current state
 * into the idempotent set of records to upsert on the outpatient side
 * (TreatmentsGiven), which drives therapist pay.
 *
 * THE TWO DIMENSIONS
 * ------------------
 *  1. PER-PATIENT ATTENDANCE — patient billing is per patient, so every patient
 *     row produces an attendance record keyed by its own treatment id.
 *  2. THERAPIST PAYMENT — for a single (non-group) treatment the one patient row
 *     IS the payment record. For a GROUP (קבוצה) the therapist is paid ONCE at
 *     the group rate, so there is exactly ONE payment record for the whole
 *     session (keyed by sessionId), NOT one per patient.
 *
 * IDEMPOTENT + DRIFT-FREE
 * -----------------------
 * Every record is keyed by a stable `treatmentId` (the patient row id, or the
 * sessionId for the group payment row), so re-sending on a retry never
 * double-counts. Because the FULL session state is rebuilt every time, unmarking
 * or editing a patient's attendance recomputes both that patient's record and
 * the group payment's `given` (= did the session happen at all), so downstream
 * pay can never drift out of sync with what the therapist actually marked.
 *
 * `given` = attendance is 'occurred'. The group payment is `given` when the
 * session happened at all (at least one patient attended); all no-shows → not
 * given → no pay.
 *
 * Framework-free; runs in the browser and under `node --test`. Mirrored inline
 * by apps-script/Code.gs (_buildSessionWriteback); any change here MUST update
 * both. `test/writeback.test.js` guards it.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / tests
  } else {
    root.Writeback = api;            // browser global
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function isGiven(attendance) { return String(attendance || '') === 'occurred'; }

  /**
   * Build the write-back for one session.
   * @param {Array} rows the session's patient rows (share a sessionId)
   * @param {object} [opts] { isGroup }  caller decides group-ness (via the
   *        TreatmentTypes isGroup flag); a single-patient group is still a group.
   * @returns {?{sessionId:string, isGroup:boolean, therapist:string, records:Array}}
   */
  function buildSessionWriteback(rows, opts) {
    opts = opts || {};
    rows = Array.isArray(rows) ? rows.filter(Boolean) : [];
    if (!rows.length) return null;
    var head = rows[0];
    var isGroup = !!opts.isGroup;
    var sessionId = head.sessionId || head.id;
    var anyGiven = rows.some(function (r) { return isGiven(r.attendance); });

    // One attendance record per patient (patient billing is per patient). For a
    // non-group treatment this single record is ALSO the therapist-payment row.
    var records = rows.map(function (r) {
      return {
        treatmentId: r.id,
        sessionId: sessionId,
        therapist: head.therapist,
        patientName: r.patientName,
        patientPhone: r.patientPhone,
        date: r.scheduledDate,
        treatmentType: head.treatmentType,
        location: head.location,
        attendance: String(r.attendance || ''),
        given: isGiven(r.attendance),
        isGroup: isGroup,
        isPayment: !isGroup,                 // group payment is a separate row below
        rate: isGroup ? 'group_member' : 'individual'
      };
    });

    // GROUP: exactly one therapist-payment record at the group rate, keyed by the
    // session (not per patient). `given` reflects whether the session happened.
    if (isGroup) {
      records.push({
        treatmentId: sessionId,
        sessionId: sessionId,
        therapist: head.therapist,
        patientName: '',
        patientPhone: '',
        date: head.scheduledDate,
        treatmentType: head.treatmentType,
        location: head.location,
        attendance: anyGiven ? 'occurred' : '',
        given: anyGiven,
        isGroup: true,
        isPayment: true,
        rate: 'group'
      });
    }

    return { sessionId: sessionId, isGroup: isGroup, therapist: head.therapist, records: records };
  }

  // The therapist-payment records (what pay is counted from). Length is 1 for a
  // group (the group row) and 1 per attended patient for non-group treatments.
  function paymentRecords(wb) {
    if (!wb || !Array.isArray(wb.records)) return [];
    return wb.records.filter(function (r) { return r.isPayment; });
  }

  // Did the session happen at all (drives the group payment's `given`).
  function isSessionGiven(rows) {
    return (Array.isArray(rows) ? rows : []).some(function (r) { return isGiven(r && r.attendance); });
  }

  // OFFLINE-SYNC support: which sessionIds still have a row needing sync. The
  // local save never fails; the outpatient write is a best-effort sync, so any
  // row left 'pending' (write unreachable) is retried later — never dropped.
  function sessionsNeedingSync(rows) {
    var seen = {};
    var out = [];
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (r && String(r.syncStatus || '') === 'pending') {
        var sid = r.sessionId || r.id;
        if (sid && !seen[sid]) { seen[sid] = true; out.push(sid); }
      }
    });
    return out;
  }

  return {
    isGiven: isGiven,
    buildSessionWriteback: buildSessionWriteback,
    paymentRecords: paymentRecords,
    isSessionGiven: isSessionGiven,
    sessionsNeedingSync: sessionsNeedingSync
  };
});
