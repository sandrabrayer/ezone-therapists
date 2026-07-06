'use strict';

/**
 * Unit tests for public/stop-alerts.js — the «עצירת טיפול» tab logic:
 * read/unread detection, the unread badge count, and the unread-first partition.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const StopAlerts = require('../public/stop-alerts');

test('isRead recognises the several read shapes', () => {
  assert.equal(StopAlerts.isRead({ read: true }), true);
  assert.equal(StopAlerts.isRead({ read: 'true' }), true);
  assert.equal(StopAlerts.isRead({ read: 'TRUE' }), true);
  assert.equal(StopAlerts.isRead({ read: '1' }), true);
  assert.equal(StopAlerts.isRead({ readAt: '2026-07-05T10:00:00Z' }), true);
  assert.equal(StopAlerts.isRead({ read: false }), false);
  assert.equal(StopAlerts.isRead({ read: '' }), false);
  assert.equal(StopAlerts.isRead({ read: 'false', readAt: '' }), false);
  assert.equal(StopAlerts.isRead({}), false);
  assert.equal(StopAlerts.isRead(null), false);
});

test('unreadCount counts only the unread alerts', () => {
  const alerts = [
    { id: 'a', read: false },
    { id: 'b', read: true },
    { id: 'c' },
    { id: 'd', readAt: '2026-07-01' }
  ];
  assert.equal(StopAlerts.unreadCount(alerts), 2);
  assert.equal(StopAlerts.unreadCount([]), 0);
  assert.equal(StopAlerts.unreadCount(null), 0);
  assert.equal(StopAlerts.unreadCount(undefined), 0);
});

test('partition puts unread first and keeps read as a separate group', () => {
  const alerts = [
    { id: 'a', read: false },
    { id: 'b', read: true },
    { id: 'c', read: false },
    { id: 'd', readAt: '2026-07-01' }
  ];
  const { unread, read } = StopAlerts.partition(alerts);
  assert.deepEqual(unread.map((x) => x.id), ['a', 'c']);
  assert.deepEqual(read.map((x) => x.id), ['b', 'd']);
});

test('partition is stable — input order preserved within each group', () => {
  const alerts = [
    { id: '1', read: false },
    { id: '2', read: false },
    { id: '3', read: true },
    { id: '4', read: false },
    { id: '5', read: true }
  ];
  const { unread, read } = StopAlerts.partition(alerts);
  assert.deepEqual(unread.map((x) => x.id), ['1', '2', '4']);
  assert.deepEqual(read.map((x) => x.id), ['3', '5']);
});

test('partition tolerates non-array input', () => {
  assert.deepEqual(StopAlerts.partition(null), { unread: [], read: [] });
  assert.deepEqual(StopAlerts.partition(undefined), { unread: [], read: [] });
});

test('reasonLabel maps each stable key to its Hebrew label', () => {
  assert.equal(StopAlerts.reasonLabel('no_payment'), 'חוסר תשלום');
  assert.equal(StopAlerts.reasonLabel('mismatch'), 'אי התאמה');
  assert.equal(StopAlerts.reasonLabel('other'), 'אחר');
});

test('reasonLabel is blank-tolerant — no chip for missing/unknown reasons', () => {
  assert.equal(StopAlerts.reasonLabel(''), '');
  assert.equal(StopAlerts.reasonLabel(null), '');
  assert.equal(StopAlerts.reasonLabel(undefined), '');
  assert.equal(StopAlerts.reasonLabel('legacy_reason'), '');
  assert.equal(StopAlerts.reasonLabel('paid'), '');
});

test('reasonLabel tolerates whitespace and case (keys stay stable on the wire)', () => {
  assert.equal(StopAlerts.reasonLabel('  no_payment  '), 'חוסר תשלום');
  assert.equal(StopAlerts.reasonLabel('MISMATCH'), 'אי התאמה');
  assert.equal(StopAlerts.reasonLabel('Other'), 'אחר');
});

test('normalize maps a realistic outpatient payload — clientName becomes the name', () => {
  // The outpatient backend stores the patient name as `clientName` and the
  // timestamp as `createdAt`. Regression: the card must NOT render a nameless «—».
  const raw = {
    id: 'row-42',
    clientId: 'c-7',
    clientName: 'דנה כהן',
    createdAt: '2026-07-05T09:30:00Z',
    status: 'stopped',
    reason: 'no_payment',
    note: 'שלושה חודשים ללא תשלום'
  };
  const n = StopAlerts.normalize(raw);
  assert.equal(n.patientName, 'דנה כהן');   // was '' before clientName was added
  assert.equal(n.id, 'row-42');
  assert.equal(n.created, '2026-07-05T09:30:00Z');
  assert.equal(n.reason, 'no_payment');      // stable key kept verbatim
  assert.equal(n.note, 'שלושה חודשים ללא תשלום');
  assert.equal(n.read, false);
});

test('normalize keeps the older name aliases and tolerates a missing name', () => {
  assert.equal(StopAlerts.normalize({ patientName: 'א' }).patientName, 'א');
  assert.equal(StopAlerts.normalize({ name: 'ב' }).patientName, 'ב');
  assert.equal(StopAlerts.normalize({ patient: 'ג' }).patientName, 'ג');
  assert.equal(StopAlerts.normalize({ clientId: 'c-1' }).patientName, '');
  assert.equal(StopAlerts.normalize(null).patientName, '');
});

test('normalize derives read/readAt from a read payload', () => {
  const n = StopAlerts.normalize({ id: 'x', clientName: 'ד', readAt: '2026-07-06T00:00:00Z' });
  assert.equal(n.read, true);
  assert.equal(n.readAt, '2026-07-06T00:00:00Z');
});
