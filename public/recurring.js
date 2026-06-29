/**
 * recurring.js
 * -----------------------------------------------------------------------------
 * TRUE weekly recurring treatment pattern → rolling occurrences.
 *
 * A therapist sets a weekly pattern PER ASSIGNMENT: N slots (N = frequencyPerWeek),
 * each slot = { weekday: 0–6 (0=Sunday), time: "HH:mm", location: "<id>" }. The
 * pattern is set ONCE and stored on the assignment (Assignments.slots, JSON). It
 * keeps producing occurrences until the patient is stopped/discharged — no end date.
 *
 * Generation is ROLLING and VIRTUAL: `generateOccurrences` materializes the coming
 * week's occurrences from the pattern for display. Nothing is pre-written to the
 * Schedule sheet — an occurrence becomes a real row only when it is REPORTED
 * (lazy materialization, server-side). Every occurrence has a DETERMINISTIC id
 * (`occ_<assignmentId>_<YYYYMMDD>_<HHMM>`) that doubles as the Schedule row id and
 * the write-back treatmentId, so re-viewing a week never duplicates (an occurrence
 * whose id already exists as a real row is dropped) and re-reporting is idempotent.
 *
 * Framework-free so it runs in the browser AND under `node --test`.
 * `test/recurring.test.js` guards every rule here.
 */
