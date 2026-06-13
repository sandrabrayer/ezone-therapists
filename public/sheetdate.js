/**
 * sheetdate.js
 * -----------------------------------------------------------------------------
 * Formats a Google-Sheets cell value read back from a sheet. Sheets coerces a
 * written string into a Date/number: a real date ("2026-07-01") becomes a Date,
 * and a TIME-ONLY value ("10:30") becomes a Date on the spreadsheet epoch day
 * **1899-12-30** (serial 0). The old reader formatted *every* Date as
 * `yyyy-MM-dd`, which turned a time cell into the bogus string "1899-12-30" shown
 * next to bookings.
 *
 * Rule: a Date whose year is before 1900 is a time-only cell → format as `HH:mm`;
 * any other Date is a real date → `yyyy-MM-dd`. Non-Date values pass through.
 *
 * Pure + framework-free (runs under `node --test`). Mirrored inline by
 * apps-script/Code.gs `_readAll` (which uses Utilities.formatDate with the script
 * timezone); any change here MUST update both. `test/sheetdate.test.js` guards it.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / tests
  } else {
    root.SheetDate = api;            // browser global (unused; kept for parity)
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /**
   * @param {*} v a value read from a sheet cell
   * @returns {*} formatted string for Date cells, or the value unchanged
   */
  function formatCell(v) {
    if (!(v instanceof Date)) return v;
    if (v.getFullYear() < 1900) {
      return pad(v.getHours()) + ':' + pad(v.getMinutes());   // time-only cell
    }
    return v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate());
  }

  return { formatCell: formatCell };
});
