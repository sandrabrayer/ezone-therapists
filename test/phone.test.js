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

// --- toCanonical: normalize THEN validate (the entry path) -----------------

test('toCanonical: already-canonical passes unchanged', () => {
  assert.deepEqual(Phone.toCanonical('0501234567'), { ok: true, value: '0501234567' });
});

test('toCanonical: strips separators and returns the normalized canonical', () => {
  assert.deepEqual(Phone.toCanonical('050-123-4567'), { ok: true, value: '0501234567' });
  assert.deepEqual(Phone.toCanonical('(050) 123 4567'), { ok: true, value: '0501234567' });
  assert.deepEqual(Phone.toCanonical(' 050.123.4567 '), { ok: true, value: '0501234567' });
});

test('toCanonical: +972 / 972 prefix becomes a leading 0', () => {
  assert.deepEqual(Phone.toCanonical('+972 50-123-4567'), { ok: true, value: '0501234567' });
  assert.deepEqual(Phone.toCanonical('972501234567'), { ok: true, value: '0501234567' });
  assert.deepEqual(Phone.toCanonical('+972501234567'), { ok: true, value: '0501234567' });
});

test('toCanonical: too short / too long → rejected with a message', () => {
  assert.equal(Phone.toCanonical('050123456').ok, false);        // 9 digits
  assert.equal(Phone.toCanonical('05012345678').ok, false);      // 11 digits
  assert.ok(/10 ספרות/.test(Phone.toCanonical('050123456').error));
});

test('toCanonical: a no-leading-zero 10-digit number is rejected (not auto-prepended)', () => {
  const r = Phone.toCanonical('5012345678');   // 10 digits but starts with 5
  assert.equal(r.ok, false);
  assert.ok(/להתחיל ב-0/.test(r.error));
});

test('toCanonical: empty / garbage → rejected', () => {
  assert.equal(Phone.toCanonical('').ok, false);
  assert.equal(Phone.toCanonical(null).ok, false);
  assert.equal(Phone.toCanonical('abc').ok, false);
});

// --- recoverStored: read-side repair of Sheets' lost leading zero ----------

test('recoverStored: a 9-digit lost-zero phone is restored to canonical', () => {
  assert.equal(Phone.recoverStored('501234567'), '0501234567');
  assert.equal(Phone.recoverStored(501234567), '0501234567');   // numeric, as Sheets stores it
  assert.equal(Phone.isCanonical(Phone.recoverStored(501234567)), true);
});

test('recoverStored: a leading zero survives the Sheets number round-trip', () => {
  const canonical = '0501234567';
  const mangled = Number(canonical);            // Sheets drops the zero -> 501234567
  assert.equal(Phone.recoverStored(mangled), canonical);
});

test('recoverStored: already-canonical is left untouched', () => {
  assert.equal(Phone.recoverStored('0501234567'), '0501234567');
});

test('recoverStored: non-signature values pass through as a trimmed string', () => {
  assert.equal(Phone.recoverStored(''), '');
  assert.equal(Phone.recoverStored(null), '');
  assert.equal(Phone.recoverStored(undefined), '');
  assert.equal(Phone.recoverStored('  0501234567 '), '0501234567'); // trimmed, not mangled
  assert.equal(Phone.recoverStored('050-123-4567'), '050-123-4567'); // 10 digits -> not the signature
  assert.equal(Phone.recoverStored('05012345678'), '05012345678');   // 11 digits -> not the signature
  assert.equal(Phone.recoverStored('012345678'), '012345678');       // 9 digits but already leads 0
});

// --- duplicateOf: create-time duplicate guard ------------------------------

test('duplicateOf: finds an existing patient by canonical or legacy form', () => {
  const patients = [{ phone: '0501234567', name: 'דנה' }, { phone: '0521111111', name: 'רון' }];
  assert.equal(Phone.duplicateOf('0501234567', patients).name, 'דנה');
  assert.equal(Phone.duplicateOf('050-123-4567', patients).name, 'דנה');   // same line, legacy form
  assert.equal(Phone.duplicateOf('+972501234567', patients).name, 'דנה');
});

test('duplicateOf: a retired (inactive) patient still owns the phone', () => {
  const patients = [{ phone: '0501234567', name: 'דנה', active: 'false' }];
  assert.equal(Phone.duplicateOf('0501234567', patients).name, 'דנה');
});

test('duplicateOf: returns null when there is no match / blank / bad input', () => {
  const patients = [{ phone: '0501234567', name: 'דנה' }];
  assert.equal(Phone.duplicateOf('0529999999', patients), null);
  assert.equal(Phone.duplicateOf('', patients), null);
  assert.equal(Phone.duplicateOf(null, patients), null);
  assert.equal(Phone.duplicateOf('0501234567', []), null);
  assert.equal(Phone.duplicateOf('0501234567', null), null);
});
