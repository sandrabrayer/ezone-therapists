'use strict';

/**
 * Tests for the staffing→Therapists roster sync (PR A: engine + read-only
 * preview; PR B: the _getData write path).
 *
 *  1. public/roster-sync.js — the PURE planner: add/deactivate/reactivate/
 *     unchanged classification, byte-exact matching (nearMatches are report-
 *     only), the possibleRenames heuristic, and applyPlan (no delete, no
 *     rename, deactivation only when explicitly allowed).
 *  2. Mirror guard: the core between the BEGIN/END markers must be
 *     BYTE-IDENTICAL in public/roster-sync.js and apps-script/Code.gs.
 *  3. vm-sandbox of apps-script/Code.gs: _staffingRoster fails CLOSED on
 *     unset property / non-2xx / non-JSON / wrong shape, and
 *     previewStaffingRosterSync NEVER writes to any sheet.
 *  4. PR B write path: _getData syncs the Therapists sheet from the feed —
 *     exactly the planned cell writes (active flips + appends, never a delete
 *     or rename, no other sheet touched), fail-soft serve-as-is on
 *     unconfigured/unavailable, the 120s CacheService window, and the
 *     Scheduling.activeNames integration. Plus source guards: no
 *     THERAPISTS_SEED, no cleanupTherapistRosterNow, SW cache bumped.
 *
 * Run with:  npm test     (Node >= 18, built-in test runner)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const RS = require('../public/roster-sync');

const sheetRow = (name, active) => ({ name, active });
const feedRow = (name, active) => ({ name, active });

// =========================================================================
// 1. planRosterSync — classification
// =========================================================================

test('add: a feed name missing from the sheet is added', () => {
  const p = RS.planRosterSync([sheetRow('הילה תבור', 'true')],
    [feedRow('הילה תבור', true), feedRow('נרי אופק', true)]);
  assert.deepEqual(p.add, ['נרי אופק']);
  assert.deepEqual(p.deactivate, []);
  assert.deepEqual(p.reactivate, []);
  assert.equal(p.unchanged, 1);
});

test('deactivate: feed says active=false for a sheet-active name', () => {
  const p = RS.planRosterSync([sheetRow('רמי רום', 'true')], [feedRow('רמי רום', false)]);
  assert.deepEqual(p.deactivate, ['רמי רום']);
  assert.equal(p.unchanged, 0);
});

test('deactivate: a sheet-active name ABSENT from the feed (also unknownInSheet)', () => {
  const p = RS.planRosterSync([sheetRow('רמי רום', 'true')], [feedRow('הילה תבור', true)]);
  assert.deepEqual(p.deactivate, ['רמי רום']);
  assert.deepEqual(p.unknownInSheet, ['רמי רום']);
  assert.deepEqual(p.add, ['הילה תבור']);
});

test('a sheet-INACTIVE name absent from the feed is unknownInSheet but NOT deactivated again', () => {
  const p = RS.planRosterSync([sheetRow('רמי רום', 'false')], []);
  assert.deepEqual(p.unknownInSheet, ['רמי רום']);
  assert.deepEqual(p.deactivate, []);
});

test('reactivate: sheet active=false, feed active=true', () => {
  const p = RS.planRosterSync([sheetRow('דנה דרוקר', 'false')], [feedRow('דנה דרוקר', true)]);
  assert.deepEqual(p.reactivate, ['דנה דרוקר']);
  assert.equal(p.unchanged, 0);
});

test('unchanged counts matches whose active flag agrees (both states)', () => {
  const p = RS.planRosterSync(
    [sheetRow('א ב', 'true'), sheetRow('ג ד', 'false')],
    [feedRow('א ב', true), feedRow('ג ד', false)]);
  assert.equal(p.unchanged, 2);
  assert.deepEqual(p.add, []);
  assert.deepEqual(p.deactivate, []);
  assert.deepEqual(p.reactivate, []);
});

test('a blank sheet active flag means ACTIVE (scheduling.js isActive semantics)', () => {
  const p = RS.planRosterSync([sheetRow('א ב', '')], [feedRow('א ב', false)]);
  assert.deepEqual(p.deactivate, ['א ב']);
});

// =========================================================================
// 1b. byte-exact matching + nearMatches (report-only, never merged)
// =========================================================================

test('gershayim variant is NOT unchanged: exact-string mismatch → add + deactivate + nearMatch', () => {
  // Sheet has ASCII-quote ד"ר, feed has gershayim ד״ר — different bytes.
  const p = RS.planRosterSync(
    [sheetRow('ד"ר נטליה סדוגין', 'true')],
    [feedRow('ד״ר נטליה סדוגין', true)]);
  assert.equal(p.unchanged, 0, 'must NOT be treated as the same name');
  assert.deepEqual(p.deactivate, ['ד"ר נטליה סדוגין'], 'sheet spelling would deactivate');
  assert.deepEqual(p.add, ['ד״ר נטליה סדוגין'], 'feed spelling would be added');
  assert.deepEqual(p.nearMatches, [
    { sheet: 'ד"ר נטליה סדוגין', feed: 'ד״ר נטליה סדוגין', reason: 'gershayim' }
  ]);
  assert.deepEqual(p.possibleRenames, [], 'a nearMatch pair is not reported as a rename too');
});

test('trailing-space variant → nearMatch reason whitespace (matched via trim, still flagged)', () => {
  const p = RS.planRosterSync([sheetRow('שירן כהן ', 'true')], [feedRow('שירן כהן', true)]);
  assert.equal(p.unchanged, 1, 'trim-matched, active agrees');
  assert.deepEqual(p.nearMatches, [{ sheet: 'שירן כהן ', feed: 'שירן כהן', reason: 'whitespace' }]);
});

test('internal double-space variant → NOT matched, nearMatch reason whitespace', () => {
  const p = RS.planRosterSync([sheetRow('שירן  כהן', 'true')], [feedRow('שירן כהן', true)]);
  assert.equal(p.unchanged, 0);
  assert.deepEqual(p.nearMatches, [{ sheet: 'שירן  כהן', feed: 'שירן כהן', reason: 'whitespace' }]);
});

test('gershayim + spacing both differing → reason gershayim+whitespace', () => {
  const p = RS.planRosterSync([sheetRow('ד"ר  ילנה', 'true')], [feedRow('ד״ר ילנה', true)]);
  assert.deepEqual(p.nearMatches, [{ sheet: 'ד"ר  ילנה', feed: 'ד״ר ילנה', reason: 'gershayim+whitespace' }]);
});

test('byte-identical names never appear in nearMatches', () => {
  const p = RS.planRosterSync([sheetRow('הילה תבור', 'true')], [feedRow('הילה תבור', true)]);
  assert.deepEqual(p.nearMatches, []);
});

// =========================================================================
// 1c. possibleRenames heuristic
// =========================================================================

test('possibleRenames fires for שירן → שירן כהן (one sheet-only + one feed-only, shared first token)', () => {
  const p = RS.planRosterSync(
    [sheetRow('שירן', 'true'), sheetRow('הילה תבור', 'true')],
    [feedRow('שירן כהן', true), feedRow('הילה תבור', true)]);
  assert.deepEqual(p.possibleRenames, [{ from: 'שירן', to: 'שירן כהן' }]);
  // and the exact-match rules still hold — nothing is auto-merged:
  assert.deepEqual(p.deactivate, ['שירן']);
  assert.deepEqual(p.add, ['שירן כהן']);
});

test('possibleRenames does NOT fire for unrelated names', () => {
  const p = RS.planRosterSync([sheetRow('רמי רום', 'true')], [feedRow('נרי אופק', true)]);
  assert.deepEqual(p.possibleRenames, []);
});

test('possibleRenames does NOT fire when the first token is ambiguous (two candidates)', () => {
  const p = RS.planRosterSync(
    [sheetRow('שירן', 'true')],
    [feedRow('שירן כהן', true), feedRow('שירן לוי', true)]);
  assert.deepEqual(p.possibleRenames, []);
});

// =========================================================================
// 1d. applyPlan — explicit deactivation, never delete, never rename
// =========================================================================

test('applyPlan with allowDeactivate:false emits ONLY add + reactivate writes', () => {
  const plan = {
    add: ['נרי אופק'], reactivate: ['דנה דרוקר'], deactivate: ['רמי רום'],
    unchanged: 5, nearMatches: [], possibleRenames: [], unknownInSheet: ['רמי רום']
  };
  assert.deepEqual(RS.applyPlan(plan, { allowDeactivate: false }), [
    { name: 'נרי אופק', active: 'true' },
    { name: 'דנה דרוקר', active: 'true' }
  ]);
});

test('applyPlan with allowDeactivate:true adds the deactivations (active=false writes)', () => {
  const plan = { add: ['א'], reactivate: [], deactivate: ['ב'], unchanged: 0,
    nearMatches: [], possibleRenames: [], unknownInSheet: [] };
  assert.deepEqual(RS.applyPlan(plan, { allowDeactivate: true }), [
    { name: 'א', active: 'true' },
    { name: 'ב', active: 'false' }
  ]);
});

test('applyPlan NEVER emits a delete or a rename — every write is exactly {name, active}', () => {
  const plan = RS.planRosterSync(
    [sheetRow('שירן', 'true'), sheetRow('ד"ר ילנה', 'true')],
    [feedRow('שירן כהן', true), feedRow('ד״ר ילנה', true), feedRow('חדש לגמרי', false)]);
  const writes = RS.applyPlan(plan, { allowDeactivate: true });
  writes.forEach((w) => {
    assert.deepEqual(Object.keys(w).sort(), ['active', 'name'], 'no delete/rename/other verbs');
    assert.ok(w.active === 'true' || w.active === 'false');
    assert.equal(typeof w.name, 'string');
  });
  // possibleRenames / nearMatches never reach the writes:
  const names = writes.map((w) => w.name);
  assert.ok(!names.some((n) => n.includes('→')), 'no rename encoding');
});

test('applyPlan of an empty/absent plan is a no-op', () => {
  assert.deepEqual(RS.applyPlan(null, { allowDeactivate: true }), []);
  assert.deepEqual(RS.applyPlan({}, { allowDeactivate: true }), []);
});

// =========================================================================
// 2. Mirror guard — Code.gs core is BYTE-IDENTICAL to public/roster-sync.js
// =========================================================================

const MODULE_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'roster-sync.js'), 'utf8');
const CODE_GS_SRC = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

function coreBlock(src, label) {
  const begin = '/* === BEGIN roster-sync core';
  const end = '/* === END roster-sync core === */';
  const b = src.indexOf(begin);
  const e = src.indexOf(end);
  assert.ok(b > -1, label + ': BEGIN marker present');
  assert.ok(e > b, label + ': END marker present after BEGIN');
  // From the end of the BEGIN marker line to the END marker.
  const afterBegin = src.indexOf('\n', b) + 1;
  return src.slice(afterBegin, e);
}

