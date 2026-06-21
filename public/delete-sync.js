/**
 * delete-sync.js
 * -----------------------------------------------------------------------------
 * Pure helpers for the CROSS-APP PATIENT DELETE propagation: when a patient is
 * deleted in this app, the matching outpatient Client is DEACTIVATED so it stops
 * appearing in the roster union (getTreatmentPlans / getDebtStatus). Without this,
 * roster.js re-adds the "deleted" patient from the outpatient sources (a base
 * source, not just an overlay) and the delete looks like it never happened.
 *
 * Why deactivate and not hard-delete: deactivation is reversible and preserves the
 * outpatient billing / session history, and getTreatmentPlans already filters by
 * status — so a deactivated Client drops out of the active roster without the
 * record being destroyed. Safer than a hard delete on the sibling's source data.
 *
 * This module holds only the framework-free, testable pieces:
 *   - building the deactivateClient POST body with a CANONICAL phone,
 *   - interpreting the outpatient response into a delete-propagation outcome.
 *
 * The actual server-to-server network call (UrlFetchApp + the
 * DEACTIVATE_CLIENT_SECRET Script Property) lives in apps-script/Code.gs
 * (_postDeactivateClient), which MIRRORS buildPayload + interpretResponse here.
 * The secret is read from config on the server side and NEVER reaches the browser.
 *
 * FAIL-CLOSED on transport/config/auth (the caller aborts the local delete), but
 * ORPHAN-SAFE: a phone matching no Client is { ok:true, deactivated:0 } — deleting
 * a patient who was never an outpatient still succeeds and removes the local row.
 *
 * Framework-free so it runs in the browser AND under `node --test`.
 * `test/delete-sync.test.js` guards every rule here.
 */
(function (root, factory) {
  var Phone = (typeof module === 'object' && module.exports)
    ? require('./phone')
    : root.Phone;
  var api = factory(Phone);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / tests
  } else {
    root.DeleteSync = api;           // browser global
  }
})(typeof self !== 'undefined' ? self : this, function (Phone) {
  'use strict';

  /**
   * Build the deactivateClient POST body. The phone is normalized to the canonical
   * 10-digit leading-zero key (outpatient's matching key) — the SAME key the patient
   * and assignment rows use, so the right Client is matched. Returns the contract
   * object on success, or a flag outcome when the phone can't be made canonical.
   * @param {*} phone
   * @param {*} secret shared secret (server-side only; never the browser)
   * @param {object} [opts] { deactivatedBy, reason }
   * @returns {{ok:true, payload:object} | {ok:false, error:'invalid_phone'}}
   */
  function buildPayload(phone, secret, opts) {
    var canon = Phone.toCanonical(phone);
    if (!canon.ok) return { ok: false, error: 'invalid_phone' };
    opts = opts || {};
    return {
      ok: true,
      payload: {
        action: 'deactivateClient',
        secret: secret,
        phone: canon.value,
        deactivatedBy: String(opts.deactivatedBy == null ? '' : opts.deactivatedBy).trim(),
        reason: String(opts.reason == null ? '' : opts.reason).trim() || 'patient_deleted'
      }
    };
  }

  /**
   * Interpret the outpatient deactivateClient response into a delete-propagation
   * outcome. FAIL-CLOSED: only a 2xx with an explicit ok:true counts as success;
   * non-2xx or ok:false aborts the local delete. ORPHAN-SAFE: ok:true with
   * deactivated:0 (no Client matched) is still success — there is simply nothing
   * to deactivate, and the local delete should proceed.
   * @param {number} httpStatus
   * @param {object|null} data parsed JSON body (or null when unparseable)
   * @returns {{ok:true, deactivated:number} | {ok:false, error:string}}
   */
  function interpretResponse(httpStatus, data) {
    if (!(httpStatus >= 200 && httpStatus < 300)) return { ok: false, error: 'http_' + httpStatus };
    if (!data || data.ok !== true) {
      var err = (data && (data.error || data.reason)) ? String(data.error || data.reason) : 'non_ok';
      return { ok: false, error: err };
    }
    var n = Number(data.deactivated);
    return { ok: true, deactivated: isNaN(n) ? 0 : n };
  }

  return {
    buildPayload: buildPayload,
    interpretResponse: interpretResponse
  };
});
