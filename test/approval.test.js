'use strict';

/**
 * Unit tests for public/approval.js — the debtor-override stamp.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * Only רון / סנדרה may approve; the stamp must capture a full audit trail.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Approval = require('../public/approval');

const FIXED = new Date('2026-06-10T09:30:00.000Z');
const base = {
  patientName: 'אורי',
  patientPhone: '0501234567',
  therapist: 'יעל',
  amountOwed: 400,
  now: () => FIXED
};

test('resolveApprover accepts id or Hebrew label, rejects others', () => {
  assert.equal(Approval.resolveApprover('ron').id, 'ron');
  assert.equal(Approval.resolveApprover('רון').id, 'ron');
  assert.equal(Approval.resolveApprover('sandra').id, 'sandra');
  assert.equal(Approval.resolveApprover('סנדרה').id, 'sandra');
  assert.equal(Approval.resolveApprover('someone else'), null);
  assert.equal(Approval.resolveApprover(''), null);
  assert.equal(Approval.resolveApprover(null), null);
});

test('buildApproval: valid Ron approval is fully stamped', () => {
  const r = Approval.buildApproval(Object.assign({ approver: 'ron', note: 'שילם במזומן' }, base));
  assert.equal(r.ok, true);
  assert.deepEqual(r.approval, {
    approverId: 'ron',
    approverName: 'רון',
    patientName: 'אורי',
    patientPhone: '0501234567',
    therapist: 'יעל',
    note: 'שילם במזומן',
    amountOwed: 400,
    approvedAt: '2026-06-10T09:30:00.000Z'
  });
});

test('buildApproval: Sandra via Hebrew label works; note optional', () => {
  const r = Approval.buildApproval(Object.assign({ approver: 'סנדרה' }, base));
  assert.equal(r.ok, true);
  assert.equal(r.approval.approverId, 'sandra');
  assert.equal(r.approval.note, '');
});

test('buildApproval: anyone but Ron/Sandra is rejected', () => {
  const r = Approval.buildApproval(Object.assign({ approver: 'יעל' }, base));
  assert.equal(r.ok, false);
  assert.match(r.error, /רון|סנדרה/);
});

test('buildApproval: missing patient/therapist fields are rejected', () => {
  assert.equal(Approval.buildApproval({ approver: 'ron', patientPhone: '0501234567', therapist: 'יעל' }).ok, false);
  assert.equal(Approval.buildApproval({ approver: 'ron', patientName: 'אורי', therapist: 'יעל' }).ok, false);
  assert.equal(Approval.buildApproval({ approver: 'ron', patientName: 'אורי', patientPhone: '0501234567' }).ok, false);
});
