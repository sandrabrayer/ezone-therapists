'use strict';

/**
 * Unit tests for public/therapist-migration.js — the FINAL therapist roster +
 * the one-time short→full name migration (mirrored in apps-script/Code.gs).
 * Run with:  npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const TM = require('../public/therapist-migration');

// --- seed replacement: the final 19, no old short names --------------------

test('FINAL_THERAPISTS is exactly the 19-name full roster', () => {
  assert.equal(TM.FINAL_THERAPISTS.length, 19);
  ['מעיין דלומי', 'תמר גנץ', 'אורן כביר', 'אביב מלכה', 'רמי', 'כנרת', 'הילה',
   'עידו בוזגלו', 'אלה', 'שירן', 'דנה', 'יפעת', 'איתן דשה', 'דליה מלמד',
   'נועה זיפמן', 'אסתר', 'ד״ר שפרינץ', 'ד״ר נטליה', 'ד״ר דנגור']
    .forEach((n) => assert.ok(TM.FINAL_THERAPISTS.includes(n), 'roster must include ' + n));
});

test('the old SHORT names are GONE from the roster (so they cannot re-seed)', () => {
  ['עידו', 'דליה', 'חנן', 'מעיין', 'איתן', 'מרים', 'תמר', 'שחר', 'יסמין']
    .forEach((n) => assert.equal(TM.FINAL_THERAPISTS.includes(n), false, n + ' must not be in the seed'));
});

// --- migrateName: only the explicit mapping, nothing invented --------------

test('migrateName: each mapped short name becomes its full name', () => {
  assert.equal(TM.migrateName('דליה'), 'דליה מלמד');
  assert.equal(TM.migrateName('מעיין'), 'מעיין דלומי');
  assert.equal(TM.migrateName('תמר'), 'תמר גנץ');
  assert.equal(TM.migrateName('איתן'), 'איתן דשה');
  assert.equal(TM.migrateName('עידו'), 'עידו בוזגלו');
  assert.equal(TM.migrateName('נועה'), 'נועה זיפמן');
});

test('migrateName: trims surrounding whitespace before mapping', () => {
  assert.equal(TM.migrateName('  עידו  '), 'עידו בוזגלו');
});

test('migrateName: an unmapped / dropped name is left untouched (never invented)', () => {
  ['חנן', 'מרים', 'יסמין', 'שחר'].forEach((n) => assert.equal(TM.migrateName(n), n));
});

test('migrateName: a name already full (or not a short key) is unchanged', () => {
  assert.equal(TM.migrateName('דליה מלמד'), 'דליה מלמד');   // not double-mapped
  assert.equal(TM.migrateName('כנרת'), 'כנרת');             // full short, stays
  assert.equal(TM.migrateName('ד״ר נטליה'), 'ד״ר נטליה');
  assert.equal(TM.migrateName(''), '');
});

// --- idempotency -----------------------------------------------------------

test('migrateName is idempotent: migrate(migrate(x)) === migrate(x)', () => {
  ['דליה', 'מעיין', 'עידו', 'חנן', 'דליה מלמד', 'כנרת'].forEach((n) => {
    assert.equal(TM.migrateName(TM.migrateName(n)), TM.migrateName(n));
  });
});

test('planMigration is idempotent: a second pass over the migrated names changes nothing', () => {
  const names = ['דליה', 'עידו', 'כנרת', 'חנן'];
  const first = TM.planMigration(names);
  const migrated = names.map(TM.migrateName);
  const second = TM.planMigration(migrated);
  assert.equal(first.changes.length, 2);          // דליה, עידו
  assert.equal(second.changes.length, 0);         // nothing left to rewrite
});

// --- planMigration: changes + unmapped report ------------------------------

test('planMigration: reports per-row changes and the distinct unmapped names', () => {
  const names = ['עידו', 'דליה', 'חנן', 'כנרת', 'מרים', 'חנן', ''];
  const r = TM.planMigration(names);
  assert.deepEqual(r.changes, [
    { index: 0, from: 'עידו', to: 'עידו בוזגלו' },
    { index: 1, from: 'דליה', to: 'דליה מלמד' }
  ]);
  // unmapped = post-migration names not in the roster, de-duped (חנן once, מרים once)
  assert.deepEqual(r.unmapped.sort(), ['חנן', 'מרים'].sort());
  assert.equal(r.scanned, 7);
});

test('planMigration: a roster name (full or unchanged short) is NOT flagged unmapped', () => {
  const r = TM.planMigration(['כנרת', 'אלה', 'דנה', 'דליה מלמד', 'עידו']);
  assert.deepEqual(r.unmapped, []);
});

// --- punctuation variants: ד״ר (gershayim) vs ד"ר (ASCII) ------------------

test('a ד"ר ASCII-quote name matches the roster (normalized) and is flagged a variant, not unmapped', () => {
  const r = TM.planMigration(['ד"ר נטליה']);    // straight ASCII quote vs roster gershayim
  assert.deepEqual(r.unmapped, [], 'must NOT be treated as unknown');
  assert.deepEqual(r.punctuationVariants, ['ד"ר נטליה']);
  assert.equal(TM.isInRosterNormalized('ד"ר נטליה'), true);
  assert.equal(TM.isInRosterExact('ד"ר נטליה'), false);
});

// --- mirror guard: apps-script/Code.gs must match this module --------------

test('Code.gs THERAPISTS_SEED mirrors FINAL_THERAPISTS exactly (no drift)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  const block = src.match(/var THERAPISTS_SEED = \[([\s\S]*?)\];/);
  assert.ok(block, 'THERAPISTS_SEED block found');
  const names = block[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
  assert.deepEqual(names, TM.FINAL_THERAPISTS, 'Code.gs seed must equal the module roster');
});

test('Code.gs _THERAPIST_SHORT_TO_FULL mirrors SHORT_TO_FULL exactly (no drift)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  const block = src.match(/var _THERAPIST_SHORT_TO_FULL = \{([\s\S]*?)\};/);
  assert.ok(block, 'mapping block found');
  const pairs = {};
  block[1].replace(/'([^']+)':\s*'([^']+)'/g, (m, k, v) => { pairs[k] = v; return m; });
  assert.deepEqual(pairs, TM.SHORT_TO_FULL, 'Code.gs mapping must equal the module mapping');
});
