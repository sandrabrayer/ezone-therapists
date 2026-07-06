/**
 * Fail-closed test: when STOP_ALERTS_SECRET is NOT configured, the /api/stop-alerts
 * routes must refuse with a clear 500 and must NEVER call the sibling Apps Script.
 * The alerts are never fetched or cleared without the configured secret.
 *
 * Own process (node --test runs each file in its own worker) so the env can be
 * set WITHOUT the secret before server.js is required.
 *
 * Run with:  npm test     (Node >= 18, built-in test runner)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const TEST_PORT = 31842;
const SHEETS_URL = 'https://script.example.com/macros/s/THERAPISTS/exec';
const OUTPATIENT_SHEETS_URL = 'https://script.example.com/macros/s/OUTPATIENT/exec';

process.env.PORT = String(TEST_PORT);
process.env.SHEETS_URL = SHEETS_URL;
process.env.OUTPATIENT_SHEETS_URL = OUTPATIENT_SHEETS_URL;
delete process.env.STOP_ALERTS_SECRET;   // the whole point: secret is UNSET

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

test('GET /api/stop-alerts is a clear 500 (fail-closed) when STOP_ALERTS_SECRET is unset', async () => {
  await waitForListen();
  called = false;
  const res = await httpGet('/api/stop-alerts');
  assert.equal(res.status, 500);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, false);
  assert.ok(/STOP_ALERTS_SECRET/.test(body.error), `error should name the missing var: ${body.error}`);
  assert.equal(called, false, 'must not call the sibling Apps Script');
});

test('POST /api/stop-alerts/read is a clear 500 (fail-closed) when STOP_ALERTS_SECRET is unset', async () => {
  await waitForListen();
  called = false;
  const res = await httpReq('POST', '/api/stop-alerts/read', { id: 'x' });
  assert.equal(res.status, 500);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, false);
  assert.ok(/STOP_ALERTS_SECRET/.test(body.error), `error should name the missing var: ${body.error}`);
  assert.equal(called, false, 'must not call the sibling Apps Script');
});

test('POST /api/stop-alerts/unread is a clear 500 (fail-closed) when STOP_ALERTS_SECRET is unset', async () => {
  await waitForListen();
  called = false;
  const res = await httpReq('POST', '/api/stop-alerts/unread', { id: 'x' });
  assert.equal(res.status, 500);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, false);
  assert.ok(/STOP_ALERTS_SECRET/.test(body.error), `error should name the missing var: ${body.error}`);
  assert.equal(called, false, 'must not call the sibling Apps Script');
});
