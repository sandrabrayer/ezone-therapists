'use strict';

/**
 * Guards for the PWA icon rebrand — the ORIGINAL E-ZONE brand logo (the stylised
 * "e" glyph), recolored via blend-remap onto the app's own fuchsia-on-plum
 * palette (--accent-vivid #e873bc on --bg #2c1a28). The glyph is NOT redrawn, so
 * these guards assert palette + presence, not stroke geometry.
 *
 *  1. Cache-version floor — public/sw.js must be at least v5, so a rebrand can
 *     never ship without busting the old cached home-screen icon.
 *  2. Palette assertions — the dominant background is #2c1a28 and the logo ink
 *     is #e873bc; no stray third colour dominates.
 *  3. Logo-presence guard — the coloured (fuchsia) ink covers > 5% of each icon,
 *     proving the recolored logo is actually present and not washed out.
 *  4. Manifest wiring — every icon the manifest references exists on disk.
 *
 * Run with:  npm test   (Node >= 18, built-in test runner)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const PUB = path.join(__dirname, '..', 'public');
const CACHE_FLOOR = 5;

const BG = [0x2c, 0x1a, 0x28];    // #2c1a28 — app --bg (plum) background
const LOGO = [0xe8, 0x73, 0xbc];  // #e873bc — app --accent-vivid fuchsia logo

// ---- minimal PNG decoder (8-bit RGB/RGBA, non-interlaced) ------------------

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodePNG(file) {
  const b = fs.readFileSync(file);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) assert.equal(b[i], sig[i], `${file}: bad PNG signature`);

  const width = b.readUInt32BE(16);
  const height = b.readUInt32BE(20);
  const bitDepth = b[24];
  const colorType = b[25];
  assert.equal(bitDepth, 8, `${file}: expected 8-bit`);
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  assert.ok(ch, `${file}: expected truecolor RGB/RGBA`);
  assert.equal(width, height, `${file}: expected a square icon`);

  const parts = [];
  let off = 8;
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') parts.push(b.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(parts));

  const N = width;
  const stride = N * ch;
  const px = Buffer.alloc(N * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < N; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;
      const up = prev[i];
      const ul = i >= ch ? prev[i - ch] : 0;
      const x = line[i];
      let v;
      if (ft === 0) v = x;
      else if (ft === 1) v = x + a;
      else if (ft === 2) v = x + up;
      else if (ft === 3) v = x + ((a + up) >> 1);
      else v = x + paeth(a, up, ul);
      cur[i] = v & 0xff;
    }
    cur.copy(px, y * stride);
    prev = cur;
  }
  return { N, ch, px };
}

function near(px, i, ch, target, tol) {
  return Math.abs(px[i * ch] - target[0]) <= tol &&
    Math.abs(px[i * ch + 1] - target[1]) <= tol &&
    Math.abs(px[i * ch + 2] - target[2]) <= tol;
}

// ---- 1. cache-version floor ------------------------------------------------

test('sw.js cache version is at or above the rebrand floor', () => {
  const sw = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8');
  const m = sw.match(/ezone-therapists-v(\d+)/);
  assert.ok(m, 'sw.js must define a versioned cache name');
  const version = Number(m[1]);
  assert.ok(
    version >= CACHE_FLOOR,
    `cache version v${version} is below the floor v${CACHE_FLOOR} — bump it so the new icon busts the old cache`
  );
});

// ---- 2 & 3. palette + logo-presence ---------------------------------------

const ICONS = [
  { file: 'icon-v2-192.png', size: 192, maskable: false },
  { file: 'icon-v2-512.png', size: 512, maskable: false },
  { file: 'icon-v2-maskable.png', size: 512, maskable: true }
];

for (const spec of ICONS) {
  test(`${spec.file} uses the #2c1a28 / #e873bc brand palette with the logo present`, () => {
    const { N, ch, px } = decodePNG(path.join(PUB, spec.file));
    assert.equal(N, spec.size, `${spec.file}: wrong dimensions`);

    const total = N * N;
    let bg = 0, logo = 0;
    for (let i = 0; i < total; i++) {
      const opaque = ch === 4 ? px[i * ch + 3] > 128 : true;
      if (!opaque) continue;                       // transparent squircle corners
      if (near(px, i, ch, BG, 6)) bg++;
      else if (near(px, i, ch, LOGO, 24)) logo++;  // widen for anti-aliased edges
    }

    // Palette: the exact background colour must dominate the opaque area.
    assert.ok(
      bg / total > 0.30,
      `${spec.file}: #2c1a28 background covers only ${(bg / total * 100).toFixed(1)}% — wrong palette`
    );

    // Logo-presence guard: fuchsia ink must cover more than 5% of the canvas.
    assert.ok(
      logo / total > 0.05,
      `${spec.file}: fuchsia #e873bc ink covers only ${(logo / total * 100).toFixed(1)}% (need > 5%) — logo missing/washed out`
    );

    // The exact brand colours must both appear as solid pixels somewhere.
    let exactBg = false, exactLogo = false;
    for (let i = 0; i < total && !(exactBg && exactLogo); i++) {
      if (near(px, i, ch, BG, 0)) exactBg = true;
      if (near(px, i, ch, LOGO, 0)) exactLogo = true;
    }
    assert.ok(exactBg, `${spec.file}: exact #071410 background pixels not found`);
    assert.ok(exactLogo, `${spec.file}: exact #ff2fd6 logo pixels not found`);

    // Maskable padding stays dark: the extreme corners (inside the safe area)
    // must be the dark background, not fuchsia.
    if (spec.maskable) {
      const corner = px[(0 * N + 0) * ch] + px[(0 * N + 0) * ch + 1] + px[(0 * N + 0) * ch + 2];
      assert.ok(corner < 120, `${spec.file}: maskable corner is not dark padding`);
    }
  });
}

// ---- 4. manifest wiring: every referenced icon exists on disk ---------------

test('every icon the manifest references exists on disk', () => {
  const man = JSON.parse(fs.readFileSync(path.join(PUB, 'manifest.webmanifest'), 'utf8'));
  assert.ok(Array.isArray(man.icons) && man.icons.length > 0, 'manifest must list icons');
  for (const icon of man.icons) {
    const p = path.join(PUB, icon.src);
    assert.ok(fs.existsSync(p), `manifest icon "${icon.src}" is missing on disk`);
    assert.ok(fs.statSync(p).size > 0, `manifest icon "${icon.src}" is empty`);
  }
  // The apple-touch-icon referenced by index.html must exist too.
  const idx = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  const m = idx.match(/rel="apple-touch-icon"\s+href="([^"]+)"/);
  assert.ok(m, 'index.html must declare an apple-touch-icon');
  assert.ok(fs.existsSync(path.join(PUB, m[1])), `apple-touch-icon "${m[1]}" is missing on disk`);
});
