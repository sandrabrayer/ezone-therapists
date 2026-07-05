/**
 * Regression test: the /api/stop-alerts proxy routes must inject STOP_ALERTS_SECRET
 * server-side and forward to the outpatient Apps Script, so the browser never sees
 * the secret and only ever calls relative /api/... paths.
 *
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * Strategy: stub global.fetch BEFORE requiring server.js, capture the outbound
 * request (url + method + body), fire a real HTTP request at each route, assert.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const TEST_PORT = 31841;
const SHEETS_URL = 'https://script.example.com/macros/s/THERAPISTS/exec';
const OUTPATIENT_SHEETS_URL = 'https://script.example.com/macros/s/OUTPATIENT/exec';
const STOP_ALERTS_SECRET = 'stop-sekret-9';

process.env.PORT = String(TEST_PORT);
process.env.SHEETS_URL = SHEETS_URL;
process.env.OUTPATIENT_SHEETS_URL = OUTPATIENT_SHEETS_URL;
process.env.STOP_ALERTS_SECRET = STOP_ALERTS_SECRET;

let captured = null;
global.fetch = async (url, opts) => {
  captured = { url, opts: opts || {} };
  return {
    status: 200,
    text: async () => JSON.stringify({ ok: true, source: 'test' }),
  };
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

test('GET /api/stop-alerts forwards getStopAlerts + STOP_ALERTS_SECRET to the outpatient URL', async () => {
  await waitForListen();
  captured = null;
  const res = await httpGet('/api/stop-alerts');
  assert.equal(res.status, 200);
  assert.ok(captured.url.startsWith(OUTPATIENT_SHEETS_URL), `got: ${captured.url}`);
  assert.ok(captured.url.includes('action=getStopAlerts'), `got: ${captured.url}`);
  assert.ok(captured.url.includes(`secret=${encodeURIComponent(STOP_ALERTS_SECRET)}`), `got: ${captured.url}`);
});

test('POST /api/stop-alerts/read posts markStopAlertRead + secret + id to the outpatient URL', async () => {
  await waitForListen();
  captured = null;
  const res = await httpReq('POST', '/api/stop-alerts/read', { id: 'alert-123' });
  assert.equal(res.status, 200);
  assert.equal(captured.opts.method, 'POST');
  assert.equal(captured.url, OUTPATIENT_SHEETS_URL);
  const sent = JSON.parse(captured.opts.body);
  assert.equal(sent.action, 'markStopAlertRead');
  assert.equal(sent.secret, STOP_ALERTS_SECRET);
  assert.equal(sent.id, 'alert-123');
});

test('POST /api/stop-alerts/read without an id is rejected 400 and never calls upstream', async () => {
  await waitForListen();
  captured = null;
  const res = await httpReq('POST', '/api/stop-alerts/read', {});
  assert.equal(res.status, 400);
  assert.equal(captured, null, 'must not call the sibling with no id');
});

test('the stop-alerts secret is bound to its routes only (not leaked to the debt route)', async () => {
  await waitForListen();
  captured = null;
  await httpGet('/api/debt-status');
  assert.ok(!captured.url.includes(STOP_ALERTS_SECRET), `debt URL must not carry the stop-alerts secret: ${captured.url}`);
});
