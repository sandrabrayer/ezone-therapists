'use strict';

/**
 * Fail-closed test: when PATIENT_MGMT_SECRET is NOT configured, every
 * /api/patient-* route must refuse with a clear 500 and must NEVER call the
 * sibling Apps Script. The notes/meta are never read or written without the
 * configured secret.
 *
 * Own process (node --test runs each file in its own worker) so the env can be
 * set WITHOUT the secret before server.js is required.
 *
 * Run with:  npm test     (Node >= 18, built-in test runner)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const TEST_PORT = 31862;
const SHEETS_URL = 'https://script.example.com/macros/s/THERAPISTS/exec';

process.env.PORT = String(TEST_PORT);
process.env.SHEETS_URL = SHEETS_URL;
delete process.env.PATIENT_MGMT_SECRET;   // the whole point: secret is UNSET

let called = false;
global.fetch = async () => {
  called = true;
  return { status: 200, text: async () => JSON.stringify({ ok: true }) };
};

const app = require('../server');
let server;
test.before(() => { server = app.start(TEST_PORT); });
test.after(() => { if (server) server.close(); });

function httpReq(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1', port: TEST_PORT, path, method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
    }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const httpGet = (path) => httpReq('GET', path);

async function waitForListen() {
  for (let i = 0; i < 50; i++) {
    try { await httpGet('/healthz'); return; }
    catch (_) { await new Promise((r) => setTimeout(r, 50)); }
  }
  throw new Error('server did not start listening');
}

function assertFailClosed(res) {
  assert.equal(res.status, 500);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, false);
  assert.ok(/PATIENT_MGMT_SECRET/.test(body.error), `error should name the missing var: ${body.error}`);
  assert.equal(called, false, 'must not call the sibling Apps Script');
}

test('GET /api/patient-notes fail-closed when PATIENT_MGMT_SECRET unset', async () => {
  await waitForListen();
  called = false;
  assertFailClosed(await httpGet('/api/patient-notes/0501234567'));
});

test('POST /api/patient-notes fail-closed when PATIENT_MGMT_SECRET unset', async () => {
  await waitForListen();
  called = false;
  assertFailClosed(await httpReq('POST', '/api/patient-notes',
    { phone: '0501234567', type: 'clinical', text: 'x' }));
});

test('GET /api/patient-meta fail-closed when PATIENT_MGMT_SECRET unset', async () => {
  await waitForListen();
  called = false;
  assertFailClosed(await httpGet('/api/patient-meta/0501234567'));
});

test('POST /api/patient-meta fail-closed when PATIENT_MGMT_SECRET unset', async () => {
  await waitForListen();
  called = false;
  assertFailClosed(await httpReq('POST', '/api/patient-meta', { phone: '0501234567', fields: {} }));
});

test('GET /api/followups fail-closed when PATIENT_MGMT_SECRET unset', async () => {
  await waitForListen();
  called = false;
  assertFailClosed(await httpGet('/api/followups/0501234567'));
});

test('POST /api/followups fail-closed when PATIENT_MGMT_SECRET unset', async () => {
  await waitForListen();
  called = false;
  assertFailClosed(await httpReq('POST', '/api/followups',
    { phone: '0501234567', dueDate: '2026-08-20', text: 'x' }));
});

test('POST /api/followups/done fail-closed when PATIENT_MGMT_SECRET unset', async () => {
  await waitForListen();
  called = false;
  assertFailClosed(await httpReq('POST', '/api/followups/done', { phone: '0501234567', id: 'fu_x', done: true }));
});

test('GET /api/followup-counts fail-closed when PATIENT_MGMT_SECRET unset', async () => {
  await waitForListen();
  called = false;
  assertFailClosed(await httpGet('/api/followup-counts'));
});
