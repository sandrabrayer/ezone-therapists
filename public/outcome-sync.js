/**
 * outcome-sync.js
 * -----------------------------------------------------------------------------
 * Pure helpers for the SESSION-OUTCOME push (iteration 18, step 3): when a
 * therapist marks what actually happened to a session here, the marked outcome
 * is pushed to the outpatient app's `recordSessionOutcome` endpoint so it
 * computes therapist pay / session status per outcome.
 *
 * This module holds only the framework-free, testable pieces:
 *   - building the recordSessionOutcome POST body with a CANONICAL phone,
 *   - interpreting the outpatient response into a sync outcome,
 *   - mapping a FAILED outcome to a Hebrew warning for the user.
 *
 * The actual server-to-server network call (UrlFetchApp + the
 * SESSION_OUTCOME_SECRET Script Property) lives in apps-script/Code.gs
 * (_postSetSessionOutcome), which MIRRORS buildPayload + interpretResponse here.
 * The secret is read from config on the server side and NEVER reaches the
 * browser.
 *
 * Like the clinical-type push (clinical-sync.js) this is FAIL-OPEN-WITH-FLAG, not
 * fail-closed: the outcome is already saved locally, so the push never blocks the
 * save — only an explicit { ok:true } is success, anything else is surfaced as a
 * Hebrew warning so the pay-sync is flagged, never silently swallowed.
 *
 * Idempotent by design: re-marking the same session re-sends the same sessionId;
 * outpatient upserts on it (no therapists-side dedupe).
 *
 * Framework-free so it runs in the browser AND under `node --test`.
 * `test/outcome-sync.test.js` guards every rule here.
 */
(function (root, factory) {
  var Phone = (typeof module === 'object' && module.exports)
    ? require('./phone')
    : root.Phone;
  var api = factory(Phone);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / tests
  } else {
    root.OutcomeSync = api;          // browser global
  }
})(typeof self !== 'undefined' ? self : this, function (Phone) {
  'use strict';

  // A FAILED recordSessionOutcome outcome → Hebrew warning. The outcome is ALWAYS
  // saved locally; a warning means only that the pay-sync needs attention
  // (surfaced to the user, never silently swallowed). Outpatient owns pay/status,
  // so its supplied reasons are surfaced verbatim where we map them.
  var REASONS = {
    unknown_therapist: 'המטפל/ת אינו/ה מוכר/ת במערכת החיצונית',
    unknown_type: 'סוג הטיפול אינו מוכר לחיוב במערכת החיצונית',
    unauthorized: 'הסנכרון נדחה — אימות נכשל',
    unconfigured: 'סנכרון תוצאת המפגש אינו מוגדר בשרת',
    invalid_phone: 'מספר טלפון לא תקין לסנכרון',
    unreachable: 'מערכת החיוב החיצונית אינה זמינה',
    non_ok: 'מערכת החיוב החיצונית דחתה את עדכון תוצאת המפגש'
  };

  /**
   * Build the recordSessionOutcome POST body. The phone is normalized to the
   * canonical 10-digit leading-zero key (outpatient's matching key). The
   * `clinicalTreatmentType` carries the session's clinical type; `frequency` is
   * deliberately NOT sent — outpatient handles its absence (e.g. for ליווי). The
   * outcome is sent as-is (the closed three-state token from outcome.js).
   * @param {object} rec  the stamped outcome { sessionId, phone, therapist,
   *                       clinicalTreatmentType, date, outcome }
   * @param {*} secret shared secret (server-side only; never the browser)
   * @returns {{ok:true, payload:object} | {ok:false, reason:'invalid_phone'}}
   */
  function buildPayload(rec, secret) {
    rec = rec || {};
    var canon = Phone.toCanonical(rec.phone);
    if (!canon.ok) return { ok: false, reason: 'invalid_phone' };
    return {
      ok: true,
      payload: {
        action: 'recordSessionOutcome',
        secret: secret,
        sessionId: String(rec.sessionId == null ? '' : rec.sessionId),
        phone: canon.value,
        therapist: String(rec.therapist == null ? '' : rec.therapist),
        clinicalTreatmentType: String(rec.clinicalTreatmentType == null ? '' : rec.clinicalTreatmentType),
        date: String(rec.date == null ? '' : rec.date),
        outcome: String(rec.outcome == null ? '' : rec.outcome)
      }
    };
  }

  /**
   * Interpret the outpatient recordSessionOutcome response into a sync outcome.
   * NEVER fail-open: only an explicit { ok:true } is success; anything else
   * (non-2xx, ok:false, an error/reason field) is a surfaced flag. Outpatient
   * computes pay/status per outcome and upserts by sessionId, so there is no
   * `matched` count to assert here — just ok-ness.
   * @param {number} httpStatus
   * @param {object|null} data parsed JSON body (or null when unparseable)
   * @returns {{ok:true} | {ok:false, reason:string}}
   */
  function interpretResponse(httpStatus, data) {
    if (!(httpStatus >= 200 && httpStatus < 300)) return { ok: false, reason: 'http_' + httpStatus };
    if (data && data.ok === true) return { ok: true };
    // Surface the outpatient-supplied reason verbatim (unknown_therapist /
    // unknown_type / unauthorized …) so the user sees WHY; fall back to non_ok.
    var reason = (data && (data.reason || data.error)) ? String(data.reason || data.error) : 'non_ok';
    return { ok: false, reason: reason };
  }

  /**
   * Map an outcomeSync outcome (as attached to a setSessionOutcome response) to a
   * Hebrew warning string, or null when there's nothing to warn about (no push
   * happened, or the sync landed cleanly).
   * @param {{ok?:boolean, reason?:string}|null|undefined} outcomeSync
   * @returns {string|null}
   */
  function warningFor(outcomeSync) {
    if (!outcomeSync || outcomeSync.ok) return null;
    var reason = String(outcomeSync.reason || '');
    return REASONS[reason] || ('סנכרון תוצאת המפגש נכשל (' + (reason || 'לא ידוע') + ')');
  }

  return {
    REASONS: REASONS,
    buildPayload: buildPayload,
    interpretResponse: interpretResponse,
    warningFor: warningFor
  };
});
