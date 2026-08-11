'use strict';

/**
 * Guards for the in-app user guide (public/guide.html):
 *
 *  1. The guide page exists, is non-empty, and is an RTL Hebrew document.
 *  2. The app header links to it, so it is reachable from every tab.
 *  3. The service worker precaches it and the cache version was bumped to v15,
 *     so installed clients pick up both the guide and the new header link.
 *
 * Run with:  npm test   (Node >= 18, built-in test runner)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'public');

test('guide.html exists, is non-empty and is an RTL document', () => {
  const p = path.join(PUB, 'guide.html');
  assert.ok(fs.existsSync(p), 'public/guide.html is missing');
  assert.ok(fs.statSync(p).size > 0, 'public/guide.html is empty');
  const guide = fs.readFileSync(p, 'utf8');
  assert.ok(guide.includes('dir="rtl"'), 'guide.html must declare dir="rtl"');
  assert.ok(guide.includes('חזרה לאפליקציה'), 'guide.html must link back to the app');
});

test('the app header links to the guide', () => {
  const idx = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  assert.ok(
    /<a[^>]+href="\.\/guide\.html"[^>]*>מדריך<\/a>/.test(idx),
    'index.html header must contain a מדריך link to ./guide.html'
  );
});

test('service worker precaches the guide under cache v15', () => {
  const sw = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8');
  const m = sw.match(/ezone-therapists-v(\d+)/);
  assert.ok(m, 'sw.js must define a versioned cache name');
  assert.equal(m[1], '15', 'cache version must be v15 so clients refetch the shell with the guide link');
  const shell = sw.match(/var SHELL = \[[^\]]*\]/);
  assert.ok(shell, 'sw.js must define the SHELL precache list');
  assert.ok(shell[0].includes("'./guide.html'"), 'SHELL must precache ./guide.html');
});
