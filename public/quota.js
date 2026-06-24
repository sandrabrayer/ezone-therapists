/**
 * quota.js — monthly package-cap logic (pure, no DOM, no network).
 *
 * Business rule (confirmed with Sandra): packages are sold per month, one month
 * forward, from a WEEKLY plan. The monthly cap for a treatment type is
 *
 *     quota = frequencyPerWeek × 4
 *
 * e.g. 1×/week individual → 4/month, 2×/week → 8/month. The cap is PER treatment
 * type (each assignment row has its own frequencyPerWeek) and resets each
 * calendar month. The same rule applies to ליווי יומי בקהילה.
 *
 * Yarden may still book beyond the cap (soft warn, not a hard block); an
 * over-cap booking is flagged for Vered's approval. This module only computes
 * the numbers and the over/at-cap state — the UI decides what to show, and the
 * cross-app request/approval lives elsewhere.
 *
 * Exposed as window.Quota (browser) and module.exports (tests).
 */
(function (root) {
  'use strict';

  var WEEKS_PER_MONTH = 4;

  // YYYY-MM for a date-ish value (ISO string, or '' → '').
  function monthKey(d) {
    return String(d == null ? '' : d).slice(0, 7);
  }

  // Monthly quota for a single assignment row. Non-positive/invalid freq → 0.
  function quotaForFrequency(frequencyPerWeek) {
    var f = Number(frequencyPerWeek);
    if (!isFinite(f) || f <= 0) return 0;
    return Math.round(f) * WEEKS_PER_MONTH;
  }

  // Normalize a treatment-type key for matching (trim; tolerate null).
  function typeKey(t) {
    return String(t == null ? '' : t).trim();
  }

  /**
   * Build the per-type quota picture for ONE patient in a given month.
   *
   * @param {Object}   opts
   * @param {Array}    opts.assignments  this patient's plan rows
   *                                     ({ treatmentType, frequencyPerWeek })
   * @param {Array}    opts.bookings     this patient's schedule rows
   *                                     ({ treatmentType, scheduledDate })
   * @param {string}   opts.month        YYYY-MM to count usage in
   * @param {function} [opts.countsBooking]  optional predicate; a booking counts
   *                   toward usage only if it returns true (default: all rows,
   *                   so cancelled/no-show handling can be injected by the caller)
   * @returns {Array} one entry per treatment type present in the plan or bookings:
   *                  { treatmentType, frequencyPerWeek, quota, used, remaining, over }
   */
  function patientQuota(opts) {
    opts = opts || {};
    var assignments = opts.assignments || [];
    var bookings = opts.bookings || [];
    var month = monthKey(opts.month);
    var counts = typeof opts.countsBooking === 'function'
      ? opts.countsBooking
      : function () { return true; };

    var byType = {}; // typeKey -> { treatmentType, frequencyPerWeek, quota, used }

    // Quota side: from the plan.
    assignments.forEach(function (a) {
      var k = typeKey(a.treatmentType);
      if (!k) return;
      var q = quotaForFrequency(a.frequencyPerWeek);
      if (!byType[k]) {
        byType[k] = { treatmentType: k, frequencyPerWeek: Number(a.frequencyPerWeek) || 0, quota: q, used: 0 };
      } else {
        // Multiple plan rows for the same type → sum their quotas/frequencies.
        byType[k].frequencyPerWeek += Number(a.frequencyPerWeek) || 0;
        byType[k].quota += q;
      }
    });

    // Usage side: count this-month bookings of each type.
    bookings.forEach(function (b) {
      if (monthKey(b.scheduledDate) !== month) return;
      if (!counts(b)) return;
      var k = typeKey(b.treatmentType);
      if (!k) return;
      if (!byType[k]) {
        // A booking exists for a type with no plan row → quota 0 (every booking
        // is "over"), so it still surfaces for Vered rather than hiding.
        byType[k] = { treatmentType: k, frequencyPerWeek: 0, quota: 0, used: 0 };
      }
      byType[k].used += 1;
    });

    return Object.keys(byType).map(function (k) {
      var e = byType[k];
      var remaining = e.quota - e.used;
      return {
        treatmentType: e.treatmentType,
        frequencyPerWeek: e.frequencyPerWeek,
        quota: e.quota,
        used: e.used,
        remaining: remaining,
        over: e.used > e.quota
      };
    });
  }

  /**
   * Would adding ONE more booking of `treatmentType` exceed the monthly cap?
   * Returns { quota, used, remaining, willExceed, atOrOver }.
   * willExceed = the NEW booking would push used past quota (used + 1 > quota).
   * atOrOver   = already at or beyond cap before adding (used >= quota).
   */
  function checkAdd(opts) {
    opts = opts || {};
    var rows = patientQuota({
      assignments: opts.assignments,
      bookings: opts.bookings,
      month: opts.month,
      countsBooking: opts.countsBooking
    });
    var k = typeKey(opts.treatmentType);
    var row = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].treatmentType === k) { row = rows[i]; break; }
    }
    var quota = row ? row.quota : 0;
    var used = row ? row.used : 0;
    return {
      quota: quota,
      used: used,
      remaining: quota - used,
      willExceed: (used + 1) > quota,
      atOrOver: used >= quota
    };
  }

  var api = {
    WEEKS_PER_MONTH: WEEKS_PER_MONTH,
    monthKey: monthKey,
    quotaForFrequency: quotaForFrequency,
    patientQuota: patientQuota,
    checkAdd: checkAdd
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Quota = api;
})(typeof window !== 'undefined' ? window : this);
