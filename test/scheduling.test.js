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

test('buildSessionRows: single patient -> one row, own gate + attendance', () => {
  const rows = Scheduling.buildSessionRows(
    { therapist: 'כנרת', treatmentType: 'פרטני כללי', location: 'ramot', scheduledDate: '2026-07-01' },
    [{ name: 'דנה', phone: '0501234567', gateStatus: 'clear' }],
    { sessionId: 'sess1', idFn: () => 'row1', now: '2026-06-11' }
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sessionId, 'sess1');
  assert.equal(rows[0].patientName, 'דנה');
  assert.equal(rows[0].location, 'ramot');
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

test('bucketMine: partitions into the four labeled buckets', () => {
  const rows = [
    { id: 'a', attendance: 'occurred', scheduledDate: '2026-06-01' },          // performed
    { id: 'b', attendance: 'missed',   scheduledDate: '2026-06-01' },          // not performed
    { id: 'c', attendance: '',         scheduledDate: '2026-06-10' },          // scheduled (past, unmarked)
    { id: 'd', attendance: '',         scheduledDate: TODAY },                 // scheduled (today)
    { id: 'e', attendance: '',         scheduledDate: '2026-06-20' }           // upcoming (future)
  ];
  const b = Scheduling.bucketMine(rows, TODAY);
  assert.deepEqual(b.performed.map((r) => r.id), ['a']);
  assert.deepEqual(b.notPerformed.map((r) => r.id), ['b']);
  assert.deepEqual(b.scheduled.map((r) => r.id), ['c', 'd']);
  assert.deepEqual(b.upcoming.map((r) => r.id), ['e']);
});

test('bucketMine: empty / missing dates land in scheduled, not upcoming', () => {
  const b = Scheduling.bucketMine([{ id: 'x', attendance: '', scheduledDate: '' }], TODAY);
  assert.deepEqual(b.scheduled.map((r) => r.id), ['x']);
  assert.equal(b.upcoming.length, 0);
});

test('multiple parallel treatments per patient — different therapists bucket independently', () => {
  // ONE patient (same phone) with two parallel treatments by two therapists.
  const all = [
    { id: 't1', patientPhone: '0501234567', therapist: 'כנרת', attendance: 'occurred', scheduledDate: '2026-06-05' },
    { id: 't2', patientPhone: '0501234567', therapist: 'חנן',  attendance: '',         scheduledDate: '2026-06-20' }
  ];
  // Each therapist's «המטופלים שלי» view is filtered to their own treatments.
  const kineret = Scheduling.bucketMine(all.filter((r) => r.therapist === 'כנרת'), TODAY);
  const hanan   = Scheduling.bucketMine(all.filter((r) => r.therapist === 'חנן'), TODAY);
  assert.deepEqual(kineret.performed.map((r) => r.id), ['t1']);
  assert.equal(kineret.upcoming.length, 0);
  assert.deepEqual(hanan.upcoming.map((r) => r.id), ['t2']);
  assert.equal(hanan.performed.length, 0);
});
