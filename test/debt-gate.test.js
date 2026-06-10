'use strict';

/**
 * Unit tests for public/debt-gate.js — the never-fail-open tri-state gate.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * Five outcomes; exactly one allows a silent save. Everything else blocks or
 * flags. "Couldn't determine" must NEVER become "allow".
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const DebtGate = require('../public/debt-gate');

const roster = [
  { name: 'אורי',  phone: '050-1234567',   debtStatus: 'debt',    amountOwed: 400 },
  { name: 'דנה',   phone: '+972527654321', debtStatus: 'clear',   amountOwed: 0 },
  { name: 'מאיה',  phone: '054-1111111',   debtStatus: 'unknown', amountOwed: 0 },
  { name: 'נועה',  phone: '050-9999999',   debtStatus: 'clear',   amountOwed: 0 },
  { name: 'נועה ב', phone: '0509999999',   debtStatus: 'debt',    amountOwed: 250 } // duplicate phone
];

test('clear + exactly one match -> allow', () => {
  const r = DebtGate.evaluate({ phone: '0527654321', roster: roster });
  assert.equal(r.decision, 'allow');
  assert.equal(r.reason, 'clear');
  assert.equal(r.matchCount, 1);
});

test('debt + exactly one match -> block, carries amountOwed', () => {
  const r = DebtGate.evaluate({ phone: '0501234567', roster: roster });
  assert.equal(r.decision, 'block');
  assert.equal(r.reason, 'owes');
  assert.equal(r.amountOwed, 400);
  assert.equal(r.match.name, 'אורי');
});

test('unknown (client exists, zero payment rows) -> flag, never allow', () => {
  const r = DebtGate.evaluate({ phone: '0541111111', roster: roster });
  assert.equal(r.decision, 'flag');
  assert.equal(r.reason, 'no_payment_record');
});

test('phone matches no client -> flag (no record)', () => {
  const r = DebtGate.evaluate({ phone: '0500000000', roster: roster });
  assert.equal(r.decision, 'flag');
  assert.equal(r.reason, 'no_record');
  assert.equal(r.matchCount, 0);
});

test('phone matches more than one client -> flag (ambiguous)', () => {
  const r = DebtGate.evaluate({ phone: '0509999999', roster: roster });
  assert.equal(r.decision, 'flag');
  assert.equal(r.reason, 'ambiguous');
  assert.equal(r.matchCount, 2);
});

test('lookup failed / roster missing -> flag, never allow', () => {
  assert.equal(DebtGate.evaluate({ phone: '0501234567', rosterOk: false }).reason, 'lookup_failed');
  assert.equal(DebtGate.evaluate({ phone: '0501234567', roster: null }).decision, 'flag');
  assert.equal(DebtGate.evaluate({ phone: '0501234567' }).decision, 'flag');
});

test('matching tolerates legacy formats on the roster side', () => {
  // roster has "050-1234567"; our canonical key is "0501234567"
  const r = DebtGate.evaluate({ phone: '0501234567', roster: roster });
  assert.equal(r.match.name, 'אורי');
  // roster has "+972527654321"; canonical "0527654321"
  assert.equal(DebtGate.evaluate({ phone: '0527654321', roster: roster }).decision, 'allow');
});

test('findMatches returns every hit (so the gate can see ambiguity)', () => {
  assert.equal(DebtGate.findMatches('0509999999', roster).length, 2);
  assert.equal(DebtGate.findMatches('0501234567', roster).length, 1);
  assert.equal(DebtGate.findMatches('0500000000', roster).length, 0);
});
