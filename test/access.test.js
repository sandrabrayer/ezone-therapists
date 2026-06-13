'use strict';

/**
 * Unit tests for public/access.js — the name-pick role access rules (iteration 7).
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * Locks in: Vered (office) sees דשבורד + שיבוץ and registers/assigns; a therapist
 * sees ONLY «המטופלים שלי» and schedules/reports; no edit-mode anywhere.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Access = require('../public/access');

test('tabs per role: Vered gets dashboard+workflow, therapist gets mine only', () => {
  assert.deepEqual(Access.tabsForRole('vered'), ['dashboard', 'workflow']);
  assert.deepEqual(Access.tabsForRole('therapist'), ['mine']);
  assert.deepEqual(Access.tabsForRole('nobody'), []);
});

test('default view is the first tab of the role', () => {
  assert.equal(Access.defaultView('vered'), 'dashboard');
  assert.equal(Access.defaultView('therapist'), 'mine');
});

test('a therapist cannot view Vered tabs and vice-versa', () => {
  assert.equal(Access.canViewTab('therapist', 'mine'), true);
  assert.equal(Access.canViewTab('therapist', 'dashboard'), false);
  assert.equal(Access.canViewTab('therapist', 'workflow'), false);
  assert.equal(Access.canViewTab('vered', 'workflow'), true);
  assert.equal(Access.canViewTab('vered', 'mine'), false);
});

test('register/assign are Vered-only; schedule/report are therapist-only', () => {
  assert.equal(Access.canRegister('vered'), true);
  assert.equal(Access.canAssign('vered'), true);
  assert.equal(Access.canSchedule('vered'), false);
  assert.equal(Access.canReport('vered'), false);

  assert.equal(Access.canSchedule('therapist'), true);
  assert.equal(Access.canReport('therapist'), true);
  assert.equal(Access.canRegister('therapist'), false);
  assert.equal(Access.canAssign('therapist'), false);
});

test('isRole accepts only the two real roles', () => {
  assert.equal(Access.isRole('vered'), true);
  assert.equal(Access.isRole('therapist'), true);
  assert.equal(Access.isRole('editor'), false);
  assert.equal(Access.isRole(''), false);
});
