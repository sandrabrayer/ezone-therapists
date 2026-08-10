/**
 * patient-mgmt-ui.js
 * -----------------------------------------------------------------------------
 * Pure, framework-free presentation helpers for the patient-management panel
 * (ניהול מטופל) UI. Kept out of app.js so the display decisions are unit-testable
 * without a DOM (test/patient-mgmt-ui.test.js):
 *
 *   - Enum ↔ Hebrew label maps for note types and patient statuses (1:1 with the
 *     canonical keys in patient-mgmt.js — the enums themselves are NOT redefined
 *     here; a guard test asserts the label maps cover exactly those keys).
 *   - statusChip(status): the header chip next to the debt chip. active → no chip;
 *     frozen / ended → a muted, DISTINCT class (never the debt-warning red, never
 *     the sky scheduling accent).
 *   - relativeDate(iso, now): Hebrew relative date ("היום" / "אתמול" / "לפני N
 *     ימים"), falling back to an absolute DD/MM/YYYY for older / unparseable
 *     values. Deterministic (UTC calendar-day diff) so tests never flake by TZ.
 *   - contactPhoneError(raw): the UI-side guard for the guardian phone — reuses
 *     phone.js (no duplicate regex); empty is allowed, otherwise it must be the
 *     one canonical shape. Returns a Hebrew error string or null (valid).
 *
 * Runs in the browser (global `PatientMgmtUi`) AND under `node --test`.
 */
