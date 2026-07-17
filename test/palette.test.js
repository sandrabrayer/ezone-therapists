/**
 * palette.test.js — guards the July 2026 palette chosen via the (now deleted)
 * /theme-lab page, and verifies the theme-lab was fully removed.
 *
 * Spec (screenshot readout, 2026-07-17): per-section scheme, filled chips and
 * cards, bg #2c1a28 @ tint 40%; primary #9d6b8a, plan #2dd4bf, sched #38bdf8.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'public');
const CSS = fs.readFileSync(path.join(PUB, 'style.css'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('root vars carry the chosen palette (both :root blocks)', () => {
  for (const [name, hex] of [
    ['--bg', '#2c1a28'], ['--bg-elev', '#3f2b3a'], ['--panel', '#4a3644'],
    ['--card', '#564150'], ['--border', '#826478'],
    ['--accent', '#9d6b8a'],
    ['--panel-plan', '#3a5d60'], ['--panel-plan-border', '#2dd4bf'],
    ['--panel-sched', '#3d5770'], ['--panel-sched-border', '#38bdf8'],
  ]) {
    const re = new RegExp(name.replace(/-/g, '\\-') + ':\\s*' + hex, 'g');
    assert.strictEqual((CSS.match(re) || []).length, 2, `${name} must be ${hex} in both :root blocks`);
  }
});

test('no old fuchsia palette hexes remain anywhere in the frontend', () => {
  const OLD = ['#ec4899', '#f871b0', '#a21d6b', '#a855f7', '#c052a0', '#e0559b',
    '#a06cf2', '#5e1f48', '#432a66', '#1a0d18', '#3a1530', 'rgba(236,72,153'];
  for (const f of ['style.css', 'index.html', 'manifest.webmanifest']) {
    const txt = fs.readFileSync(path.join(PUB, f), 'utf8');
    for (const hex of OLD) assert.ok(!txt.includes(hex), `${f} still contains ${hex}`);
  }
});

test('error red and semantic payment chips are untouched', () => {
  assert.match(CSS, /--red:\s*#ff7676/);
  assert.match(CSS, /\.chip-paid\s*\{\s*background:\s*#d4edda/);
  assert.match(CSS, /\.chip-unpaid\s*\{\s*background:\s*#f8d7da/);
});

test('reserved red is distinct from every selected accent', () => {
  // none of the chosen accents may drift into red territory
  for (const hex of ['#9d6b8a', '#2dd4bf', '#38bdf8']) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    assert.ok(!(r > 180 && g < 110 && b < 110), `accent ${hex} too close to error red`);
  }
});

test('PWA theme colors match the new background', () => {
  const man = fs.readFileSync(path.join(PUB, 'manifest.webmanifest'), 'utf8');
  const idx = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  assert.match(man, /"theme_color":\s*"#2c1a28"/);
  assert.match(man, /"background_color":\s*"#2c1a28"/);
  assert.match(idx, /theme-color" content="#2c1a28"/);
});

test('service-worker cache was bumped for the restyle', () => {
  const sw = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8');
  assert.match(sw, /ezone-therapists-v6/);
  assert.ok(!sw.includes('ezone-therapists-v5'), 'old cache name must be gone');
});

test('theme-lab is fully deleted (page, route, tests, changelog)', () => {
  assert.ok(!fs.existsSync(path.join(PUB, 'theme-lab.html')), 'theme-lab.html must be deleted');
  assert.ok(!fs.existsSync(path.join(__dirname, 'theme-lab.test.js')), 'theme-lab.test.js must be deleted');
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'CHANGELOG-theme-lab.md')), 'CHANGELOG-theme-lab.md must be deleted');
  assert.ok(!SERVER.includes('theme-lab'), 'server.js must not mention theme-lab');
});
