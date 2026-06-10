/**
 * Regression test: the cross-app proxy routes must inject the right shared
 * secret server-side and forward to the correct sibling Apps Script URL, so
 * the browser never sees a secret and only ever calls relative /api/... paths.
 *
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * Strategy: stub global.fetch BEFORE requiring server.js, capture the outbound
 * URL, fire a real HTTP request at each route, assert the URL + secret.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const TEST_PORT = 31837;
const SHEETS_URL = 'https://script.example.com/macros/s/THERAPISTS/exec';
const OUTPATIENT_SHEETS_URL = 'https://script.example.com/macros/s/OUTPATIENT/exec';
const DASHBOARD_SHEETS_URL = 'https://script.example.com/macros/s/DASHBOARD/exec';
const DEBT_STATUS_SECRET = 'debt-sekret-1';
const TREATMENT_PLANS_SECRET = 'plans-sekret-2';
const OCCUPANCY_SECRET = 'occ-sekret-3';

process.env.PORT = String(TEST_PORT);
process.env.SHEETS_URL = SHEETS_URL;
process.env.OUTPATIENT_SHEETS_URL = OUTPATIENT_SHEETS_URL;
process.env.DASHBOARD_SHEETS_URL = DASHBOARD_SHEETS_URL;
process.env.DEBT_STATUS_SECRET = DEBT_STATUS_SECRET;
process.env.TREATMENT_PLANS_SECRET = TREATMENT_PLANS_SECRET;
process.env.OCCUPANCY_SECRET = OCCUPANCY_SECRET;

let capturedUrl = null;
global.fetch = async (url) => {
  capturedUrl = url;
  return {
    status: 200,
    text: async () => JSON.stringify({ ok: true, source: 'test' }),
  };
};

// Import the app and start a server we control, so the test runner can exit
// cleanly (the server is closed in the after() hook below).
const app = require('../server');
let server;
test.before(() => { server = app.start(TEST_PORT); });
test.after(() => { if (server) server.close(); });

function httpGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: TEST_PORT, path }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
  });
}

async function waitForListen() {
  for (let i = 0; i < 50; i++) {
    try { await httpGet('/healthz'); return; }
    catch (_) { await new Promise((r) => setTimeout(r, 50)); }
  }
  throw new Error('server did not start listening');
}

test('/api/debt-status forwards getDebtStatus + DEBT_STATUS_SECRET to the outpatient URL', async () => {
  await waitForListen();
  capturedUrl = null;
  const res = await httpGet('/api/debt-status');
  assert.equal(res.status, 200);
  assert.ok(capturedUrl.startsWith(OUTPATIENT_SHEETS_URL), `got: ${capturedUrl}`);
  assert.ok(capturedUrl.includes('action=getDebtStatus'), `got: ${capturedUrl}`);
  assert.ok(capturedUrl.includes(`secret=${encodeURIComponent(DEBT_STATUS_SECRET)}`), `got: ${capturedUrl}`);
});

test('/api/treatment-plans forwards getTreatmentPlans + TREATMENT_PLANS_SECRET to the outpatient URL', async () => {
  await waitForListen();
  capturedUrl = null;
  const res = await httpGet('/api/treatment-plans');
  assert.equal(res.status, 200);
  assert.ok(capturedUrl.startsWith(OUTPATIENT_SHEETS_URL), `got: ${capturedUrl}`);
  assert.ok(capturedUrl.includes('action=getTreatmentPlans'), `got: ${capturedUrl}`);
  assert.ok(capturedUrl.includes(`secret=${encodeURIComponent(TREATMENT_PLANS_SECRET)}`), `got: ${capturedUrl}`);
});

test('/api/admitted forwards getAdmittedRoster + OCCUPANCY_SECRET to the dashboard URL', async () => {
  await waitForListen();
  capturedUrl = null;
  const res = await httpGet('/api/admitted');
  assert.equal(res.status, 200);
  assert.ok(capturedUrl.startsWith(DASHBOARD_SHEETS_URL), `got: ${capturedUrl}`);
  assert.ok(capturedUrl.includes('action=getAdmittedRoster'), `got: ${capturedUrl}`);
  assert.ok(capturedUrl.includes(`secret=${encodeURIComponent(OCCUPANCY_SECRET)}`), `got: ${capturedUrl}`);
});

test('the debt secret is bound to the debt route only (not leaked to dashboard)', async () => {
  await waitForListen();
  capturedUrl = null;
  await httpGet('/api/admitted');
  assert.ok(!capturedUrl.includes(DEBT_STATUS_SECRET), `dashboard URL must not carry the debt secret: ${capturedUrl}`);
});
