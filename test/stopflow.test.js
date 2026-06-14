'use strict';

/**
 * Unit tests for public/stopflow.js — the patient stop / discharge flow (sender).
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * Three contracts: recognise the discharged status / stopped patient, build the
 * canonical flagStop payload, and pick the future-unreported bookings to cancel.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const StopFlow = require('../public/stopflow');

test('isStoppedStatus: only the discharged status string', () => {
  assert.equal(StopFlow.isStoppedStatus('סיים טיפול'), true);
  assert.equal(StopFlow.isStoppedStatus('  סיים טיפול  '), true);  // trimmed
  assert.equal(StopFlow.isStoppedStatus('פעיל'), false);
  assert.equal(StopFlow.isStoppedStatus(''), false);
  assert.equal(StopFlow.isStoppedStatus(null), false);
});

test('isPatientStopped: discharged OR locally flagged', () => {
  assert.equal(StopFlow.isPatientStopped({ planStatus: 'סיים טיפול' }), true);
  assert.equal(StopFlow.isPatientStopped({ localStopped: true }), true);
  assert.equal(StopFlow.isPatientStopped({ localStopped: 'true' }), true);   // stored string
  assert.equal(StopFlow.isPatientStopped({ planStatus: 'פעיל', localStopped: 'false' }), false);
  assert.equal(StopFlow.isPatientStopped({}), false);
  assert.equal(StopFlow.isPatientStopped(null), false);
});

// --- buildFlagStopPayload: canonical phone out -----------------------------

test('buildFlagStopPayload: canonicalizes the phone and trims fields', () => {
  const r = StopFlow.buildFlagStopPayload({
    phone: '050-123-4567', name: '  אורי  ', reportedBy: ' כנרת ', note: ' עזב לעיר אחרת '
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.payload, {
    phone: '0501234567', name: 'אורי', reportedBy: 'כנרת', note: 'עזב לעיר אחרת'
  });
});

test('buildFlagStopPayload: +972 prefix becomes a leading zero', () => {
  const r = StopFlow.buildFlagStopPayload({ phone: '+972501234567', name: 'דנה' });
  assert.equal(r.ok, true);
  assert.equal(r.payload.phone, '0501234567');
});

test('buildFlagStopPayload: a non-canonical phone is rejected (never sent)', () => {
  const short = StopFlow.buildFlagStopPayload({ phone: '050123456' });   // 9 digits
  assert.equal(short.ok, false);
  assert.ok(short.error);
  assert.equal(StopFlow.buildFlagStopPayload({ phone: '' }).ok, false);
  assert.equal(StopFlow.buildFlagStopPayload({ phone: 'abc' }).ok, false);
});

test('buildFlagStopPayload: blank optional fields default to empty strings', () => {
  const r = StopFlow.buildFlagStopPayload({ phone: '0501234567' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.payload, { phone: '0501234567', name: '', reportedBy: '', note: '' });
});

// --- futureBookingsToCancel: today forward, unreported only ----------------

const TODAY = '2026-06-14';
const ROWS = [
  { id: 'past-done',    patientPhone: '0501234567', scheduledDate: '2026-06-01', attendance: 'occurred' },
  { id: 'past-pending', patientPhone: '0501234567', scheduledDate: '2026-06-10', attendance: '' },
  { id: 'today',        patientPhone: '0501234567', scheduledDate: '2026-06-14', attendance: '' },
  { id: 'future',       patientPhone: '050-123-4567', scheduledDate: '2026-06-20', attendance: '' }, // legacy phone form
  { id: 'future-done',  patientPhone: '0501234567', scheduledDate: '2026-06-25', attendance: 'missed' },
  { id: 'other',        patientPhone: '0521111111', scheduledDate: '2026-06-30', attendance: '' }
];

test('futureBookingsToCancel: cancels future unreported rows, keeps past + reported', () => {
  const ids = StopFlow.futureBookingIdsToCancel(ROWS, '0501234567', TODAY);
  assert.deepEqual(ids.sort(), ['future', 'today']);   // today forward, unreported, matching phone
});

test('futureBookingsToCancel: matches across legacy phone formats', () => {
  // The patient phone is canonical; a booking stored in a legacy free-form is
  // still the same line and gets cancelled.
  const ids = StopFlow.futureBookingIdsToCancel(ROWS, '+972 50 123 4567', TODAY);
  assert.ok(ids.indexOf('future') !== -1);
});

test('futureBookingsToCancel: never touches another patient', () => {
  const ids = StopFlow.futureBookingIdsToCancel(ROWS, '0501234567', TODAY);
  assert.equal(ids.indexOf('other'), -1);
});

test('futureBookingsToCancel: blank phone / today / rows → nothing', () => {
  assert.deepEqual(StopFlow.futureBookingIdsToCancel(ROWS, '', TODAY), []);
  assert.deepEqual(StopFlow.futureBookingIdsToCancel(ROWS, '0501234567', ''), []);
  assert.deepEqual(StopFlow.futureBookingIdsToCancel(null, '0501234567', TODAY), []);
});

test('futureBookingsToCancel: handles ISO datetime scheduledDate', () => {
  const rows = [{ id: 'iso', patientPhone: '0501234567', scheduledDate: '2026-06-20T10:00', attendance: '' }];
  assert.deepEqual(StopFlow.futureBookingIdsToCancel(rows, '0501234567', TODAY), ['iso']);
});
