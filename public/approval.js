/**
 * approval.js
 * -----------------------------------------------------------------------------
 * Business rule: a patient who OWES money in outpatient must not continue
 * treatment unless approved by Ron (רון) or Sandra (סנדרה). When the debt gate
 * returns `block`, the only way the treatment log saves is with an approval
 * stamp built here.
 *
 * The stamp is auto-filled with everything needed for an audit trail:
 *   patient (name + canonical phone), therapist, approver, note, timestamp,
 *   and the amount that was owed at approval time.
 *
 * Only רון / סנדרה may approve — `APPROVERS` is the allowlist and
 * `buildApproval` rejects anyone else. Framework-free; runs in the browser and
 * under `node --test`. `test/approval.test.js` guards it.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / tests
  } else {
    root.Approval = api;             // browser global
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // The only people allowed to approve continued treatment for a debtor.
  // id is stored; he is the display label.
  var APPROVERS = [
    { id: 'ron',    he: 'רון' },
    { id: 'sandra', he: 'סנדרה' }
  ];

  function approverById(id) {
    for (var i = 0; i < APPROVERS.length; i++) if (APPROVERS[i].id === id) return APPROVERS[i];
    return null;
  }
  // Accept either the stable id ('ron') or the Hebrew label ('רון').
  function resolveApprover(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return null;
    var byId = approverById(s.toLowerCase());
    if (byId) return byId;
    for (var i = 0; i < APPROVERS.length; i++) if (APPROVERS[i].he === s) return APPROVERS[i];
    return null;
  }

  /**
   * Build an approval stamp for a blocked (debtor) treatment.
   *
   * @param {object} input
   * @param {string} input.approver    'ron' | 'sandra' | 'רון' | 'סנדרה' (REQUIRED)
   * @param {string} input.patientName REQUIRED
   * @param {string} input.patientPhone canonical phone, REQUIRED
   * @param {string} input.therapist    who is logging, REQUIRED
   * @param {string} [input.note]       optional free-text justification
   * @param {number} [input.amountOwed] amount owed at approval time
   * @param {function} [input.now]      injectable clock (returns Date) for tests
   * @returns {{ok:boolean, approval?:object, error?:string}}
   */
  function buildApproval(input) {
    input = input || {};
    var approver = resolveApprover(input.approver);
    if (!approver) {
      return { ok: false, error: 'נדרש אישור של רון או סנדרה' };
    }
    var patientName = String(input.patientName == null ? '' : input.patientName).trim();
    if (!patientName) return { ok: false, error: 'חסר שם מטופל לאישור' };
    var patientPhone = String(input.patientPhone == null ? '' : input.patientPhone).trim();
    if (!patientPhone) return { ok: false, error: 'חסר טלפון מטופל לאישור' };
    var therapist = String(input.therapist == null ? '' : input.therapist).trim();
    if (!therapist) return { ok: false, error: 'חסר שם מטפל לאישור' };

    var nowFn = typeof input.now === 'function' ? input.now : function () { return new Date(); };
    var ts = nowFn().toISOString();

    return {
      ok: true,
      approval: {
        approverId: approver.id,
        approverName: approver.he,
        patientName: patientName,
        patientPhone: patientPhone,
        therapist: therapist,
        note: String(input.note == null ? '' : input.note).trim(),
        amountOwed: Number(input.amountOwed) || 0,
        approvedAt: ts
      }
    };
  }

  return {
    APPROVERS: APPROVERS,
    approverById: approverById,
    resolveApprover: resolveApprover,
    buildApproval: buildApproval
  };
});
