'use strict';

/**
 * Unit tests for public/outcome.js — the three-state SESSION OUTCOME (step 2).
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * Locks shut the things the outcome storage must get right:
 *   1. EXACTLY THREE values are accepted (happened / therapist_cancelled /
 *      patient_no_show) and nothing else (incl. the old occurred/missed tokens);
 *   2. every stored outcome is STAMPED with the full session identity —
 *      patient, therapist, treatmentType, date, outcome, timestamp;
 *   3. it is storage-only — building an outcome computes no pay and produces no
 *      writeback shape (no `given`/`isPayment`/`rate` fields).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Outcome = require('../public/outcome');

function row(over) {
  return Object.assign({
    id: 'r1', sessionId: 's1', therapist: 'כנרת', treatmentType: 'פרטני כללי',
    location: 'ramot', scheduledDate: '2026-07-01', time: '10:00',
    patientName: 'דנה', patientPhone: '0501234567'
  }, over || {});
}

// --- the closed set of three values ----------------------------------------

test('exactly three outcomes are valid', () => {
  assert.deepEqual(Outcome.VALUES, ['happened', 'therapist_cancelled', 'patient_no_show']);
  assert.equal(Outcome.isValid('happened'), true);
  assert.equal(Outcome.isValid('therapist_cancelled'), true);
  assert.equal(Outcome.isValid('patient_no_show'), true);
});

test('everything else is rejected — incl. the legacy attendance tokens and empty', () => {
  ['', 'occurred', 'missed', 'cancelled', 'no_show', 'HAPPENED', null, undefined, ' happened ']
    .forEach((bad) => assert.equal(Outcome.isValid(bad), false, 'should reject ' + JSON.stringify(bad)));
});

test('buildOutcome rejects an invalid outcome', () => {
  const res = Outcome.buildOutcome(row(), 'occurred');
  assert.equal(res.ok, false);
  assert.equal(res.error, 'invalid_outcome');
});

test('buildOutcome rejects a row with no id', () => {
  const res = Outcome.buildOutcome({ patientName: 'x' }, 'happened');
  assert.equal(res.ok, false);
  assert.equal(res.error, 'missing_row');
});

// --- the stamp: every required field is recorded ---------------------------

test('a marked outcome is stamped with patient, therapist, type, date, outcome, timestamp', () => {
  const res = Outcome.buildOutcome(row(), 'therapist_cancelled', { now: '2026-07-01T08:30:00.000Z' });
  assert.equal(res.ok, true);
  const rec = res.record;
  assert.equal(rec.id, 'r1');
  assert.equal(rec.sessionId, 's1');
  assert.equal(rec.patientName, 'דנה');
  assert.equal(rec.patientPhone, '0501234567');
  assert.equal(rec.therapist, 'כנרת');
  assert.equal(rec.treatmentType, 'פרטני כללי');
  assert.equal(rec.scheduledDate, '2026-07-01');
  assert.equal(rec.outcome, 'therapist_cancelled');
  assert.equal(rec.outcomeAt, '2026-07-01T08:30:00.000Z');
});

test('timestamp defaults to an ISO string when not injected', () => {
  const rec = Outcome.buildOutcome(row(), 'happened').record;
  assert.match(rec.outcomeAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('sessionId falls back to the row id for a single (non-group) session', () => {
  const rec = Outcome.buildOutcome(row({ sessionId: '' }), 'patient_no_show').record;
  assert.equal(rec.sessionId, 'r1');
});

// --- a session can be marked, re-read, and re-marked -----------------------

test('re-marking yields the new outcome (last write wins), identity unchanged', () => {
  const r = row();
  const first = Outcome.buildOutcome(r, 'happened').record;
  const second = Outcome.buildOutcome(r, 'patient_no_show').record;
  assert.equal(first.outcome, 'happened');
  assert.equal(second.outcome, 'patient_no_show');
  assert.equal(first.id, second.id);
  assert.equal(first.patientName, second.patientName);
});

// --- storage-only: no pay / no writeback shape -----------------------------

test('the record carries NO pay/writeback fields (storage-only)', () => {
  const rec = Outcome.buildOutcome(row(), 'happened').record;
  ['given', 'isPayment', 'rate', 'isGroup'].forEach((k) =>
    assert.equal(k in rec, false, 'must not leak pay field ' + k));
});

// --- Hebrew labels (display-only) ------------------------------------------

test('labelFor maps tokens to Hebrew, unknowns to empty', () => {
  assert.equal(Outcome.labelFor('happened'), 'התקיים');
  assert.equal(Outcome.labelFor('therapist_cancelled'), 'המטפל ביטל / לא הגיע');
  assert.equal(Outcome.labelFor('patient_no_show'), 'המטופל לא הגיע');
  assert.equal(Outcome.labelFor('occurred'), '');
  assert.equal(Outcome.labelFor(''), '');
});
