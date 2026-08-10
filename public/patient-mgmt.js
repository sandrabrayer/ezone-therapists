/**
 * patient-mgmt.js
 * -----------------------------------------------------------------------------
 * Pure validation + schema for the per-patient management panel (ניהול מטופל):
 *
 *   A. Notes log (יומן הערות) — append-only audit trail. Each entry is
 *      { phone, timestamp, author, type, text }. `type` is one of a fixed enum.
 *   B. Patient meta (single editable row per phone): status + reason/date,
 *      guardian contact, referral, treatment goals; last-writer-wins with an
 *      updatedBy / updatedAt stamp added by the writer.
 *
 * This module is the SINGLE SOURCE OF TRUTH for the header order and the
 * validation rules. Apps Script (apps-script/Code.gs) cannot import it, so it
 * mirrors `validateNote` / `validateMeta` and the two header arrays INLINE —
 * any change to the enum, the phone rule, or the header order MUST update both
 * sides. `test/patient-mgmt.test.js` guards every rule here AND asserts Code.gs
 * declares the same header order (append-only).
 *
 * The phone is the patient key; it reuses phone.js so the one canonical rule
 * (/^0\d{9}$/) is never re-implemented. Framework-free so it runs in the
 * browser AND under `node --test`.
 */
(function (root, factory) {
  var Phone = (typeof require === 'function')
    ? require('./phone.js')           // Node / tests
    : root.Phone;                     // browser global (phone.js loaded first)
  var api = factory(Phone);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;             // Node / tests
  } else {
    root.PatientMgmt = api;           // browser global
  }
})(typeof self !== 'undefined' ? self : this, function (Phone) {
  'use strict';

  // APPEND-ONLY header orders. New columns go at the END only — never reorder
  // or remove, or existing rows misalign. Guarded by test/patient-mgmt.test.js
  // (module + Code.gs mirror).
  var NOTES_HEADERS = ['phone', 'timestamp', 'author', 'type', 'text'];
  var PATIENT_META_HEADERS = [
    'phone', 'status', 'statusReason', 'statusDate',
    'contactName', 'contactPhone', 'referral', 'goals',
    'updatedBy', 'updatedAt'
  ];
  // Phase 2 — follow-up tasks (משימות מעקב). Append-only; `id` is a
  // server-generated timestamp-based unique string; `done` is a 'true'/'' flag.
  var FOLLOWUPS_HEADERS = [
    'phone', 'id', 'createdAt', 'createdBy', 'dueDate', 'text', 'done', 'doneAt', 'doneBy'
  ];

  // Fixed enums. UI labels (Hebrew) live in the frontend; the stored value is
  // always the canonical English key.
  var NOTE_TYPES = ['clinical', 'admin', 'family', 'other'];
  var PATIENT_STATUSES = ['active', 'continuing', 'frozen', 'ended'];

  function isNoteType(t) { return NOTE_TYPES.indexOf(String(t == null ? '' : t)) !== -1; }
  function isStatus(s) { return PATIENT_STATUSES.indexOf(String(s == null ? '' : s)) !== -1; }

  function _str(v) { return v == null ? '' : String(v); }

  /**
   * Validate an ADD-note request. The server owns the timestamp (never trust a
   * client clock) so it is NOT taken here; `author` is the therapist's session
   * name, trimmed but not otherwise constrained. Enforces: canonical phone,
   * type in the enum, non-empty text (after trim).
   * @returns {{ok:true, value:{phone,type,text,author}} | {ok:false, error:string}}
   */
  function validateNote(input) {
    input = input || {};
    var phone = _str(input.phone);
    if (!Phone.isCanonical(phone)) return { ok: false, error: 'invalid_phone' };
    if (!isNoteType(input.type)) return { ok: false, error: 'invalid_type' };
    var text = _str(input.text).trim();
    if (!text) return { ok: false, error: 'empty_text' };
    return {
      ok: true,
      value: { phone: phone, type: String(input.type), text: text, author: _str(input.author).trim() }
    };
  }

  /**
   * Validate a SET-meta request. `fields` is the editable subset; the writer
   * (server) stamps updatedBy/updatedAt afterwards, so they are not validated
   * here. Enforces: canonical phone, status in the enum (default 'active' when
   * blank), and — when non-empty — a canonical contactPhone. Free-text fields
   * are passed through as strings. Returns a fully-defaulted value object so a
   * caller can write a complete row (last-writer-wins).
   * @returns {{ok:true, value:object} | {ok:false, error:string}}
   */
  function validateMeta(input) {
    input = input || {};
    var phone = _str(input.phone);
    if (!Phone.isCanonical(phone)) return { ok: false, error: 'invalid_phone' };
    var fields = input.fields || {};
    var status = _str(fields.status).trim() || 'active';
    if (!isStatus(status)) return { ok: false, error: 'invalid_status' };
    var contactPhone = _str(fields.contactPhone).trim();
    if (contactPhone && !Phone.isCanonical(contactPhone)) return { ok: false, error: 'invalid_contact_phone' };
    return {
      ok: true,
      value: {
        phone: phone,
        status: status,
        statusReason: _str(fields.statusReason),
        statusDate: _str(fields.statusDate),
        contactName: _str(fields.contactName),
        contactPhone: contactPhone,
        referral: _str(fields.referral),
        goals: _str(fields.goals)
      }
    };
  }

  /** Empty defaults for a patient with no meta row yet — status defaults active. */
  function defaultMeta(phone) {
    return {
      phone: _str(phone), status: 'active', statusReason: '', statusDate: '',
      contactName: '', contactPhone: '', referral: '', goals: '',
      updatedBy: '', updatedAt: ''
    };
  }

  // ---- Follow-up tasks (משימות מעקב) -----------------------------------------

  var _ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  /** Strict `YYYY-MM-DD` calendar-date check (rejects 2026-13-40, 2026-02-30…). */
  function isISODate(s) {
    var v = _str(s).trim();
    if (!_ISO_DATE_RE.test(v)) return false;
    var y = +v.slice(0, 4), m = +v.slice(5, 7), d = +v.slice(8, 10);
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  /** A stored `done` flag is truthy only for 'true'/'1'/'yes' (case-insensitive). */
  function isDone(v) {
    var s = _str(v).trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes';
  }

  /**
   * Validate an ADD-follow-up request. Server owns id/createdAt/done, so they are
   * NOT taken here. Enforces: canonical phone, non-empty text, valid ISO dueDate.
   * @returns {{ok:true, value:{phone,text,dueDate,createdBy}} | {ok:false, error:string}}
   */
  function validateFollowUp(input) {
    input = input || {};
    var phone = _str(input.phone);
    if (!Phone.isCanonical(phone)) return { ok: false, error: 'invalid_phone' };
    var text = _str(input.text).trim();
    if (!text) return { ok: false, error: 'empty_text' };
    var dueDate = _str(input.dueDate).trim();
    if (!isISODate(dueDate)) return { ok: false, error: 'invalid_due_date' };
    return { ok: true, value: { phone: phone, text: text, dueDate: dueDate, createdBy: _str(input.createdBy).trim() } };
  }

  /**
   * Overdue = due strictly BEFORE `today` AND not done. A task due TODAY is NOT
   * overdue (it's still open-on-time). ISO date strings compare lexically =
   * chronologically. `today` is 'YYYY-MM-DD' (caller's local day).
   */
  function isFollowUpOverdue(dueDate, today, done) {
    if (isDone(done)) return false;
    var d = _str(dueDate).trim(), t = _str(today).trim();
    if (!_ISO_DATE_RE.test(d) || !_ISO_DATE_RE.test(t)) return false;
    return d < t;
  }

  /**
   * Aggregate {open, overdue} per patient from ALL follow-up rows in one pass —
   * the source for the per-card overdue badge (so the list needs ONE bulk call,
   * not N per-card calls). Keyed by the normalized phone (matches how the app
   * looks patients up). Done rows are excluded from `open`.
   * @param {Array} rows follow-up rows ({phone, dueDate, done, ...})
   * @param {string} today 'YYYY-MM-DD'
   * @returns {Object} { "<normPhone>": { open:number, overdue:number } }
   */
  function followUpCounts(rows, today) {
    var out = {};
    (rows || []).forEach(function (r) {
      if (!r || isDone(r.done)) return;
      var key = Phone.normalizeForMatch(r.phone);
      if (!key) return;
      if (!out[key]) out[key] = { open: 0, overdue: 0 };
      out[key].open++;
      if (isFollowUpOverdue(r.dueDate, today, r.done)) out[key].overdue++;
    });
    return out;
  }

  return {
    NOTES_HEADERS: NOTES_HEADERS,
    PATIENT_META_HEADERS: PATIENT_META_HEADERS,
    FOLLOWUPS_HEADERS: FOLLOWUPS_HEADERS,
    NOTE_TYPES: NOTE_TYPES,
    PATIENT_STATUSES: PATIENT_STATUSES,
    isNoteType: isNoteType,
    isStatus: isStatus,
    isISODate: isISODate,
    isDone: isDone,
    validateNote: validateNote,
    validateMeta: validateMeta,
    validateFollowUp: validateFollowUp,
    isFollowUpOverdue: isFollowUpOverdue,
    followUpCounts: followUpCounts,
    defaultMeta: defaultMeta
  };
});
