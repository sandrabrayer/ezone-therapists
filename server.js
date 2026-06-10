const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Env config -------------------------------------------------------------
// SHEETS_URL              — this app's OWN Apps Script Web App (treatment logs,
//                           approvals). Required.
// OUTPATIENT_SHEETS_URL   — the ezone-outpatient Apps Script /exec URL, source
//                           of the cross-app debt gate (getDebtStatus) and the
//                           treatment-plan roster (getTreatmentPlans).
// DEBT_STATUS_SECRET      — shared secret for outpatient getDebtStatus.
// TREATMENT_PLANS_SECRET  — shared secret for outpatient getTreatmentPlans.
// DASHBOARD_SHEETS_URL    — the E-Zone-Dashboard Apps Script /exec URL, source
//                           of the admitted/occupancy roster (getAdmittedRoster).
// OCCUPANCY_SECRET        — shared secret for the dashboard getAdmittedRoster.
//
// Secrets are NEVER sent to the browser. The frontend calls relative /api/...
// routes; this server injects the secret and forwards to the sibling Apps
// Script. Same shared-secret pattern as getWinbackSource on the outpatient side.
const SHEETS_URL = process.env.SHEETS_URL || '';
const OUTPATIENT_SHEETS_URL = process.env.OUTPATIENT_SHEETS_URL || '';
const DEBT_STATUS_SECRET = process.env.DEBT_STATUS_SECRET || '';
const TREATMENT_PLANS_SECRET = process.env.TREATMENT_PLANS_SECRET || '';
const DASHBOARD_SHEETS_URL = process.env.DASHBOARD_SHEETS_URL || '';
const OCCUPANCY_SECRET = process.env.OCCUPANCY_SECRET || '';
const BUILD = String(Date.now());

// --- Cache config -----------------------------------------------------------
// Caches the slow `getData` bulk read from this app's own Apps Script in
// memory. Writes (POST) automatically invalidate the cache so saves are
// reflected. Pass ?fresh=1 to force a live fetch and refresh the cache.
//
// The cross-app debt gate is DELIBERATELY NOT cached: a debt decision must be
// live, never stale. Treatment-plan and admitted rosters are read live too.
const CACHE_TTL_MS = 60 * 1000;          // 60 seconds
const STALE_FALLBACK_MS = 10 * 60 * 1000; // serve stale up to 10 min if upstream fails
const getDataCache = {
  data: null,
  status: null,
  timestamp: 0
};
function isCacheFresh() {
  return getDataCache.data && (Date.now() - getDataCache.timestamp) < CACHE_TTL_MS;
}
function isCacheStaleButUsable() {
  return getDataCache.data && (Date.now() - getDataCache.timestamp) < STALE_FALLBACK_MS;
}
function invalidateCache() {
  getDataCache.data = null;
  getDataCache.status = null;
  getDataCache.timestamp = 0;
}
// ---------------------------------------------------------------------------

app.use(express.json({ limit: '2mb' }));

const INDEX_PATH = path.join(__dirname, 'public', 'index.html');
function sendIndex(res) {
  fs.readFile(INDEX_PATH, 'utf8', (err, html) => {
    if (err) return res.status(500).send('index load error');
    res.set('Cache-Control', 'no-store');
    res.type('html').send(html.replace(/__BUILD__/g, BUILD));
  });
}
app.get('/', (req, res) => sendIndex(res));
app.get('/index.html', (req, res) => sendIndex(res));

app.use(express.static(path.join(__dirname, 'public')));

const lastLoad = {
  at: null,
  status: null,
  treatments: 0,
  approvals: 0,
  error: null
};

function requireSheetsUrl(res) {
  if (!SHEETS_URL) {
    res.status(500).json({
      ok: false,
      error: 'SHEETS_URL env var is not configured on the server.'
    });
    return false;
  }
  return true;
}

