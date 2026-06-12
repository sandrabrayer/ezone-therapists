/**
 * debt-alert.js
 * -----------------------------------------------------------------------------
 * POST-SCHEDULING debt alert (iteration 2). The debt gate at scheduling time
 * decides whether a treatment may be booked. But a patient can fall INTO debt
 * AFTER a treatment is already on the calendar — so debt must be re-checked for
 * upcoming scheduled treatments on every app load / refresh, not just once.
 *
 * This module re-runs the live debt gate against each UPCOMING, NOT-YET-MARKED
 * scheduled row and reports the rows that now have a debt problem the therapist
 * needs to see. It is purely additive to the gate — it never changes a saved
 * decision, it only surfaces "this booked patient now owes".
 *
 * NEVER FAIL OPEN, BUT NEVER FALSE-ALARM: if the live roster is unavailable we
 * cannot assert that anyone went into debt, so we raise NO alert (the
 * server-authoritative gate already fails closed at save time — that is a
 * separate, stronger guarantee). An alert here means we positively re-confirmed
 * the patient now owes.
 *
 * Framework-free; runs in the browser and under `node --test`.
 * `test/debt-alert.test.js` guards it.
 */
(function (root, factory) {
  var DebtGate = (typeof module === 'object' && module.exports)
    ? require('./debt-gate')
    : root.DebtGate;
  var api = factory(DebtGate);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / tests
  } else {
    root.DebtAlert = api;            // browser global
  }
})(typeof self !== 'undefined' ? self : this, function (DebtGate) {
  'use strict';

  function dateOnly(v) {
    var s = String(v == null ? '' : v);
    if (s.indexOf('T') !== -1) s = s.split('T')[0];
    return s;
  }

  // A row still matters for the alert if it is scheduled today or later AND has
  // not already been marked occurred/missed. Past or already-attended rows are
  // settled — re-checking their debt would be noise.
  function isUpcomingUnmarked(row, today) {
    if (!row) return false;
    var att = String(row.attendance || '');
    if (att === 'occurred' || att === 'missed') return false;
    var d = dateOnly(row.scheduledDate);
    if (!d) return false;
    return d >= today;
  }

  /**
   * Re-evaluate debt for each upcoming, unmarked scheduled row and return the
   * rows that should now alert the therapist.
   *
   * An alert fires when the LIVE gate now says `block` (the patient owes) for a
   * row that was NOT booked as a known-and-approved debtor — i.e. the debt is
   * new since scheduling. A row already saved as `approved` (Ron/Sandra signed
   * off on the debt) does not re-alert; a row already `flagged` is its own
   * separate manual-resolution state.
   *
   * @param {object} input
   * @param {Array}  input.rows    scheduled patient rows
   * @param {Array}  input.roster  live getDebtStatus clients
   * @param {boolean} [input.rosterOk] false when the debt lookup failed/missing
   * @param {string} input.today   'YYYY-MM-DD' (injected for deterministic tests)
   * @param {object} [phoneApi]
   * @returns {Array} [{id, sessionId, patientName, patientPhone, scheduledDate,
   *                    amountOwed, reason}] one entry per alerting row
   */
  function evaluateAlerts(input, phoneApi) {
    input = input || {};
    // Can't determine debt with no live roster -> raise nothing (no false alarm).
    if (input.rosterOk === false || input.roster == null) return [];
    var rows = Array.isArray(input.rows) ? input.rows : [];
    var today = String(input.today || '');
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!isUpcomingUnmarked(row, today)) continue;
      var status = String(row.gateStatus || '').toLowerCase();
      // Already an acknowledged debtor (approved) or already flagged for manual
      // resolution -> not a NEW post-scheduling debt surprise.
      if (status === 'approved' || status === 'flagged') continue;
      var gate = DebtGate.evaluate({
        phone: row.patientPhone,
        roster: input.roster,
        rosterOk: input.rosterOk
      }, phoneApi);
      if (gate.decision === 'block') {
        out.push({
          id: row.id,
          sessionId: row.sessionId,
          patientName: row.patientName,
          patientPhone: row.patientPhone,
          scheduledDate: dateOnly(row.scheduledDate),
          amountOwed: gate.amountOwed,
          reason: gate.reason
        });
      }
    }
    return out;
  }

  return {
    isUpcomingUnmarked: isUpcomingUnmarked,
    evaluateAlerts: evaluateAlerts
  };
});
