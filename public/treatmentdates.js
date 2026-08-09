/**
 * treatmentdates.js
 * -----------------------------------------------------------------------------
 * Display formatter for the outpatient TREATMENT PERIOD dates — the treatment
 * start date and treatment end date shown on each patient card.
 *
 * These come from the outpatient `getTreatmentPlans` projection (the Clients
 * sheet's `startDate` / `exitDate`), surfaced here as
 * `treatmentStartDate` / `treatmentEndDate` on the roster item. The outpatient
 * Apps Script `_readAll` normalizes a real Date cell to a `yyyy-MM-dd` string,
 * so that is the expected shape; an ISO `yyyy-MM-ddTHH:mm:ss` string is also
 * tolerated. Two realities MUST be handled visibly, never silently:
 *   - MISSING — every ACTIVE patient has a blank `exitDate`; blank/absent input
 *     renders the em-dash placeholder «—», never '' / 'undefined' / 'null'.
 *   - MALFORMED — anything that is not a recognizable date also renders «—»
 *     rather than leaking raw garbage onto the card.
 * A valid date renders as `DD/MM/YYYY` (day-first, the app's convention — see
 * app.js displayDate).
 *
 * Pure + framework-free: runs in the browser (global `TreatmentDates`) AND under
 * `node --test`. `test/treatmentdates.test.js` guards it.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / tests
  } else {
    root.TreatmentDates = api;       // browser global
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // The visible placeholder for a missing OR unparseable date. An em dash (U+2014),
  // matching the «—» used elsewhere on the card for absent values.
  var MISSING = '—';

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /**
   * Format a treatment date for display.
   * @param {*} v  a value from the outpatient projection: normally a
   *   'yyyy-MM-dd' string, possibly an ISO 'yyyy-MM-ddT...' string, often blank.
   * @returns {string} 'DD/MM/YYYY' for a valid date, else MISSING («—»). NEVER
   *   returns '', 'undefined', 'null', or the raw input.
   */
  function format(v) {
    if (v == null) return MISSING;
    var s = String(v).trim();
    if (!s) return MISSING;
    if (s.indexOf('T') !== -1) s = s.split('T')[0];   // ISO → date part only
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (!m) return MISSING;                            // malformed → «—»
    var year = m[1], month = Number(m[2]), day = Number(m[3]);
    if (month < 1 || month > 12) return MISSING;       // out of range → «—»
    if (day < 1 || day > 31) return MISSING;
    return pad(day) + '/' + pad(month) + '/' + year;
  }

  return { MISSING: MISSING, format: format };
});