test('roster-sync core is byte-identical between public/roster-sync.js and Code.gs', () => {
  assert.equal(coreBlock(CODE_GS_SRC, 'Code.gs'), coreBlock(MODULE_SRC, 'roster-sync.js'),
    'the mirrored function bodies must not drift — edit BOTH files together');
});

test('Code.gs dispatches the previewStaffingRosterSync action (POST)', () => {
  assert.ok(/if \(action === 'previewStaffingRosterSync'\) return _json\(_previewStaffingRosterSync\(\)\);/.test(CODE_GS_SRC));
});

test('PR B guards: NO therapist seed left — _getData syncs from staffing instead', () => {
  assert.ok(!CODE_GS_SRC.includes('THERAPISTS_SEED'),
    'THERAPISTS_SEED must be fully gone from Code.gs (the roster has no seed)');
  assert.ok(!CODE_GS_SRC.includes('cleanupTherapistRosterNow'),
    'cleanupTherapistRosterNow is superseded by the sync and must be gone');
  assert.ok(/_syncTherapistsFromStaffing/.test(CODE_GS_SRC),
    '_getData must run the staffing sync');
  assert.ok(!/_ensureSeededList\('Therapists'/.test(CODE_GS_SRC),
    'the Therapists sheet must not go through _ensureSeededList anymore');
});

test('service worker cache version bumped for the sync UI (>= v17)', () => {
  const sw = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  const m = sw.match(/ezone-therapists-v(\d+)/);
  assert.ok(m, 'sw.js must define a versioned cache name');
  assert.ok(Number(m[1]) >= 17, 'cache version must be >= v17 so clients pick up the roster-sync frontend');
});

// =========================================================================
// 3. vm-sandbox of Code.gs — fail-closed fetch + zero-write preview
// =========================================================================

function makeSheet(headers, rows) {
  // grid holds the header row + data rows, addressed 1-based like Sheets.
  const grid = [headers.slice()].concat(
    rows.map((r) => headers.map((h) => (r[h] === undefined || r[h] === null) ? '' : r[h])));
  const writes = [];
  return {
    _writes: writes,
    getLastRow: () => grid.length,
    getLastColumn: () => headers.length,
    getMaxRows: () => grid.length + 10,
    setFrozenRows: () => {},
    appendRow: (row) => { writes.push({ op: 'appendRow', row }); grid.push(row); },
    deleteRow: (n) => { writes.push({ op: 'deleteRow', n }); },
    getRange: (row, col, numRows, numCols) => {
      numRows = numRows || 1; numCols = numCols || 1;
      return {
        getValues: () => {
          const out = [];
          for (let r = 0; r < numRows; r++) {
            const src = grid[row - 1 + r] || [];
            const line = [];
            for (let c = 0; c < numCols; c++) {
              line.push(src[col - 1 + c] === undefined ? '' : src[col - 1 + c]);
            }
            out.push(line);
          }
          return out;
        },
        // Record AND apply, so a post-write _readAll sees the new state (the
        // write-path tests read the synced roster back).
        setValues: (vals) => {
          writes.push({ op: 'setValues', row, col, vals });
          for (let r = 0; r < vals.length; r++) {
            while (grid.length < row + r) grid.push([]);
            const line = grid[row - 1 + r];
            for (let c = 0; c < vals[r].length; c++) line[col - 1 + c] = vals[r][c];
          }
        },
        setNumberFormat: () => {},
        clearContent: () => { writes.push({ op: 'clearContent', row, col }); }
      };
    }
  };
}

// Values built inside the vm have the vm realm's prototypes, which strict
// deepEqual rejects — JSON round-trip them into this realm before comparing.
const j = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

function gsContext(opts) {
  opts = opts || {};
  const props = opts.props || {};
  const sheets = {};
  for (const name of Object.keys(opts.sheets || {})) {
    const def = opts.sheets[name];
    sheets[name] = makeSheet(def.headers, def.rows || []);
  }
  const fetchCalls = [];
  const ctx = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => sheets[n] || null,
        insertSheet: (n) => { sheets[n] = makeSheet([], []); return sheets[n]; }
      })
    },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) })
    },
    UrlFetchApp: {
      fetch: (url, params) => {
        fetchCalls.push({ url, params });
        if (!opts.fetch) throw new Error('network unavailable');
        return opts.fetch(url, params);
      }
    },
    Session: { getScriptTimeZone: () => 'Asia/Jerusalem' },
    Utilities: { formatDate: (d) => String(d) },
    Logger: { log: () => {} },
    ContentService: {
      createTextOutput: (s) => ({ setMimeType: () => ({ _json: s }) }),
      MimeType: { JSON: 'JSON' }
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} })
    },
    // Map-backed (TTL ignored — tests model "within the 120s window" by sharing
    // one store, "expired" by using a fresh one). opts.cacheStore lets two vm
    // contexts share a store, modelling two separate Apps Script executions.
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (k in cacheStore ? cacheStore[k] : null),
        put: (k, v) => { cacheStore[k] = v; }
      })
    }
  };
  const cacheStore = opts.cacheStore || {};
  vm.createContext(ctx);
  vm.runInContext(CODE_GS_SRC, ctx);
  return { ctx, sheets, fetchCalls, cacheStore };
}

