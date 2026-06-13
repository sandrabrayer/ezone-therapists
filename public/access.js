/**
 * access.js
 * -----------------------------------------------------------------------------
 * Role-based access rules as pure predicates (iteration 7). Identity is
 * NAME-PICK, not password-based: a user is either Vered (the office) or a
 * therapist (picked by name). There is NO edit-mode toggle — actions are
 * always visible and scoped by role + tab.
 *
 *   - ורד (vered)      — the office: sees דשבורד + שיבוץ; registers patients and
 *                        assigns therapists. Sees everything.
 *   - מטפל/ת (therapist) — sees ONLY «המטופלים שלי», scoped to their OWN assigned
 *                          patients: sets scheduling, the weekly view, and the
 *                          post-treatment report.
 *
 * Identity is self-asserted (no password); the real controls are the
 * outpatient debt gate and the Ron/Sandra approval audit trail.
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

  var ROLES = { VERED: 'vered', THERAPIST: 'therapist' };

  // The tabs (views) each role may see, in order. The first is the default.
  var TABS = {
    vered: ['dashboard', 'workflow'],
    therapist: ['mine']
  };

  function isRole(role) { return role === ROLES.VERED || role === ROLES.THERAPIST; }
  function tabsForRole(role) { return TABS[role] ? TABS[role].slice() : []; }
  function defaultView(role) { return (TABS[role] && TABS[role][0]) || ''; }
  function canViewTab(role, view) { return tabsForRole(role).indexOf(view) !== -1; }

  // Registering a patient and assigning a therapist are Vered (office) actions.
  function canRegister(role) { return role === ROLES.VERED; }
  function canAssign(role) { return role === ROLES.VERED; }
  // Setting the schedule (days/hours/location) and reporting did-it-happen are
  // therapist actions, on their own patients.
  function canSchedule(role) { return role === ROLES.THERAPIST; }
  function canReport(role) { return role === ROLES.THERAPIST; }

  return {
    ROLES: ROLES,
    TABS: TABS,
    isRole: isRole,
    tabsForRole: tabsForRole,
    defaultView: defaultView,
    canViewTab: canViewTab,
    canRegister: canRegister,
    canAssign: canAssign,
    canSchedule: canSchedule,
    canReport: canReport
  };
});
