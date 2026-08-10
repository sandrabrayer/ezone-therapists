'use strict';

/**
 * Unit tests for the patient-management validation module + schema.
 *   - note type enum enforcement, empty-text rejection
 *   - phone accept/reject (exact /^0\d{9}$/), incl. separators / 9-digit / +972
 *   - leading-zero recovery round-trip (Sheets numeric value -> canonical ->
 *     matches the same normalization the roster uses)
 *   - meta: status enum, canonical-or-empty contactPhone, default active
 *   - header-order guard: the exact append-only column order, asserted on BOTH
 *     the pure module AND the apps-script/Code.gs inline mirror.
 *
 * Run with:  npm test     (Node >= 18, built-in test runner)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PM = require('../public/patient-mgmt.js');
const Phone = require('../public/phone.js');

// ---- Notes: type enum + text --------------------------------------------------
test('validateNote accepts every enum type with a canonical phone + text', () => {
  ['clinical', 'admin', 'family', 'other'].forEach((type) => {
    const r = PM.validateNote({ phone: '0501234567', author: 'ד"ר כהן', type, text: 'שיחה' });
    assert.equal(r.ok, true, `type ${type} should be accepted`);
    assert.equal(r.value.type, type);
    assert.equal(r.value.text, 'שיחה');
  });
});

test('validateNote rejects a type outside the enum', () => {
  ['urgent', 'CLINICAL', 'clinical ', '', null, 'note'].forEach((type) => {
    const r = PM.validateNote({ phone: '0501234567', type, text: 'x' });
    assert.equal(r.ok, false, `type ${JSON.stringify(type)} should be rejected`);
    assert.equal(r.error, 'invalid_type');
  });
});

test('validateNote rejects empty / whitespace-only text', () => {
  ['', '   ', '\n\t', null, undefined].forEach((text) => {
    const r = PM.validateNote({ phone: '0501234567', type: 'clinical', text });
    assert.equal(r.ok, false, `text ${JSON.stringify(text)} should be rejected`);
    assert.equal(r.error, 'empty_text');
  });
});

test('validateNote trims text + author but preserves inner content', () => {
  const r = PM.validateNote({ phone: '0501234567', type: 'admin', text: '  הערה  ', author: '  יעל  ' });
  assert.equal(r.ok, true);
  assert.equal(r.value.text, 'הערה');
  assert.equal(r.value.author, 'יעל');
});

// ---- Phone validation (the patient key) --------------------------------------
test('validateNote accepts ONLY an exact canonical 0XXXXXXXXX phone', () => {
  assert.equal(PM.validateNote({ phone: '0501234567', type: 'clinical', text: 'x' }).ok, true);
  assert.equal(PM.validateNote({ phone: '0523456789', type: 'clinical', text: 'x' }).ok, true);
});

test('validateNote rejects separators, 9-digit, and +972 phone shapes', () => {
  ['050-123-4567', '050 123 4567', '(050)1234567', '501234567', '+972501234567',
   '972501234567', '05012345678', '1234567890'].forEach((phone) => {
    const r = PM.validateNote({ phone, type: 'clinical', text: 'x' });
    assert.equal(r.ok, false, `phone ${phone} should be rejected`);
    assert.equal(r.error, 'invalid_phone');
  });
});

test('leading-zero recovery round-trip: Sheets numeric -> canonical -> matches roster normalization', () => {
  // Sheets drops the leading zero of a canonical number on a numeric cell:
  // "0501234567" is stored as the number 501234567.
  const stored = 501234567;
  const recovered = Phone.recoverStored(stored);
  assert.equal(recovered, '0501234567', 'recoverStored restores the dropped leading zero');
  // The recovered value is now accepted as a canonical note phone...
  assert.equal(PM.validateNote({ phone: recovered, type: 'clinical', text: 'x' }).ok, true);
  // ...and normalizes to the SAME key the roster uses to match a free-form number.
  assert.equal(Phone.normalizeForMatch(recovered), Phone.normalizeForMatch('050-123-4567'));
  assert.equal(Phone.normalizeForMatch(recovered), Phone.normalizeForMatch('+972501234567'));
});

// ---- Meta: status enum + contact phone + defaults ----------------------------
test('validateMeta defaults a blank status to active', () => {
  const r = PM.validateMeta({ phone: '0501234567', fields: {} });
  assert.equal(r.ok, true);
  assert.equal(r.value.status, 'active');
});

test('validateMeta accepts the status enum (incl. continuing) and rejects anything else', () => {
  ['active', 'continuing', 'frozen', 'ended'].forEach((status) => {
    assert.equal(PM.validateMeta({ phone: '0501234567', fields: { status } }).ok, true,
      `status ${status} should be accepted`);
  });
  ['paused', 'ACTIVE', 'continue', 'done', 'x'].forEach((status) => {
    const r = PM.validateMeta({ phone: '0501234567', fields: { status } });
    assert.equal(r.ok, false, `status ${status} should be rejected`);
    assert.equal(r.error, 'invalid_status');
  });
});

test('validateMeta: contactPhone must be canonical when present, empty allowed', () => {
  assert.equal(PM.validateMeta({ phone: '0501234567', fields: { contactPhone: '' } }).ok, true);
  assert.equal(PM.validateMeta({ phone: '0501234567', fields: { contactPhone: '0522223333' } }).ok, true);
  const bad = PM.validateMeta({ phone: '0501234567', fields: { contactPhone: '052-222-3333' } });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'invalid_contact_phone');
});

test('validateMeta rejects a non-canonical patient phone', () => {
  const r = PM.validateMeta({ phone: '501234567', fields: {} });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'invalid_phone');
});

test('validateMeta passes free-text fields through as strings', () => {
  const r = PM.validateMeta({ phone: '0501234567', fields: {
    status: 'frozen', statusReason: 'הפסקה זמנית', statusDate: '2026-08-01',
    contactName: 'אמא', contactPhone: '0522223333', referral: 'רווחה', goals: 'הפחתת חרדה'
  }});
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {
    phone: '0501234567', status: 'frozen', statusReason: 'הפסקה זמנית', statusDate: '2026-08-01',
    contactName: 'אמא', contactPhone: '0522223333', referral: 'רווחה', goals: 'הפחתת חרדה'
  });
});

test('defaultMeta returns empty defaults with status active', () => {
  assert.deepEqual(PM.defaultMeta('0501234567'), {
    phone: '0501234567', status: 'active', statusReason: '', statusDate: '',
    contactName: '', contactPhone: '', referral: '', goals: '', updatedBy: '', updatedAt: ''
  });
});

// ---- Header-order guard (append-only) -----------------------------------------
test('module header order is the exact append-only contract', () => {
  assert.deepEqual(PM.NOTES_HEADERS, ['phone', 'timestamp', 'author', 'type', 'text']);
  assert.deepEqual(PM.PATIENT_META_HEADERS, [
    'phone', 'status', 'statusReason', 'statusDate',
    'contactName', 'contactPhone', 'referral', 'goals',
    'updatedBy', 'updatedAt'
  ]);
});

test('apps-script/Code.gs declares the SAME header order (inline mirror)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

  function declaredArray(name) {
    const m = src.match(new RegExp('var\\s+' + name + '\\s*=\\s*(\\[[\\s\\S]*?\\])'));
    assert.ok(m, `Code.gs must declare ${name}`);
    // Extract the quoted string literals in order.
    return (m[1].match(/'([^']*)'/g) || []).map((s) => s.slice(1, -1));
  }

  assert.deepEqual(declaredArray('NOTES_HEADERS'), PM.NOTES_HEADERS,
    'Code.gs NOTES_HEADERS must match the module (exact order, append-only)');
  assert.deepEqual(declaredArray('PATIENT_META_HEADERS'), PM.PATIENT_META_HEADERS,
    'Code.gs PATIENT_META_HEADERS must match the module (exact order, append-only)');
  assert.deepEqual(declaredArray('FOLLOWUPS_HEADERS'), PM.FOLLOWUPS_HEADERS,
    'Code.gs FOLLOWUPS_HEADERS must match the module (exact order, append-only)');
});

// ---- Follow-up tasks (משימות מעקב) -------------------------------------------
test('FOLLOWUPS_HEADERS is the exact append-only contract', () => {
  assert.deepEqual(PM.FOLLOWUPS_HEADERS,
    ['phone', 'id', 'createdAt', 'createdBy', 'dueDate', 'text', 'done', 'doneAt', 'doneBy']);
});

test('isISODate accepts valid calendar dates, rejects malformed/impossible ones', () => {
  ['2026-08-10', '2026-01-01', '2026-12-31', '2024-02-29'].forEach((d) =>
    assert.equal(PM.isISODate(d), true, `${d} should be valid`));
  ['2026-13-01', '2026-00-10', '2026-02-30', '2026-8-10', '10/08/2026', '', '2026-08-10T00:00', 'nope', null]
    .forEach((d) => assert.equal(PM.isISODate(d), false, `${JSON.stringify(d)} should be invalid`));
});

test('validateFollowUp: canonical phone, non-empty text, valid ISO dueDate', () => {
  const ok = PM.validateFollowUp({ phone: '0501234567', createdBy: 'יעל', dueDate: '2026-08-20', text: '  להתקשר  ' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { phone: '0501234567', text: 'להתקשר', dueDate: '2026-08-20', createdBy: 'יעל' });

  assert.equal(PM.validateFollowUp({ phone: '050-1', dueDate: '2026-08-20', text: 'x' }).error, 'invalid_phone');
  assert.equal(PM.validateFollowUp({ phone: '0501234567', dueDate: '2026-08-20', text: '   ' }).error, 'empty_text');
  assert.equal(PM.validateFollowUp({ phone: '0501234567', dueDate: '2026-02-30', text: 'x' }).error, 'invalid_due_date');
  assert.equal(PM.validateFollowUp({ phone: '0501234567', dueDate: '', text: 'x' }).error, 'invalid_due_date');
});

test('isFollowUpOverdue: due BEFORE today = overdue; due today = NOT overdue; done = never', () => {
  const today = '2026-08-10';
  assert.equal(PM.isFollowUpOverdue('2026-08-09', today, ''), true, 'yesterday → overdue');
  assert.equal(PM.isFollowUpOverdue('2026-08-10', today, ''), false, 'today → NOT overdue (boundary)');
  assert.equal(PM.isFollowUpOverdue('2026-08-11', today, ''), false, 'tomorrow → not overdue');
  assert.equal(PM.isFollowUpOverdue('2026-08-09', today, 'true'), false, 'done → never overdue');
  assert.equal(PM.isFollowUpOverdue('', today, ''), false, 'missing date → not overdue');
});

test('followUpCounts: aggregates open/overdue per phone; excludes done; boundary at today', () => {
  const today = '2026-08-10';
  const rows = [
    { phone: '0501234567', dueDate: '2026-08-09', done: '' },   // overdue + open
    { phone: '0501234567', dueDate: '2026-08-10', done: '' },   // open, NOT overdue (today)
    { phone: '0501234567', dueDate: '2026-08-01', done: 'true' }, // done → excluded
    { phone: '0522223333', dueDate: '2026-08-15', done: '' }    // open, not overdue
  ];
  const c = PM.followUpCounts(rows, today);
  assert.deepEqual(c['0501234567'], { open: 2, overdue: 1 });
  assert.deepEqual(c['0522223333'], { open: 1, overdue: 0 });
  // A phone with only done tasks does not appear.
  assert.equal(PM.followUpCounts([{ phone: '0509999999', dueDate: '2026-01-01', done: 'true' }], today)['0509999999'], undefined);
});