// Fetch a sibling Apps Script GET action with the shared secret injected
// server-side. Never-fail-open: any upstream/parse error becomes a 502 with
// ok:false so the consumer treats it as "couldn't determine", never "clear".
async function proxyGet(baseUrl, action, secret, res, label) {
  if (!baseUrl) {
    return res.status(500).json({
      ok: false,
      error: label + ' source URL is not configured on the server.'
    });
  }
  try {
    const url = baseUrl
      + (baseUrl.includes('?') ? '&' : '?')
      + 'action=' + encodeURIComponent(action)
      + (secret ? '&secret=' + encodeURIComponent(secret) : '');
    const r = await fetch(url, { redirect: 'follow' });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); }
    catch (_) { throw new Error('Non-JSON from ' + label + ': ' + text.slice(0, 200)); }
    res.status(r.status).json(data);
  } catch (err) {
    res.status(502).json({ ok: false, error: String(err) });
  }
}

app.get('/api/sheets', async (req, res) => {
  if (!requireSheetsUrl(res)) return;

  const action = (req.query && req.query.action) || 'getData';
  const forceFresh = req.query && (req.query.fresh === '1' || req.query.fresh === 'true');

  // Serve from cache when possible: only for the bulk read, and only when
  // the caller hasn't explicitly asked for a fresh fetch.
  if (action === 'getData' && !forceFresh && isCacheFresh()) {
    res.set('X-Cache', 'HIT');
    return res.status(getDataCache.status || 200).json(getDataCache.data);
  }

  try {
    const url = SHEETS_URL
      + (SHEETS_URL.includes('?') ? '&' : '?')
      + 'action=' + encodeURIComponent(action)
      + (req.query.secret ? '&secret=' + encodeURIComponent(req.query.secret) : '');
    const r = await fetch(url, { redirect: 'follow' });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); }
    catch (_) { throw new Error('Non-JSON from Apps Script: ' + text.slice(0, 200)); }

    // Track load metrics + populate cache only on the bulk read.
    if (action === 'getData') {
      lastLoad.at = new Date().toISOString();
      lastLoad.status = r.status;
      lastLoad.treatments = Array.isArray(data.treatments) ? data.treatments.length : 0;
      lastLoad.approvals = Array.isArray(data.approvals) ? data.approvals.length : 0;
      lastLoad.error = data.ok === false ? (data.error || 'unknown') : null;

      // Only cache successful responses
      if (r.status >= 200 && r.status < 300 && data.ok !== false) {
        getDataCache.data = data;
        getDataCache.status = r.status;
        getDataCache.timestamp = Date.now();
      }
    }

    res.set('X-Cache', 'MISS');
    res.status(r.status).json(data);
  } catch (err) {
    lastLoad.at = new Date().toISOString();
    lastLoad.status = 'error';
    lastLoad.error = String(err);

    // Graceful degradation: if Apps Script fails on a getData call but we
    // still have a recent-ish cached copy, serve that instead of erroring.
    if (action === 'getData' && isCacheStaleButUsable()) {
      res.set('X-Cache', 'STALE');
      res.set('X-Cache-Error', String(err).slice(0, 200));
      return res.status(getDataCache.status || 200).json(getDataCache.data);
    }

    res.status(502).json({ ok: false, error: String(err) });
  }
});

app.post('/api/sheets', async (req, res) => {
  if (!requireSheetsUrl(res)) return;
  try {
    // Pass through whatever action the client asked for.
    const body = Object.assign({}, req.body || {});
    if (!body.action) body.action = 'saveTreatment';
    const r = await fetch(SHEETS_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); }
    catch (_) { throw new Error('Non-JSON from Apps Script: ' + text.slice(0, 200)); }

    // Any successful write invalidates the cache so the next read is fresh.
    if (r.status >= 200 && r.status < 300 && data.ok !== false) {
      invalidateCache();
    }

    res.status(r.status).json(data);
  } catch (err) {
    res.status(502).json({ ok: false, error: String(err) });
  }
});

