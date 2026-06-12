'use strict';

/**
 * Unit tests for public/writeback.js — the outpatient write-back payload.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * Locks shut the three things the write-back must get right:
 *   1. GROUP = ONE therapist-payment record at the group rate (not one per
 *      patient), while still capturing per-patient attendance;
 *   2. IDEMPOTENT by treatment id — rebuilding yields identical, stably-keyed
 *      records so a retry never double-counts; unmark/edit adjusts what's
 *      written so downstream pay can't drift;
 *   3. OFFLINE-SYNC — rows left 'pending' are reported for retry, never dropped.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const WB = require('../public/writeback');

function row(over) {
  return Object.assign({
    id: 'r1', sessionId: 's1', therapist: 'כנרת', treatmentType: 'פרטני כללי',
    location: 'ramot', scheduledDate: '2026-07-01', patientName: 'דנה',
    patientPhone: '0501234567', attendance: 'occurred', syncStatus: ''
  }, over || {});
}

// --- non-group: one patient = one payment ----------------------------------

test('non-group occurred -> single record that is the payment, given=true', () => {
  const wb = WB.buildSessionWriteback([row()], { isGroup: false });
  assert.equal(wb.records.length, 1);
  assert.equal(wb.records[0].treatmentId, 'r1');
  assert.equal(wb.records[0].isPayment, true);
  assert.equal(wb.records[0].given, true);
  assert.equal(WB.paymentRecords(wb).length, 1);
});

test('non-group missed/unmarked -> not given (no pay)', () => {
  assert.equal(WB.buildSessionWriteback([row({ attendance: 'missed' })], { isGroup: false }).records[0].given, false);
  assert.equal(WB.buildSessionWriteback([row({ attendance: '' })], { isGroup: false }).records[0].given, false);
});

// --- group: ONE payment record at the group rate ---------------------------

const groupRows = [
  row({ id: 'g1', sessionId: 'sg', patientName: 'דנה',  patientPhone: '0501111111', attendance: 'occurred', treatmentType: 'קבוצה' }),
  row({ id: 'g2', sessionId: 'sg', patientName: 'אורי', patientPhone: '0502222222', attendance: 'missed',   treatmentType: 'קבוצה' }),
  row({ id: 'g3', sessionId: 'sg', patientName: 'נועה', patientPhone: '0503333333', attendance: 'occurred', treatmentType: 'קבוצה' })
];

test('group -> exactly ONE therapist-payment record at the group rate', () => {
  const wb = WB.buildSessionWriteback(groupRows, { isGroup: true });
  const pay = WB.paymentRecords(wb);
  assert.equal(pay.length, 1);                       // not one per patient
  assert.equal(pay[0].treatmentId, 'sg');            // keyed by the session
  assert.equal(pay[0].rate, 'group');
  assert.equal(pay[0].patientName, '');              // it's the session, not a patient
});

test('group -> per-patient attendance still captured (one per patient)', () => {
  const wb = WB.buildSessionWriteback(groupRows, { isGroup: true });
  const attendance = wb.records.filter((r) => !r.isPayment);
  assert.equal(attendance.length, 3);
  assert.equal(attendance.find((r) => r.patientName === 'דנה').given, true);
  assert.equal(attendance.find((r) => r.patientName === 'אורי').given, false);
});

test('group payment given = session happened (any patient attended)', () => {
  assert.equal(WB.buildSessionWriteback(groupRows, { isGroup: true }).records.find((r) => r.isPayment).given, true);
  // everyone no-shows -> session not given -> no group pay
  const allMissed = groupRows.map((r) => row(Object.assign({}, r, { attendance: 'missed' })));
  assert.equal(WB.buildSessionWriteback(allMissed, { isGroup: true }).records.find((r) => r.isPayment).given, false);
});

// --- idempotency + drift ---------------------------------------------------

test('idempotent: rebuilding the same session yields identical records', () => {
  const a = WB.buildSessionWriteback(groupRows, { isGroup: true });
  const b = WB.buildSessionWriteback(groupRows, { isGroup: true });
  assert.deepEqual(a.records, b.records);
  // treatment ids are unique keys (no double-count on retry)
  const ids = a.records.map((r) => r.treatmentId);
  assert.equal(new Set(ids).size, ids.length);
});

test('unmarking a group patient adjusts that record AND the group payment', () => {
  // start: all attended -> payment given
  let rows = groupRows.map((r) => row(Object.assign({}, r, { attendance: 'occurred' })));
  assert.equal(WB.buildSessionWriteback(rows, { isGroup: true }).records.find((r) => r.isPayment).given, true);
  // unmark everyone -> payment must flip to not given
  rows = rows.map((r) => row(Object.assign({}, r, { attendance: '' })));
  const wb = WB.buildSessionWriteback(rows, { isGroup: true });
  assert.equal(wb.records.find((r) => r.isPayment).given, false);
  assert.ok(wb.records.filter((r) => !r.isPayment).every((r) => r.given === false));
});

test('empty / null session -> no payload', () => {
  assert.equal(WB.buildSessionWriteback([], { isGroup: false }), null);
  assert.equal(WB.buildSessionWriteback(null, {}), null);
});

// --- offline-sync ----------------------------------------------------------

test('sessionsNeedingSync: pending rows are reported, synced ones are not', () => {
  const rows = [
    row({ id: 'a', sessionId: 's1', syncStatus: 'pending' }),
    row({ id: 'b', sessionId: 's1', syncStatus: 'pending' }), // same session, de-duped
    row({ id: 'c', sessionId: 's2', syncStatus: 'synced' }),
    row({ id: 'd', sessionId: 's3', syncStatus: '' })
  ];
  assert.deepEqual(WB.sessionsNeedingSync(rows), ['s1']);
});

test('sessionsNeedingSync: nothing pending -> empty', () => {
  assert.deepEqual(WB.sessionsNeedingSync([row({ syncStatus: 'synced' })]), []);
  assert.deepEqual(WB.sessionsNeedingSync([]), []);
});
