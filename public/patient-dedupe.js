/**
 * patient-dedupe.js
 * -----------------------------------------------------------------------------
 * A patient record is unique by CANONICAL PHONE — exactly one record per
 * patient. Creating a SECOND record for a phone that already has one is blocked.
 * Editing an existing record (mode !== 'create') always passes: it upserts the
 * SAME row by phone, and multiple treatments/assignments per patient live in a
 * separate sheet, so this never limits those.
 *
 * Pure + framework-free so it runs in the browser AND under `node --test`, and
 * is mirrored inline in apps-script/Code.gs (_savePatient) for backend
 * enforcement. `test/patient-dedupe.test.js` guards the rule.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / tests
  } else {
    root.PatientDedupe = api;        // browser global
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Should a CREATE be blocked as a duplicate?
   * @param {*} mode               'create' blocks on an existing phone; anything
   *                               else (edit) never blocks.
   * @param {string} canonicalPhone the canonical phone being created.
   * @param {Array<string>} existingCanonicals canonical phones already stored.
   * @returns {boolean} true when the create must be rejected.
   */
  function isDuplicateCreate(mode, canonicalPhone, existingCanonicals) {
    if (String(mode) !== 'create') return false;     // edit upserts the same row
    if (!canonicalPhone) return false;               // empty handled elsewhere
    var list = existingCanonicals || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && String(list[i]) === String(canonicalPhone)) return true;
    }
    return false;
  }

  return { isDuplicateCreate: isDuplicateCreate };
});
