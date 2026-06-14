/**
 * stopflow.js
 * -----------------------------------------------------------------------------
 * The patient STOP / discharge flow — therapists side (the SENDER).
 *
 * A patient stops treatment in one of two ways, and BOTH move them out of the
 * active list into the "stopped / discharged" list (history kept):
 *
 *  1. DISCHARGED in outpatient — the source of truth. Outpatient's
 *     `getTreatmentPlans` reports `status: "סיים טיפול"` for a discharged
 *     patient; `isStoppedStatus` recognises exactly that string.
 *
 *  2. LOCALLY FLAGGED here — Vered (in שיבוץ) or a therapist (on their own
 *     patient) presses "סמן הפסקת טיפול". This does NOT discharge the patient
 *     directly: it POSTs `flagStop` to the outpatient `/exec` (server-to-server
 *     from the therapists Apps Script, shared secret `STOP_FLAG_SECRET`), which
 *     becomes a PENDING request Vered confirms in outpatient. Until then the
 *     patient is "stopped" here so we stop scheduling them and cancel their
 *     future bookings.
 *
 * This module is the PURE part: recognise the discharged status, decide whether
 * a patient is stopped, build the canonical `flagStop` payload (reusing the one
 * phone helper), and pick the future-unreported bookings to cancel. The network
 * POST + the Sheet writes live in Code.gs (mirrored there). Framework-free so it
 * runs in the browser AND under `node --test`; `test/stopflow.test.js` guards it.
 */
(function (root, factory) {
  var Phone = (typeof module === 'object' && module.exports)
    ? require('./phone')
    : root.Phone;
  var api = factory(Phone);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / tests
  } else {
    root.StopFlow = api;             // browser global
  }
})(typeof self !== 'undefined' ? self : this, function (Phone) {
  'use strict';

  // The outpatient status string that means the patient was discharged.
  var DISCHARGED_STATUS = 'סיים טיפול';

  /**
   * Is this outpatient plan status the discharged one? (trimmed exact match).
   * @param {*} status
   * @returns {boolean}
   */
  function isStoppedStatus(status) {
    return String(status == null ? '' : status).trim() === DISCHARGED_STATUS;
  }

  /**
   * Is the patient stopped? Discharged in outpatient OR locally flagged (a stop
   * request pending Vered's confirmation). `localStopped` accepts a boolean or
   * the stored 'true' string.
   * @param {{planStatus?:*, localStopped?:*}} input
   * @returns {boolean}
   */
  function isPatientStopped(input) {
    input = input || {};
    if (isStoppedStatus(input.planStatus)) return true;
    var ls = input.localStopped;
    return ls === true || String(ls == null ? '' : ls).trim().toLowerCase() === 'true';
  }

  /**
   * Build the `flagStop` POST body. Reuses the canonical phone helper so the
   * OUTGOING phone is always canonical (10 digits, leading zero); a phone that
   * can't be made canonical is rejected — we never send a malformed key to
   * outpatient. Name/reportedBy/note are trimmed strings.
   * @param {{phone:*, name?:*, reportedBy?:*, note?:*}} input
   * @param {object} [phoneApi] injectable for tests (defaults to Phone)
   * @returns {{ok:true, payload:object} | {ok:false, error:string}}
   */
  function buildFlagStopPayload(input, phoneApi) {
    input = input || {};
    var P = phoneApi || Phone;
    var pv = P.toCanonical(input.phone);
    if (!pv.ok) return { ok: false, error: pv.error };
    return {
      ok: true,
      payload: {
        phone: pv.value,
        name: String(input.name == null ? '' : input.name).trim(),
        reportedBy: String(input.reportedBy == null ? '' : input.reportedBy).trim(),
        note: String(input.note == null ? '' : input.note).trim()
      }
    };
  }

  /**
   * The future, UNREPORTED bookings for one patient — the rows to cancel on stop.
   * Matches by normalized phone; "future" is today forward (`date >= today`);
   * already-reported rows (attendance set) and past rows are KEPT for the record.
   * @param {Array} rows schedule rows ({patientPhone, scheduledDate, attendance, id})
   * @param {*} phone the patient's phone
   * @param {string} today 'YYYY-MM-DD'
   * @param {object} [phoneApi]
   * @returns {Array} the rows that should be cancelled
   */
  function futureBookingsToCancel(rows, phone, today, phoneApi) {
    var P = phoneApi || Phone;
    // Recover a leading zero Sheets may have dropped BEFORE normalizing, so a
    // canonical key matches a mangled stored phone (e.g. 501234567). Without this
    // the patient's own bookings are missed and never cancelled.
    var key = P.normalizeForMatch(P.recoverStored(phone));
    var t = String(today || '');
    if (!key || !t) return [];
    return (Array.isArray(rows) ? rows : []).filter(function (r) {
      if (!r) return false;
      if (P.normalizeForMatch(P.recoverStored(r.patientPhone)) !== key) return false;
      if (String(r.attendance || '') !== '') return false;     // already reported → keep
      var d = String(r.scheduledDate || '');
      if (d.indexOf('T') !== -1) d = d.split('T')[0];
      return !!d && d >= t;                                    // today forward
    });
  }

  /**
   * Just the ids of `futureBookingsToCancel` (blank ids dropped).
   * @returns {string[]}
   */
  function futureBookingIdsToCancel(rows, phone, today, phoneApi) {
    return futureBookingsToCancel(rows, phone, today, phoneApi)
      .map(function (r) { return r.id; })
      .filter(Boolean);
  }

  /**
   * Partition a built roster into { active, stopped } by each item's `stopped`
   * flag — the "local move". This is what removes a just-flagged patient from the
   * active working lists and surfaces them in the stop-request list.
   * @param {Array} patients roster items carrying a boolean `stopped`
   * @returns {{active:Array, stopped:Array}}
   */
  function splitStopped(patients) {
    var active = [], stopped = [];
    (Array.isArray(patients) ? patients : []).forEach(function (p) {
      (p && p.stopped ? stopped : active).push(p);
    });
    return { active: active, stopped: stopped };
  }

  return {
    DISCHARGED_STATUS: DISCHARGED_STATUS,
    isStoppedStatus: isStoppedStatus,
    isPatientStopped: isPatientStopped,
    buildFlagStopPayload: buildFlagStopPayload,
    futureBookingsToCancel: futureBookingsToCancel,
    futureBookingIdsToCancel: futureBookingIdsToCancel,
    splitStopped: splitStopped
  };
});
