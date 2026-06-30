/**
 * export.js
 * ---------------------------------------------------------------------------
 * Per-therapist export to a spreadsheet-friendly CSV. Pure string-building so it
 * is unit-tested; the DOM download is wired in app.js.
 *
 * Two logical tables, emitted as ONE CSV with a blank separator row:
 *   1) המטופלים שלי — one row per (patient × treatment type): name, phone, type,
 *      frequency, therapist/framework, and the fixed weekly slots (day/time/
 *      location/room).
 *   2) מפגשים קרובים — one row per upcoming session: date, time, patient, type,
 *      location, room.
 *
 * Excel-on-Hebrew needs a UTF-8 BOM to render correctly; app.js prepends it.
 * IIFE: window.Exporter (browser) and module.exports (tests).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./recurring'));
  } else {
    root.Exporter = factory(root.Recurring);
  }
})(typeof self !== 'undefined' ? self : this, function (Recurring) {
  'use strict';

  var WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  // RFC-4180 CSV cell: wrap in quotes, double internal quotes. Always quote so
  // commas/newlines/RTL marks never break the row.
  function cell(v) {
    var s = (v == null) ? '' : String(v);
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function row(cells) { return cells.map(cell).join(','); }

  function slotText(slot, locationLabel) {
    var wd = WEEKDAYS[Number(slot.weekday)] || '';
    var parts = [];
    if (wd) parts.push(wd);
    if (slot.time) parts.push(slot.time);
    var loc = slot.location ? (locationLabel ? locationLabel(slot.location) : slot.location) : '';
    if (loc) parts.push(loc);
    if (slot.room) parts.push('חדר ' + slot.room);
    return parts.join(' · ');
  }

  /**
   * Build the CSV body (no BOM).
   * @param {object} args
   *   patients      : the therapist's patients, each {name, phone, planTypes[], assignments[]}
   *   sessions      : upcoming session rows {scheduledDate, time, patientName, treatmentType, location, room}
   *   therapistName : selected therapist (for the title row)
   *   svc           : (type)->label
   *   locationLabel : (code)->label
   *   freqUnit      : (type)->'שבוע'|'חודש'
   *   isFramework   : (type)->bool
   */
  function buildCsv(args) {
    args = args || {};
    var patients = args.patients || [];
    var sessions = args.sessions || [];
    var svc = args.svc || function (x) { return x; };
    var locationLabel = args.locationLabel || function (x) { return x; };
    var freqUnit = args.freqUnit || function () { return 'שבוע'; };
    var isFramework = args.isFramework || function () { return false; };

    var lines = [];
    lines.push(row(['המטופלים של: ' + (args.therapistName || '')]));
    lines.push(row(['הופק בתאריך', new Date().toLocaleString('he-IL')]));
    lines.push('');

    // Table 1 — patients × types.
    lines.push(row(['מטופל/ת', 'טלפון', 'סוג טיפול', 'תדירות', 'מטפל/ת / מסגרת', 'לוז שבועי קבוע']));
    patients.forEach(function (p) {
      var byType = {};
      (p.assignments || []).forEach(function (a) {
        if (a.treatmentType) byType[a.treatmentType] = a;
      });
      var types = (p.planTypes && p.planTypes.length)
        ? p.planTypes
        : (p.assignments || []).map(function (a) { return { treatmentType: a.treatmentType, frequencyPerWeek: a.frequencyPerWeek }; });
      types.forEach(function (t) {
        var a = byType[t.treatmentType] || {};
        var freq = (t.frequencyPerWeek || t.frequencyPerWeek === 0)
          ? (t.frequencyPerWeek + '/' + freqUnit(t.treatmentType)) : '';
        var who;
        if (isFramework(t.treatmentType)) {
          var locs = Recurring.parseSlots(a.slots)
            .map(function (s) { return s.location ? locationLabel(s.location) : ''; })
            .filter(Boolean);
          who = 'מסגרת' + (locs.length ? ' — ' + locs.join(' · ') : '');
        } else {
          who = a.therapist || 'טרם שובץ';
        }
        var slots = Recurring.parseSlots(a.slots)
          .map(function (s) { return slotText(s, locationLabel); })
          .filter(Boolean).join(' | ');
        lines.push(row([p.name, p.phone, svc(t.treatmentType), freq, who, slots]));
      });
    });

    lines.push('');
    // Table 2 — upcoming sessions.
    lines.push(row(['מפגשים קרובים']));
    lines.push(row(['תאריך', 'שעה', 'מטופל/ת', 'סוג טיפול', 'מיקום', 'חדר']));
    sessions.slice().sort(function (a, b) {
      return String(a.scheduledDate).localeCompare(String(b.scheduledDate));
    }).forEach(function (s) {
      lines.push(row([
        s.scheduledDate || '', s.time || '', s.patientName || '',
        svc(s.treatmentType || ''), s.location ? locationLabel(s.location) : '', s.room || ''
      ]));
    });

    return lines.join('\r\n');
  }

  function fileName(therapistName) {
    var safe = String(therapistName || 'מטפל').replace(/[\\/:"*?<>|]+/g, '_').trim();
    var d = new Date();
    var stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    return 'מטופלים_' + safe + '_' + stamp + '.csv';
  }

  return { buildCsv: buildCsv, fileName: fileName, _cell: cell, _slotText: slotText };
});
