'use strict';

/**
 * Route tests for the patient-management proxy. The four /api/patient-* routes
 * must inject PATIENT_MGMT_SECRET server-side (never sent by the browser),
 * forward to this app's own SHEETS_URL with the right action, and validate the
 * phone shape BEFORE forwarding (defense in depth).
 *
 * Strategy: stub global.fetch BEFORE requiring server.js, capture the outbound
 * URL/body, fire real HTTP requests, assert.
 *
 * Run with:  npm test     (Node >= 18, built-in test runner)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const TEST_PORT = 31861;
const SHEETS_URL = 'https://script.example.com/macros/s/THERAPISTS/exec';
const PATIENT_MGMT_SECRET = 'patient-mgmt-sekret-9';

process.env.PORT = String(TEST_PORT);
process.env.SHEETS_URL = SHEETS_URL;
process.env.PATIENT_MGMT_SECRET = PATIENT_MGMT_SECRET;

let captured = { url: null, method: null, body: null };
global.fetch = async (url, opts) => {
  captured = { url, method: (opts && opts.method) || 'GET', body: opts && opts.body ? JSON.parse(opts.body) : null };
  return { status: 200, text: async () => JSON.stringify({ ok: true, source: 'test' }) };
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

function resetCaptured() { captured = { url: null, method: null, body: null }; }

// ---- GET notes ---------------------------------------------------------------
test('GET /api/patient-notes/:phone forwards getPatientNotes + secret + phone', async () => {
  await waitForListen();
  resetCaptured();
  const res = await httpGet('/api/patient-notes/0501234567');
  assert.equal(res.status, 200);
  assert.ok(captured.url.startsWith(SHEETS_URL), `got: ${captured.url}`);
  assert.ok(captured.url.includes('action=getPatientNotes'), `got: ${captured.url}`);
  assert.ok(captured.url.includes(`secret=${encodeURIComponent(PATIENT_MGMT_SECRET)}`), `got: ${captured.url}`);
  assert.ok(captured.url.includes('phone=0501234567'), `got: ${captured.url}`);
});

test('GET /api/patient-notes/:phone rejects a non-canonical phone (400, no fetch)', async () => {
  await waitForListen();
  resetCaptured();
  const res = await httpGet('/api/patient-notes/050-123-4567');
  assert.equal(res.status, 400);
  assert.equal(captured.url, null, 'must not call the sibling Apps Script');
});

// ---- POST note ---------------------------------------------------------------
test('POST /api/patient-notes forwards addPatientNote + secret in the body', async () => {
  await waitForListen();
  resetCaptured();
  const res = await httpReq('POST', '/api/patient-notes',
    { phone: '0501234567', author: 'ד"ר כהן', type: 'clinical', text: 'שיחה' });
  assert.equal(res.status, 200);
  assert.equal(captured.method, 'POST');
  assert.equal(captured.url, SHEETS_URL);
  assert.equal(captured.body.action, 'addPatientNote');
  assert.equal(captured.body.secret, PATIENT_MGMT_SECRET);
  assert.equal(captured.body.phone, '0501234567');
  assert.equal(captured.body.type, 'clinical');
});

test('POST /api/patient-notes rejects a non-canonical phone (400, no fetch)', async () => {
  await waitForListen();
  resetCaptured();
  const res = await httpReq('POST', '/api/patient-notes', { phone: '501234567', type: 'clinical', text: 'x' });
  assert.equal(res.status, 400);
  assert.equal(captured.url, null);
});

// ---- GET / POST meta ---------------------------------------------------------
test('GET /api/patient-meta/:phone forwards getPatientMeta + secret + phone', async () => {
  await waitForListen();
  resetCaptured();
  const res = await httpGet('/api/patient-meta/0501234567');
  assert.equal(res.status, 200);
  assert.ok(captured.url.includes('action=getPatientMeta'), `got: ${captured.url}`);
  assert.ok(captured.url.includes(`secret=${encodeURIComponent(PATIENT_MGMT_SECRET)}`), `got: ${captured.url}`);
  assert.ok(captured.url.includes('phone=0501234567'), `got: ${captured.url}`);
});

test('POST /api/patient-meta forwards setPatientMeta + secret + fields + updatedBy', async () => {
  await waitForListen();
  resetCaptured();
  const res = await httpReq('POST', '/api/patient-meta', {
    phone: '0501234567', updatedBy: 'יעל',
    fields: { status: 'frozen', statusReason: 'הפסקה', contactPhone: '0522223333' }
  });
  assert.equal(res.status, 200);
  assert.equal(captured.body.action, 'setPatientMeta');
  assert.equal(captured.body.secret, PATIENT_MGMT_SECRET);
  assert.equal(captured.body.updatedBy, 'יעל');
  assert.equal(captured.body.fields.status, 'frozen');
});

test('POST /api/patient-meta rejects a non-canonical contactPhone (400, no fetch)', async () => {
  await waitForListen();
  resetCaptured();
  const res = await httpReq('POST', '/api/patient-meta',
    { phone: '0501234567', fields: { contactPhone: '052-222-3333' } });
  assert.equal(res.status, 400);
  assert.equal(captured.url, null);
});

test('POST /api/patient-meta allows an empty contactPhone', async () => {
  await waitForListen();
  resetCaptured();
  const res = await httpReq('POST', '/api/patient-meta',
    { phone: '0501234567', fields: { contactPhone: '' } });
  assert.equal(res.status, 200);
  assert.equal(captured.body.action, 'setPatientMeta');
});

// ---- Follow-up routes --------------------------------------------------------
test('GET /api/followups/:phone forwards getFollowUps + secret + phone', async () => {
  await waitForListen();
  resetCaptured();
  const res = await httpGet('/api/followups/0501234567');
  assert.equal(res.status, 200);
  assert.ok(captured.url.includes('action=getFollowUps'), `got: ${captured.url}`);
  assert.ok(captured.url.includes(`secret=${encodeURIComponent(PATIENT_MGMT_SECRET)}`), `got: ${captured.url}`);
  assert.ok(captured.url.includes('phone=0501234567'), `got: ${captured.url}`);
});

test('GET /api/followups/:phone rejects a non-canonical phone (400, no fetch)', async () => {
  await waitForListen();
  resetCaptured();
  const res = await httpGet('/api/followups/050-1');
  assert.equal(res.status, 400);
  assert.equal(captured.url, null);
});

test('POST /api/followups forwards addFollowUp + secret in the body', async () => {
  await waitForListen();
  resetCaptured();
  const res = await httpReq('POST', '/api/followups',
    { phone: '0501234567', createdBy: 'יעל', dueDate: '2026-08-20', text: 'להתקשר' });
  assert.equal(res.status, 200);
  assert.equal(captured.body.action, 'addFollowUp');
  assert.equal(captured.body.secret, PATIENT_MGMT_SECRET);
  assert.equal(captured.body.dueDate, '2026-08-20');
  assert.equal(captured.body.text, 'להתקשר');
});

test('POST /api/followups rejects a non-canonical phone (400, no fetch)', async () => {
  await waitForListen();
  resetCaptured();
  const res = await httpReq('POST', '/api/followups', { phone: '501234567', dueDate: '2026-08-20', text: 'x' });
  assert.equal(res.status, 400);
  assert.equal(captured.url, null);
});

test('POST /api/followups/done forwards setFollowUpDone + secret; requires id', async () => {
  await waitForListen();
  resetCaptured();
  const ok = await httpReq('POST', '/api/followups/done', { phone: '0501234567', id: 'fu_x', done: true, doneBy: 'יעל' });
  assert.equal(ok.status, 200);
  assert.equal(captured.body.action, 'setFollowUpDone');
  assert.equal(captured.body.secret, PATIENT_MGMT_SECRET);
  assert.equal(captured.body.id, 'fu_x');
  // missing id → 400, no fetch
  resetCaptured();
  const bad = await httpReq('POST', '/api/followups/done', { phone: '0501234567', done: true });
  assert.equal(bad.status, 400);
  assert.equal(captured.url, null);
});

test('GET /api/followup-counts forwards getOpenFollowUpCounts + secret, no phone', async () => {
  await waitForListen();
  resetCaptured();
  const res = await httpGet('/api/followup-counts');
  assert.equal(res.status, 200);
  assert.ok(captured.url.includes('action=getOpenFollowUpCounts'), `got: ${captured.url}`);
  assert.ok(captured.url.includes(`secret=${encodeURIComponent(PATIENT_MGMT_SECRET)}`), `got: ${captured.url}`);
  assert.ok(!captured.url.includes('phone='), 'counts is a bulk call — no phone param');
});

// ---- The secret never crosses to the browser ---------------------------------
test('the patient-mgmt secret is never echoed in a response body', async () => {
  await waitForListen();
  const res = await httpGet('/api/patient-notes/0501234567');
  assert.ok(!res.body.includes(PATIENT_MGMT_SECRET), 'response must not leak the secret');
});
