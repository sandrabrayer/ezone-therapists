'use strict';

/**
 * Unit tests for public/scheduling.js — the iteration-2 scheduling model.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * Locks shut the four things the redesign must get right:
 *   1. extensible active-flagged lists (Sheet-driven dropdowns), and that
 *      RETIRING an entry does not rewrite/break records that already use it;
 *   2. the group type is recognised (by flag, with a name fallback);
 *   3. one-row-per-patient-per-session rows share a sessionId but keep their own
 *      gate + attendance state;
 *   4. the debt gate runs PER PATIENT across a group — one debtor is blocked
 *      individually while the rest stay clear.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Scheduling = require('../public/scheduling');
const DebtGate = require('../public/debt-gate');

// --- active-flagged lists --------------------------------------------------

test('activeNames: active entries feed the dropdown, retired ones drop out', () => {
  const therapists = [
    { name: 'כנרת', active: 'true' },
    { name: 'דליה' },                       // empty active -> active by default
    { name: 'הילה', active: true },
    { name: 'עידו', active: 'false' },       // retired
    { name: 'איתן', active: 'TRUE' }
  ];
  assert.deepEqual(Scheduling.activeNames(therapists), ['כנרת', 'דליה', 'הילה', 'איתן']);
});

test('activeNames: a newly added name appears in the dropdown', () => {
  const before = [{ name: 'כנרת' }, { name: 'דליה' }];
  assert.ok(!Scheduling.activeNames(before).includes('מעיין'));
  const after = before.concat([{ name: 'מעיין', active: 'true' }]);
  assert.ok(Scheduling.activeNames(after).includes('מעיין'));
});

test('activeNames: de-dupes and preserves order; tolerates plain strings', () => {
  assert.deepEqual(Scheduling.activeNames(['חנן', 'חנן', 'מעיין']), ['חנן', 'מעיין']);
  assert.deepEqual(Scheduling.activeNames(null), []);
});

test('displayServiceType: relabels מרכז יום -> ליווי יומי בקהילה (display only)', () => {
  assert.equal(Scheduling.displayServiceType('מרכז יום'), 'ליווי יומי בקהילה');
  // Unmapped values pass through untouched; the stored value is never mutated.
  assert.equal(Scheduling.displayServiceType('פרטני כללי'), 'פרטני כללי');
  assert.equal(Scheduling.displayServiceType(''), '');
  assert.equal(Scheduling.displayServiceType(null), '');
});

test('retiring a therapist/type does NOT alter records that already reference it', () => {
  // A past row was saved with therapist 'עידו' and type 'פרטני EMDR'.
  const oldRow = { therapist: 'עידו', treatmentType: 'פרטני EMDR', patientName: 'דנה' };
  // Admin retires both in the Sheet.
  const therapists = [{ name: 'כנרת' }, { name: 'עידו', active: 'false' }];
  const types = [{ name: 'פרטני כללי' }, { name: 'פרטני EMDR', active: 'false' }];
  // Dropdowns no longer offer them...
  assert.ok(!Scheduling.activeNames(therapists).includes('עידו'));
  assert.ok(!Scheduling.activeNames(types).includes('פרטני EMDR'));
  // ...but the historical row is untouched (deactivation is dropdown-only).
  assert.equal(oldRow.therapist, 'עידו');
  assert.equal(oldRow.treatmentType, 'פרטני EMDR');
});

// --- group type recognition ------------------------------------------------

test('isGroupType: recognises קבוצה by name fallback', () => {
  assert.equal(Scheduling.isGroupType('קבוצה'), true);
  assert.equal(Scheduling.isGroupType('פרטני כללי'), false);
  assert.equal(Scheduling.isGroupType(''), false);
});

test('isGroupType: honours an explicit isGroup flag (robust to rename)', () => {
  const types = [
    { name: 'פרטני כללי', isGroup: 'false' },
    { name: 'מפגש קבוצתי', isGroup: 'true' }   // renamed group type, flagged
  ];
  assert.equal(Scheduling.isGroupType('מפגש קבוצתי', types), true);
  assert.equal(Scheduling.isGroupType('פרטני כללי', types), false);
});

// --- session row building --------------------------------------------------

test('buildSessionRows: single patient -> one row, own gate + attendance + time', () => {
  const rows = Scheduling.buildSessionRows(
    { therapist: 'כנרת', treatmentType: 'פרטני כללי', location: 'ramot', scheduledDate: '2026-07-01', time: '10:30' },
    [{ name: 'דנה', phone: '0501234567', gateStatus: 'clear' }],
    { sessionId: 'sess1', idFn: () => 'row1', now: '2026-06-11' }
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sessionId, 'sess1');
  assert.equal(rows[0].patientName, 'דנה');
  assert.equal(rows[0].location, 'ramot');
  assert.equal(rows[0].time, '10:30');             // time-of-day carried through
  assert.equal(rows[0].attendance, '');            // pending by default
  assert.equal(rows[0].gateStatus, 'clear');
  assert.equal(rows[0].created, '2026-06-11');
});

test('buildSessionRows: group -> many rows share sessionId, distinct ids/gates', () => {
  let n = 0;
  const rows = Scheduling.buildSessionRows(
    { therapist: 'חנן', treatmentType: 'קבוצה', location: 'asher', scheduledDate: '2026-07-02' },
    [
      { name: 'דנה', phone: '0501234567', gateStatus: 'clear' },
      { name: 'אורי', phone: '0502222222', gateStatus: 'approved', amountOwed: 400, approverId: 'ron' }
    ],
    { sessionId: 'sessG', idFn: () => 'r' + (++n) }
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].sessionId, 'sessG');
  assert.equal(rows[1].sessionId, 'sessG');
  assert.notEqual(rows[0].id, rows[1].id);
  assert.equal(rows[0].gateStatus, 'clear');
  assert.equal(rows[1].gateStatus, 'approved');
  assert.equal(rows[1].amountOwed, 400);
});

test('buildSessionRows: invalid attendance is normalised to pending', () => {
  const rows = Scheduling.buildSessionRows(
    { therapist: 'כנרת', treatmentType: 'פרטני כללי', location: 'ramot', scheduledDate: '2026-07-01' },
    [{ name: 'דנה', phone: '0501234567', attendance: 'maybe' }],
    { sessionId: 's', idFn: () => 'r' }
  );
  assert.equal(rows[0].attendance, '');
});

// --- per-patient gate across a group ---------------------------------------

const roster = [
  { name: 'אורי', phone: '0501234567', debtStatus: 'debt',  amountOwed: 400 },
  { name: 'דנה',  phone: '0502222222', debtStatus: 'clear', amountOwed: 0 },
  { name: 'נועה', phone: '0503333333', debtStatus: 'clear', amountOwed: 0 }
];

test('evaluateGroup: one debtor is blocked individually; the rest stay clear', () => {
  const results = Scheduling.evaluateGroup({
    patients: [
      { name: 'אורי', phone: '0501234567' }, // debt
      { name: 'דנה',  phone: '0502222222' }, // clear
      { name: 'נועה', phone: '0503333333' }  // clear
    ],
    roster: roster,
    rosterOk: true
  });
  assert.equal(results.length, 3);
  assert.equal(results[0].gate.decision, 'block');
  assert.equal(results[0].gate.amountOwed, 400);
  assert.equal(results[1].gate.decision, 'allow');
  assert.equal(results[2].gate.decision, 'allow');
});

test('evaluateGroup: the debtor never passes just because the group was checked', () => {
  const results = Scheduling.evaluateGroup({
    patients: [{ name: 'דנה', phone: '0502222222' }, { name: 'אורי', phone: '0501234567' }],
    roster: roster,
    rosterOk: true
  });
  const blocked = results.filter((r) => r.gate.decision === 'block');
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].name, 'אורי');
});

test('evaluateGroup: lookup failure flags every patient (never fail open)', () => {
  const results = Scheduling.evaluateGroup({
    patients: [{ name: 'דנה', phone: '0502222222' }],
    roster: null,
    rosterOk: false
  });
  assert.equal(results[0].gate.decision, 'flag');
  assert.equal(results[0].gate.reason, 'lookup_failed');
});

// --- «המטופלים שלי» four buckets -------------------------------------------

const TODAY = '2026-06-12';
const WEEK_END = '2026-06-19';   // today + 7 (the "coming week")

test('bucketMine: «קרובים» is the coming week (today..+7); else scheduled', () => {
  const rows = [
    { id: 'a', attendance: 'occurred', scheduledDate: '2026-06-01' },   // performed
    { id: 'b', attendance: 'missed',   scheduledDate: '2026-06-01' },   // not performed
    { id: 'c', attendance: '',         scheduledDate: '2026-06-10' },   // overdue → scheduled
    { id: 'd', attendance: '',         scheduledDate: TODAY },          // today → upcoming
    { id: 'e', attendance: '',         scheduledDate: WEEK_END },       // +7 boundary → upcoming
    { id: 'f', attendance: '',         scheduledDate: '2026-06-20' },   // +8 (beyond week) → scheduled
    { id: 'g', attendance: '',         scheduledDate: '2026-07-15' }    // far future → scheduled
  ];
  const b = Scheduling.bucketMine(rows, TODAY, WEEK_END);
  assert.deepEqual(b.performed.map((r) => r.id), ['a']);
  assert.deepEqual(b.notPerformed.map((r) => r.id), ['b']);
  assert.deepEqual(b.upcoming.map((r) => r.id), ['d', 'e']);
  assert.deepEqual(b.scheduled.map((r) => r.id), ['c', 'f', 'g']);
});

test('bucketMine: empty / missing dates land in scheduled, not upcoming', () => {
  const b = Scheduling.bucketMine([{ id: 'x', attendance: '', scheduledDate: '' }], TODAY, WEEK_END);
  assert.deepEqual(b.scheduled.map((r) => r.id), ['x']);
  assert.equal(b.upcoming.length, 0);
});

test('bucketMine: no weekEnd → any future date counts as upcoming', () => {
  const b = Scheduling.bucketMine([{ id: 'far', attendance: '', scheduledDate: '2026-09-01' }], TODAY);
  assert.deepEqual(b.upcoming.map((r) => r.id), ['far']);
});

test('multiple parallel treatments per patient — different therapists bucket independently', () => {
  // ONE patient (same phone) with two parallel treatments by two therapists.
  const all = [
    { id: 't1', patientPhone: '0501234567', therapist: 'כנרת', attendance: 'occurred', scheduledDate: '2026-06-05' },
    { id: 't2', patientPhone: '0501234567', therapist: 'חנן',  attendance: '',         scheduledDate: '2026-06-15' }
  ];
  // Each therapist's «המטופלים שלי» view is filtered to their own treatments.
  const kineret = Scheduling.bucketMine(all.filter((r) => r.therapist === 'כנרת'), TODAY, WEEK_END);
  const hanan   = Scheduling.bucketMine(all.filter((r) => r.therapist === 'חנן'), TODAY, WEEK_END);
  assert.deepEqual(kineret.performed.map((r) => r.id), ['t1']);
  assert.equal(kineret.upcoming.length, 0);
  assert.deepEqual(hanan.upcoming.map((r) => r.id), ['t2']);
  assert.equal(hanan.performed.length, 0);
});

// --- gate decision → persisted gateStatus ----------------------------------

test('gateStatusForDecision: allow→clear, block→approved, flag→flagged', () => {
  assert.equal(Scheduling.gateStatusForDecision('allow'), 'clear');
  assert.equal(Scheduling.gateStatusForDecision('block'), 'approved');
  assert.equal(Scheduling.gateStatusForDecision('flag'), 'flagged');
});

test('lookup_failed (debt endpoint unavailable) persists as flagged, never clear', () => {
  // The gate returns {decision:'flag', reason:'lookup_failed'} when debt can't be read…
  const gate = DebtGate.evaluate({ phone: '0501234567', rosterOk: false });
  assert.equal(gate.decision, 'flag');
  assert.equal(gate.reason, 'lookup_failed');
  // …and that saves as 'flagged' (manual resolution) — so scheduling is never a
  // dead-end retry when the debt endpoint is down.
  assert.equal(Scheduling.gateStatusForDecision(gate.decision), 'flagged');
});

// --- time slots + cancel guard (iteration 10) ------------------------------

test('timeSlots: 30-min slots 07:00..21:00 inclusive', () => {
  const slots = Scheduling.timeSlots('07:00', '21:00', 30);
  assert.equal(slots.length, 29);              // (21-7)*2 + 1
  assert.equal(slots[0], '07:00');
  assert.equal(slots[slots.length - 1], '21:00');
  assert.ok(slots.includes('07:30'));
  assert.ok(slots.includes('13:00'));
  assert.ok(!slots.includes('21:30'));         // stops at 21:00
});

test('canCancelBooking: only an unreported booking can be cancelled', () => {
  assert.equal(Scheduling.canCancelBooking({ attendance: '' }), true);
  assert.equal(Scheduling.canCancelBooking({ attendance: 'occurred' }), false);
  assert.equal(Scheduling.canCancelBooking({ attendance: 'missed' }), false);
  assert.equal(Scheduling.canCancelBooking(null), true);   // nothing reported
});
