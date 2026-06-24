/**
 * roster.js
 * -----------------------------------------------------------------------------
 * The cross-app PATIENT ROSTER build — the single source of the dashboard's
 * patient list. Extracted from app.js's buildPatientRoster so the merge can be
 * unit-tested (`test/roster.test.js`) instead of only living inside the browser
 * IIFE. Framework-free: runs in the browser (global `Roster`) AND under
 * `node --test`.
 *
 * Active outpatients come from the outpatient sibling roster — treatment plans
 * (getTreatmentPlans) preferred, debt roster as a fallback/union — keyed by
 * NORMALIZED phone, then LEFT-JOINED with this app's local intake record and the
 * patient's active assignments.
 *
 * Phone contract: every source carries its phone through `add(name, phone, ...)`,
 * which stores the phone on the per-key record (`phone: phone || ''`). The final
 * roster object exposes it as `phone: base.phone` — the exact field patientCard
 * renders. A record only exists when its phone yields a non-empty match key, so a
 * built roster item ALWAYS has a non-empty phone.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./phone'), require('./stopflow'));   // Node / tests
  } else {
    root.Roster = factory(root.Phone, root.StopFlow);                      // browser global
  }
})(typeof self !== 'undefined' ? self : this, function (Phone, StopFlow) {
  'use strict';

  function normPhone(v) { return Phone.normalizeForMatch(v); }

  // Render a plan's sessions value (object map or scalar) as a short label.
  function planSessionsText(s) {
    if (s == null || s === '') return '';
    if (typeof s === 'object') {
      try { return Object.keys(s).map(function (k) { return k + ': ' + s[k]; }).join(', '); }
      catch (_) { return ''; }
    }
    return String(s);
  }

  // The one debt-roster entry that owns this already-normalized key (or null when
  // absent / ambiguous). Mirrors app.js debtEntryFor, taking the key directly
  // since the caller already normalized base.phone into it.
  function debtEntryForKey(debtRoster, key) {
    if (!key) return null;
    var hits = (debtRoster || []).filter(function (c) { return normPhone(c.phone) === key; });
    return hits.length === 1 ? hits[0] : null;
  }

  /**
   * Build EVERY patient (active + stopped), each tagged with a `stopped` flag.
   * @param {object} state  { plans, debtRoster, patients, assignments }
   * @returns {Array} roster items, each carrying a non-empty `phone`.
   */
  function build(state) {
    state = state || {};
    var byPhone = {};
    var planStatusByPhone = {};
    function add(name, phone, serviceType, sessions) {
      var key = normPhone(phone);
      if (!key) return;
      if (!byPhone[key]) byPhone[key] = { name: name || '', phone: phone || '', serviceType: serviceType || '', sessions: sessions };
      else {
        if (!byPhone[key].name && name) byPhone[key].name = name;
        if (!byPhone[key].serviceType && serviceType) byPhone[key].serviceType = serviceType;
        if ((byPhone[key].sessions == null || byPhone[key].sessions === '') && sessions != null) byPhone[key].sessions = sessions;
      }
    }
    (state.plans || []).forEach(function (p) {
      add(p.name, p.phone, p.serviceType, p.sessions != null ? p.sessions : p.sessionsPerWeek);
      var k = normPhone(p.phone);
      if (k && p.status != null && planStatusByPhone[k] == null) planStatusByPhone[k] = p.status;
    });
    (state.debtRoster || []).forEach(function (c) { add(c.name, c.phone); });

    // Locally-registered patients (Vered's intake) appear on the dashboard even
    // when they are not yet in the outpatient roster — a base source, not only an
    // overlay.
    var localByPhone = {};
    (state.patients || []).forEach(function (p) {
      var key = normPhone(p.phone);
      if (!key) return;
      localByPhone[key] = p;
      if (String(p.active) !== 'false') add(p.name, p.phone);
    });

    // A patient may have MULTIPLE active assignments (parallel treatments /
    // therapists) — collect them all per phone.
    var assignsByPhone = {};
    (state.assignments || []).forEach(function (a) {
      if (!a || String(a.active) === 'false') return;
      var key = normPhone(a.patientPhone);
      if (!key) return;
      (assignsByPhone[key] = assignsByPhone[key] || []).push({
        id: a.id, therapist: a.therapist || '', treatmentType: a.treatmentType || '',
        frequencyPerWeek: a.frequencyPerWeek != null ? String(a.frequencyPerWeek) : '',
        slots: a.slots || ''
      });
    });

    return Object.keys(byPhone).map(function (key) {
      var base = byPhone[key];
      var local = localByPhone[key] || {};
      var debt = debtEntryForKey(state.debtRoster, key);
      var assigns = assignsByPhone[key] || [];
      var planStatus = planStatusByPhone[key] || '';
      return {
        name: local.name || base.name,
        phone: base.phone,
        serviceType: base.serviceType,
        rosterSessions: planSessionsText(base.sessions),
        assignments: assigns,
        therapists: assigns.map(function (a) { return a.therapist; }).filter(Boolean),
        origin: local.origin || '',
        stillAdmitted: String(local.stillAdmitted || '') === 'true',
        admittedHouse: local.admittedHouse || '',
        debtStatus: debt ? String(debt.debtStatus || '').toLowerCase() : '',
        amountOwed: debt ? (Number(debt.amountOwed) || 0) : 0,
        planStatus: planStatus,
        stopped: StopFlow.isPatientStopped({ planStatus: planStatus, localStopped: local.stopped }),
        stoppedBy: local.stoppedBy || '',
        stoppedAt: local.stoppedAt || '',
        stopNote: local.stopNote || '',
        key: key
      };
    });
  }

  return { build: build };
});
