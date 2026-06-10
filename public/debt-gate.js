/**
 * debt-gate.js
 * -----------------------------------------------------------------------------
 * Turns the outpatient `getDebtStatus` roster into a single GATE DECISION for
 * "this therapist is about to log a treatment for this patient". It composes
 * two things that must never collapse into "looks fine, allow":
 *
 *   1. the phone MATCH (how many outpatient clients does this phone hit?), and
 *   2. the matched client's tri-state debtStatus (clear / debt / unknown).
 *
 * NEVER FAIL OPEN. There are five outcomes, and only ONE of them allows the
 * save to proceed silently:
 *
 *   decision   gate      when                                        consumer UI
 *   --------   -------   ------------------------------------------  -----------
 *   allow      'allow'   exactly 1 match, debtStatus 'clear'         save
 *   block      'block'   exactly 1 match, debtStatus 'debt'          require Ron/
 *                                                                     Sandra approval
 *   flag       'flag'    1 match but debtStatus 'unknown'            manual resolve
 *   flag       'flag'    0 matches (phone hits no client)            manual resolve
 *   flag       'flag'    >1 matches (ambiguous phone)                manual resolve
 *   flag       'flag'    roster missing / endpoint error             manual resolve
 *
 * A blocked ('debt') treatment may proceed ONLY with an explicit approval by
 * Ron (רון) or Sandra (סנדרה) — see approval.js. 'flag' is NOT a soft-allow:
 * it means we could not determine debt and a human must resolve it.
 *
 * Framework-free; runs in the browser and under `node --test`. The phone
 * matcher is injected (or falls back to the Phone module) so the rule and the
 * matching stay in lockstep with phone.js. `test/debt-gate.test.js` guards it.
 */
(function (root, factory) {
  var Phone = (typeof module === 'object' && module.exports)
    ? require('./phone')
    : root.Phone;
  var api = factory(Phone);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / tests
  } else {
    root.DebtGate = api;             // browser global
  }
})(typeof self !== 'undefined' ? self : this, function (Phone) {
  'use strict';

  var DECISIONS = { ALLOW: 'allow', BLOCK: 'block', FLAG: 'flag' };

  // Reasons are stable ids (not display text) so the UI can localize and tests
  // can assert without coupling to copy.
  var REASONS = {
    CLEAR: 'clear',                       // allow
    OWES: 'owes',                         // block
    UNKNOWN_NO_PAYMENT_RECORD: 'no_payment_record', // flag — client exists, zero rows
    NO_MATCH: 'no_record',                // flag — phone matched nobody
    MULTI_MATCH: 'ambiguous',             // flag — phone matched >1 client
    LOOKUP_FAILED: 'lookup_failed'        // flag — roster missing / endpoint error
  };

  function matcher(custom) {
    if (custom && typeof custom.matches === 'function') return custom;
    if (Phone && typeof Phone.matches === 'function') return Phone;
    throw new Error('debt-gate requires a phone matcher (Phone.matches)');
  }

  /**
   * Find every roster client whose phone matches the given canonical phone.
   * @param {string} phone canonical patient phone
   * @param {Array} roster getDebtStatus clients [{name, phone, debtStatus, amountOwed}]
   * @param {object} [phoneApi] override matcher (defaults to Phone module)
   * @returns {Array} matching roster entries
   */
  function findMatches(phone, roster, phoneApi) {
    var m = matcher(phoneApi);
    if (!Array.isArray(roster)) return [];
    return roster.filter(function (c) {
      return c && m.matches(phone, c.phone);
    });
  }

  /**
   * Decide the gate for one patient about to be logged.
   *
   * @param {object} input
   * @param {string} input.phone   canonical patient phone (REQUIRED for a match)
   * @param {Array}  input.roster  getDebtStatus client roster
   * @param {boolean} [input.rosterOk]  false when the debt lookup failed/missing
   * @param {object} [phoneApi] override matcher
   * @returns {{decision:string, reason:string, amountOwed:number, match:?object, matchCount:number}}
   */
  function evaluate(input, phoneApi) {
    input = input || {};
    var phone = input.phone;

    // Never fail open: a failed/absent lookup is a flag, not an allow.
    if (input.rosterOk === false || input.roster == null) {
      return { decision: DECISIONS.FLAG, reason: REASONS.LOOKUP_FAILED, amountOwed: 0, match: null, matchCount: 0 };
    }

    var hits = findMatches(phone, input.roster, phoneApi);

    if (hits.length === 0) {
      return { decision: DECISIONS.FLAG, reason: REASONS.NO_MATCH, amountOwed: 0, match: null, matchCount: 0 };
    }
    if (hits.length > 1) {
      return { decision: DECISIONS.FLAG, reason: REASONS.MULTI_MATCH, amountOwed: 0, match: null, matchCount: hits.length };
    }

    var c = hits[0];
    var status = String(c.debtStatus || '').toLowerCase();
    var owed = Number(c.amountOwed) || 0;

    if (status === 'debt') {
      return { decision: DECISIONS.BLOCK, reason: REASONS.OWES, amountOwed: owed, match: c, matchCount: 1 };
    }
    if (status === 'clear') {
      return { decision: DECISIONS.ALLOW, reason: REASONS.CLEAR, amountOwed: 0, match: c, matchCount: 1 };
    }
    // 'unknown' or any unexpected value -> flag. Absence of evidence is not
    // evidence of payment.
    return { decision: DECISIONS.FLAG, reason: REASONS.UNKNOWN_NO_PAYMENT_RECORD, amountOwed: 0, match: c, matchCount: 1 };
  }

  return {
    DECISIONS: DECISIONS,
    REASONS: REASONS,
    findMatches: findMatches,
    evaluate: evaluate
  };
});
