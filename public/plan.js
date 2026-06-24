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
 *  - forPhone({phone, plans, plansOk}) → Array<{ treatmentType, frequencyPerWeek }> | null
 *        The per-type projection of the ONE plan row matching `phone`: one entry
 *        per treatment type, each with its own weekly frequency (a patient's
 *        approved plan can hold SEVERAL types, each assignable to a different
 *        therapist). Returns null — "cannot verify, must BLOCK" — when there is no
 *        single approved plan to read: no match, an ambiguous multi-match, plans
 *        unavailable (!plansOk), OR a matched plan that yields zero types. NEVER
 *        fails open.
 *  - typesFromSessions(sessions, serviceType) → Array<{ treatmentType, frequencyPerWeek }>
 *        The per-type breakdown of a plan's `sessions`. A JSON-blob type→count map
 *        (object or "{...}" string) → one entry per key (the KEYS are the treatment
 *        types). A scalar `sessions` + a `serviceType` → a single entry for that
 *        type. Empty / unparseable → [].
 *  - blockMessage(plan, plansOk) → string | null
 *        The Hebrew block copy for a null plan: "no approved plan" when plans are
 *        available (Vered must define one), "cannot verify" when plans are down.
 *  - assignmentPayload({entry, ...}) → assignment row with treatmentType +
 *        frequencyPerWeek FORCED from the given plan-type `entry` (the function
 *        takes no type/freq input of its own, so a saved row can never carry a
 *        user-entered type/frequency).
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
   * The per-type breakdown of a plan's `sessions`.
   *   - JSON-blob map (object, or "{...}" string), type→count: ONE entry per key —
   *     the keys ARE the treatment types, each with its own frequency. A multi-type
   *     plan therefore yields multiple entries (never collapsed/summed into one).
   *   - plain scalar ("2" / 2) + a serviceType: a single entry for that type.
   *   - empty / unparseable / scalar-without-serviceType: [].
   * @param {*} sessions
   * @param {*} [serviceType] used only for the scalar fallback's type name
   * @returns {Array<{treatmentType:string, frequencyPerWeek:number}>}
   */
  function typesFromSessions(sessions, serviceType) {
    if (sessions == null || sessions === '') return [];
    var obj = null;
    if (typeof sessions === 'object') {
      obj = sessions;
    } else {
      var s = String(sessions).trim();
      if (s.charAt(0) === '{') {
        try { obj = JSON.parse(s); } catch (_) { obj = null; }
      } else {
        var scalar = parseInt(s, 10);
        var svcName = String(serviceType == null ? '' : serviceType).trim();
        if (isFinite(scalar) && scalar > 0 && svcName) {
          return [{ treatmentType: svcName, frequencyPerWeek: scalar }];
        }
        return [];
      }
    }
    if (obj && typeof obj === 'object') {
      var out = [];
      Object.keys(obj).forEach(function (k) {
        var name = String(k).trim();
        var c = Number(obj[k]);
        if (name && isFinite(c) && c > 0) out.push({ treatmentType: name, frequencyPerWeek: c });
      });
      return out;
    }
    return [];
  }

  /**
   * The per-type approved-plan projection for one phone, or null when it cannot be
   * verified. Matches against the RAW plans list (not the deduped roster) so an
   * ambiguous multi-match is detectable and a no-match never silently passes.
   * @param {object} input { phone, plans, plansOk }
   * @returns {Array<{treatmentType:string, frequencyPerWeek:number}>|null}
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
    var types = typesFromSessions(p.sessions != null ? p.sessions : p.sessionsPerWeek, p.serviceType);
    if (!types.length) return null;                  // a plan with zero types → treated as no plan
    return types;
  }

  /**
   * The block message for a (possibly null) plan, or null when the plan is present
   * (no block). Distinguishes "no approved plan" (plans available) from "cannot
   * verify" (plans endpoint down) — never fails open in either case.
   * @param {Array|null} plan  result of forPhone (non-empty array, or null)
   * @param {boolean} plansOk   state.plansOk
   * @returns {string|null}
   */
  function blockMessage(plan, plansOk) {
    if (plan) return null;
    return plansOk ? MSG_NO_PLAN : MSG_CANNOT_VERIFY;
  }

  /**
   * Build an assignment payload whose treatmentType + frequencyPerWeek are FORCED
   * from ONE approved plan-type `entry`. The function deliberately accepts NO
   * type/frequency argument of its own, so a saved assignment can never carry a
   * user-entered value.
   * @param {object} input { entry, id, patientPhone, therapist, slots, updatedBy }
   * @returns {object}
   */
  function assignmentPayload(input) {
    input = input || {};
    var entry = input.entry || {};
    return {
      id: input.id,
      patientPhone: input.patientPhone,
      therapist: input.therapist,
      treatmentType: entry.treatmentType || '',
      frequencyPerWeek: (entry.frequencyPerWeek != null && entry.frequencyPerWeek !== 0) ? String(entry.frequencyPerWeek) : '',
      slots: input.slots || '',
      updatedBy: input.updatedBy
    };
  }

  return {
    MSG_NO_PLAN: MSG_NO_PLAN,
    MSG_CANNOT_VERIFY: MSG_CANNOT_VERIFY,
    typesFromSessions: typesFromSessions,
    forPhone: forPhone,
    blockMessage: blockMessage,
    assignmentPayload: assignmentPayload
  };
});
