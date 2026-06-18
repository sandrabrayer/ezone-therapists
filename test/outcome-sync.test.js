'use strict';

/**
 * Unit tests for public/outcome-sync.js — the SESSION-OUTCOME push that fires
 * when a therapist marks a session outcome (Task 4.8 step 3).
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * Locks shut the four things the feature must get right:
 *   1. the push fires on EACH of the three outcomes with the correct
 *      CANONICAL-phone payload (10-digit leading zero), and the secret travels in
 *      that payload (read from config, never hardcoded);
 *   2. every response outcome is handled — ok:true is the ONLY success, and
 *      unknown_therapist / unknown_type / unauthorized / unconfigured / non-ok /
 *      non-2xx each surface a distinct flag (never fail-open / never swallowed);
 *   3. the secret is whatever config supplies (never hardcoded in the module);
 *   4. a clean/absent sync warns nothing — the LOCAL outcome is unaffected by the
 *      push, only the pay-sync is flagged.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const OutcomeSync = require('../public/outcome-sync');

const OUTCOMES = ['happened', 'therapist_cancelled', 'patient_no_show'];

// --- buildPayload: fires on each outcome, canonical phone + secret from config -

test('buildPayload: emits the recordSessionOutcome contract with a canonical phone', () => {
  const r = OutcomeSync.buildPayload({
    sessionId: 'sess-1', phone: '0501234567', therapist: 'דנה',
    clinicalTreatmentType: 'פסיכודינמי', date: '2026-06-18', outcome: 'happened'
  }, 'sekret-xyz');
  assert.equal(r.ok, true);
  assert.deepEqual(r.payload, {
    action: 'recordSessionOutcome',
    secret: 'sekret-xyz',
    sessionId: 'sess-1',
    phone: '0501234567',
    therapist: 'דנה',
    clinicalTreatmentType: 'פסיכודינמי',
    date: '2026-06-18',
    outcome: 'happened'
  });
});

test('buildPayload: fires on ALL THREE outcomes, carrying the outcome verbatim', () => {
  OUTCOMES.forEach((outcome) => {
    const r = OutcomeSync.buildPayload({
      sessionId: 's', phone: '0501234567', therapist: 'ת', date: 'd', outcome
    }, 's');
    assert.equal(r.ok, true, `${outcome} must build a payload`);
    assert.equal(r.payload.outcome, outcome);
    assert.equal(r.payload.phone, '0501234567', 'phone stays canonical for every outcome');
  });
});

test('buildPayload: normalizes a fixable phone to the 10-digit leading-zero key', () => {
  // +972 / separators are normalized to the canonical key before sending.
  const r = OutcomeSync.buildPayload(
    { sessionId: 's', phone: '+972 50-123-4567', therapist: 'ת', date: 'd', outcome: 'happened' }, 's');
  assert.equal(r.ok, true);
  assert.equal(r.payload.phone, '0501234567');
});

test('buildPayload: an un-canonicalizable phone is flagged, not sent', () => {
  const r = OutcomeSync.buildPayload(
    { sessionId: 's', phone: '12345', therapist: 'ת', date: 'd', outcome: 'happened' }, 's');
  assert.deepEqual(r, { ok: false, reason: 'invalid_phone' });
});

test('buildPayload: frequency is NOT sent — outpatient handles its absence (e.g. ליווי)', () => {
  const r = OutcomeSync.buildPayload({
    sessionId: 's', phone: '0501234567', therapist: 'ת', date: 'd', outcome: 'happened',
    frequency: 2, frequencyPerWeek: 2
  }, 's');
  assert.equal(r.ok, true);
  assert.ok(!('frequency' in r.payload), 'frequency must not be in the payload');
  assert.ok(!('frequencyPerWeek' in r.payload), 'frequencyPerWeek must not be in the payload');
});

test('buildPayload: the secret is taken from config, not hardcoded', () => {
  // Two different configured secrets must flow through verbatim — proving the
  // module never substitutes a baked-in value.
  const base = { sessionId: 's', phone: '0501234567', therapist: 'ת', date: 'd', outcome: 'happened' };
  assert.equal(OutcomeSync.buildPayload(base, 'AAA').payload.secret, 'AAA');
  assert.equal(OutcomeSync.buildPayload(base, 'BBB').payload.secret, 'BBB');
  // And the source text carries no literal secret assignment.
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'outcome-sync.js'), 'utf8');
  assert.ok(!/secret\s*[:=]\s*['"][^'"]+['"]/.test(src), 'module must not hardcode a secret literal');
});

// --- interpretResponse: every outcome handled, never fail-open -------------

test('interpretResponse: ok:true is the only success (no matched count needed)', () => {
  assert.deepEqual(OutcomeSync.interpretResponse(200, { ok: true }), { ok: true });
  assert.deepEqual(OutcomeSync.interpretResponse(200, { ok: true, status: 'paid' }), { ok: true });
});

test('interpretResponse: unknown_therapist / unknown_type / unauthorized surface verbatim', () => {
  assert.deepEqual(OutcomeSync.interpretResponse(200, { ok: false, reason: 'unknown_therapist' }), { ok: false, reason: 'unknown_therapist' });
  assert.deepEqual(OutcomeSync.interpretResponse(200, { ok: false, reason: 'unknown_type' }), { ok: false, reason: 'unknown_type' });
  // outpatient may report the auth failure under `error` rather than `reason`.
  assert.deepEqual(OutcomeSync.interpretResponse(200, { ok: false, error: 'unauthorized' }), { ok: false, reason: 'unauthorized' });
});

test('interpretResponse: ok:false without a reason is a non_ok flag (never fail-open)', () => {
  assert.deepEqual(OutcomeSync.interpretResponse(200, { ok: false }), { ok: false, reason: 'non_ok' });
  assert.deepEqual(OutcomeSync.interpretResponse(200, null), { ok: false, reason: 'non_ok' });
});

test('interpretResponse: a non-2xx status is flagged with its code', () => {
  assert.deepEqual(OutcomeSync.interpretResponse(500, { ok: true }), { ok: false, reason: 'http_500' });
  assert.deepEqual(OutcomeSync.interpretResponse(404, null), { ok: false, reason: 'http_404' });
});

// --- warningFor: failed outcomes warn, clean ones stay quiet ---------------

test('warningFor: a clean / absent sync produces no warning (local outcome unaffected)', () => {
  assert.equal(OutcomeSync.warningFor({ ok: true }), null);
  assert.equal(OutcomeSync.warningFor(null), null);
  assert.equal(OutcomeSync.warningFor(undefined), null);
});

test('warningFor: each failure reason maps to a Hebrew message (never swallowed)', () => {
  ['unknown_therapist', 'unknown_type', 'unauthorized', 'unconfigured', 'invalid_phone', 'unreachable', 'non_ok']
    .forEach((reason) => {
      const w = OutcomeSync.warningFor({ ok: false, reason });
      assert.equal(typeof w, 'string');
      assert.ok(w.length > 0, `reason ${reason} must yield a message`);
    });
});

test('warningFor: an unmapped reason still warns (e.g. http_500), never silent', () => {
  const w = OutcomeSync.warningFor({ ok: false, reason: 'http_500' });
  assert.equal(typeof w, 'string');
  assert.ok(w.includes('http_500'));
});
