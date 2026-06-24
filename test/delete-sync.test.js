'use strict';

/**
 * Unit tests for the CROSS-APP DATA-INTEGRITY fixes:
 *   (a) assignment phone is canonicalized on save (no more assignment↔patient
 *       phone mismatch — the רון מנחם bug), and an empty/invalid phone is rejected
 *       exactly like _savePatient;
 *   (b) cross-app patient DELETE propagation — public/delete-sync.js, the pure
 *       payload-builder + response-interpreter mirrored by Code.gs
 *       _postDeactivateClient, plus a pure mirror of the outpatient receiver
 *       proving the deactivate-match and the orphan-safe (no match → no crash)
 *       behavior.
 *
 * Run with:  npm test     (Node >= 18, built-in test runner)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const DeleteSync = require('../public/delete-sync');
const Phone = require('../public/phone');

const CODE_GS = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

// =========================================================================
// (a) _saveAssignment canonicalizes the phone (mirror guard on Code.gs)
// =========================================================================
// _saveAssignment lives in Apps Script (not importable), so we assert against
// the source that it now mirrors _savePatient's phone discipline: reject empty
// (missing_phone), then canonicalize+validate (invalid_phone), then STORE the
// canonical value — never the raw a.patientPhone.

function saveAssignmentBody() {
  const m = CODE_GS.match(/function _saveAssignment\(payload\)\s*\{[\s\S]*?\n\}/);
  assert.ok(m, '_saveAssignment must exist in Code.gs');
  return m[0];
}

test('_saveAssignment rejects an empty phone with missing_phone (consistent with _savePatient)', () => {
  const body = saveAssignmentBody();
  assert.match(body, /\.trim\(\)\s*===\s*''\)\s*return\s*\{\s*ok:\s*false,\s*error:\s*'missing_phone'/,
    'empty phone must still be rejected as missing_phone');
});

test('_saveAssignment canonicalizes via _toCanonicalPhone and rejects non-canonical (invalid_phone)', () => {
  const body = saveAssignmentBody();
  assert.match(body, /var phone = _toCanonicalPhone\(a\.patientPhone\);/,
    'phone must be canonicalized with _toCanonicalPhone');
  assert.match(body, /if \(!phone\) return \{ ok: false, error: 'invalid_phone' \};/,
    'a non-canonical phone must be rejected as invalid_phone');
});

test('_saveAssignment stores the canonical phone, NOT the raw a.patientPhone', () => {
  const body = saveAssignmentBody();
  assert.match(body, /patientPhone:\s*phone,/, 'the stored row must use the canonical `phone` var');
  assert.doesNotMatch(body, /patientPhone:\s*String\(a\.patientPhone/,
    'the raw trimmed a.patientPhone must no longer be stored');
});

// The canonicalization rule itself (mirrored by _toCanonicalPhone) — the same
// Phone.toCanonical that _savePatient relies on. A messy-but-fixable phone
// becomes the canonical key; empty/garbage is rejected.
test('assignment phone rule: a fixable phone canonicalizes to the 10-digit key', () => {
  assert.deepEqual(Phone.toCanonical('+972 50-123-4567'), { ok: true, value: '0501234567' });
  assert.deepEqual(Phone.toCanonical('0501234567'), { ok: true, value: '0501234567' });
});

test('assignment phone rule: empty and un-canonicalizable phones are rejected', () => {
  assert.equal(Phone.toCanonical('').ok, false);
  assert.equal(Phone.toCanonical('   ').ok, false);
  assert.equal(Phone.toCanonical('12345').ok, false);
});

// =========================================================================
// (b) cross-app delete propagation — delete-sync.buildPayload
// =========================================================================

test('buildPayload: emits the deactivateClient contract with a CANONICAL phone + secret', () => {
  const r = DeleteSync.buildPayload('0501234567', 'sekret-xyz', { deactivatedBy: 'כנרת', reason: 'נמחק' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.payload, {
    action: 'deactivateClient',
    secret: 'sekret-xyz',
    phone: '0501234567',
    deactivatedBy: 'כנרת',
    reason: 'נמחק'
  });
});

test('buildPayload: normalizes a fixable phone to the 10-digit leading-zero key', () => {
  const r = DeleteSync.buildPayload('+972 50-123-4567', 's');
  assert.equal(r.ok, true);
  assert.equal(r.payload.phone, '0501234567');
});

test('buildPayload: defaults the reason to patient_deleted when none given', () => {
  const r = DeleteSync.buildPayload('0501234567', 's');
  assert.equal(r.payload.reason, 'patient_deleted');
  assert.equal(r.payload.deactivatedBy, '');
});

test('buildPayload: an un-canonicalizable phone is flagged, not sent', () => {
  assert.deepEqual(DeleteSync.buildPayload('12345', 's'), { ok: false, error: 'invalid_phone' });
  assert.deepEqual(DeleteSync.buildPayload('', 's'), { ok: false, error: 'invalid_phone' });
});

// --- interpretResponse: fail-closed on transport/auth, orphan-safe on no-match -

test('interpretResponse: ok:true with a match count is success', () => {
  assert.deepEqual(DeleteSync.interpretResponse(200, { ok: true, deactivated: 1 }), { ok: true, deactivated: 1 });
});

test('interpretResponse: ORPHAN-SAFE — ok:true, deactivated:0 (no Client matched) still succeeds', () => {
  assert.deepEqual(DeleteSync.interpretResponse(200, { ok: true, deactivated: 0 }), { ok: true, deactivated: 0 });
});

test('interpretResponse: a non-2xx aborts the local delete (fail-closed)', () => {
  assert.deepEqual(DeleteSync.interpretResponse(401, null), { ok: false, error: 'http_401' });
  assert.deepEqual(DeleteSync.interpretResponse(500, { ok: true, deactivated: 1 }), { ok: false, error: 'http_500' });
});

test('interpretResponse: ok:false surfaces the error (e.g. unauthorized) and aborts', () => {
  assert.deepEqual(DeleteSync.interpretResponse(200, { ok: false, error: 'unauthorized' }), { ok: false, error: 'unauthorized' });
  assert.deepEqual(DeleteSync.interpretResponse(200, {}), { ok: false, error: 'non_ok' });
  assert.deepEqual(DeleteSync.interpretResponse(200, null), { ok: false, error: 'non_ok' });
});

// =========================================================================
// (b) cross-app delete — Code.gs sender + _removePatient wiring (mirror guard)
// =========================================================================

test('Code.gs _postDeactivateClient exists, sends the canonical phone + dedicated secret, fail-closed', () => {
  assert.match(CODE_GS, /function _postDeactivateClient\(body\)/);
  assert.match(CODE_GS, /_toCanonicalPhone\(body && body\.phone\)/, 'canonical phone is sent');
  assert.match(CODE_GS, /getProperty\('DEACTIVATE_CLIENT_SECRET'\)/, 'uses its own dedicated secret');
  assert.match(CODE_GS, /action=deactivateClient/);
  assert.match(CODE_GS, /return \{ ok: false, error: 'deactivate_unconfigured' \}/, 'unset secret/url fails closed');
});

test('Code.gs _removePatient is FAIL-CLOSED on the deactivate before deleting locally', () => {
  const m = CODE_GS.match(/function _removePatient\(payload\)\s*\{[\s\S]*?\n\}/);
  assert.ok(m, '_removePatient must exist');
  const body = m[0];
  assert.match(body, /_postDeactivateClient\(/, '_removePatient must propagate the delete');
  assert.match(body, /if \(!deactivate\.ok\) return \{ ok: false, error: deactivate\.error \|\| 'deactivate_failed' \};/,
    'a failed deactivate aborts the local delete (no half-state)');
  // ordering: the deactivate guard must come before the local row delete
  assert.ok(body.indexOf('_postDeactivateClient(') < body.indexOf('_deleteLocalPatient('),
    'deactivate must run BEFORE _deleteLocalPatient');
});

// =========================================================================
// (b) pure mirror of the OUTPATIENT receiver — proves deactivate-match +
//     orphan-safety (the receiver itself ships in docs/outpatient-
//     deactivateClient.patch.md; this mirrors its matching logic).
// =========================================================================

function receiverKey(raw) {                  // mirror of the receiver's tolerant phone key
  let d = String(raw == null ? '' : raw).replace(/[^\d]/g, '');
  if (!d) return '';
  if (d.indexOf('972') === 0) d = '0' + d.slice(3);
  if (d.length === 9 && d.charAt(0) !== '0') d = '0' + d;   // recover Sheets-dropped zero
  return d;
}

function deactivateClient(clients, phone) {   // pure mirror of _deactivateClient
  const key = receiverKey(phone);
  if (!key) return { ok: false, error: 'invalid_phone' };
  let n = 0;
  const out = clients.map((c) => {
    if (receiverKey(c.phone) === key && String(c.active) !== 'false') { n++; return Object.assign({}, c, { active: 'false' }); }
    return c;
  });
  return { ok: true, deactivated: n, clients: out };
}

test('receiver: deactivates the matching Client (even an orphan whose stored phone lost its zero)', () => {
  const clients = [{ phone: 501234567, name: 'רון מנחם', active: 'true' }, { phone: '0529999999', name: 'אורי', active: 'true' }];
  const r = deactivateClient(clients, '0501234567');     // canonical; stored lost its zero
  assert.equal(r.ok, true);
  assert.equal(r.deactivated, 1);
  assert.equal(r.clients[0].active, 'false', 'matched client is now inactive → leaves the roster union');
  assert.equal(r.clients[1].active, 'true', 'other clients untouched');
});

test('receiver: ORPHAN-SAFE — a phone matching no Client returns deactivated:0, no crash', () => {
  const r = deactivateClient([{ phone: '0529999999', active: 'true' }], '0501234567');
  assert.deepEqual(r, { ok: true, deactivated: 0, clients: [{ phone: '0529999999', active: 'true' }] });
});

test('receiver: an empty client list does not crash (deactivated:0)', () => {
  assert.deepEqual(deactivateClient([], '0501234567'), { ok: true, deactivated: 0, clients: [] });
});
