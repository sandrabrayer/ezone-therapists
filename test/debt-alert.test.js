'use strict';

/**
 * Unit tests for public/debt-alert.js — the post-scheduling debt alert.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * A patient can fall into debt AFTER a treatment is booked. On every load we
 * re-check the live roster for upcoming, unmarked rows and surface the ones
 * that now owe — without false-alarming when debt can't be determined, and
 * without re-alerting on rows that were already approved or flagged.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const DebtAlert = require('../public/debt-alert');

const TODAY = '2026-06-11';

// 'אורי' has fallen into debt since his treatment was booked clear.
const roster = [
  { name: 'אורי', phone: '0501234567', debtStatus: 'debt',  amountOwed: 400 },
  { name: 'דנה',  phone: '0502222222', debtStatus: 'clear', amountOwed: 0 }
];

function row(over) {
  return Object.assign({
    id: 'r', sessionId: 's', patientName: 'אורי', patientPhone: '0501234567',
    scheduledDate: '2026-07-01', attendance: '', gateStatus: 'clear'
  }, over || {});
}

test('upcoming clear-booked patient who now owes -> alert', () => {
  const alerts = DebtAlert.evaluateAlerts({ rows: [row()], roster: roster, rosterOk: true, today: TODAY });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].patientName, 'אורי');
  assert.equal(alerts[0].amountOwed, 400);
});

test('a still-clear patient does not alert', () => {
  const r = row({ patientName: 'דנה', patientPhone: '0502222222' });
  assert.deepEqual(DebtAlert.evaluateAlerts({ rows: [r], roster: roster, rosterOk: true, today: TODAY }), []);
});

test('past or already-marked rows are settled -> no alert', () => {
  const past = row({ scheduledDate: '2026-05-01' });
  const occurred = row({ attendance: 'occurred' });
  const missed = row({ attendance: 'missed' });
  assert.deepEqual(DebtAlert.evaluateAlerts({ rows: [past, occurred, missed], roster: roster, rosterOk: true, today: TODAY }), []);
});

test('today counts as upcoming', () => {
  const r = row({ scheduledDate: TODAY });
  assert.equal(DebtAlert.evaluateAlerts({ rows: [r], roster: roster, rosterOk: true, today: TODAY }).length, 1);
});

test('already-approved debtor does not re-alert (debt was acknowledged)', () => {
  const r = row({ gateStatus: 'approved' });
  assert.deepEqual(DebtAlert.evaluateAlerts({ rows: [r], roster: roster, rosterOk: true, today: TODAY }), []);
});

test('already-flagged row is its own state -> no debt alert', () => {
  const r = row({ gateStatus: 'flagged' });
  assert.deepEqual(DebtAlert.evaluateAlerts({ rows: [r], roster: roster, rosterOk: true, today: TODAY }), []);
});

test('no live roster -> no alert (never false-alarm)', () => {
  assert.deepEqual(DebtAlert.evaluateAlerts({ rows: [row()], roster: null, rosterOk: false, today: TODAY }), []);
  assert.deepEqual(DebtAlert.evaluateAlerts({ rows: [row()], rosterOk: false, today: TODAY }), []);
});

test('only the debtor rows in a mixed group alert', () => {
  const rows = [
    row({ id: 'r1', patientName: 'אורי', patientPhone: '0501234567' }), // debt
    row({ id: 'r2', patientName: 'דנה',  patientPhone: '0502222222' })  // clear
  ];
  const alerts = DebtAlert.evaluateAlerts({ rows: rows, roster: roster, rosterOk: true, today: TODAY });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].id, 'r1');
});

test('isUpcomingUnmarked: helper boundary cases', () => {
  assert.equal(DebtAlert.isUpcomingUnmarked(row(), TODAY), true);
  assert.equal(DebtAlert.isUpcomingUnmarked(row({ scheduledDate: '2026-06-10' }), TODAY), false);
  assert.equal(DebtAlert.isUpcomingUnmarked(row({ attendance: 'occurred' }), TODAY), false);
  assert.equal(DebtAlert.isUpcomingUnmarked(null, TODAY), false);
});