(function (root, factory) {
  var Phone = (typeof module === 'object' && module.exports)
    ? require('./phone')
    : root.Phone;
  var api = factory(Phone);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / tests
  } else {
    root.Recurring = api;            // browser global
  }
})(typeof self !== 'undefined' ? self : this, function (Phone) {
  'use strict';

  var TIME_RE = /^\d{2}:\d{2}$/;

  function _pad2(n) { return (n < 10 ? '0' : '') + n; }
  function _parseYmd(s) {
    var p = String(s).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));   // local midnight
  }
  function _fmtYmd(d) {
    return d.getFullYear() + '-' + _pad2(d.getMonth() + 1) + '-' + _pad2(d.getDate());
  }

  /**
   * Parse the stored slots (JSON string or array) into an array. Bad input → [].
   * @param {*} raw
   * @returns {Array}
   */
  function parseSlots(raw) {
    if (raw == null || raw === '') return [];
    var arr = raw;
    if (typeof raw === 'string') {
      try { arr = JSON.parse(raw); } catch (_) { return []; }
    }
    return Array.isArray(arr) ? arr : [];
  }

  /**
   * Validate a weekly pattern. When `frequency` is given, the number of slots must
   * equal it. Each slot needs a weekday 0–6, a "HH:mm" time, and a non-empty
   * location. Returns { ok:true, slots } with normalized slots, or { ok:false, error }.
   * @param {*} slots JSON string or array
   * @param {*} [frequency]
   * @returns {{ok:boolean, slots?:Array, error?:string}}
   */
  function validateSlots(slots, frequency) {
    var arr = parseSlots(slots);
    if (frequency != null && String(frequency) !== '' && arr.length !== Number(frequency)) {
      return { ok: false, error: 'יש להגדיר ' + frequency + ' מועדים שבועיים' };
    }
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var s = arr[i] || {};
      if (s.weekday === '' || s.weekday == null) return { ok: false, error: 'יש לבחור יום בשבוע לכל מועד' };
      var wd = Number(s.weekday);
      if (!(wd >= 0 && wd <= 6) || String(Math.floor(wd)) !== String(wd)) return { ok: false, error: 'יום בשבוע לא תקין' };
      var time = String(s.time == null ? '' : s.time);
      if (!TIME_RE.test(time)) return { ok: false, error: 'שעה לא תקינה (לדוגמה 10:00)' };
      if (!String(s.location == null ? '' : s.location).trim()) return { ok: false, error: 'יש לבחור מיקום לכל מועד' };
      out.push({ weekday: wd, time: time, location: String(s.location).trim(), room: String(s.room == null ? '' : s.room).trim() });
    }
    return { ok: true, slots: out };
  }

  /**
   * Patient time-collision check. A patient cannot be in two treatments at the
   * same weekday+time (they can't be in two places at once), regardless of which
   * therapist or treatment type. Used when a therapist sets/edits the weekly
   * schedule for one of the patient's assignments.
   *
   * @param {object}  args
   * @param {Array}   args.candidateSlots  the slots being set, [{weekday,time,...}]
   * @param {Array}   args.otherAssignments the SAME patient's OTHER assignments
   *                  (exclude the one being edited), each with .slots
   * @returns {{ok:true} | {ok:false, error:string, weekday:number, time:string}}
   *   On conflict, returns the first offending weekday+time.
   */
  function patientSlotConflict(args) {
    args = args || {};
    var cand = parseSlots(args.candidateSlots);
    var others = Array.isArray(args.otherAssignments) ? args.otherAssignments : [];
    // Build a set of taken "weekday@time" keys from all OTHER assignments.
    var taken = {};
    others.forEach(function (a) {
      parseSlots(a && a.slots).forEach(function (s) {
        var wd = Number(s.weekday);
        var t = String(s.time == null ? '' : s.time);
        if (!isNaN(wd) && t) taken[wd + '@' + t] = true;
      });
    });
    for (var i = 0; i < cand.length; i++) {
      var wd2 = Number(cand[i].weekday);
      var t2 = String(cand[i].time == null ? '' : cand[i].time);
      if (!t2 || isNaN(wd2)) continue;
      if (taken[wd2 + '@' + t2]) {
        return { ok: false, error: 'המטופל/ת כבר משובץ/ת לטיפול אחר באותו יום ושעה', weekday: wd2, time: t2 };
      }
      // Also guard against a duplicate WITHIN the candidate set itself.
      for (var j = i + 1; j < cand.length; j++) {
        if (Number(cand[j].weekday) === wd2 && String(cand[j].time || '') === t2) {
          return { ok: false, error: 'שני מועדים זהים באותו יום ושעה', weekday: wd2, time: t2 };
        }
      }
    }
    return { ok: true };
  }

  /**
   * The DETERMINISTIC occurrence id — the idempotency key. Same assignment + date
   * + time always yields the same id, which becomes the Schedule row id and the
   * write-back treatmentId.
   * @param {string} assignmentId
   * @param {string} dateYmd 'YYYY-MM-DD'
   * @param {string} time 'HH:mm'
   * @returns {string}
   */
  function occurrenceId(assignmentId, dateYmd, time) {
    return 'occ_' + String(assignmentId) +
      '_' + String(dateYmd).replace(/-/g, '') +
      '_' + String(time).replace(/[^\d]/g, '');
  }

  /**
   * Generate the coming-week's VIRTUAL occurrences from active assignment patterns.
   * Rolling window [today, today+horizonDays]; each weekday resolves to its soonest
   * date in the window. Skips: inactive assignments, other therapists, stopped
   * patients, and any occurrence whose id already exists as a real Schedule row.
   *
   * @param {object} input
   *   - assignments: Array of {id, patientPhone, therapist, treatmentType, frequencyPerWeek, active, slots}
   *   - therapist:   only this therapist's assignments (omit/empty = all)
   *   - today:       'YYYY-MM-DD'
   *   - horizonDays: window length (default 7)
   *   - patientsByPhone: { normalizedPhone: { name } } for display names
   *   - stoppedPhones:   { normalizedPhone: true } — skipped (stop/discharge halts generation)
   *   - existingScheduleIds: { id: true } — already-materialized rows, dropped (idempotency)
   * @param {object} [phoneApi]
   * @returns {Array} virtual occurrence rows (shape mirrors a Schedule row + {recurring, assignmentId})
   */
  function generateOccurrences(input, phoneApi) {
    input = input || {};
    var P = phoneApi || Phone;
    var assignments = Array.isArray(input.assignments) ? input.assignments : [];
    var therapist = String(input.therapist == null ? '' : input.therapist);
    var today = String(input.today || '');
    if (!today) return [];
    var horizon = input.horizonDays != null ? Number(input.horizonDays) : 7;
    var patientsByPhone = input.patientsByPhone || {};
    var stopped = input.stoppedPhones || {};
    var existingIds = input.existingScheduleIds || {};

    // Each weekday → its soonest date in the rolling window (first wins).
    var start = _parseYmd(today);
    var dateByWeekday = {};
    for (var d = 0; d <= horizon; d++) {
      var dt = new Date(start.getFullYear(), start.getMonth(), start.getDate() + d);
      var wd = dt.getDay();
      if (dateByWeekday[wd] == null) dateByWeekday[wd] = _fmtYmd(dt);
    }

    var out = [];
    for (var i = 0; i < assignments.length; i++) {
      var a = assignments[i];
      if (!a) continue;
      if (String(a.active) === 'false') continue;
      if (therapist && String(a.therapist || '') !== therapist) continue;
      var key = P.normalizeForMatch(P.recoverStored(a.patientPhone));
      if (!key || stopped[key]) continue;                  // stop/discharge → no occurrences
      var slots = parseSlots(a.slots);
      for (var s = 0; s < slots.length; s++) {
        var slot = slots[s] || {};
        var date = dateByWeekday[Number(slot.weekday)];
        if (!date) continue;
        var time = String(slot.time || '');
        var id = occurrenceId(a.id, date, time);
        if (existingIds[id]) continue;                     // already a real row → no duplicate
        var pinfo = patientsByPhone[key] || {};
        out.push({
          id: id,
          sessionId: id,
          therapist: a.therapist || '',
          treatmentType: a.treatmentType || '',
          location: slot.location || '',
          room: slot.room || '',
          scheduledDate: date,
          time: time,
          patientName: pinfo.name || '',
          patientPhone: a.patientPhone || '',
          attendance: '',
          recurring: true,
          assignmentId: a.id
        });
      }
    }
    return out;
  }

  return {
    parseSlots: parseSlots,
    validateSlots: validateSlots,
    patientSlotConflict: patientSlotConflict,
    occurrenceId: occurrenceId,
    generateOccurrences: generateOccurrences
  };
});
