'use strict';

/**
 * Tests for the staffing→Therapists roster sync (PR A: engine + read-only
 * preview).
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

test('Code.gs still seeds THERAPISTS_SEED in _getData (unchanged in PR A)', () => {
  assert.ok(/_ensureSeededList\('Therapists', THERAPISTS_HEADERS,\s*\n?\s*THERAPISTS_SEED/.test(CODE_GS_SRC),
    'PR A must not touch the seeding path — the write flip is PR B');
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
        setValues: (vals) => { writes.push({ op: 'setValues', row, col, vals }); },
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
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) }
  };
  vm.createContext(ctx);
  vm.runInContext(CODE_GS_SRC, ctx);
  return { ctx, sheets, fetchCalls };
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
