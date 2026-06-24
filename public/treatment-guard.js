/**
 * treatment-guard.js
 * -----------------------------------------------------------------------------
 * SERVER-AUTHORITATIVE save policy for treatment logs. This is the rule the
 * Apps Script backend enforces in `_saveTreatment` — it is NOT a UI helper.
 *
 * WHY IT EXISTS
 * -------------
 * The Apps Script Web App is deployed "Anyone with the link", so a forged POST
 * can hit it directly, bypassing the Node server and the browser gate entirely.
 * Therefore the debt gate cannot be trusted from the client: `gateStatus` and
 * `approverId` arriving on a POST are CLAIMS. The server must:
 *   1. only accept an approval from the real allowlist (Ron / Sandra), and
 *   2. re-read live outpatient debt and confirm a 'clear'/'approved' claim
 *      against it — never trust the claim.
 *
 * This module encodes (1) and (2) as pure functions so they can be unit-tested
 * under `node --test`. `apps-script/Code.gs` MIRRORS `decideSave` /
 * `isAllowedApprover` inline (Apps Script can't import a module); any change to
 * the policy here MUST update both. `test/treatment-guard.test.js` guards it.
 *
 * NEVER FAIL OPEN: if the server cannot verify (lookup unavailable or
 * unconfigured), a 'clear'/'approved' claim is REJECTED, not saved.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / tests
  } else {
    root.TreatmentGuard = api;       // browser/global (optional)
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Canonical approvers. The KEY is the stored `approverId` (see
  // public/approval.js — approverId is the id, approverName is the Hebrew
  // label). Hebrew labels are also accepted defensively in case a caller puts
  // the label in the id field.
  var APPROVERS = { ron: 'רון', sandra: 'סנדרה' };

  function resolveApproverId(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return '';
    if (APPROVERS[s.toLowerCase()]) return s.toLowerCase();
    for (var id in APPROVERS) { if (APPROVERS[id] === s) return id; }
    return '';
  }
  function isAllowedApprover(v) { return !!resolveApproverId(v); }

  /**
   * Decide whether a treatment save is allowed to persist with its CLAIMED
   * gateStatus, given the authoritative verification the server obtained by
   * RE-READING live outpatient debt (not the client's claim).
   *
   * @param {object} input
   * @param {string} input.kind        'outpatient' | 'inpatient'
   * @param {string} input.gateStatus  claimed 'clear' | 'approved' | 'flagged' | ''
   * @param {string} input.approverId  claimed approver id (for 'approved')
   * @param {string} input.verification authoritative status the server computed:
   *        'allow'        exactly one match, clear   -> may persist 'clear'
   *        'block'        owes                        -> needs an approval
   *        'flag'         unknown / no / multi match  -> cannot confirm
   *        'unavailable'  lookup configured but failed (fail CLOSED)
   *        'unconfigured' no verification endpoint set on the backend
   * @returns {{ok:boolean, error?:string}}
   */
  function decideSave(input) {
    input = input || {};
    var kind = input.kind || 'outpatient';
    var gateStatus = String(input.gateStatus || '').toLowerCase();
    var v = String(input.verification || 'unconfigured').toLowerCase();

    // Inpatient logs are not debt-gated.
    if (kind !== 'outpatient') return { ok: true };

    // A flagged log is explicitly marked for manual resolution; persist as-is
    // (it is never counted as verified/paid downstream).
    if (gateStatus === 'flagged') return { ok: true };

    // An approval must come from the real allowlist AND correspond to a real,
    // server-confirmed debt situation.
    if (gateStatus === 'approved') {
      if (!isAllowedApprover(input.approverId)) return { ok: false, error: 'invalid_approver' };
      if (v === 'block') return { ok: true };           // confirmed debt, approved
      if (v === 'allow') return { ok: true };           // debt cleared between check & save; approval harmless
      if (v === 'unconfigured') return { ok: false, error: 'debt_verification_unconfigured' };
      if (v === 'unavailable') return { ok: false, error: 'debt_verification_unavailable' };
      return { ok: false, error: 'debt_verification_failed' }; // flag — cannot confirm
    }

    // A 'clear' (or empty) claim on an outpatient log must be confirmed clear by
    // the live re-read. A forged 'clear' for a debtor lands here as 'block' and
    // is rejected — closing the bypass.
    if (gateStatus === 'clear' || gateStatus === '') {
      if (v === 'allow') return { ok: true };
      if (v === 'unconfigured') return { ok: false, error: 'debt_verification_unconfigured' };
      if (v === 'unavailable') return { ok: false, error: 'debt_verification_unavailable' };
      return { ok: false, error: 'debt_verification_failed' };
    }

    return { ok: false, error: 'invalid_gate_status' };
  }

  return {
    APPROVERS: APPROVERS,
    resolveApproverId: resolveApproverId,
    isAllowedApprover: isAllowedApprover,
    decideSave: decideSave
  };
});
