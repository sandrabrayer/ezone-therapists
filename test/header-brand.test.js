/**
 * header-brand.test.js — guards the topbar brand after dropping the "E-ZONE"
 * wordmark. The header must show the app's existing emblem image next to the
 * Hebrew app name ("מטפלים") only, RTL-correct and no-wrap, with the emblem
 * sized ~30px desktop / 28px mobile and the icon/colours left untouched.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'public');
const HTML = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(PUB, 'style.css'), 'utf8');

// The topbar markup (everything inside <header class="topbar">…</header>).
const topbar = HTML.match(/<header class="topbar">([\s\S]*?)<\/header>/);

test('topbar exists and its logo no longer contains the "E-ZONE" wordmark', () => {
  assert.ok(topbar, 'topbar header must exist');
  const logo = topbar[1].match(/<div class="logo">([\s\S]*?)<\/div>/);
  assert.ok(logo, 'logo element must exist in the topbar');
  assert.ok(!/E-?ZONE/i.test(logo[1]), 'the logo must not contain the E-ZONE text');
  assert.ok(!/Therapists/i.test(logo[1]), 'the logo must not contain the English "Therapists" text');
});

test('logo shows the existing emblem image next to the Hebrew app name', () => {
  const logo = topbar[1].match(/<div class="logo">([\s\S]*?)<\/div>/)[1];
  // emblem is one of the app's manifest icons — the icon asset itself is untouched
  assert.match(logo, /<img[^>]*class="logo-emblem"[^>]*src="icon-v2-192\.png"/,
    'emblem must reuse the existing icon-v2-192.png asset');
  assert.match(logo, /מטפלים/, 'the Hebrew app name must be present');
});

test('emblem is decorative and pre-sized to ~30px in markup', () => {
  const img = topbar[1].match(/<img[^>]*class="logo-emblem"[^>]*>/)[0];
  assert.match(img, /alt=""/, 'emblem is decorative (adjacent Hebrew name labels it)');
  assert.match(img, /width="30"/);
  assert.match(img, /height="30"/);
});

test('.logo is a no-wrap flex row (RTL-safe, does not crowd the nav)', () => {
  const rule = CSS.match(/\.logo \{[\s\S]*?\}/);
  assert.ok(rule, '.logo rule must exist');
  assert.match(rule[0], /display:\s*flex/);
  assert.match(rule[0], /align-items:\s*center/);
  assert.match(rule[0], /white-space:\s*nowrap/);
  assert.match(rule[0], /flex-shrink:\s*0/);
});

test('emblem sized 30px desktop and 28px on the mobile breakpoint', () => {
  assert.match(CSS, /\.logo-emblem \{[^}]*width:\s*30px[^}]*height:\s*30px/);
  const mobile = CSS.match(/@media \(max-width:\s*560px\) \{[\s\S]*?\n\}/);
  assert.ok(mobile, 'mobile breakpoint must exist');
  assert.match(mobile[0], /\.logo-emblem \{[^}]*width:\s*28px[^}]*height:\s*28px/);
});
