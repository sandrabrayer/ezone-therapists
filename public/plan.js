/**
 * plan.js
 * -----------------------------------------------------------------------------
 * The APPROVED outpatient treatment plan is the SINGLE SOURCE OF TRUTH for a
 * patient's treatment type + weekly frequency. It is owned by Vered in the
 * outpatient intake system and surfaced here via getTreatmentPlans
 * (state.plans / state.plansOk). The therapists app is fully READ-ONLY on the
 * plan: it never lets a user pick or edit type/frequency — those are projected
 * from the plan and locked.
 *
 * This module is the pure, testable projection of that rule, extracted from the
 * app.js IIFE so `test/plan.test.js` can guard it (mirrors roster.js/recurring.js).
 *
 *  - forPhone({phone, plans, plansOk}) → { serviceType, frequency } | null
 *        The ONE plan row matching `phone`. Returns null — "cannot verify, must
 *        BLOCK" — when there is no single approved plan to read: no match, an
 *        ambiguous multi-match, or plans unavailable (!plansOk). NEVER fails open.
 *  - freqFromSessions(sessions) → number
 *        The numeric weekly frequency from a plan's `sessions`. A JSON-blob
 *        type→count map is SUMMED across all types (a multi-type plan keeps every
 *        weekly session — it is not collapsed to one type); a scalar is taken as-is.
 *  - blockMessage(plan, plansOk) → string | null
 *        The Hebrew block copy for a null plan: "no approved plan" when plans are
 *        available (Vered must define one), "cannot verify" when plans are down.
 *  - assignmentPayload({...}) → assignment row with treatmentType + frequencyPerWeek
 *        FORCED from the plan (the function takes no type/freq input at all, so a
 *        saved row can never carry a user-entered type/frequency).
 *
 * Framework-free so it runs in the browser (global `Plan`) AND under `node --test`.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./phone'));   // Node / tests
  } else {
    root.Plan = factory(root.Phone);                // browser global
  }
})(typeof self !== 'undefined' ? self : this, function (Phone) {
  'use strict';

  function normPhone(v) { return Phone.normalizeForMatch(v); }

  // Hebrew block copy — kept here so the two flows (שיבוץ + scheduling) share one
  // wording and the tests assert against a single source.
  var MSG_NO_PLAN = 'אין תוכנית טיפול מאושרת — על ורד להגדיר תחילה תוכנית במערכת הקליטה';
  var MSG_CANNOT_VERIFY = 'לא ניתן לאמת את תוכנית הטיפול כעת (מטופלי חוץ אינם זמינים) — נסו שוב מאוחר יותר';

  /**
   * Numeric weekly frequency from a plan's `sessions`.
   *   - JSON-blob map (object, or "{...}" string), type→count: SUM all counts so a
   *     multi-type plan keeps every weekly session (never collapse to one type).
   *   - plain scalar ("2" / 2): taken as the count.
   *   - empty / unparseable: 0.
   * @param {*} sessions
   * @returns {number}
   */
  function freqFromSessions(sessions) {
    if (sessions == null || sessions === '') return 0;
    var obj = null;
    if (typeof sessions === 'object') {
      obj = sessions;
    } else {
      var s = String(sessions).trim();
      if (s.charAt(0) === '{') {
        try { obj = JSON.parse(s); } catch (_) { obj = null; }
      } else {
        var scalar = parseInt(s, 10);
        return (isFinite(scalar) && scalar > 0) ? scalar : 0;
      }
    }
    if (obj && typeof obj === 'object') {
      var total = 0;
      Object.keys(obj).forEach(function (k) {
        var c = Number(obj[k]);
        if (isFinite(c) && c > 0) total += c;
      });
      return total;
    }
    return 0;
  }

  /**
   * The approved plan projection for one phone, or null when it cannot be verified.
   * Matches against the RAW plans list (not the deduped roster) so an ambiguous
   * multi-match is detectable and a no-match never silently passes.
   * @param {object} input { phone, plans, plansOk }
   * @returns {{serviceType:string, frequency:number}|null}
   */
  function forPhone(input) {
    input = input || {};
    if (!input.plansOk) return null;                 // plans endpoint down → cannot verify
    var key = normPhone(input.phone);
    if (!key) return null;
    var hits = (input.plans || []).filter(function (p) {
      return p && normPhone(p.phone) === key;
    });
    if (hits.length !== 1) return null;              // no-match OR ambiguous multi-match
    var p = hits[0];
    return {
      serviceType: p.serviceType || '',
      frequency: freqFromSessions(p.sessions != null ? p.sessions : p.sessionsPerWeek)
    };
  }

  /**
   * The block message for a (possibly null) plan, or null when the plan is present
   * (no block). Distinguishes "no approved plan" (plans available) from "cannot
   * verify" (plans endpoint down) — never fails open in either case.
   * @param {object|null} plan  result of forPhone
   * @param {boolean} plansOk   state.plansOk
   * @returns {string|null}
   */
  function blockMessage(plan, plansOk) {
    if (plan) return null;
    return plansOk ? MSG_NO_PLAN : MSG_CANNOT_VERIFY;
  }

  /**
   * Build an assignment payload whose treatmentType + frequencyPerWeek are FORCED
   * from the approved plan. The function deliberately accepts NO type/frequency
   * argument, so a saved assignment can never carry a user-entered value.
   * @param {object} input { plan, id, patientPhone, therapist, slots, updatedBy }
   * @returns {object}
   */
  function assignmentPayload(input) {
    input = input || {};
    var plan = input.plan || {};
    return {
      id: input.id,
      patientPhone: input.patientPhone,
      therapist: input.therapist,
      treatmentType: plan.serviceType || '',
      frequencyPerWeek: (plan.frequency != null && plan.frequency !== 0) ? String(plan.frequency) : '',
      slots: input.slots || '',
      updatedBy: input.updatedBy
    };
  }

  return {
    MSG_NO_PLAN: MSG_NO_PLAN,
    MSG_CANNOT_VERIFY: MSG_CANNOT_VERIFY,
    freqFromSessions: freqFromSessions,
    forPhone: forPhone,
    blockMessage: blockMessage,
    assignmentPayload: assignmentPayload
  };
});