const okResponse = (body) => () => ({
  getResponseCode: () => 200,
  getContentText: () => JSON.stringify(body)
});

const THERAPISTS_SHEET = {
  headers: ['name', 'active'],
  rows: [{ name: 'הילה תבור', active: 'true' }, { name: 'רמי רום', active: 'true' }]
};

test('_staffingRoster: STAFFING_SHEETS_URL unset → unconfigured, no fetch', () => {
  const { ctx, fetchCalls } = gsContext({ props: {} });
  assert.deepEqual(j(ctx._staffingRoster()), { status: 'unconfigured' });
  assert.equal(fetchCalls.length, 0, 'must not attempt a network call');
});

test('_staffingRoster: non-2xx response → unavailable (fail closed)', () => {
  const { ctx } = gsContext({
    props: { STAFFING_SHEETS_URL: 'https://x/exec' },
    fetch: () => ({ getResponseCode: () => 500, getContentText: () => 'oops' })
  });
  assert.deepEqual(j(ctx._staffingRoster()), { status: 'unavailable' });
});

test('_staffingRoster: non-JSON body → unavailable (fail closed)', () => {
  const { ctx } = gsContext({
    props: { STAFFING_SHEETS_URL: 'https://x/exec' },
    fetch: () => ({ getResponseCode: () => 200, getContentText: () => '<html>sign in</html>' })
  });
  assert.deepEqual(j(ctx._staffingRoster()), { status: 'unavailable' });
});

