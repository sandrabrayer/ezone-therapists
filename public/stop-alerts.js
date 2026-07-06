/**
 * stop-alerts.js
 * -----------------------------------------------------------------------------
 * The «עצירת טיפול» (stop-treatment) alerts tab — PURE part.
 *
 * The OUTPATIENT app raises a persistent stop-treatment alert whenever a
 * patient's treatment must be halted. Those alerts are read here (getStopAlerts)
 * so Yarden sees them, and are cleared ONE-BY-ONE by an explicit "נקראה"
 * (mark-read) press (markStopAlertRead). They are PERSISTENT: an alert NEVER
 * disappears on its own — the only thing that moves an alert out of the unread
 * list is an explicit mark-read, which drops it into the dimmed "נקראו" group.
 * A read alert stays visible (history), it is never deleted from the view.
 *
 * This module is the framework-free logic: decide read/unread, count the unread
 * (the tab badge), and split a list into the unread-first / read groups the tab
 * renders. The network round-trips (fetch getStopAlerts / POST markStopAlertRead)
 * live in app.js and the proxy in server.js. Runs in the browser AND under
 * `node --test`; `test/stop-alerts.test.js` guards it.
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

  // The tab badge — how many alerts still need Yarden's attention.
  function unreadCount(alerts) {
    if (!Array.isArray(alerts)) return 0;
    var n = 0;
    for (var i = 0; i < alerts.length; i++) if (!isRead(alerts[i])) n++;
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
    unreadCount: unreadCount,
    partition: partition,
    reasonLabel: reasonLabel,
    normalize: normalize
  };
});
