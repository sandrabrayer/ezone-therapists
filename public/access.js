/**
 * access.js
 * -----------------------------------------------------------------------------
 * Iteration 8: there are NO roles and NO login. The app opens directly and all
 * three tabs are visible to everyone (Vered and therapists alike). This module
 * is now just the canonical tab list + ordering.
 *
 *   - דשבורד מטופלים (dashboard) — view-only overview of all active patients.
 *   - שיבוץ מטפלים (workflow)     — create/edit patients, assign therapists.
 *   - המטופלים שלי (mine)          — a therapist picks their name IN THE TAB
 *                                     (fresh each open, not persisted) and sees
 *                                     only their own patients/treatments.
 *   - עצירת טיפול (stopAlerts)      — persistent stop-treatment alerts the
 *                                     outpatient app raised; Yarden marks each
 *                                     one read explicitly (they never auto-clear).
 *
 * Framework-free; runs in the browser and under `node --test`.
 * `test/access.test.js` guards it.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / tests
  } else {
    root.Access = api;               // browser global
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // All tabs, in order. The first is the default view on open.
  var TABS = ['dashboard', 'workflow', 'mine', 'stopAlerts'];

  function tabs() { return TABS.slice(); }
  function defaultView() { return TABS[0]; }
  function isTab(view) { return TABS.indexOf(view) !== -1; }

  return { TABS: TABS, tabs: tabs, defaultView: defaultView, isTab: isTab };
});