test('_staffingRoster: wrong shapes → unavailable (therapists not an array; entry missing/bad fields)', () => {
  const shapes = [
    { ok: true, therapists: 'x' },
    { ok: true, therapists: [{ name: 'א' }] },                       // missing active
    { ok: true, therapists: [{ active: true }] },                    // missing name
    { ok: true, therapists: [{ name: 'א', active: 'true' }] },       // active not boolean
    { ok: true, therapists: [{ name: 7, active: true }] },           // name not string
    { ok: true, therapists: [null] },
    { ok: false, therapists: [] },                                   // ok:false refused
    {}
  ];
  for (const body of shapes) {
    const { ctx } = gsContext({
      props: { STAFFING_SHEETS_URL: 'https://x/exec' },
      fetch: okResponse(body)
    });
    assert.deepEqual(j(ctx._staffingRoster()), { status: 'unavailable' },
      'shape must fail closed: ' + JSON.stringify(body));
  }
});

test('_staffingRoster: fetch throws → unavailable (fail closed)', () => {
  const { ctx } = gsContext({ props: { STAFFING_SHEETS_URL: 'https://x/exec' } });   // no fetch mock → throws
  assert.deepEqual(j(ctx._staffingRoster()), { status: 'unavailable' });
});

test('_staffingRoster: valid feed → ok, secret + action in URL, per-execution cache (one fetch)', () => {
  const feed = [{ name: 'הילה תבור', active: true }];
  const { ctx, fetchCalls } = gsContext({
    props: { STAFFING_SHEETS_URL: 'https://x/exec', STAFFING_THERAPISTS_SECRET: 's&crt' },
    fetch: okResponse({ ok: true, therapists: feed })
  });
  assert.deepEqual(j(ctx._staffingRoster()), { status: 'ok', therapists: feed });
  ctx._staffingRoster();
  assert.equal(fetchCalls.length, 1, 'second call must hit the per-execution cache');
  assert.ok(fetchCalls[0].url.includes('action=getTherapistsForTherapists'));
  assert.ok(fetchCalls[0].url.includes('secret=' + encodeURIComponent('s&crt')));
  assert.equal(fetchCalls[0].params.muteHttpExceptions, true);
  assert.equal(fetchCalls[0].params.followRedirects, true);
});

