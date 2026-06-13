'use strict';

/**
 * Unit tests for public/access.js — the tab list (iteration 8: no roles/login).
 * Run with:  npm test     (Node >= 18, built-in test runner)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Access = require('../public/access');

test('all three tabs, dashboard first (default view)', () => {
  assert.deepEqual(Access.tabs(), ['dashboard', 'workflow', 'mine']);
  assert.equal(Access.defaultView(), 'dashboard');
});

test('isTab recognises the real tabs only', () => {
  assert.equal(Access.isTab('dashboard'), true);
  assert.equal(Access.isTab('workflow'), true);
  assert.equal(Access.isTab('mine'), true);
  assert.equal(Access.isTab('nope'), false);
  assert.equal(Access.isTab(''), false);
});

test('tabs() returns a copy (callers can\'t mutate the canonical list)', () => {
  const a = Access.tabs();
  a.push('x');
  assert.deepEqual(Access.tabs(), ['dashboard', 'workflow', 'mine']);
});
