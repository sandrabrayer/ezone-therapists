'use strict';

/**
 * Unit tests for the one-time admin cleanup of ORPHANED scheduled sessions
 * (apps-script/Code.gs → cleanupOrphanedScheduledSessions).
 *
 * Code.gs can't be imported, so this file mirrors the pure DECISION the cleanup
 * makes per Schedule row — orphan → delete, live patient → keep, multi-match →
 * keep+flag, empty phone → keep+flag — using a faithful copy of Code.gs's tolerant
 * phone match (_matchPhone = _normalizePhoneForMatch(_recoverStoredPhone)). A
 * mirror-guard at the bottom asserts the real Code.gs function shares the same
 * tolerant match + never-fail-open + log-before-delete + bottom-up-delete shape,
 * so the two can't silently drift.
 *
 * Run with:  npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// --- faithful mirror of Code.gs phone matching ----------------------------
function recoverStored(raw) {              // _recoverStoredPhone
  if (raw == null) return '';
  const s = String(raw).trim();
  if (!s) return '';
  const digits = s.replace(/[^\d]/g, '');
  if (digits.length === 9 && digits.charAt(0) !== '0') return '0' + digits;
  return s;
}
function normalizeForMatch(raw) {          // _normalizePhoneForMatch
  if (raw == null) return '';
  let digits = String(raw).replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.indexOf('972') === 0) digits = '0' + digits.slice(3);
  return digits;
}
function matchPhone(raw) { return normalizeForMatch(recoverStored(raw)); }   // _matchPhone

// --- mirror of the per-row decision ---------------------------------------
// patientPhones: the Patients-sheet phone column. Returns the action the cleanup
// takes for a Schedule row with this patientPhone.
function classify(rowPhone, patientPhones) {
  const key = matchPhone(rowPhone);
  if (!key) return { action: 'flag', reason: 'no_phone', matches: 0 };
  const matches = (patientPhones || []).filter((p) => matchPhone(p) === key).length;
  if (matches === 0) return { action: 'delete', matches: 0 };
  if (matches === 1) return { action: 'keep', matches: 1 };
  return { action: 'flag', reason: 'multi_match', matches };
}
// Plan the whole sweep: only rows classified 'delete' are removed.
function planCleanup(rows, patientPhones) {
  const deleted = [], flagged = [], kept = [];
  rows.forEach((r) => {
    const c = classify(r.patientPhone, patientPhones);
    if (c.action === 'delete') deleted.push(r);
    else if (c.action === 'flag') flagged.push(r);
    else kept.push(r);
  });
  return { deleted, flagged, kept, count: deleted.length };
}

// =========================================================================
// Decision tests
// =========================================================================

test('orphaned row (phone matches no patient) → DELETED', () => {
  const patients = ['0501111111', '0502222222'];
  assert.equal(classify('0509999999', patients).action, 'delete');
});

test('live-patient row (phone matches exactly one patient) → KEPT', () => {
  const patients = ['0501111111', '0502222222'];
  assert.equal(classify('0501111111', patients).action, 'keep');
});

test('multi-match (phone matches >1 patient row) → KEPT and FLAGGED (never fail open)', () => {
  const patients = ['0501234567', '0501234567'];   // duplicate patient rows
  const c = classify('0501234567', patients);
  assert.equal(c.action, 'flag');
  assert.equal(c.reason, 'multi_match');
  assert.equal(c.matches, 2);
});

test('tolerant match: a zero-dropped stored patient phone still KEEPS the row', () => {
  // The Patients cell came back as the number 501234567 (Sheets dropped the zero);
  // the Schedule row holds the canonical 0501234567. They must match → keep, so a
  // LIVE patient is never deleted over a leading-zero glitch.
  assert.equal(classify('0501234567', [501234567]).action, 'keep');
  // ...and the reverse (canonical patient, zero-dropped schedule cell).
  assert.equal(classify(501234567, ['0501234567']).action, 'keep');
});

test('empty / unparseable phone → KEPT and FLAGGED (cannot classify → never delete)', () => {
  assert.equal(classify('', ['0501111111']).action, 'flag');
  assert.equal(classify(null, ['0501111111']).action, 'flag');
  assert.equal(classify('abc', ['0501111111']).action, 'flag');
});

test('planCleanup: deletes ONLY orphans, returns the deleted count, keeps the rest', () => {
  const patients = ['0501111111', '0502222222', '0502222222'];   // 3rd is a dup of #2
  const rows = [
    { id: 'a', patientPhone: '0501111111' },   // live → keep
    { id: 'b', patientPhone: '0509999999' },   // orphan → delete
    { id: 'c', patientPhone: '0502222222' },   // multi-match → flag (kept)
    { id: 'd', patientPhone: '' },             // empty → flag (kept)
    { id: 'e', patientPhone: '0508888888' }    // orphan → delete
  ];
  const r = planCleanup(rows, patients);
  assert.deepEqual(r.deleted.map((x) => x.id), ['b', 'e']);
  assert.equal(r.count, 2);
  assert.deepEqual(r.kept.map((x) => x.id), ['a']);
  assert.deepEqual(r.flagged.map((x) => x.id), ['c', 'd']);
});

test('planCleanup: never deletes a real future session of a live patient', () => {
  const patients = ['0501111111'];
  const rows = [{ id: 'future', patientPhone: '0501111111', scheduledDate: '2099-12-31' }];
  assert.equal(planCleanup(rows, patients).count, 0);   // date is irrelevant; live patient → kept
});

// =========================================================================
// Mirror-guard — Code.gs must share the decision + safety shape (no drift)
// =========================================================================
const CODE_GS = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
function cleanupBody() {
  const m = CODE_GS.match(/function cleanupOrphanedScheduledSessions\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(m, 'cleanupOrphanedScheduledSessions must exist in Code.gs');
  return m[0];
}

test('Code.gs cleanup uses the tolerant _matchPhone for BOTH patients and schedule rows', () => {
  const body = cleanupBody();
  assert.ok((body.match(/_matchPhone\(/g) || []).length >= 2, 'tolerant match on both sides');
});

test('Code.gs cleanup deletes ONLY orphans: matches===1 kept, matches>1 flagged, empty flagged', () => {
  const body = cleanupBody();
  assert.match(body, /matches === 1\) continue;/, 'one match → keep');
  assert.match(body, /matches > 1\)/, 'multi-match handled (kept + flagged)');
  assert.match(body, /if \(!key\)/, 'empty/invalid phone handled (kept + flagged)');
  // The only deletion is on the zero-match branch.
  assert.match(body, /toDelete\.push\(r \+ 2\)/);
});

test('Code.gs cleanup logs BEFORE deleting and deletes bottom-up; decision keyed on matches only', () => {
  const body = cleanupBody();
  const logIdx = body.indexOf("Logger.log('DELETE (orphaned)");
  const pushIdx = body.indexOf('toDelete.push(r + 2)');
  assert.ok(logIdx > -1 && pushIdx > logIdx, 'log the row before queuing its deletion');
  assert.match(body, /for \(var d = toDelete\.length - 1; d >= 0; d--\) schSh\.deleteRow/, 'bottom-up delete');
  // The delete is reached ONLY after the matches===1 / matches>1 / empty guards —
  // i.e. driven by patient-match count, NOT by date or status. (scheduledDate is
  // read for the LOG line only, never branched on.)
  const guardIdx = body.indexOf('var matches = patientCount[key]');
  assert.ok(guardIdx > -1 && guardIdx < pushIdx, 'deletion is gated by the match count');
  assert.doesNotMatch(body, /if \([^)]*scheduledDate|if \([^)]*attendance|if \([^)]*outcome/, 'never branch on date/status');
});