test('previewStaffingRosterSync: read-only — ZERO sheet writes on a live diff', () => {
  const { ctx, sheets } = gsContext({
    props: { STAFFING_SHEETS_URL: 'https://x/exec', STAFFING_THERAPISTS_SECRET: 's' },
    sheets: { Therapists: THERAPISTS_SHEET },
    fetch: okResponse({
      ok: true,
      therapists: [
        { name: 'הילה תבור', active: true },
        { name: 'נרי אופק', active: true }      // new in feed; רמי רום absent
      ]
    })
  });
  const r = j(ctx._previewStaffingRosterSync());
  assert.equal(r.ok, true);
  assert.equal(r.source, 'ok');
  assert.deepEqual(r.plan.add, ['נרי אופק']);
  assert.deepEqual(r.plan.deactivate, ['רמי רום']);
  assert.deepEqual(r.plan.unknownInSheet, ['רמי רום']);
  assert.equal(r.plan.unchanged, 1);
  for (const name of Object.keys(sheets)) {
    assert.deepEqual(sheets[name]._writes, [], 'sheet "' + name + '" must not be written');
  }
});

test('previewStaffingRosterSync: unconfigured → {source:unconfigured, plan:null}, zero writes, no sheet touch', () => {
  const { ctx, sheets, fetchCalls } = gsContext({ props: {}, sheets: { Therapists: THERAPISTS_SHEET } });
  assert.deepEqual(j(ctx._previewStaffingRosterSync()), { ok: true, source: 'unconfigured', plan: null });
  assert.equal(fetchCalls.length, 0);
  assert.deepEqual(sheets.Therapists._writes, []);
});

