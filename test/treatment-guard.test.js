'use strict';

/**
 * Unit tests for public/treatment-guard.js — the SERVER-AUTHORITATIVE save
 * policy mirrored inline in apps-script/Code.gs (_decideSave / _isAllowedApprover).
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * Two gaps these tests lock shut:
 *   1. approver allowlist — only Ron/Sandra may approve.
 *   2. trusted gateStatus — a forged 'clear'/'approved' for a debtor must be
 *      rejected against the live re-read; verification never fails open.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Guard = require('../public/treatment-guard');

test('isAllowedApprover: only Ron/Sandra, by id or Hebrew label', () => {
  assert.equal(Guard.isAllowedApprover('ron'), true);
  assert.equal(Guard.isAllowedApprover('sandra'), true);
  assert.equal(Guard.isAllowedApprover('רון'), true);
  assert.equal(Guard.isAllowedApprover('סנדרה'), true);
  assert.equal(Guard.isAllowedApprover('RON'), true);
  assert.equal(Guard.isAllowedApprover('yael'), false);
  assert.equal(Guard.isAllowedApprover('יעל'), false);
  assert.equal(Guard.isAllowedApprover(''), false);
  assert.equal(Guard.isAllowedApprover(null), false);
});

test('approved: requires an allowlisted approver', () => {
  assert.deepEqual(Guard.decideSave({ kind: 'outpatient', gateStatus: 'approved', approverId: 'ron', verification: 'block' }), { ok: true });
  assert.deepEqual(Guard.decideSave({ kind: 'outpatient', gateStatus: 'approved', approverId: 'סנדרה', verification: 'block' }), { ok: true });
  assert.deepEqual(Guard.decideSave({ kind: 'outpatient', gateStatus: 'approved', approverId: 'yael', verification: 'block' }), { ok: false, error: 'invalid_approver' });
  assert.deepEqual(Guard.decideSave({ kind: 'outpatient', gateStatus: 'approved', approverId: '', verification: 'block' }), { ok: false, error: 'invalid_approver' });
});

test('approved: valid approver but verification cannot confirm -> rejected (fail closed)', () => {
  assert.deepEqual(Guard.decideSave({ kind: 'outpatient', gateStatus: 'approved', approverId: 'ron', verification: 'flag' }), { ok: false, error: 'debt_verification_failed' });
  assert.deepEqual(Guard.decideSave({ kind: 'outpatient', gateStatus: 'approved', approverId: 'ron', verification: 'unavailable' }), { ok: false, error: 'debt_verification_unavailable' });
  assert.deepEqual(Guard.decideSave({ kind: 'outpatient', gateStatus: 'approved', approverId: 'ron', verification: 'unconfigured' }), { ok: false, error: 'debt_verification_unconfigured' });
  // debt cleared between check and save — approval is harmless, accepted
  assert.deepEqual(Guard.decideSave({ kind: 'outpatient', gateStatus: 'approved', approverId: 'ron', verification: 'allow' }), { ok: true });
});

test('clear: forged clear for a debtor is rejected by the live re-read', () => {
  // the bypass attempt: client claims clear, server re-read says owes -> block
  assert.deepEqual(Guard.decideSave({ kind: 'outpatient', gateStatus: 'clear', verification: 'block' }), { ok: false, error: 'debt_verification_failed' });
  // genuinely clear
  assert.deepEqual(Guard.decideSave({ kind: 'outpatient', gateStatus: 'clear', verification: 'allow' }), { ok: true });
  // could not determine (flag) -> rejected, never silently saved as clear
  assert.deepEqual(Guard.decideSave({ kind: 'outpatient', gateStatus: 'clear', verification: 'flag' }), { ok: false, error: 'debt_verification_failed' });
});

test('clear: verification unavailable / unconfigured -> rejected (never fail open)', () => {
  assert.deepEqual(Guard.decideSave({ kind: 'outpatient', gateStatus: 'clear', verification: 'unavailable' }), { ok: false, error: 'debt_verification_unavailable' });
  assert.deepEqual(Guard.decideSave({ kind: 'outpatient', gateStatus: 'clear', verification: 'unconfigured' }), { ok: false, error: 'debt_verification_unconfigured' });
});

test('empty gateStatus on an outpatient log is treated as a clear claim (must verify)', () => {
  assert.deepEqual(Guard.decideSave({ kind: 'outpatient', gateStatus: '', verification: 'block' }), { ok: false, error: 'debt_verification_failed' });
  assert.deepEqual(Guard.decideSave({ kind: 'outpatient', gateStatus: '', verification: 'allow' }), { ok: true });
});

test('flagged outpatient logs persist as-is (already marked for manual resolution)', () => {
  assert.deepEqual(Guard.decideSave({ kind: 'outpatient', gateStatus: 'flagged', verification: 'unconfigured' }), { ok: true });
  assert.deepEqual(Guard.decideSave({ kind: 'outpatient', gateStatus: 'flagged', verification: 'block' }), { ok: true });
});

test('inpatient logs are not debt-gated', () => {
  assert.deepEqual(Guard.decideSave({ kind: 'inpatient', gateStatus: '', verification: 'unconfigured' }), { ok: true });
  assert.deepEqual(Guard.decideSave({ kind: 'inpatient', gateStatus: 'clear', verification: 'unavailable' }), { ok: true });
});
