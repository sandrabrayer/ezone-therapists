'use strict';

/**
 * Unit tests for public/clinical-sync.js — the clinical billing-type push that
 * fires when an assignment is saved (Task 4.5b).
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * Locks shut the four things the feature must get right:
 *   1. the push fires on save with the correct CANONICAL-phone payload
 *      (10-digit leading zero), and the secret travels in that payload;
 *   2. every response outcome is handled — ok:true/matched:1 is the ONLY success,
 *      and no_match / multi_match / unknown_type / non-ok / non-2xx each surface
 *      a distinct flag (never fail-open);
 *   3. the secret is whatever config supplies (never hardcoded in the module);
 *   4. the menu grouping is DISPLAY ONLY — the specific clinical value is kept,
 *      never collapsed to the group label 'פרטני'.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const ClinicalSync = require('../public/clinical-sync');

// --- shouldPush ------------------------------------------------------------

test('shouldPush: only a non-empty treatment type pushes', () => {
  assert.equal(ClinicalSync.shouldPush('פסיכודינמי'), true);
  assert.equal(ClinicalSync.shouldPush(''), false);
  assert.equal(ClinicalSync.shouldPush('   '), false);
  assert.equal(ClinicalSync.shouldPush(null), false);
  assert.equal(ClinicalSync.shouldPush(undefined), false);
});

// --- buildPayload: canonical phone + secret from config --------------------

test('buildPayload: emits the setClinicalType contract with a canonical phone', () => {
  const r = ClinicalSync.buildPayload('0501234567', 'פסיכודינמי', 'sekret-xyz');
  assert.equal(r.ok, true);
  assert.deepEqual(r.payload, {
    action: 'setClinicalType',
    secret: 'sekret-xyz',
    phone: '0501234567',
    clinicalTreatmentType: 'פסיכודינמי'
  });
});

test('buildPayload: normalizes a fixable phone to the 10-digit leading-zero key', () => {
  // +972 / separators are normalized to the canonical key before sending.
  const r = ClinicalSync.buildPayload('+972 50-123-4567', 'טיפול אינטגרטיבי', 's');
  assert.equal(r.ok, true);
  assert.equal(r.payload.phone, '0501234567');
});

test('buildPayload: an un-canonicalizable phone is flagged, not sent', () => {
  const r = ClinicalSync.buildPayload('12345', 'פסיכודינמי', 's');
  assert.deepEqual(r, { ok: false, reason: 'invalid_phone' });
});

test('buildPayload: the secret is taken from config, not hardcoded', () => {
  // Two different configured secrets must flow through verbatim — proving the
  // module never substitutes a baked-in value.
  assert.equal(ClinicalSync.buildPayload('0501234567', 'x', 'AAA').payload.secret, 'AAA');
  assert.equal(ClinicalSync.buildPayload('0501234567', 'x', 'BBB').payload.secret, 'BBB');
  // And the source text carries no literal secret assignment.
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'clinical-sync.js'), 'utf8');
  assert.ok(!/secret\s*[:=]\s*['"][^'"]+['"]/.test(src), 'module must not hardcode a secret literal');
});

// --- interpretResponse: every outcome handled, never fail-open -------------

test('interpretResponse: ok:true + matched:1 is the only success', () => {
  assert.deepEqual(ClinicalSync.interpretResponse(200, { ok: true, matched: 1 }), { ok: true, matched: 1 });
  // string "1" tolerated (Apps Script / Sheets stringiness)
  assert.deepEqual(ClinicalSync.interpretResponse(200, { ok: true, matched: '1' }), { ok: true, matched: 1 });
});

test('interpretResponse: no_match / multi_match / unknown_type surface verbatim', () => {
  assert.deepEqual(ClinicalSync.interpretResponse(200, { ok: false, reason: 'no_match' }), { ok: false, reason: 'no_match' });
  assert.deepEqual(ClinicalSync.interpretResponse(200, { ok: false, reason: 'multi_match' }), { ok: false, reason: 'multi_match' });
  assert.deepEqual(ClinicalSync.interpretResponse(200, { ok: false, reason: 'unknown_type' }), { ok: false, reason: 'unknown_type' });
});

test('interpretResponse: matched:0 / ok:false without a reason is a non_ok flag (never fail-open)', () => {
  assert.deepEqual(ClinicalSync.interpretResponse(200, { ok: true, matched: 0 }), { ok: false, reason: 'non_ok' });
  assert.deepEqual(ClinicalSync.interpretResponse(200, { ok: false }), { ok: false, reason: 'non_ok' });
  assert.deepEqual(ClinicalSync.interpretResponse(200, null), { ok: false, reason: 'non_ok' });
});

test('interpretResponse: a non-2xx status is flagged with its code', () => {
  assert.deepEqual(ClinicalSync.interpretResponse(500, { ok: true, matched: 1 }), { ok: false, reason: 'http_500' });
  assert.deepEqual(ClinicalSync.interpretResponse(404, null), { ok: false, reason: 'http_404' });
});

// --- warningFor: failed outcomes warn, clean ones stay quiet ---------------

test('warningFor: a clean / absent sync produces no warning', () => {
  assert.equal(ClinicalSync.warningFor({ ok: true, matched: 1 }), null);
  assert.equal(ClinicalSync.warningFor(null), null);
  assert.equal(ClinicalSync.warningFor(undefined), null);
});

test('warningFor: each failure reason maps to a Hebrew message (never swallowed)', () => {
  ['no_match', 'multi_match', 'unknown_type', 'unconfigured', 'invalid_phone', 'unreachable', 'non_ok']
    .forEach((reason) => {
      const w = ClinicalSync.warningFor({ ok: false, reason });
      assert.equal(typeof w, 'string');
      assert.ok(w.length > 0, `reason ${reason} must yield a message`);
    });
});

test('warningFor: an unmapped reason still warns (e.g. http_500), never silent', () => {
  const w = ClinicalSync.warningFor({ ok: false, reason: 'http_500' });
  assert.equal(typeof w, 'string');
  assert.ok(w.includes('http_500'));
});

// --- partitionTypes: grouping is display-only, value preserved -------------

test('partitionTypes: the 5 individual-billing types group; others stay inline', () => {
  const names = [
    'פרטני כללי', 'פסיכודינמי', 'קבוצה', 'עיסוי טיפולי',
    'מעקב פסיכיאטרי', 'טיפול אינטגרטיבי'
  ];
  const { inline, grouped } = ClinicalSync.partitionTypes(names);
  assert.deepEqual(grouped, ['פסיכודינמי', 'עיסוי טיפולי', 'טיפול אינטגרטיבי']);
  assert.deepEqual(inline, ['פרטני כללי', 'קבוצה', 'מעקב פסיכיאטרי']);
});

test('partitionTypes: grouping keeps the SPECIFIC value — never the group label', () => {
  const { grouped } = ClinicalSync.partitionTypes(ClinicalSync.INDIVIDUAL_BILLING_TYPES.slice());
  // The values are the distinct clinical names; the label 'פרטני' is never one
  // of the option values.
  assert.deepEqual(grouped, ClinicalSync.INDIVIDUAL_BILLING_TYPES);
  assert.ok(grouped.indexOf(ClinicalSync.GROUP_LABEL) === -1, 'group label is display only');
});

test('partitionTypes: order within each bucket is preserved', () => {
  const names = ['טיפול אינטגרטיבי', 'משהו אחר', 'פסיכודינמי'];
  const { inline, grouped } = ClinicalSync.partitionTypes(names);
  assert.deepEqual(grouped, ['טיפול אינטגרטיבי', 'פסיכודינמי']);
  assert.deepEqual(inline, ['משהו אחר']);
});
