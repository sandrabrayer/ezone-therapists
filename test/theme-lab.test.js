/**
 * theme-lab.test.js — guards for the TEMPORARY /theme-lab page.
 * These tests are deleted together with the page in the palette-application PR.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'theme-lab.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('server exposes /theme-lab BEFORE the SPA catch-all', () => {
  const route = SERVER.indexOf("app.get('/theme-lab'");
  const catchAll = SERVER.indexOf("app.get('*'");
  assert.ok(route !== -1, 'route missing');
  assert.ok(catchAll !== -1, 'catch-all missing');
  assert.ok(route < catchAll, '/theme-lab must be registered before the catch-all');
});

test('theme-lab route is no-store (never cached)', () => {
  const seg = SERVER.slice(SERVER.indexOf("app.get('/theme-lab'"), SERVER.indexOf("app.get('*'"));
  assert.match(seg, /no-store/);
});

test('page enforces the shared password gate via /api/gate', () => {
  assert.match(HTML, /fetch\('\/api\/gate'\)/, 'must check whether the gate is required');
  assert.match(HTML, /method:\s*'POST'/, 'must verify the password server-side');
  assert.match(HTML, /gateScreen/, 'gate screen markup missing');
});

test('client-only: no persistence and no data-writing APIs', () => {
  for (const banned of ['localStorage', 'sessionStorage', 'document.cookie', 'indexedDB', '/api/sheets']) {
    assert.ok(!HTML.includes(banned), `theme-lab must not use ${banned}`);
  }
});

test('page declares itself temporary and is not indexed', () => {
  assert.match(HTML, /TEMPORARY/, 'temporary marker comment missing');
  assert.match(HTML, /noindex/, 'robots noindex missing');
  assert.match(HTML, /זמני/, 'visible Hebrew temporary banner missing');
});

test('red is reserved: no red-dominant hex in any selectable swatch row', () => {
  const m = HTML.match(/var SWATCHES = \{[\s\S]*?\};/);
  assert.ok(m, 'SWATCHES block not found');
  const hexes = m[0].match(/#[0-9a-fA-F]{6}/g) || [];
  assert.ok(hexes.length >= 24, 'expected 3 rows × 8 swatches');
  for (const h of hexes) {
    const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
    const isRed = r > 180 && g < 110 && b < 110; // red/orange-red territory
    assert.ok(!isRed, `swatch ${h} encroaches on the reserved error red`);
  }
  assert.ok(!m[0].includes('#ff7676'), 'the reserved --red must not be selectable');
});

test('theme-lab is not linked from index.html (direct URL only)', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(!index.includes('theme-lab'), 'index.html must not link to /theme-lab');
});
