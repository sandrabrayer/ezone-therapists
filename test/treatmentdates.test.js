'use strict';

/**
 * Unit tests for public/treatmentdates.js — the treatment start/end date
 * display formatter shown on each patient card.
 *
 * Pure logic, no I/O: there are no HTTP calls or backends to mock. Covers the
 * two must-handle-visibly cases the feature calls out — MISSING and MALFORMED —
 * plus the valid `yyyy-MM-dd` and ISO shapes the outpatient projection delivers.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const TreatmentDates = require('../public/treatmentdates');

const DASH = '—'; // the em-dash placeholder

test('valid yyyy-MM-dd → DD/MM/YYYY (day-first)', () => {
  assert.equal(TreatmentDates.format('2026-07-01'), '01/07/2026');
  assert.equal(TreatmentDates.format('2025-12-31'), '31/12/2025');
});

test('ISO datetime string → date part only, DD/MM/YYYY', () => {
  assert.equal(TreatmentDates.format('2026-07-01T00:00:00.000Z'), '01/07/2026');
  assert.equal(TreatmentDates.format('2026-03-09T13:45:00'), '09/03/2026');
});

test('unpadded month/day are padded on output', () => {
  assert.equal(TreatmentDates.format('2026-7-1'), '01/07/2026');
});

test('surrounding whitespace is tolerated', () => {
  assert.equal(TreatmentDates.format('  2026-07-01  '), '01/07/2026');
});

test('MISSING dates render «—», never blank/undefined/null', () => {
  assert.equal(TreatmentDates.format(''), DASH);          // active patient: blank exitDate
  assert.equal(TreatmentDates.format('   '), DASH);
  assert.equal(TreatmentDates.format(null), DASH);
  assert.equal(TreatmentDates.format(undefined), DASH);
  // The literal strings that must NEVER leak to the card:
  assert.notEqual(TreatmentDates.format(undefined), '');
  assert.notEqual(TreatmentDates.format(undefined), 'undefined');
  assert.notEqual(TreatmentDates.format(null), 'null');
});

test('MALFORMED dates render «—», never raw garbage', () => {
  assert.equal(TreatmentDates.format('not-a-date'), DASH);
  assert.equal(TreatmentDates.format('2026/07/01'), DASH);   // wrong separator
  assert.equal(TreatmentDates.format('01-07-2026'), DASH);   // wrong order/shape
  assert.equal(TreatmentDates.format('2026-07'), DASH);      // incomplete
  assert.equal(TreatmentDates.format('20260701'), DASH);     // no separators
  assert.equal(TreatmentDates.format('abcd-ef-gh'), DASH);
});

test('out-of-range month or day → «—»', () => {
  assert.equal(TreatmentDates.format('2026-13-01'), DASH);   // month 13
  assert.equal(TreatmentDates.format('2026-00-10'), DASH);   // month 0
  assert.equal(TreatmentDates.format('2026-07-32'), DASH);   // day 32
  assert.equal(TreatmentDates.format('2026-07-00'), DASH);   // day 0
});

test('MISSING is the em dash (U+2014), matching the card placeholder', () => {
  assert.equal(TreatmentDates.MISSING, '—');
});
