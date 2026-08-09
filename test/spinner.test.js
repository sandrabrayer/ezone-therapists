'use strict';

/**
 * Unit tests for public/spinner.js — the framework-free loading-spinner helpers.
 * Only the pure logic (state decision) and markup are testable here; the DOM
 * injection lives in app.js.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Spinner = require('../public/spinner');

test('isInitialLoading: true only on the very first load, before data arrives', () => {
  assert.equal(Spinner.isInitialLoading({ initialLoading: true, loaded: false }), true);
});

test('isInitialLoading: false once data has loaded (manual refresh keeps the view)', () => {
  // A manual refresh sets initialLoading again would be a bug — but even if it
  // did, loaded:true suppresses the whole-app spinner. Belt and braces.
  assert.equal(Spinner.isInitialLoading({ initialLoading: true, loaded: true }), false);
  assert.equal(Spinner.isInitialLoading({ initialLoading: false, loaded: true }), false);
});

test('isInitialLoading: false when nothing is loading', () => {
  assert.equal(Spinner.isInitialLoading({ initialLoading: false, loaded: false }), false);
});

test('isInitialLoading: tolerates missing/undefined state', () => {
  assert.equal(Spinner.isInitialLoading(), false);
  assert.equal(Spinner.isInitialLoading(null), false);
  assert.equal(Spinner.isInitialLoading({}), false);
});

test('html: renders an accessible status region with a spinner glyph', () => {
  const out = Spinner.html();
  assert.match(out, /role="status"/);
  assert.match(out, /aria-live="polite"/);
  assert.match(out, /class="spinner"/);
  assert.match(out, /aria-hidden="true"/);
  // No label element when none is passed.
  assert.doesNotMatch(out, /spinner-label/);
});

test('html: includes the label text when provided', () => {
  const out = Spinner.html('טוען…');
  assert.match(out, /class="spinner-label">טוען…</);
});

test('html: escapes label text (no markup injection through the label)', () => {
  const out = Spinner.html('<b>x</b>&"\'');
  assert.doesNotMatch(out, /<b>x<\/b>/);
  assert.match(out, /&lt;b&gt;x&lt;\/b&gt;&amp;&quot;&#39;/);
});
