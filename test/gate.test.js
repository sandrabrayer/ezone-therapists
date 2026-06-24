'use strict';

/**
 * Tests for the shared UI-gate password (server-side check).
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * Verifies: GET /api/gate reports required true/false from APP_PASSWORD; POST
 * verifies the password; the secret is NEVER in any response body. Mirrors the
 * stub-env + real-HTTP approach of sheets-secret-forwarding.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const TEST_PORT = 31947;
const APP_PASSWORD = 'sup3r-secret-gate';

process.env.PORT = String(TEST_PORT);
process.env.SHEETS_URL = 'https://script.example.com/macros/s/THERAPISTS/exec';
process.env.APP_PASSWORD = APP_PASSWORD;

// Prevent any accidental outbound fetch from hanging the test.
global.fetch = async () => ({ status: 200, text: async () => JSON.stringify({ ok: true }) });

const app = require('../server');
let server;
test.before(() => { server = app.start(TEST_PORT); });
test.after(() => { if (server) server.close(); });

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      { host: '127.0.0.1', port: TEST_PORT, path, method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} },
      (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b })); }
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function waitForListen() {
  for (let i = 0; i < 50; i++) {
    try { await req('GET', '/healthz'); return; } catch (_) { await new Promise((r) => setTimeout(r, 50)); }
  }
  throw new Error('server did not start');
}

test('GET /api/gate reports required when APP_PASSWORD is set, never the value', async () => {
  await waitForListen();
  const res = await req('GET', '/api/gate');
  assert.equal(res.status, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.required, true);
  assert.ok(!res.body.includes(APP_PASSWORD), 'gate status must not leak the password');
});

test('POST /api/gate: correct password → ok:true; secret never echoed', async () => {
  await waitForListen();
  const res = await req('POST', '/api/gate', { password: APP_PASSWORD });
  const j = JSON.parse(res.body);
  assert.equal(j.ok, true);
  assert.ok(!res.body.includes(APP_PASSWORD), 'response must not echo the password');
});

test('POST /api/gate: wrong / empty / missing password → ok:false', async () => {
  await waitForListen();
  assert.equal(JSON.parse((await req('POST', '/api/gate', { password: 'nope' })).body).ok, false);
  assert.equal(JSON.parse((await req('POST', '/api/gate', { password: '' })).body).ok, false);
  assert.equal(JSON.parse((await req('POST', '/api/gate', {})).body).ok, false);
});
