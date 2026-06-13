'use strict';

/**
 * Unit tests for public/access.js — the edit-mode / tab access rules.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * Locks in iteration 6: the dashboard is view-only for everyone, the «עריכה»
 * toggle is editor-only and only on the editable tabs, and edit controls show
 * only once an editor turns edit mode on.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Access = require('../public/access');

test('dashboard is never editable; workflow + mine are', () => {
  assert.equal(Access.isEditableView('dashboard'), false);
  assert.equal(Access.isEditableView('workflow'), true);
  assert.equal(Access.isEditableView('mine'), true);
  assert.equal(Access.isEditableView(''), false);
});

test('edit toggle: editor-only AND only on an editable tab', () => {
  assert.equal(Access.editToggleVisible('editor', 'workflow'), true);
  assert.equal(Access.editToggleVisible('editor', 'mine'), true);
  assert.equal(Access.editToggleVisible('editor', 'dashboard'), false); // dashboard view-only
  assert.equal(Access.editToggleVisible('viewer', 'workflow'), false);  // viewers can't edit
  assert.equal(Access.editToggleVisible('viewer', 'mine'), false);
});

test('edit controls: only when an editor has edit mode ON', () => {
  assert.equal(Access.editControlsVisible('editor', true), true);
  assert.equal(Access.editControlsVisible('editor', false), false);   // editor, mode off
  assert.equal(Access.editControlsVisible('viewer', true), false);    // viewer never edits
  assert.equal(Access.editControlsVisible('viewer', false), false);
});
