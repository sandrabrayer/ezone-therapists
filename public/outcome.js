/**
 * outcome.js
 * -----------------------------------------------------------------------------
 * SESSION OUTCOME (iteration 18, step 2) — the therapist marks what actually
 * happened to a scheduled session, as exactly ONE of three mutually-exclusive
 * outcomes:
 *
 *   happened             → התקיים            (the treatment took place)
 *   therapist_cancelled  → המטפל ביטל / לא הגיע
 *   patient_no_show      → המטופל לא הגיע
 *
 * STORAGE-ONLY. This module turns a session row + a chosen outcome into a
 * stamped record (patient, therapist, treatmentType, date, outcome, timestamp).
 * It does NO pay computation and triggers NO outpatient write-back — wiring the
 * outcome to therapist pay / the outpatient receiver is step 3. The legacy
 * binary `attendance` field (occurred/missed) and its writeback (public/writeback.js)
 * are intentionally left untouched for that step.
 *
 * English tokens are the stored values (matching the app's enum convention —
 * attendance/gateStatus/syncStatus); Hebrew is display-only. The token set is
 * CLOSED: only the three values above are accepted, anything else is rejected.
 *
 * Framework-free; runs in the browser and under `node --test`. Mirrored inline
 * by apps-script/Code.gs (_setSessionOutcome); any change to the allowed values
 * here MUST update both. `test/outcome.test.js` guards it.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / tests
  } else {
    root.Outcome = api;              // browser global
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // The CLOSED set of session outcomes: storage token → Hebrew (display-only).
  // Order is the display order of the picker.
  var OUTCOMES = {
    happened: 'התקיים',
    therapist_cancelled: 'המטפל ביטל / לא הגיע',
    patient_no_show: 'המטופל לא הגיע'
  };
  var VALUES = ['happened', 'therapist_cancelled', 'patient_no_show'];

  // Is `v` one of the three allowed outcomes? (The empty/unmarked state is NOT
  // an outcome — there is nothing to store — so it is not valid here.)
  function isValid(v) { return VALUES.indexOf(String(v == null ? '' : v)) !== -1; }

  // Hebrew label for a stored token ('' for unknown/unmarked).
  function labelFor(v) { return OUTCOMES[String(v == null ? '' : v)] || ''; }

  /**
   * Build the stamped outcome record for one session row.
   * Every outcome is stamped with the session's identity so the stored row is
   * self-describing: patient, therapist, treatmentType, date, outcome, timestamp.
   * @param {object} row   a Schedule row (has id/sessionId/patient/therapist/…)
   * @param {string} outcome  one of VALUES
   * @param {object} [opts] { now } injectable ISO timestamp (tests)
   * @returns {{ok:true, record:object} | {ok:false, error:string}}
   */
  function buildOutcome(row, outcome, opts) {
    opts = opts || {};
    if (!row || !row.id) return { ok: false, error: 'missing_row' };
    if (!isValid(outcome)) return { ok: false, error: 'invalid_outcome' };
    var now = opts.now || new Date().toISOString();
    return {
      ok: true,
      record: {
        id: row.id,
        sessionId: row.sessionId || row.id,
        patientName: row.patientName || '',
        patientPhone: row.patientPhone || '',
        therapist: row.therapist || '',
        treatmentType: row.treatmentType || '',
        scheduledDate: row.scheduledDate || '',
        outcome: String(outcome),
        outcomeAt: now
      }
    };
  }

  return {
    OUTCOMES: OUTCOMES,
    VALUES: VALUES,
    isValid: isValid,
    labelFor: labelFor,
    buildOutcome: buildOutcome
  };
});