test('previewStaffingRosterSync: unavailable feed → {source:unavailable, plan:null}, zero writes', () => {
  const { ctx, sheets } = gsContext({
    props: { STAFFING_SHEETS_URL: 'https://x/exec' },
    sheets: { Therapists: THERAPISTS_SHEET },
    fetch: () => ({ getResponseCode: () => 502, getContentText: () => '' })
  });
  assert.deepEqual(j(ctx._previewStaffingRosterSync()), { ok: true, source: 'unavailable', plan: null });
  assert.deepEqual(sheets.Therapists._writes, []);
});

test('doPost routes previewStaffingRosterSync and stays read-only end-to-end', () => {
  const { ctx, sheets } = gsContext({
    props: { STAFFING_SHEETS_URL: 'https://x/exec' },
    sheets: { Therapists: THERAPISTS_SHEET },
    fetch: okResponse({ ok: true, therapists: [{ name: 'הילה תבור', active: true }, { name: 'רמי רום', active: true }] })
  });
  const out = ctx.doPost({ parameter: { action: 'previewStaffingRosterSync' } });
  const body = JSON.parse(out._json);
  assert.equal(body.ok, true);
  assert.equal(body.source, 'ok');
  assert.equal(body.plan.unchanged, 2);
  assert.deepEqual(sheets.Therapists._writes, []);
});

test('vm sandbox parity: Code.gs planRosterSync agrees with the Node module', () => {
  const { ctx } = gsContext({});
  const sheetRows = [sheetRow('שירן', 'true'), sheetRow('ד"ר ילנה', 'true'), sheetRow('הילה תבור', 'false')];
  const feedRows = [feedRow('שירן כהן', true), feedRow('ד״ר ילנה', true), feedRow('הילה תבור', true)];
  assert.deepEqual(j(ctx.planRosterSync(sheetRows, feedRows)), RS.planRosterSync(sheetRows, feedRows));
  const plan = RS.planRosterSync(sheetRows, feedRows);
  assert.deepEqual(j(ctx.applyPlan(plan, { allowDeactivate: false })), RS.applyPlan(plan, { allowDeactivate: false }));
});

// =========================================================================
// 4. PR B — the write path (_syncTherapistsFromStaffing inside _getData)
// =========================================================================

const Scheduling = require('../public/scheduling');

// One context just to read Code.gs's header/seed constants for sheet fixtures.
const headerCtx = gsContext({}).ctx;

// Every sheet _getData touches, prepopulated with its REAL headers (and the
// TreatmentTypes seed rows) so the only writes left to observe are the sync's.
function allSheets(therapistRows) {
  return {
    Schedule: { headers: j(headerCtx.SCHEDULE_HEADERS) },
    Approvals: { headers: j(headerCtx.APPROVALS_HEADERS) },
    Patients: { headers: j(headerCtx.PATIENTS_HEADERS) },
    Assignments: { headers: j(headerCtx.ASSIGNMENTS_HEADERS) },
    Therapists: { headers: ['name', 'active'], rows: therapistRows },
    TreatmentTypes: { headers: j(headerCtx.TREATMENT_TYPES_HEADERS), rows: j(headerCtx.TREATMENT_TYPES_SEED) }
  };
}

// Sheet rows 2/3/4; feed says: reactivate דנה, add נרי, drop רמי (absent).
const SYNC_SHEET_ROWS = [
  { name: 'הילה תבור', active: 'true' },
  { name: 'רמי רום', active: 'true' },
  { name: 'דנה דרוקר', active: 'false' }
];
const SYNC_FEED = [
  { name: 'הילה תבור', active: true },
  { name: 'דנה דרוקר', active: true },
  { name: 'נרי אופק', active: true }
];
const SYNC_PROPS = { STAFFING_SHEETS_URL: 'https://x/exec', STAFFING_THERAPISTS_SECRET: 's' };

