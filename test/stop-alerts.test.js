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
