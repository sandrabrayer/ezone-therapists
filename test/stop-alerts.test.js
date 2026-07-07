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

// ── action-inbox redesign: type (stop/resume) + status (unread/read/cancelled),
//    unread-only primary list, and a 14-day collapsed history ────────────────

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-07-15T12:00:00Z').getTime();   // fixed clock for windows

test('alertType reads the direction; legacy/blank/unknown → stop', () => {
  assert.equal(StopAlerts.alertType({ type: 'resume' }), 'resume');
  assert.equal(StopAlerts.alertType({ type: 'stop' }), 'stop');
  assert.equal(StopAlerts.alertType({ type: '  RESUME ' }), 'resume');   // case/space tolerant
  assert.equal(StopAlerts.alertType({ type: 'stopped' }), 'stop');       // unknown → stop
  assert.equal(StopAlerts.alertType({}), 'stop');                        // legacy blank
  assert.equal(StopAlerts.alertType(null), 'stop');
});

test('typeTitle gives the Hebrew direction title', () => {
  assert.equal(StopAlerts.typeTitle({ type: 'stop' }), 'עצירת טיפול');
  assert.equal(StopAlerts.typeTitle({ type: 'resume' }), 'חידוש טיפול');
  assert.equal(StopAlerts.typeTitle({}), 'עצירת טיפול');                 // legacy → stop title
});

test('statusOf: cancelled wins, explicit read/unread honoured, legacy derives from read', () => {
  assert.equal(StopAlerts.statusOf({ status: 'unread' }), 'unread');
  assert.equal(StopAlerts.statusOf({ status: 'read' }), 'read');
  assert.equal(StopAlerts.statusOf({ status: 'cancelled' }), 'cancelled');
  assert.equal(StopAlerts.statusOf({ status: 'canceled' }), 'cancelled');   // spelling tolerance
  assert.equal(StopAlerts.statusOf({ status: 'CANCELLED' }), 'cancelled');  // case tolerance
  assert.equal(StopAlerts.statusOf({ readAt: '2026-07-01' }), 'read');      // legacy read flag
  assert.equal(StopAlerts.statusOf({ read: true }), 'read');
  assert.equal(StopAlerts.statusOf({ status: 'stopped' }), 'unread');       // legacy status → derive
  assert.equal(StopAlerts.statusOf({ status: 'stopped', readAt: '2026-07-01' }), 'read');
  assert.equal(StopAlerts.statusOf({}), 'unread');
  assert.equal(StopAlerts.statusOf(null), 'unread');
});

test('inbox primary is UNREAD only — both directions, backend order preserved', () => {
  const alerts = [
    { id: 'u-stop', type: 'stop', status: 'unread' },
    { id: 'r', status: 'read', readAt: '2026-07-14T00:00:00Z' },
    { id: 'u-resume', type: 'resume', status: 'unread' },
    { id: 'c', status: 'cancelled', created: '2026-07-14T00:00:00Z' }
  ];
  const { primary } = StopAlerts.inbox(alerts, NOW);
  assert.deepEqual(primary.map((x) => x.id), ['u-stop', 'u-resume']);   // read + cancelled excluded
});

test('inbox history holds read + cancelled within 14 days; older rows are dropped', () => {
  const alerts = [
    { id: 'u', status: 'unread' },
    { id: 'r-recent', status: 'read', readAt: new Date(NOW - 5 * DAY).toISOString() },
    { id: 'r-old', status: 'read', readAt: new Date(NOW - 25 * DAY).toISOString() },
    { id: 'c-recent', status: 'cancelled', created: new Date(NOW - 10 * DAY).toISOString() },
    { id: 'c-old', status: 'cancelled', created: new Date(NOW - 40 * DAY).toISOString() }
  ];
  const { primary, history } = StopAlerts.inbox(alerts, NOW);
  assert.deepEqual(primary.map((x) => x.id), ['u']);
  assert.deepEqual(history.map((x) => x.id), ['r-recent', 'c-recent']);   // window keeps recent only
});

