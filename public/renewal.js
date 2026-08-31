/**
 * renewal.js
 * -----------------------------------------------------------------------------
 * Package-renewal alerts (חידוש חבילה) — pure logic + HTML builders.
 *
 * The outpatient `getTreatmentPlans` projection carries `renewalDate` — the
 * client's next package end (outpatient `nextBillingDate`). Yarden needs the
 * SAME 7-day «due soon» window Vered sees in outpatient, so both apps flag the
 * same patient on the same day; when Vered renews, the outpatient app moves
 * `nextBillingDate` forward and the alert here clears on the next load. DATE
 * ONLY — no payment state is read or shown.
 *
 * Status model (renewalStatus):
 *   unknown  — blank / malformed date (an outpatient deploy without the field,
 *              or garbage). NEVER alerts; the card shows «—».
 *   overdue  — daysLeft < 0 (package end passed, not yet renewed).
 *   due_soon — 0 <= daysLeft <= DUE_SOON_DAYS (7).
 *   ok       — daysLeft > 7.
 *
 * daysBetween MIRRORS outpatient public/app.js daysBetween — Math.round of
 * ms/86400000 over `new Date(iso)` — so the two apps compute the identical
 * day count. Do not "improve" it here without changing outpatient in lockstep.
 *
 * Pure + framework-free: runs in the browser (global `Renewal`, loaded after
 * treatmentdates.js) AND under `node --test` (`test/renewal.test.js`).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./treatmentdates'));   // Node / tests
  } else {
    root.Renewal = factory(root.TreatmentDates);             // browser global
  }
})(typeof self !== 'undefined' ? self : this, function (TreatmentDates) {
  'use strict';

  var DUE_SOON_DAYS = 7;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // 'yyyy-MM-dd' (ISO 'T' suffix tolerated) → the date part, or null when
  // blank/malformed. Same acceptance rule as TreatmentDates.format.
  function dateOnly(v) {
    if (v == null) return null;
    var s = String(v).trim();
    if (!s) return null;
    if (s.indexOf('T') !== -1) s = s.split('T')[0];
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (!m) return null;
    var month = Number(m[2]), day = Number(m[3]);
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;
    return s;
  }

  // Whole days from a to b — the outpatient formula, verbatim.
  function daysBetween(aIso, bIso) {
    return Math.round((new Date(bIso) - new Date(aIso)) / 86400000);
  }

  /**
   * @param {*} renewalDate  'yyyy-MM-dd' (often blank)
   * @param {string} todayIso  'yyyy-MM-dd'
   * @returns {{status:'due_soon'|'overdue'|'ok'|'unknown', daysLeft:number|null}}
   */
  function renewalStatus(renewalDate, todayIso) {
    var d = dateOnly(renewalDate);
    var t = dateOnly(todayIso);
    if (!d || !t) return { status: 'unknown', daysLeft: null };
    var n = daysBetween(t, d);
    if (n < 0) return { status: 'overdue', daysLeft: n };
    if (n <= DUE_SOON_DAYS) return { status: 'due_soon', daysLeft: n };
    return { status: 'ok', daysLeft: n };
  }

  /**
   * The roster items whose package end is due/overdue, each extended with
   * `renewalStatus` + `daysLeft`, sorted daysLeft ascending (overdue first).
   * Items with a `treatmentEndDate` are DISCHARGED — never up for renewal.
   */
  function renewalAlerts(rosterItems, todayIso) {
    var out = [];
    (rosterItems || []).forEach(function (p) {
      if (!p || p.treatmentEndDate) return;
      var st = renewalStatus(p.renewalDate, todayIso);
      if (st.status !== 'due_soon' && st.status !== 'overdue') return;
      var item = Object.assign({}, p);
      item.renewalStatus = st.status;
      item.daysLeft = st.daysLeft;
      out.push(item);
    });
    out.sort(function (a, b) { return a.daysLeft - b.daysLeft; });
    return out;
  }

  // The badge contribution: how many renewal alerts the roster holds right now.
  function alertCount(rosterItems, todayIso) {
    return renewalAlerts(rosterItems, todayIso).length;
  }

  // Human days-left chip text. due_soon reads naturally (היום / מחר / בעוד X
  // ימים), overdue is the fixed «באיחור». ok/unknown get NO chip ('').
  function chipLabel(status, daysLeft) {
    if (status === 'overdue') return 'באיחור';
    if (status !== 'due_soon') return '';
    if (daysLeft === 0) return 'היום';
    if (daysLeft === 1) return 'מחר';
    return 'בעוד ' + daysLeft + ' ימים';
  }

  // '' for ok/unknown; otherwise a .chip span — amber (warn token) for
  // due_soon, red for overdue. Classes styled in style.css.
  function chipHtml(status, daysLeft) {
    var label = chipLabel(status, daysLeft);
    if (!label) return '';
    var cls = status === 'overdue' ? 'renewal-chip-over' : 'renewal-chip-warn';
    return '<span class="chip renewal-chip ' + cls + '">' + esc(label) + '</span>';
  }

  // The dashboard card's third date line: «חידוש חבילה» + formatted date +
  // (only when due/overdue) the days-left chip. Slots into the card's existing
  // cc-dates block under תחילת/סיום טיפול.
  function cardDateLineHtml(renewalDate, todayIso) {
    var st = renewalStatus(renewalDate, todayIso);
    return '<div class="cc-line cc-date-line cc-renewal-line">' +
      '<span class="cc-k">חידוש חבילה</span>' +
      '<span class="cc-v">' + esc(TreatmentDates.format(renewalDate)) + '</span>' +
      chipHtml(st.status, st.daysLeft) +
      '</div>';
  }

  // One row of the «חידוש חבילה — השבוע הקרוב» section: name · phone ·
  // assigned therapists · renewal date · days-left chip.
  function alertRowHtml(item) {
    var thers = (item.therapists || []).filter(Boolean).join(' · ');
    return '<div class="renewal-row' + (item.renewalStatus === 'overdue' ? ' renewal-stop' : ' renewal-warn') + '">' +
      '<div class="renewal-main">' +
        '<span class="renewal-name">' + esc(item.name || '—') + '</span>' +
        '<span class="renewal-phone">' + esc(item.phone || '') + '</span>' +
        (thers ? '<span class="renewal-thers">' + esc(thers) + '</span>' : '') +
      '</div>' +
      '<div class="renewal-meta">' +
        '<span class="renewal-date">' + esc(TreatmentDates.format(item.renewalDate)) + '</span>' +
        chipHtml(item.renewalStatus, item.daysLeft) +
      '</div>' +
      '</div>';
  }

  // The section body: alert rows, or the empty state. The section title lives
  // in index.html.
  function alertsListHtml(rosterItems, todayIso) {
    var alerts = renewalAlerts(rosterItems, todayIso);
    if (!alerts.length) return '<div class="billing-empty">אין חידושים השבוע</div>';
    return alerts.map(alertRowHtml).join('');
  }

  return {
    DUE_SOON_DAYS: DUE_SOON_DAYS,
    daysBetween: daysBetween,
    renewalStatus: renewalStatus,
    renewalAlerts: renewalAlerts,
    alertCount: alertCount,
    chipLabel: chipLabel,
    chipHtml: chipHtml,
    cardDateLineHtml: cardDateLineHtml,
    alertRowHtml: alertRowHtml,
    alertsListHtml: alertsListHtml
  };
});
