'use strict';

/**
 * Unit tests for public/therapist-migration.js — the one-time short→full name
 * migration (mirrored in apps-script/Code.gs).
 *
 * Since the staffing roster sync (PR B) the roster is the LIVE Therapists sheet
 * (synced from ezone-staffing), not a hard-coded list: FINAL_THERAPISTS and
 * Code.gs's THERAPISTS_SEED are GONE, and every membership check takes the
 * roster as a parameter. ROSTER below is a test fixture standing in for the
 * synced sheet's names.
 *
 * Run with:  npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const TM = require('../public/therapist-migration');

// Fixture: the roster as the synced Therapists sheet would hold it.
const ROSTER = [
  'ד"ר מיכאל שפרינץ', 'ד"ר יצחק דנגור', 'ד"ר נטליה סדוגין', 'ד"ר ילנה',
  'ד"ר מאקה קוורשוילי', 'עידו בוזגלו', 'רנטה בינו', 'חנן וויל', 'אורן סלמניק',
  'אייל הר גיל', 'אלה שפירא', 'דליה מלמד', 'דנה דרוקר', 'הילה תבור', 'ליאת חגבי',
  'מעיין דלומי', 'רמי רום', 'תמר גנץ', 'מורן בנטל', 'כנרת זיידן',
  'יפעת רומנו', 'איתן דשא', 'יעל קינן', 'רעות חוגה', 'דניאל סייג', 'יניב הוד',
  'נדיה מוסיירי', 'נרי אופק', 'שירן כהן'
];

// --- the hard-coded roster is GONE (staffing is the source of truth) --------

test('no hard-coded roster: FINAL_THERAPISTS is no longer exported', () => {
  assert.equal(TM.FINAL_THERAPISTS, undefined,
    'the roster lives in the synced Therapists sheet, not in code');
});

test('no seed exists: THERAPISTS_SEED and cleanupTherapistRosterNow are gone from Code.gs', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  assert.ok(!src.includes('THERAPISTS_SEED'), 'THERAPISTS_SEED must not appear in Code.gs');
  assert.ok(!src.includes('FINAL_THERAPISTS'), 'FINAL_THERAPISTS must not appear in Code.gs');
  assert.ok(!src.includes('cleanupTherapistRosterNow'), 'cleanupTherapistRosterNow is superseded by the sync');
});

// --- migrateName: only the explicit mapping, nothing invented --------------

test('migrateName: each mapped short name becomes its full name', () => {
  assert.equal(TM.migrateName('דליה'), 'דליה מלמד');
  assert.equal(TM.migrateName('מעיין'), 'מעיין דלומי');
  assert.equal(TM.migrateName('תמר'), 'תמר גנץ');
  assert.equal(TM.migrateName('איתן דשה'), 'איתן דשא');
  assert.equal(TM.migrateName('עידו'), 'עידו בוזגלו');
  assert.equal(TM.migrateName('רמי'), 'רמי רום');
  assert.equal(TM.migrateName('כנרת'), 'כנרת זיידן');
  assert.equal(TM.migrateName('הילה'), 'הילה תבור');
  assert.equal(TM.migrateName('אלה'), 'אלה שפירא');
  assert.equal(TM.migrateName('שירן'), 'שירן כהן');
  assert.equal(TM.migrateName('דנה'), 'דנה דרוקר');
  assert.equal(TM.migrateName('יפעת'), 'יפעת רומנו');
  assert.equal(TM.migrateName('ד"ר שפרינץ'), 'ד"ר מיכאל שפרינץ');
  assert.equal(TM.migrateName('ד"ר נטליה'), 'ד"ר נטליה סדוגין');
  assert.equal(TM.migrateName('ד"ר דנגור'), 'ד"ר יצחק דנגור');
});

test('migrateName: trims surrounding whitespace before mapping', () => {
  assert.equal(TM.migrateName('  עידו  '), 'עידו בוזגלו');
});

test('migrateName: an unmapped / dropped name is left untouched (never invented)', () => {
  ['חנן', 'מרים', 'יסמין', 'שחר'].forEach((n) => assert.equal(TM.migrateName(n), n));
});

test('migrateName: a name already full (or not a short key) is unchanged', () => {
  assert.equal(TM.migrateName('דליה מלמד'), 'דליה מלמד');   // not double-mapped
  assert.equal(TM.migrateName('רנטה בינו'), 'רנטה בינו');   // full name, not a key, stays
  assert.equal(TM.migrateName('חנן וויל'), 'חנן וויל');     // full name, not a key, stays
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
  const first = TM.planMigration(names, ROSTER);
  const migrated = names.map(TM.migrateName);
  const second = TM.planMigration(migrated, ROSTER);
  assert.equal(first.changes.length, 3);          // דליה, עידו, כנרת
  assert.equal(second.changes.length, 0);         // nothing left to rewrite
});

// --- planMigration: changes + unmapped report (against the roster param) ----

test('planMigration: reports per-row changes and the distinct unmapped names', () => {
  const names = ['עידו', 'דליה', 'חנן', 'כנרת', 'מרים', 'חנן', ''];
  const r = TM.planMigration(names, ROSTER);
  assert.deepEqual(r.changes, [
    { index: 0, from: 'עידו', to: 'עידו בוזגלו' },
    { index: 1, from: 'דליה', to: 'דליה מלמד' },
    { index: 3, from: 'כנרת', to: 'כנרת זיידן' }
  ]);
  // unmapped = post-migration names not in the roster, de-duped (חנן once, מרים once)
  assert.deepEqual(r.unmapped.sort(), ['חנן', 'מרים'].sort());
  assert.equal(r.scanned, 7);
});

test('planMigration: a roster name (full or unchanged short) is NOT flagged unmapped', () => {
  const r = TM.planMigration(['כנרת', 'אלה', 'דנה', 'דליה מלמד', 'עידו'], ROSTER);
  assert.deepEqual(r.unmapped, []);
});

test('planMigration with an EMPTY roster flags everything unmapped (roster is a required input)', () => {
  const r = TM.planMigration(['דליה מלמד'], []);
  assert.deepEqual(r.unmapped, ['דליה מלמד']);
});

// --- punctuation variants: ד״ר (gershayim) vs ד"ר (ASCII) ------------------

test('a ד״ר gershayim-quote name matches the roster (normalized) and is flagged a variant, not unmapped', () => {
  const r = TM.planMigration(['ד״ר ילנה'], ROSTER);    // gershayim quote vs roster ASCII; not a rename key
  assert.deepEqual(r.unmapped, [], 'must NOT be treated as unknown');
  assert.deepEqual(r.punctuationVariants, ['ד״ר ילנה']);
  assert.equal(TM.isInRosterNormalized('ד״ר ילנה', ROSTER), true);
  assert.equal(TM.isInRosterExact('ד״ר ילנה', ROSTER), false);
});

// --- mirror guard: apps-script/Code.gs must match this module --------------

test('Code.gs _THERAPIST_SHORT_TO_FULL mirrors SHORT_TO_FULL exactly (no drift)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  const block = src.match(/var _THERAPIST_SHORT_TO_FULL = \{([\s\S]*?)\};/);
  assert.ok(block, 'mapping block found');
  const pairs = {};
  block[1].replace(/'([^']+)':\s*'([^']+)'/g, (m, k, v) => { pairs[k] = v; return m; });
  assert.deepEqual(pairs, TM.SHORT_TO_FULL, 'Code.gs mapping must equal the module mapping');
});

test('Code.gs _rosterKeySet reads the LIVE Therapists sheet (not a constant)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  const fn = src.match(/function _rosterKeySet\(\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, '_rosterKeySet found');
  assert.ok(fn[1].includes("_ensureSheet('Therapists'"), 'must read the sheet');
});
