/**
 * clinical-sync.js
 * -----------------------------------------------------------------------------
 * Pure helpers for the CLINICAL BILLING-TYPE push: when ירדן saves an assignment
 * here, the patient's clinical treatment type is pushed to the outpatient app so
 * its per-patient billing rate follows the clinical plan chosen in this app.
 *
 * This module holds only the framework-free, testable pieces:
 *   - which treatment types are the individual-billing ones nested under פרטני
 *     in the picker (DISPLAY-ONLY grouping — the saved value stays the specific
 *     clinical name, never the group label),
 *   - building the setClinicalType POST body with a CANONICAL phone,
 *   - interpreting the outpatient response into a sync outcome,
 *   - mapping a FAILED outcome to a Hebrew warning for the user.
 *
 * The actual server-to-server network call (UrlFetchApp + the CLINICAL_TYPE_SECRET
 * Script Property) lives in apps-script/Code.gs (_postSetClinicalType), which
 * MIRRORS buildPayload + interpretResponse here. The secret is read from config
 * on the server side and NEVER reaches the browser.
 *
 * Framework-free so it runs in the browser AND under `node --test`.
 * `test/clinical-sync.test.js` guards every rule here.
 */
(function (root, factory) {
  var Phone = (typeof module === 'object' && module.exports)
    ? require('./phone')
    : root.Phone;
  var api = factory(Phone);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / tests
  } else {
    root.ClinicalSync = api;         // browser global
  }
})(typeof self !== 'undefined' ? self : this, function (Phone) {
  'use strict';

  // The 5 individual-billing clinical types. In the picker they are nested under
  // a single 'פרטני' <optgroup> — but each keeps its own distinct value, so the
  // SAVED treatmentType is always the specific clinical name, not 'פרטני'.
  var INDIVIDUAL_BILLING_TYPES = [
    'פסיכודינמי', 'פסיכותרפי ממוקד טראומה', 'עיסוי טיפולי',
    'טיפול ממוקד התמכרויות', 'טיפול אינטגרטיבי'
  ];
  var GROUP_LABEL = 'פרטני';

  // A FAILED setClinicalType outcome → Hebrew warning. The assignment ALWAYS
  // saved locally; a warning means only that the billing-type sync needs
  // attention (surfaced to the user, never silently swallowed).
  var REASONS = {
    no_match: 'המטופל/ת לא נמצא/ה במערכת המטופלים החיצונית',
    multi_match: 'נמצאו כמה רשומות תואמות במערכת החיצונית',
    unknown_type: 'סוג הטיפול אינו מוכר לחיוב במערכת החיצונית',
    unconfigured: 'סנכרון סוג החיוב אינו מוגדר בשרת',
    invalid_phone: 'מספר טלפון לא תקין לסנכרון',
    unreachable: 'מערכת החיוב החיצונית אינה זמינה',
    non_ok: 'מערכת החיוב החיצונית דחתה את העדכון'
  };

  /**
   * Should the push fire for this treatment type? Only when there's a non-empty
   * type to bill against; a blank type has nothing to sync.
   * @param {*} type
   * @returns {boolean}
   */
  function shouldPush(type) {
    return String(type == null ? '' : type).trim() !== '';
  }

  /**
   * Build the setClinicalType POST body. The phone is normalized to the canonical
   * 10-digit leading-zero key (outpatient's matching key). Returns the contract
   * object on success, or a flag outcome when the phone can't be made canonical.
   * @param {*} phone
   * @param {*} clinicalTreatmentType
   * @param {*} secret shared secret (server-side only; never the browser)
   * @returns {{ok:true, payload:object} | {ok:false, reason:'invalid_phone'}}
   */
  function buildPayload(phone, clinicalTreatmentType, secret) {
    var canon = Phone.toCanonical(phone);
    if (!canon.ok) return { ok: false, reason: 'invalid_phone' };
    return {
      ok: true,
      payload: {
        action: 'setClinicalType',
        secret: secret,
        phone: canon.value,
        clinicalTreatmentType: String(clinicalTreatmentType == null ? '' : clinicalTreatmentType).trim()
      }
    };
  }

  /**
   * Interpret the outpatient setClinicalType response into a sync outcome.
   * NEVER fail-open: only an explicit {ok:true, matched:1} is success; anything
   * else (non-2xx, ok:false, no/multi match, unknown type) is a surfaced flag.
   * @param {number} httpStatus
   * @param {object|null} data parsed JSON body (or null when unparseable)
   * @returns {{ok:true, matched:1} | {ok:false, reason:string}}
   */
  function interpretResponse(httpStatus, data) {
    if (!(httpStatus >= 200 && httpStatus < 300)) return { ok: false, reason: 'http_' + httpStatus };
    if (data && data.ok === true && (data.matched === 1 || data.matched === '1')) {
      return { ok: true, matched: 1 };
    }
    // Surface the outpatient-supplied reason verbatim (no_match / multi_match /
    // unknown_type) so the user sees WHY; fall back to a generic non_ok.
    var reason = (data && (data.reason || data.error)) ? String(data.reason || data.error) : 'non_ok';
    return { ok: false, reason: reason };
  }

  /**
   * Map a clinicalSync outcome (as attached to a save response) to a Hebrew
   * warning string, or null when there's nothing to warn about (no push happened,
   * or the sync landed cleanly).
   * @param {{ok?:boolean, reason?:string}|null|undefined} clinicalSync
   * @returns {string|null}
   */
  function warningFor(clinicalSync) {
    if (!clinicalSync || clinicalSync.ok) return null;
    var reason = String(clinicalSync.reason || '');
    return REASONS[reason] || ('סנכרון נכשל (' + (reason || 'לא ידוע') + ')');
  }

  /**
   * Is `name` one of the individual-billing types nested under פרטני?
   * @param {*} name
   * @returns {boolean}
   */
  function isIndividualBillingType(name) {
    return INDIVIDUAL_BILLING_TYPES.indexOf(String(name == null ? '' : name).trim()) !== -1;
  }

  /**
   * Partition the active type names into the inline ones and the grouped ones
   * (the individual-billing types present, in list order). Order within each
   * bucket is preserved. The picker renders `inline` as plain options and
   * `grouped` inside one 'פרטני' <optgroup> — display only, values unchanged.
   * @param {string[]} names
   * @returns {{inline:string[], grouped:string[]}}
   */
  function partitionTypes(names) {
    names = Array.isArray(names) ? names : [];
    var inline = [];
    var grouped = [];
    for (var i = 0; i < names.length; i++) {
      if (isIndividualBillingType(names[i])) grouped.push(names[i]);
      else inline.push(names[i]);
    }
    return { inline: inline, grouped: grouped };
  }

  return {
    INDIVIDUAL_BILLING_TYPES: INDIVIDUAL_BILLING_TYPES,
    GROUP_LABEL: GROUP_LABEL,
    REASONS: REASONS,
    shouldPush: shouldPush,
    buildPayload: buildPayload,
    interpretResponse: interpretResponse,
    warningFor: warningFor,
    isIndividualBillingType: isIndividualBillingType,
    partitionTypes: partitionTypes
  };
});
