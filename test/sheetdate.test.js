'use strict';

/**
 * Unit tests for public/sheetdate.js — the cell formatter that fixes the
 * 1899-12-30 bug. Run with:  npm test
 *
 * The bug: a time-only cell ("10:30") is stored by Sheets on the epoch day
 * (1899-12-30) and the old reader formatted it as yyyy-MM-dd → "1899-12-30".
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const SheetDate = require('../public/sheetdate');

test('time-only cell (epoch day) → HH:mm, NOT 1899-12-30', () => {
  // Sheets stores "10:30" as a Date on 1899-12-30.
  const timeCell = new Date(1899, 11, 30, 10, 30, 0);
  assert.equal(SheetDate.formatCell(timeCell), '10:30');
});

test('time-only cell pads single digits', () => {
  assert.equal(SheetDate.formatCell(new Date(1899, 11, 30, 9, 5, 0)), '09:05');
});

test('real date cell → yyyy-MM-dd', () => {
  assert.equal(SheetDate.formatCell(new Date(2026, 6, 1, 0, 0, 0)), '2026-07-01');
});

test('non-Date values pass through unchanged', () => {
  assert.equal(SheetDate.formatCell('0501234567'), '0501234567');
  assert.equal(SheetDate.formatCell(''), '');
  assert.equal(SheetDate.formatCell(3), 3);
  assert.equal(SheetDate.formatCell('2026-07-01T00:00:00.000Z'), '2026-07-01T00:00:00.000Z');
});
