'use strict';

/**
 * Unit tests for public/phone.js — the patient-matching key.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * Two contracts: strict canonical INPUT validation, and tolerant legacy
 * MATCHING normalization. They must not bleed into each other.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Phone = require('../public/phone');

test('isCanonical: only 10 digits with a leading zero', () => {
  assert.equal(Phone.isCanonical('0501234567'), true);
  assert.equal(Phone.isCanonical('0500000000'), true);
  assert.equal(Phone.isCanonical('501234567'), false);    // missing leading 0
  assert.equal(Phone.isCanonical('05012345678'), false);  // 11 digits
  assert.equal(Phone.isCanonical('050123456'), false);    // 9 digits
  assert.equal(Phone.isCanonical('050-1234567'), false);  // separators
  assert.equal(Phone.isCanonical('+972501234567'), false);
  assert.equal(Phone.isCanonical(' 0501234567 '), false); // whitespace
  assert.equal(Phone.isCanonical(501234567), false);      // not a string
});

test('validateCanonical: accepts ONLY the canonical format, never reformats', () => {
  const ok = Phone.validateCanonical('0501234567');
  assert.equal(ok.ok, true);
  assert.equal(ok.value, '0501234567'); // returned unchanged

  // empty / missing
  assert.equal(Phone.validateCanonical('').ok, false);
  assert.equal(Phone.validateCanonical(null).ok, false);
  assert.equal(Phone.validateCanonical(undefined).ok, false);

  // wrong shapes are HARD errors, not silently fixed
  assert.equal(Phone.validateCanonical('050-1234567').ok, false);
  assert.equal(Phone.validateCanonical('+972501234567').ok, false);
  assert.equal(Phone.validateCanonical('0 50 123 4567').ok, false);
  assert.equal(Phone.validateCanonical('501234567').ok, false);
  assert.equal(Phone.validateCanonical('05012345678').ok, false);
});

test('validateCanonical: error messages are specific and in Hebrew', () => {
  assert.match(Phone.validateCanonical('050-1234567').error, /ספרות בלבד|רווחים|מקפים/);
  assert.match(Phone.validateCanonical('05012345').error, /10 ספרות/);
  assert.match(Phone.validateCanonical('1234567890').error, /להתחיל ב-0/);
});

test('normalizeForMatch: strips separators', () => {
  assert.equal(Phone.normalizeForMatch('050-123-4567'), '0501234567');
  assert.equal(Phone.normalizeForMatch('(050) 1234567'), '0501234567');
  assert.equal(Phone.normalizeForMatch('050.123.4567'), '0501234567');
  assert.equal(Phone.normalizeForMatch('  0501234567 '), '0501234567');
});

test('normalizeForMatch: +972 / 972 country prefix -> leading 0', () => {
  assert.equal(Phone.normalizeForMatch('+972501234567'), '0501234567');
  assert.equal(Phone.normalizeForMatch('972-50-123-4567'), '0501234567');
  assert.equal(Phone.normalizeForMatch('+972 (50) 123-4567'), '0501234567');
});

test('normalizeForMatch: empty/garbage -> empty string', () => {
  assert.equal(Phone.normalizeForMatch(''), '');
  assert.equal(Phone.normalizeForMatch(null), '');
  assert.equal(Phone.normalizeForMatch('   '), '');
  assert.equal(Phone.normalizeForMatch('abc'), '');
});

test('matches: canonical vs legacy free-form forms of the same line', () => {
  assert.equal(Phone.matches('0501234567', '050-123-4567'), true);
  assert.equal(Phone.matches('0501234567', '+972 50 1234567'), true);
  assert.equal(Phone.matches('0501234567', '972501234567'), true);
  assert.equal(Phone.matches('0501234567', '0501234567'), true);
});

test('matches: different numbers never match; blanks never match', () => {
  assert.equal(Phone.matches('0501234567', '0517654321'), false);
  assert.equal(Phone.matches('0501234567', ''), false);     // no false match on blank
  assert.equal(Phone.matches('', '0501234567'), false);
  assert.equal(Phone.matches('', ''), false);
  assert.equal(Phone.matches('0501234567', null), false);
});
