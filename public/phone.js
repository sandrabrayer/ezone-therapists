/**
 * phone.js
 * -----------------------------------------------------------------------------
 * The phone number is THE patient-matching key for this app. Two distinct jobs
 * live here, and they are deliberately not the same function:
 *
 *  1. INPUT (this app's own data) — ONE enforced canonical format.
 *     Exactly 10 digits, no separators, leading zero: e.g. "0501234567".
 *     `validateCanonical` accepts ONLY that. Anything else is rejected with a
 *     clear error. We NEVER silently reformat what the user typed — a wrong
 *     shape is a hard error they must fix, so the stored key is always clean.
 *
 *  2. MATCHING (against sibling apps' legacy data) — tolerant normalization.
 *     Outpatient / dashboard phones were entered freely over time
 *     ("050-123-4567", "+972 50 1234567", "(050) 1234567"). To compare a
 *     canonical key against that legacy value we normalize the legacy side at
 *     READ/COMPARE time only: strip spaces/dashes/parens/dots, convert a
 *     +972 / 972 country prefix to a leading 0. We do NOT write the normalized
 *     form back anywhere — normalization is a comparison aid, not storage.
 *
 * Framework-free so it runs in the browser AND under `node --test`.
 * `test/phone.test.js` guards every rule here.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / tests
  } else {
    root.Phone = api;                // browser global
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Canonical: leading zero + 9 more digits = 10 digits total, nothing else.
  var CANONICAL_RE = /^0\d{9}$/;

  /**
   * Is `s` already in the one canonical format? (strict — no whitespace, no
   * separators, no country code).
   * @param {*} s
   * @returns {boolean}
   */
  function isCanonical(s) {
    return typeof s === 'string' && CANONICAL_RE.test(s);
  }

  /**
   * Validate user INPUT against the single enforced format. Returns a result
   * object — never throws, never reformats.
   *   { ok: true,  value: "0501234567" }
   *   { ok: false, error: "<hebrew reason>" }
   * The value on success is exactly what was validated (already canonical).
   * @param {*} raw
   * @returns {{ok: boolean, value?: string, error?: string}}
   */
  function validateCanonical(raw) {
    if (raw == null) return { ok: false, error: 'חסר מספר טלפון' };
    var s = String(raw);
    if (s.trim() === '') return { ok: false, error: 'חסר מספר טלפון' };
    // Reject anything that is not EXACTLY canonical. We intentionally do not
    // trim-and-accept or strip separators here: input must be clean at source.
    if (!CANONICAL_RE.test(s)) {
      // Give a specific, actionable message.
      if (/\D/.test(s)) {
        return { ok: false, error: 'מספר טלפון לא תקין — יש להזין 10 ספרות בלבד, ללא רווחים או מקפים (לדוגמה 0501234567)' };
      }
      if (s.length !== 10) {
        return { ok: false, error: 'מספר טלפון לא תקין — נדרשות בדיוק 10 ספרות (לדוגמה 0501234567)' };
      }
      if (s.charAt(0) !== '0') {
        return { ok: false, error: 'מספר טלפון לא תקין — חייב להתחיל ב-0 (לדוגמה 0501234567)' };
      }
      return { ok: false, error: 'מספר טלפון לא תקין (לדוגמה 0501234567)' };
    }
    return { ok: true, value: s };
  }

  /**
   * Normalize ANY phone string to a comparison key. Used on the LEGACY side
   * (sibling-app data) before matching against a canonical key. Best-effort:
   * returns the cleaned digit string, never throws. Returns '' for empty.
   *
   * Rules, in order:
   *   - drop spaces, dashes, parentheses, dots, and a leading '+'
   *   - "972..." (Israeli country code) -> drop "972", ensure a single leading 0
   *   - leave an already-canonical "0XXXXXXXXX" untouched
   *
   * Note: this is intentionally lenient. It does NOT guarantee the result is a
   * valid canonical number — callers compare two normalized values for equality
   * and additionally require canonical validity where it matters.
   * @param {*} raw
   * @returns {string} normalized digits (possibly '')
   */
  function normalizeForMatch(raw) {
    if (raw == null) return '';
    var s = String(raw).trim();
    if (!s) return '';
    // Strip everything that is not a digit (spaces, -, (), ., +, unicode marks).
    var digits = s.replace(/[^\d]/g, '');
    if (!digits) return '';
    // Country code 972 -> local leading 0.
    if (digits.indexOf('972') === 0) {
      digits = '0' + digits.slice(3);
    }
    return digits;
  }

  /**
   * Do two phone numbers refer to the same line? Normalizes BOTH sides and
   * compares. Empty/normalization-failed inputs never match (no false match on
   * blank data — that becomes a "no record" flag upstream, not a silent pass).
   * @param {*} a canonical key (this app)
   * @param {*} b legacy value (sibling app)
   * @returns {boolean}
   */
  function matches(a, b) {
    var na = normalizeForMatch(a);
    var nb = normalizeForMatch(b);
    if (!na || !nb) return false;
    return na === nb;
  }

  /**
   * RECOVER a value Google Sheets mangled on storage. A canonical phone written
   * to a number-formatted cell ("0501234567") loses its leading zero and is kept
   * as the number 501234567 — a 9-digit value whose first digit is NOT 0. That is
   * the unambiguous "lost-zero" signature, and the ONLY thing this repairs: a
   * 9-digit run not starting with 0 gets its leading 0 restored, yielding a
   * canonical 10-digit string. Everything else (already-canonical, blank, legacy
   * free-form, wrong length) is returned as a trimmed string, untouched.
   *
   * This is READ-side recovery of data Sheets corrupted — never an entry path:
   * a human typing a no-leading-zero number is still rejected by validateCanonical
   * / toCanonical. Used by the server on read (mirrored in Code.gs) and the client.
   * @param {*} raw
   * @returns {string}
   */
  function recoverStored(raw) {
    if (raw == null) return '';
    var s = String(raw).trim();
    if (!s) return '';
    var digits = s.replace(/[^\d]/g, '');
    if (digits.length === 9 && digits.charAt(0) !== '0') return '0' + digits;
    return s;
  }

  /**
   * Find an existing patient that already owns `phone` — the create-time
   * duplicate guard. Matches tolerantly (canonical vs legacy free-form are the
   * same line) via `matches`. Returns the FIRST matching patient object (so the
   * caller can name them in a message), or null when there is no match, the phone
   * is blank, or `patients` isn't a usable list. An inactive patient still owns
   * the phone key, so this does not skip on `active` — re-creating a retired
   * patient's number is still a duplicate.
   * @param {*} phone canonical phone being created
   * @param {Array<{phone:*, name?:*}>} patients existing records
   * @returns {object|null}
   */
  function duplicateOf(phone, patients) {
    var key = normalizeForMatch(phone);
    if (!key || !Array.isArray(patients)) return null;
    for (var i = 0; i < patients.length; i++) {
      var p = patients[i];
      if (p && matches(key, p.phone)) return p;
    }
    return null;
  }

  /**
   * NORMALIZE then VALIDATE — the canonical entry path. Strips separators and
   * converts a +972/972 prefix to a leading 0 (via normalizeForMatch), then
   * requires the result to be canonical (via isCanonical). On success returns
   * the NORMALIZED canonical value to store; on failure a clear Hebrew error.
   * Composes the two existing functions — no duplicated logic. Unlike
   * validateCanonical (strict, no reformat), this accepts a fixable number and
   * returns it cleaned, but a number that can't be made canonical is rejected
   * (e.g. a 9-digit number with no leading zero is NOT auto-prepended).
   * @param {*} raw
   * @returns {{ok:boolean, value?:string, error?:string}}
   */
  function toCanonical(raw) {
    if (raw == null || String(raw).trim() === '') return { ok: false, error: 'חסר מספר טלפון' };
    var norm = normalizeForMatch(raw);
    if (isCanonical(norm)) return { ok: true, value: norm };
    if (!norm) return { ok: false, error: 'מספר טלפון לא תקין (לדוגמה 0501234567)' };
    if (norm.length !== 10) {
      return { ok: false, error: 'מספר טלפון לא תקין — נדרשות בדיוק 10 ספרות (לדוגמה 0501234567)' };
    }
    if (norm.charAt(0) !== '0') {
      return { ok: false, error: 'מספר טלפון לא תקין — חייב להתחיל ב-0 (לדוגמה 0501234567)' };
    }
    return { ok: false, error: 'מספר טלפון לא תקין (לדוגמה 0501234567)' };
  }

  return {
    CANONICAL_RE: CANONICAL_RE,
    isCanonical: isCanonical,
    validateCanonical: validateCanonical,
    toCanonical: toCanonical,
    recoverStored: recoverStored,
    duplicateOf: duplicateOf,
    normalizeForMatch: normalizeForMatch,
    matches: matches
  };
});
