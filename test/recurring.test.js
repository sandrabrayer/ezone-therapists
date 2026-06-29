'use strict';

/**
 * Unit tests for public/recurring.js — the weekly recurring pattern → occurrences.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Recurring = require('../public/recurring');

// 2026-06-14 is a SUNDAY (weekday 0). The rolling 7-day window from it is
// Sun 06-14 .. Sun 06-21, so each weekday 0–6 resolves to its first date:
//   0→06-14, 1→06-15, 2→06-16, 3→06-17, 4→06-18, 5→06-19, 6→06-20
const TODAY = '2026-06-14';

function cbt3(extra) {
  // CBT 3×/week: Sun 10:00, Tue 10:00, Thu 10:00 at רעננה אשר.
  return Object.assign({
    id: 'a1', patientPhone: '0501234567', therapist: 'כנרת',
    treatmentType: 'פרטני CBT', frequencyPerWeek: '3', active: 'true',
    slots: JSON.stringify([
      { weekday: 0, time: '10:00', location: 'raanana_asher' },
      { weekday: 2, time: '10:00', location: 'raanana_asher' },
      { weekday: 4, time: '10:00', location: 'raanana_asher' }
    ])
  }, extra || {});
}

const NAMES = { '0501234567': { name: 'אורי' } };

// --- validateSlots ---------------------------------------------------------

test('validateSlots: N slots must equal frequency', () => {
  const two = [{ weekday: 0, time: '10:00', location: 'x' }, { weekday: 2, time: '10:00', location: 'x' }];
  assert.equal(Recurring.validateSlots(two, 3).ok, false);
  assert.equal(Recurring.validateSlots(two, 2).ok, true);
});

test('validateSlots: each slot needs weekday 0-6, HH:mm time, location', () => {
  assert.equal(Recurring.validateSlots([{ weekday: '', time: '10:00', location: 'x' }], 1).ok, false);
  assert.equal(Recurring.validateSlots([{ weekday: 7, time: '10:00', location: 'x' }], 1).ok, false);
  assert.equal(Recurring.validateSlots([{ weekday: 1, time: '1000', location: 'x' }], 1).ok, false);
  assert.equal(Recurring.validateSlots([{ weekday: 1, time: '10:00', location: '' }], 1).ok, false);
  const ok = Recurring.validateSlots([{ weekday: 1, time: '10:00', location: 'x' }], 1);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.slots, [{ weekday: 1, time: '10:00', location: 'x', room: '' }]);
});

test('validateSlots: room (free text) is preserved and trimmed; optional', () => {
  const ok = Recurring.validateSlots([{ weekday: 2, time: '11:00', location: 'rehab', room: '  חדר 3 ' }], 1);
  assert.equal(ok.ok, true);
  assert.equal(ok.slots[0].room, 'חדר 3');
  // No room provided → empty string, still valid (room is optional).
  const ok2 = Recurring.validateSlots([{ weekday: 2, time: '11:00', location: 'rehab' }], 1);
  assert.equal(ok2.ok, true);
  assert.equal(ok2.slots[0].room, '');
});

test('validateSlots: weekday 0 (Sunday) is valid, not treated as missing', () => {
  assert.equal(Recurring.validateSlots([{ weekday: 0, time: '09:30', location: 'x' }], 1).ok, true);
});

// --- occurrenceId ----------------------------------------------------------

test('occurrenceId: deterministic and stable', () => {
  assert.equal(Recurring.occurrenceId('a1', '2026-06-16', '10:00'), 'occ_a1_20260616_1000');
  assert.equal(
    Recurring.occurrenceId('a1', '2026-06-16', '10:00'),
    Recurring.occurrenceId('a1', '2026-06-16', '10:00')
  );
});

// --- generateOccurrences: pattern → weekly occurrences ----------------------

test('generateOccurrences: N slots → N dated occurrences on the right weekdays', () => {
  const occ = Recurring.generateOccurrences({
    assignments: [cbt3()], therapist: 'כנרת', today: TODAY, patientsByPhone: NAMES
  });
  assert.equal(occ.length, 3);
  const byDate = {};
  occ.forEach(o => { byDate[o.scheduledDate] = o; });
  assert.deepEqual(Object.keys(byDate).sort(), ['2026-06-14', '2026-06-16', '2026-06-18']); // Sun, Tue, Thu
  const sun = byDate['2026-06-14'];
  assert.equal(sun.id, 'occ_a1_20260614_1000');
  assert.equal(sun.patientName, 'אורי');
  assert.equal(sun.patientPhone, '0501234567');
  assert.equal(sun.treatmentType, 'פרטני CBT');
  assert.equal(sun.location, 'raanana_asher');
  assert.equal(sun.time, '10:00');
  assert.equal(sun.attendance, '');
  assert.equal(sun.recurring, true);
  assert.equal(sun.assignmentId, 'a1');
  assert.equal(sun.sessionId, sun.id);
});

test('generateOccurrences: only the named therapist, only active assignments', () => {
  assert.equal(Recurring.generateOccurrences({ assignments: [cbt3()], therapist: 'דנה', today: TODAY }).length, 0);
  assert.equal(Recurring.generateOccurrences({ assignments: [cbt3({ active: 'false' })], therapist: 'כנרת', today: TODAY }).length, 0);
  assert.equal(Recurring.generateOccurrences({ assignments: [cbt3({ slots: '' })], therapist: 'כנרת', today: TODAY }).length, 0);
});

test('generateOccurrences: IDEMPOTENT — an occurrence already a real row is dropped', () => {
  const all = Recurring.generateOccurrences({ assignments: [cbt3()], therapist: 'כנרת', today: TODAY, patientsByPhone: NAMES });
  // Pretend the Tuesday one was already reported (a real Schedule row exists).
  const existing = {}; existing['occ_a1_20260616_1000'] = true;
  const again = Recurring.generateOccurrences({
    assignments: [cbt3()], therapist: 'כנרת', today: TODAY, patientsByPhone: NAMES, existingScheduleIds: existing
  });
  assert.equal(all.length, 3);
  assert.equal(again.length, 2);
  assert.equal(again.some(o => o.id === 'occ_a1_20260616_1000'), false);
});

test('generateOccurrences: re-running yields identical ids (no dupes on re-view)', () => {
  const a = Recurring.generateOccurrences({ assignments: [cbt3()], therapist: 'כנרת', today: TODAY });
  const b = Recurring.generateOccurrences({ assignments: [cbt3()], therapist: 'כנרת', today: TODAY });
  assert.deepEqual(a.map(o => o.id).sort(), b.map(o => o.id).sort());
});

test('generateOccurrences: a STOPPED patient produces no occurrences', () => {
  const occ = Recurring.generateOccurrences({
    assignments: [cbt3()], therapist: 'כנרת', today: TODAY,
    patientsByPhone: NAMES, stoppedPhones: { '0501234567': true }
  });
  assert.equal(occ.length, 0);
});

test('report lifecycle: an occurrence reported once keeps its id and is not re-generated', () => {
  // 1) Generate the week's occurrences.
  const first = Recurring.generateOccurrences({ assignments: [cbt3()], therapist: 'כנרת', today: TODAY, patientsByPhone: NAMES });
  const sun = first.find(o => o.scheduledDate === '2026-06-14');
  // 2) Reporting materializes a real Schedule row keyed by the SAME deterministic
  //    id (= write-back treatmentId), so reporting/write-back is idempotent.
  assert.equal(sun.id, Recurring.occurrenceId('a1', '2026-06-14', '10:00'));
  const existing = {}; existing[sun.id] = true;
  // 3) Re-viewing the week no longer emits that occurrence (the real row shows).
  const after = Recurring.generateOccurrences({
    assignments: [cbt3()], therapist: 'כנרת', today: TODAY, patientsByPhone: NAMES, existingScheduleIds: existing
  });
  assert.equal(after.some(o => o.id === sun.id), false);
  assert.equal(after.length, first.length - 1);
});

test('generateOccurrences: matches a stopped patient across legacy phone forms', () => {
  // assignment phone canonical, stop key from a legacy free-form / mangled form.
  const occ = Recurring.generateOccurrences({
    assignments: [cbt3()], therapist: 'כנרת', today: TODAY,
    stoppedPhones: { '0501234567': true }
  });
  assert.equal(occ.length, 0);
});

// --- patientSlotConflict: a patient can't be in two treatments at once -------

test('patientSlotConflict: same weekday+time on another assignment is blocked', () => {
  const res = Recurring.patientSlotConflict({
    candidateSlots: [{ weekday: 1, time: '10:00', location: 'x' }],
    otherAssignments: [{ id: 'a2', slots: [{ weekday: 1, time: '10:00', location: 'y' }] }]
  });
  assert.equal(res.ok, false);
  assert.equal(res.weekday, 1);
  assert.equal(res.time, '10:00');
});

test('patientSlotConflict: different time on same weekday is allowed', () => {
  const res = Recurring.patientSlotConflict({
    candidateSlots: [{ weekday: 1, time: '11:00', location: 'x' }],
    otherAssignments: [{ id: 'a2', slots: [{ weekday: 1, time: '10:00', location: 'y' }] }]
  });
  assert.equal(res.ok, true);
});

test('patientSlotConflict: different weekday same time is allowed', () => {
  const res = Recurring.patientSlotConflict({
    candidateSlots: [{ weekday: 2, time: '10:00', location: 'x' }],
    otherAssignments: [{ id: 'a2', slots: [{ weekday: 1, time: '10:00', location: 'y' }] }]
  });
  assert.equal(res.ok, true);
});

test('patientSlotConflict: duplicate within the candidate set itself is blocked', () => {
  const res = Recurring.patientSlotConflict({
    candidateSlots: [
      { weekday: 3, time: '09:00', location: 'x' },
      { weekday: 3, time: '09:00', location: 'x' }
    ],
    otherAssignments: []
  });
  assert.equal(res.ok, false);
  assert.equal(res.weekday, 3);
});

test('patientSlotConflict: no other assignments → always ok', () => {
  assert.equal(Recurring.patientSlotConflict({
    candidateSlots: [{ weekday: 0, time: '08:00', location: 'x' }], otherAssignments: []
  }).ok, true);
});