(function (root, factory) {
  var isNode = (typeof module === 'object' && module.exports);
  var Phone = isNode ? require('./phone') : root.Phone;
  var PatientMgmt = isNode ? require('./patient-mgmt') : root.PatientMgmt;
  var api = factory(Phone, PatientMgmt);
  if (isNode) module.exports = api;      // Node / tests
  else root.PatientMgmtUi = api;         // browser global
})(typeof self !== 'undefined' ? self : this, function (Phone, PatientMgmt) {
  'use strict';

  // Enum → Hebrew UI label. The KEYS must stay 1:1 with patient-mgmt.js's
  // NOTE_TYPES / PATIENT_STATUSES — guarded by test/patient-mgmt-ui.test.js.
  var TYPE_LABELS = {
    clinical: 'קלינית',
    admin: 'אדמיניסטרטיבית',
    family: 'קשר עם משפחה',
    other: 'אחר'
  };
  var STATUS_LABELS = {
    active: 'פעיל',
    continuing: 'ממשיך לעוד חודש',
    frozen: 'מוקפא',
    ended: 'הסתיים'
  };

  function typeLabel(type) {
    var k = String(type == null ? '' : type);
    return Object.prototype.hasOwnProperty.call(TYPE_LABELS, k) ? TYPE_LABELS[k] : k;
  }
  function statusLabel(status) {
    var k = String(status == null ? '' : status);
    return Object.prototype.hasOwnProperty.call(STATUS_LABELS, k) ? STATUS_LABELS[k] : k;
  }

  /**
   * The header status chip shown next to the debt chip. `active` (the default)
   * renders NO chip. `continuing` / `frozen` / `ended` render a chip with a
   * DISTINCT class — deliberately not the debt-warning red and not the sky
   * scheduling accent (see the CSS: emerald for continuing, slate for frozen,
   * mauve-gray for ended).
   * @param {*} status
   * @returns {{show:boolean, label?:string, cls?:string}}
   */
  function statusChip(status) {
    var k = String(status == null ? '' : status);
    if (k === 'continuing') return { show: true, label: STATUS_LABELS.continuing, cls: 'cc-status-chip cc-status-continuing' };
    if (k === 'frozen') return { show: true, label: STATUS_LABELS.frozen, cls: 'cc-status-chip cc-status-frozen' };
    if (k === 'ended') return { show: true, label: STATUS_LABELS.ended, cls: 'cc-status-chip cc-status-ended' };
    return { show: false };   // active / unknown → no chip
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // Parse an ISO/`yyyy-MM-dd` value (or ms number) to a Date, or null.
  function toDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    if (typeof v === 'number') { var dn = new Date(v); return isNaN(dn.getTime()) ? null : dn; }
    var d = new Date(String(v));
    return isNaN(d.getTime()) ? null : d;
  }

  // Whole-calendar-day difference (now - then) computed on the UTC calendar, so
  // the result never depends on the runner's timezone.
  function utcDayDiff(now, then) {
    var DAY = 86400000;
    var a = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    var b = Date.UTC(then.getUTCFullYear(), then.getUTCMonth(), then.getUTCDate());
    return Math.round((a - b) / DAY);
  }

  function absoluteDate(d) {
    return pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
  }

  /**
   * Hebrew relative date for a note timestamp.
   *   today (or future clock-skew) → "היום"
   *   1 day  → "אתמול"
   *   2 days → "לפני יומיים"   (Hebrew dual)
   *   3–29   → "לפני N ימים"
   *   ≥ 30 or unparseable-but-a-date → absolute "DD/MM/YYYY"
   * An unparseable value returns its trimmed self (never 'null'/'undefined').
   * @param {*} iso  the note timestamp (server ISO string)
   * @param {*} now  current time (ms, Date, or ISO) — injected for deterministic tests
   * @returns {string}
   */
  function relativeDate(iso, now) {
    var then = toDate(iso);
    if (!then) return String(iso == null ? '' : iso).trim();
    var nowD = toDate(now);
    if (!nowD) return absoluteDate(then);
    var days = utcDayDiff(nowD, then);
    if (days <= 0) return 'היום';
    if (days === 1) return 'אתמול';
    if (days === 2) return 'לפני יומיים';
    if (days < 30) return 'לפני ' + days + ' ימים';
    return absoluteDate(then);
  }

  /** Absolute date+time for the title/hover tooltip (never 'null'/'undefined'). */
  function absoluteDateTime(iso) {
    var d = toDate(iso);
    if (!d) return String(iso == null ? '' : iso).trim();
    return absoluteDate(d) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
  }

  /**
   * UI-side guardian-phone guard. Empty is allowed (contactPhone is optional);
   * a non-empty value must be exactly canonical — reuses phone.js so there is no
   * second regex to drift. Returns a Hebrew error string, or null when valid.
   * @param {*} raw
   * @returns {string|null}
   */
  function contactPhoneError(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (s === '') return null;                 // optional field
    if (Phone.isCanonical(s)) return null;     // exactly /^0\d{9}$/
    return 'מספר טלפון לא תקין — 10 ספרות המתחילות ב-0 (לדוגמה 0501234567), או השאירו ריק';
  }

  // ---- Follow-up tasks (משימות מעקב) ------------------------------------------

  /** A due date (date-only ISO) formatted DD/MM/YYYY; unparseable → trimmed self. */
  function formatDate(iso) {
    var d = toDate(iso);
    if (!d) return String(iso == null ? '' : iso).trim();
    return absoluteDate(d);
  }

  /**
   * The per-card overdue badge shown next to the status chip. Hidden when the
   * overdue count is 0; otherwise "מעקב באיחור" (with the count when > 1).
   * @param {number} overdueCount
   * @returns {{show:boolean, label?:string, cls?:string}}
   */
  function overdueBadge(overdueCount) {
    var n = Number(overdueCount) || 0;
    if (n <= 0) return { show: false };
    return { show: true, label: n > 1 ? ('מעקב באיחור · ' + n) : 'מעקב באיחור', cls: 'cc-followup-badge' };
  }

  /** Client-side add-follow-up guard: non-empty text + valid ISO due date. */
  function followUpError(text, dueDate) {
    if (!String(text == null ? '' : text).trim()) return 'לא ניתן להוסיף משימה ללא טקסט';
    if (!PatientMgmt.isISODate(dueDate)) return 'יש לבחור תאריך יעד תקין';
    return null;
  }

  return {
    TYPE_LABELS: TYPE_LABELS,
    STATUS_LABELS: STATUS_LABELS,
    NOTE_TYPES: PatientMgmt.NOTE_TYPES,
    PATIENT_STATUSES: PatientMgmt.PATIENT_STATUSES,
    typeLabel: typeLabel,
    statusLabel: statusLabel,
    statusChip: statusChip,
    relativeDate: relativeDate,
    absoluteDateTime: absoluteDateTime,
    contactPhoneError: contactPhoneError,
    formatDate: formatDate,
    overdueBadge: overdueBadge,
    followUpError: followUpError,
    isOverdue: PatientMgmt.isFollowUpOverdue
  };
});
