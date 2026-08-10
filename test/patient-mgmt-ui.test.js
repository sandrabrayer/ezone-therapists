'use strict';

/**
 * Unit tests for the patient-management UI presentation helpers.
 *   - type/status label maps are complete and 1:1 with the canonical enums
 *   - status chip: active → no chip; frozen/ended → distinct muted classes
 *   - relative-date formatter: today / yesterday / N days / absolute fallback
 *   - contactPhone UI guard reuses the shared phone rule (empty ok, else canonical)
 *
 * Run with:  npm test     (Node >= 18, built-in test runner)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const UI = require('../public/patient-mgmt-ui.js');
const PM = require('../public/patient-mgmt.js');

// ---- Label maps: complete + 1:1 with the canonical enums ---------------------
test('TYPE_LABELS keys are exactly the NOTE_TYPES enum (1:1, complete)', () => {
  assert.deepEqual(Object.keys(UI.TYPE_LABELS).sort(), [...PM.NOTE_TYPES].sort());
  // Every label is a non-empty Hebrew string, and distinct.
  const labels = Object.values(UI.TYPE_LABELS);
  labels.forEach((l) => assert.ok(l && typeof l === 'string'));
  assert.equal(new Set(labels).size, labels.length, 'labels must be distinct');
});

test('STATUS_LABELS keys are exactly the PATIENT_STATUSES enum (1:1, complete)', () => {
  assert.deepEqual(Object.keys(UI.STATUS_LABELS).sort(), [...PM.PATIENT_STATUSES].sort());
  const labels = Object.values(UI.STATUS_LABELS);
  assert.equal(new Set(labels).size, labels.length, 'labels must be distinct');
});

test('typeLabel maps each enum key to its Hebrew label; unknown passes through', () => {
  assert.equal(UI.typeLabel('clinical'), 'קלינית');
  assert.equal(UI.typeLabel('admin'), 'אדמיניסטרטיבית');
  assert.equal(UI.typeLabel('family'), 'קשר עם משפחה');
  assert.equal(UI.typeLabel('other'), 'אחר');
  assert.equal(UI.typeLabel('mystery'), 'mystery');
});

test('statusLabel maps each enum key; unknown passes through', () => {
  assert.equal(UI.statusLabel('active'), 'פעיל');
  assert.equal(UI.statusLabel('continuing'), 'ממשיך לעוד חודש');
  assert.equal(UI.statusLabel('frozen'), 'מוקפא');
  assert.equal(UI.statusLabel('ended'), 'הסתיים');
  assert.equal(UI.statusLabel('weird'), 'weird');
});

// ---- Status chip -------------------------------------------------------------
test('statusChip: active (default) renders NO chip', () => {
  assert.equal(UI.statusChip('active').show, false);
  assert.equal(UI.statusChip('').show, false);
  assert.equal(UI.statusChip(null).show, false);
  assert.equal(UI.statusChip('unknown').show, false);
});

test('statusChip: continuing, frozen and ended render distinct chips', () => {
  const cont = UI.statusChip('continuing');
  const frozen = UI.statusChip('frozen');
  const ended = UI.statusChip('ended');
  assert.equal(cont.show, true);
  assert.equal(cont.label, 'ממשיך לעוד חודש');
  assert.ok(/cc-status-continuing/.test(cont.cls));
  assert.equal(frozen.show, true);
  assert.equal(frozen.label, 'מוקפא');
  assert.ok(/cc-status-frozen/.test(frozen.cls));
  assert.equal(ended.show, true);
  assert.equal(ended.label, 'הסתיים');
  assert.ok(/cc-status-ended/.test(ended.cls));
  // All three must use different classes.
  assert.equal(new Set([cont.cls, frozen.cls, ended.cls]).size, 3, 'each status must use a distinct class');
});

// ---- Relative date -----------------------------------------------------------
const NOW = '2026-08-10T12:00:00Z';

test('relativeDate: same UTC day → היום (incl. future clock-skew)', () => {
  assert.equal(UI.relativeDate('2026-08-10T09:30:00Z', NOW), 'היום');
  assert.equal(UI.relativeDate('2026-08-10T23:59:00Z', NOW), 'היום'); // later same day
  assert.equal(UI.relativeDate('2026-08-11T05:00:00Z', NOW), 'היום'); // future → clamped
});

test('relativeDate: yesterday → אתמול, two days → יומיים, N days → לפני N ימים', () => {
  assert.equal(UI.relativeDate('2026-08-09T12:00:00Z', NOW), 'אתמול');
  assert.equal(UI.relativeDate('2026-08-08T12:00:00Z', NOW), 'לפני יומיים');
  assert.equal(UI.relativeDate('2026-08-07T12:00:00Z', NOW), 'לפני 3 ימים');
  assert.equal(UI.relativeDate('2026-08-01T12:00:00Z', NOW), 'לפני 9 ימים');
});

test('relativeDate: ≥30 days → absolute DD/MM/YYYY', () => {
  assert.equal(UI.relativeDate('2026-07-01T12:00:00Z', NOW), '01/07/2026');
  assert.equal(UI.relativeDate('2025-12-25T00:00:00Z', NOW), '25/12/2025');
});

test('relativeDate: unparseable input returns its trimmed self, never null/undefined', () => {
  assert.equal(UI.relativeDate('  not-a-date  ', NOW), 'not-a-date');
  assert.equal(UI.relativeDate('', NOW), '');
  assert.equal(UI.relativeDate(null, NOW), '');
});

test('absoluteDateTime: DD/MM/YYYY HH:mm (UTC), fallback for garbage', () => {
  assert.equal(UI.absoluteDateTime('2026-08-09T07:05:00Z'), '09/08/2026 07:05');
  assert.equal(UI.absoluteDateTime('nope'), 'nope');
});

// ---- contactPhone guard (reuses the shared phone rule) -----------------------
test('contactPhoneError: empty/whitespace is allowed (optional field)', () => {
  assert.equal(UI.contactPhoneError(''), null);
  assert.equal(UI.contactPhoneError('   '), null);
  assert.equal(UI.contactPhoneError(null), null);
  assert.equal(UI.contactPhoneError(undefined), null);
});

test('contactPhoneError: a canonical number is valid', () => {
  assert.equal(UI.contactPhoneError('0501234567'), null);
  assert.equal(UI.contactPhoneError('0522223333'), null);
});

test('contactPhoneError: separators / 9-digit / +972 are rejected with a Hebrew message', () => {
  ['052-222-3333', '052 222 3333', '522223333', '+972522223333', '05222233334'].forEach((bad) => {
    const err = UI.contactPhoneError(bad);
    assert.ok(err && /טלפון/.test(err), `${bad} should be rejected with a Hebrew error`);
  });
});

// ---- Follow-up UI helpers ----------------------------------------------------
test('formatDate: a due date renders DD/MM/YYYY; garbage passes through trimmed', () => {
  assert.equal(UI.formatDate('2026-08-20'), '20/08/2026');
  assert.equal(UI.formatDate('2026-12-05'), '05/12/2026');
  assert.equal(UI.formatDate('  nope  '), 'nope');
  assert.equal(UI.formatDate(''), '');
});

test('overdueBadge: hidden at 0; shown with "מעקב באיחור" (count when > 1)', () => {
  assert.equal(UI.overdueBadge(0).show, false);
  assert.equal(UI.overdueBadge(null).show, false);
  const one = UI.overdueBadge(1);
  assert.equal(one.show, true);
  assert.equal(one.label, 'מעקב באיחור');
  assert.ok(/cc-followup-badge/.test(one.cls));
  const many = UI.overdueBadge(3);
  assert.equal(many.show, true);
  assert.ok(/3/.test(many.label), 'count shown when > 1');
});

test('isOverdue (UI re-export): due today is NOT overdue; yesterday is; done never', () => {
  const today = '2026-08-10';
  assert.equal(UI.isOverdue('2026-08-10', today, ''), false);
  assert.equal(UI.isOverdue('2026-08-09', today, ''), true);
  assert.equal(UI.isOverdue('2026-08-09', today, 'true'), false);
});

test('followUpError: blocks empty text and invalid due date, Hebrew messages', () => {
  assert.ok(/טקסט/.test(UI.followUpError('   ', '2026-08-20')));
  assert.ok(/תאריך/.test(UI.followUpError('להתקשר', '2026-02-30')));
  assert.ok(/תאריך/.test(UI.followUpError('להתקשר', '')));
  assert.equal(UI.followUpError('להתקשר', '2026-08-20'), null);
});