test('inbox window edge — exactly 14 days is kept, just past it is dropped', () => {
  const alerts = [
    { id: 'edge', status: 'read', readAt: new Date(NOW - 14 * DAY).toISOString() },
    { id: 'past', status: 'read', readAt: new Date(NOW - 14 * DAY - 1000).toISOString() }
  ];
  const { history } = StopAlerts.inbox(alerts, NOW);
  assert.deepEqual(history.map((x) => x.id), ['edge']);
});

test('inbox uses the NEWEST of created/readAt for the window', () => {
  // Created long ago but read yesterday → still inside the 14-day window.
  const alerts = [
    { id: 'x', status: 'read', created: new Date(NOW - 90 * DAY).toISOString(), readAt: new Date(NOW - 1 * DAY).toISOString() }
  ];
  assert.equal(StopAlerts.inbox(alerts, NOW).history.length, 1);
});

test('inbox with no clock keeps the whole history (no silent drop), tolerates non-array', () => {
  const all = StopAlerts.inbox([{ id: 'r', status: 'read', readAt: '2000-01-01' }], 0);
  assert.equal(all.history.length, 1);
  assert.deepEqual(StopAlerts.inbox(null), { primary: [], history: [] });
  assert.deepEqual(StopAlerts.inbox(undefined), { primary: [], history: [] });
});

test('unreadCount counts BOTH directions, excludes read + cancelled', () => {
  const alerts = [
    { status: 'unread', type: 'stop' },
    { status: 'unread', type: 'resume' },
    { status: 'read' },
    { status: 'cancelled' },
    { readAt: '2026-07-01' }        // legacy read
  ];
  assert.equal(StopAlerts.unreadCount(alerts), 2);
});

test('cancelled row: in history, never primary, and unread-count-invisible', () => {
  const c = { id: 'c', status: 'cancelled', created: new Date(NOW - 2 * DAY).toISOString() };
  const { primary, history } = StopAlerts.inbox([c], NOW);
  assert.equal(primary.length, 0);
  assert.deepEqual(history.map((x) => x.id), ['c']);
  assert.equal(StopAlerts.unreadCount([c]), 0);
});

test('mark-read → mark-unread round-trip moves a row between primary and history', () => {
  // Mirrors the optimistic app.js flips: status is the source of truth.
  const a = StopAlerts.normalize({ id: 'x', clientName: 'ד', type: 'stop', status: 'unread' });
  assert.equal(a.status, 'unread');
  assert.equal(StopAlerts.inbox([a], NOW).primary.length, 1);

  a.status = 'read'; a.read = true;                       // optimistic mark-read
  assert.equal(StopAlerts.statusOf(a), 'read');
  let inb = StopAlerts.inbox([a], NOW);
  assert.equal(inb.primary.length, 0);
  assert.equal(inb.history.length, 1);

  a.status = 'unread'; a.read = false; a.readAt = '';     // optimistic mark-unread
  assert.equal(StopAlerts.statusOf(a), 'unread');
  inb = StopAlerts.inbox([a], NOW);
  assert.equal(inb.primary.length, 1);
  assert.equal(inb.history.length, 0);
});

test('normalize carries type + canonical status; legacy payloads still resolve', () => {
  const n = StopAlerts.normalize({ id: 'r', clientName: 'ד', type: 'resume', status: 'unread', createdAt: '2026-07-05' });
  assert.equal(n.type, 'resume');
  assert.equal(n.status, 'unread');

  const legacy = StopAlerts.normalize({ id: 'l', clientName: 'ה', readAt: '2026-07-06' });
  assert.equal(legacy.type, 'stop');       // no type field → stop
  assert.equal(legacy.status, 'read');     // derived from readAt

  const cancelled = StopAlerts.normalize({ id: 'c', clientName: 'ו', type: 'stop', status: 'cancelled' });
  assert.equal(cancelled.status, 'cancelled');
});