// --- Cross-app reads (secrets injected server-side) -------------------------
// The debt gate. NOT cached — a debt decision must be live, never stale.
app.get('/api/debt-status', (req, res) =>
  proxyGet(OUTPATIENT_SHEETS_URL, 'getDebtStatus', DEBT_STATUS_SECRET, res, 'outpatient debt status'));

// Outpatient treatment-plan roster (name, phone, serviceType, sessions).
app.get('/api/treatment-plans', (req, res) =>
  proxyGet(OUTPATIENT_SHEETS_URL, 'getTreatmentPlans', TREATMENT_PLANS_SECRET, res, 'outpatient treatment plans'));

// Admitted/occupancy roster from the dashboard (name, phone, house).
app.get('/api/admitted', (req, res) =>
  proxyGet(DASHBOARD_SHEETS_URL, 'getAdmittedRoster', OCCUPANCY_SECRET, res, 'dashboard admitted roster'));

app.get('/api/debug/env', (req, res) => {
  res.json({
    ok: true,
    node: process.version,
    port: PORT,
    sheetsUrlConfigured: !!SHEETS_URL,
    sheetsUrlHost: SHEETS_URL ? new URL(SHEETS_URL).host : null,
    outpatientUrlConfigured: !!OUTPATIENT_SHEETS_URL,
    debtSecretConfigured: !!DEBT_STATUS_SECRET,
    treatmentPlansSecretConfigured: !!TREATMENT_PLANS_SECRET,
    dashboardUrlConfigured: !!DASHBOARD_SHEETS_URL,
    occupancySecretConfigured: !!OCCUPANCY_SECRET
  });
});

app.get('/api/debug/routes', (req, res) => {
  const routes = [];
  app._router.stack.forEach((m) => {
    if (m.route) {
      const methods = Object.keys(m.route.methods).map((x) => x.toUpperCase());
      routes.push({ path: m.route.path, methods });
    }
  });
  res.json({ ok: true, routes });
});

app.get('/api/debug/last-load', (req, res) => {
  res.json({ ok: true, lastLoad });
});

app.get('/api/debug/cache', (req, res) => {
  const ageMs = getDataCache.timestamp ? Date.now() - getDataCache.timestamp : null;
  res.json({
    ok: true,
    cached: !!getDataCache.data,
    ageMs,
    ttlMs: CACHE_TTL_MS,
    fresh: isCacheFresh(),
    staleButUsable: !isCacheFresh() && isCacheStaleButUsable(),
    treatments: getDataCache.data && Array.isArray(getDataCache.data.treatments) ? getDataCache.data.treatments.length : 0,
    approvals: getDataCache.data && Array.isArray(getDataCache.data.approvals) ? getDataCache.data.approvals.length : 0
  });
});

// Manually clear the cache (handy for debugging)
app.post('/api/debug/cache/clear', (req, res) => {
  invalidateCache();
  res.json({ ok: true, cleared: true });
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.get('*', (req, res) => sendIndex(res));

// Start only when run directly (`node server.js`). When required by a test the
// app is exported instead, so the test owns the server lifecycle and the test
// runner can exit cleanly instead of hanging on a listening socket.
function start(port) {
  return app.listen(port || PORT, () => {
    console.log(`E-ZONE Therapists listening on :${port || PORT}`);
    console.log(`SHEETS_URL configured: ${!!SHEETS_URL}`);
    console.log(`OUTPATIENT_SHEETS_URL configured: ${!!OUTPATIENT_SHEETS_URL} (debt gate + treatment plans)`);
    console.log(`DASHBOARD_SHEETS_URL configured: ${!!DASHBOARD_SHEETS_URL} (admitted roster)`);
    console.log(`Cache TTL: ${CACHE_TTL_MS}ms, stale fallback: ${STALE_FALLBACK_MS}ms`);
  });
}

if (require.main === module) {
  start();
}

module.exports = app;
module.exports.start = start;
