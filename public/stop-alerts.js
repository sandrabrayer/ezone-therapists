/**
 * stop-alerts.js
 * -----------------------------------------------------------------------------
 * The «התראות טיפול» (treatment alerts) tab — PURE part.
 *
 * The OUTPATIENT app raises a persistent alert whenever a patient's treatment
 * changes direction: a `type:'stop'` (עצירת טיפול) when treatment must be
 * halted, or a `type:'resume'` (חידוש טיפול) when it resumes. Legacy alerts
 * predate the field and carry no/blank type — those read as 'stop'. Each alert
 * also carries a `status`: 'unread' (needs attention), 'read' (acknowledged), or
 * 'cancelled' (voided by the outpatient side). Read-state on legacy rows is still
 * derived from the read / readAt flags.
 *
 * The tab is an ACTION INBOX + collapsed HISTORY:
 *   - PRIMARY LIST — status 'unread' only, both directions. A «נקראה» press
 *     (markStopAlertRead) acknowledges one and drops it into history.
 *   - HISTORY — a collapsed 14-day window of 'read' (reversible via
 *     markStopAlertUnread) and 'cancelled' (dimmed, no action) rows. Older rows
 *     are not rendered; the data stays in the sheet.
 *
 * This module is the framework-free logic: classify type/status, count the
 * unread (the tab badge), and split a list into the primary / history groups the
 * tab renders (with the history date window). The network round-trips live in
 * app.js and the proxy in server.js. Runs in the browser AND under `node --test`;
 * `test/stop-alerts.test.js` guards it.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / tests
  } else {
    root.StopAlerts = api;           // browser global
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // An alert is READ when it carries a truthy read flag or a read-timestamp.
  // Tolerates the several shapes the alert may arrive in (boolean true, the
  // string 'true', or only a readAt stamp) so a persisted read never re-surfaces
  // as unread after a reload.
  function isRead(a) {
    if (!a) return false;
    if (a.read === true) return true;
    var s = String(a.read == null ? '' : a.read).trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes') return true;
    return !!(a.readAt && String(a.readAt).trim());
  }

  // The direction of an alert: 'resume' (חידוש טיפול) or, for anything else
  // incl. the legacy blank/unknown type, 'stop' (עצירת טיפול). Kept blank-
  // tolerant so legacy stop alerts (predating the field) never mis-render.
  function alertType(a) {
    if (!a) return 'stop';
    var t = String(a.type == null ? '' : a.type).trim().toLowerCase();
    return t === 'resume' ? 'resume' : 'stop';
  }

  // Canonical lifecycle status: 'cancelled' (voided outpatient-side), 'read'
  // (acknowledged), or 'unread' (needs attention). 'cancelled' wins; an explicit
  // 'read'/'unread' status is honoured; otherwise we fall back to the legacy
  // read / readAt flags (isRead) so old rows and optimistic flips stay correct.
  // Any other/legacy status string (e.g. the old 'stopped') derives from isRead.
  function statusOf(a) {
    if (!a) return 'unread';
    var s = String(a.status == null ? '' : a.status).trim().toLowerCase();
    if (s === 'cancelled' || s === 'canceled') return 'cancelled';
    if (s === 'unread') return 'unread';
    if (s === 'read') return 'read';
    return isRead(a) ? 'read' : 'unread';
  }

  // Render-time Hebrew title for an alert's direction. Pure so the tab and the
  // tests agree on it.
  function typeTitle(a) {
    return alertType(a) === 'resume' ? 'חידוש טיפול' : 'עצירת טיפול';
  }

  // The tab badge — how many alerts still need Yarden's attention. Counts
  // BOTH directions (stop + resume); read and cancelled are excluded.
  function unreadCount(alerts) {
    if (!Array.isArray(alerts)) return 0;
    var n = 0;
    for (var i = 0; i < alerts.length; i++) if (statusOf(alerts[i]) === 'unread') n++;
    return n;
  }

  /**
   * Split the alerts into the two groups the tab renders, UNREAD FIRST. Order
   * WITHIN each group is preserved from the input (the backend returns
   * newest-first), so this is a stable partition — no alert is dropped, only
   * grouped. Read alerts collapse into the dimmed "נקראו" group; they are never
   * removed.
   * @param {Array} alerts
   * @returns {{unread: Array, read: Array}}
   */
  function partition(alerts) {
    var unread = [];
    var read = [];
    if (Array.isArray(alerts)) {
      for (var i = 0; i < alerts.length; i++) {
        if (isRead(alerts[i])) read.push(alerts[i]);
        else unread.push(alerts[i]);
      }
    }
    return { unread: unread, read: read };
  }

  // Parse an alert timestamp to epoch-ms, or NaN when absent/unparseable.
  function toMs(v) {
    if (!v) return NaN;
    var t = new Date(v).getTime();
    return t !== t ? NaN : t;   // NaN-safe (isNaN without the global)
  }

  // Is this history row within the `windowMs` lookback from `now`? Uses the most
  // recent of created / readAt (and their raw aliases). Defensive: with no clock
  // reference (now falsy) or no parseable date we KEEP the row rather than
  // silently drop it — hiding is only ever done on a confident out-of-window.
  function withinWindow(a, now, windowMs) {
    if (!now) return true;
    a = a || {};
    var stamps = [a.readAt, a.read_at, a.created, a.createdAt, a.cancelledAt];
    var newest = -Infinity;
    for (var i = 0; i < stamps.length; i++) {
      var t = toMs(stamps[i]);
      if (t === t && t > newest) newest = t;   // t===t skips NaN
    }
    if (newest === -Infinity) return true;
    return (now - newest) <= windowMs;
  }

  /**
   * Split the alerts into the ACTION INBOX the tab renders:
   *   - primary: status 'unread' (both directions), backend order preserved.
   *   - history: status 'read' or 'cancelled' whose newest stamp (created/readAt)
   *     is within `windowDays` (default 14) of `now`. Older rows are dropped from
   *     the view only — the data stays in the sheet.
   * `now` is epoch-ms (the browser passes Date.now(); tests pass a fixed clock).
   * When `now` is 0/absent the whole history is kept (no clock → no hiding).
   * @param {Array} alerts
   * @param {number} [now]         epoch-ms reference clock
   * @param {number} [windowDays]  history lookback in days (default 14)
   * @returns {{primary: Array, history: Array}}
   */
  function inbox(alerts, now, windowDays) {
    var primary = [];
    var history = [];
    if (!Array.isArray(alerts)) return { primary: primary, history: history };
    var days = (typeof windowDays === 'number' && windowDays > 0) ? windowDays : 14;
    var windowMs = days * 24 * 60 * 60 * 1000;
    for (var i = 0; i < alerts.length; i++) {
      var a = alerts[i];
      var st = statusOf(a);
      if (st === 'unread') { primary.push(a); continue; }
      if (withinWindow(a, now, windowMs)) history.push(a);   // 'read' or 'cancelled'
    }
    return { primary: primary, history: history };
  }

  // Render-time Hebrew label for a stable reason key. The outpatient backend
  // tags each alert with a STABLE key (no_payment / mismatch / other); ONLY the
  // display text is localized here so the keys stay stable across the wire.
  // Blank-tolerant: unknown or blank reasons (legacy alerts predate the field)
  // yield '' — the tab then renders no chip for them.
  var REASON_LABELS = {
    no_payment: 'חוסר תשלום',
    mismatch: 'אי התאמה',
    other: 'אחר'
  };
  function reasonLabel(reason) {
    if (reason == null) return '';
    var key = String(reason).trim().toLowerCase();
    return REASON_LABELS[key] || '';
  }

  // Normalize ONE raw outpatient alert into the shape the tab renders. The
  // outpatient app owns these rows, so accept the field aliases it may send:
  // the patient name arrives as `clientName` (the outpatient store's own column)
  // but older/other shapes used name/patient/patientName — try them all so the
  // card never renders a nameless «—». `created` tolerates createdAt likewise.
  // The stable `reason` key is kept verbatim (localized to a chip at render
  // time); the free-text note stays separate from it. `read` is derived by
  // isRead. This is the PURE part — the browser wrapper adds the phone (which
  // needs the Phone module) on top of this.
  function normalize(a) {
    a = a || {};
    return {
      id: a.id || a.alertId || a.rowId || '',
      type: alertType(a),
      status: statusOf(a),
      patientName: a.patientName || a.clientName || a.name || a.patient || '',
      created: a.created || a.createdDate || a.createdAt || a.date || '',
      note: a.note || a.message || '',
      reason: a.reason || '',
      read: isRead(a),
      readAt: a.readAt || a.read_at || a.readOn || ''
    };
  }

  return {
    isRead: isRead,
    alertType: alertType,
    statusOf: statusOf,
    typeTitle: typeTitle,
    unreadCount: unreadCount,
    partition: partition,
    inbox: inbox,
    reasonLabel: reasonLabel,
    normalize: normalize
  };
});
