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

test('statusChip: frozen and ended render distinct muted chips', () => {
  const frozen = UI.statusChip('frozen');
  const ended = UI.statusChip('ended');
  assert.equal(frozen.show, true);
  assert.equal(frozen.label, 'מוקפא');
  assert.ok(/cc-status-frozen/.test(frozen.cls));
  assert.equal(ended.show, true);
  assert.equal(ended.label, 'הסתיים');
  assert.ok(/cc-status-ended/.test(ended.cls));
  assert.notEqual(frozen.cls, ended.cls, 'frozen and ended must use different classes');
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