test('_getData feed ok: writes exactly the planned cells (active flips + append), nothing else', () => {
  const { ctx, sheets, fetchCalls } = gsContext({
    props: SYNC_PROPS,
    sheets: allSheets(SYNC_SHEET_ROWS),
    fetch: okResponse({ ok: true, therapists: SYNC_FEED })
  });
  const data = j(ctx._getData());
  assert.equal(data.ok, true);
  assert.equal(data.rosterSource, 'staffing');
  assert.deepEqual(data.rosterSyncSummary, { added: 1, deactivated: 1, reactivated: 1 });
  // The returned therapists ARE the post-sync sheet: existing rows keep their
  // position (never deleted, never renamed), the new name is appended active.
  assert.deepEqual(data.therapists, [
    { name: 'הילה תבור', active: 'true' },
    { name: 'רמי רום', active: 'false' },
    { name: 'דנה דרוקר', active: 'true' },
    { name: 'נרי אופק', active: 'true' }
  ]);
  // Exactly the planned writes: only the `active` CELL of an existing row
  // (col 2), one appended row block — no clears, no deletes, no name rewrites.
  assert.deepEqual(j(sheets.Therapists._writes), [
    { op: 'setValues', row: 4, col: 2, vals: [['true']] },              // reactivate דנה
    { op: 'setValues', row: 3, col: 2, vals: [['false']] },             // deactivate רמי
    { op: 'setValues', row: 5, col: 1, vals: [['נרי אופק', 'true']] }   // append the new name
  ]);
  // The sync must never touch any other sheet.
  ['Schedule', 'Approvals', 'Patients', 'Assignments', 'TreatmentTypes'].forEach((n) => {
    assert.deepEqual(sheets[n]._writes, [], 'sheet "' + n + '" must not be written');
  });
  assert.equal(fetchCalls.length, 1);
});

test('_getData feed unavailable: ZERO writes, rosterSource=unavailable, sheet served as-is', () => {
  const { ctx, sheets } = gsContext({
    props: { STAFFING_SHEETS_URL: 'https://x/exec' },
    sheets: allSheets(SYNC_SHEET_ROWS),
    fetch: () => ({ getResponseCode: () => 502, getContentText: () => '' })
  });
  const data = j(ctx._getData());
  assert.equal(data.ok, true);
  assert.equal(data.rosterSource, 'unavailable');
  assert.equal(data.rosterSyncSummary, null);
  assert.deepEqual(data.therapists, SYNC_SHEET_ROWS, 'the last-synced roster is served unchanged');
  assert.deepEqual(sheets.Therapists._writes, []);
});

test('_getData unconfigured: ZERO fetches, ZERO writes, rosterSource=unconfigured', () => {
  const { ctx, sheets, fetchCalls } = gsContext({
    props: {},
    sheets: allSheets(SYNC_SHEET_ROWS)
  });
  const data = j(ctx._getData());
  assert.equal(data.rosterSource, 'unconfigured');
  assert.deepEqual(data.therapists, SYNC_SHEET_ROWS);
  assert.equal(fetchCalls.length, 0);
  assert.deepEqual(sheets.Therapists._writes, []);
});

test('a second execution inside the 120s cache window refetches and rewrites NOTHING', () => {
  const store = {};
  const first = gsContext({
    props: SYNC_PROPS,
    sheets: allSheets(SYNC_SHEET_ROWS),
    fetch: okResponse({ ok: true, therapists: SYNC_FEED }),
    cacheStore: store
  });
  first.ctx._getData();
  assert.equal(first.fetchCalls.length, 1);

  // A NEW vm context = a new Apps Script execution; same CacheService store =
  // still inside the TTL. Its sheet already holds the synced state.
  const syncedRows = [
    { name: 'הילה תבור', active: 'true' },
    { name: 'רמי רום', active: 'false' },
    { name: 'דנה דרוקר', active: 'true' },
    { name: 'נרי אופק', active: 'true' }
  ];
  const second = gsContext({
    props: SYNC_PROPS,
    sheets: allSheets(syncedRows),
    fetch: okResponse({ ok: true, therapists: SYNC_FEED }),
    cacheStore: store
  });
  const data = j(second.ctx._getData());
  assert.equal(second.fetchCalls.length, 0, 'must not refetch inside the cache TTL');
  assert.deepEqual(second.sheets.Therapists._writes, []);
  assert.equal(data.rosterSource, 'staffing');
  assert.deepEqual(data.rosterSyncSummary, { added: 1, deactivated: 1, reactivated: 1 },
    'the cached summary is echoed back for the console');
});

test('integration: Scheduling.activeNames over the synced list equals the feed\'s active names', () => {
  const { ctx } = gsContext({
    props: SYNC_PROPS,
    sheets: allSheets(SYNC_SHEET_ROWS),
    fetch: okResponse({ ok: true, therapists: SYNC_FEED })
  });
  const data = j(ctx._getData());
  const dropdown = Scheduling.activeNames(data.therapists);
  const feedActives = SYNC_FEED.filter((f) => f.active).map((f) => f.name);
  assert.deepEqual([...dropdown].sort(), [...feedActives].sort());
});
