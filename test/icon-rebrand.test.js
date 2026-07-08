'use strict';

/**
 * Guards for the PWA icon rebrand (bold fuchsia "E" on white).
 *
 *  1. Cache-version floor — public/sw.js must be at least v4, so a rebrand can
 *     never ship without busting the old cached home-screen icon.
 *  2. Boldness guard — decodes each committed PNG and asserts the glyph is a
 *     thick, well-covered, correctly-coloured E (not a thin/hollow/blank icon).
 *
 * Run with:  npm test   (Node >= 18, built-in test runner)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const PUB = path.join(__dirname, '..', 'public');
const CACHE_FLOOR = 4;

const WHITE = [0xff, 0xff, 0xff];
const FUCHSIA = [0xe5, 0x00, 0xa4];

// ---- minimal PNG decoder (truecolor 8-bit RGB, non-interlaced) -------------

function decodePNG(file) {
  const b = fs.readFileSync(file);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) assert.equal(b[i], sig[i], `${file}: bad PNG signature`);

  const width = b.readUInt32BE(16);
  const height = b.readUInt32BE(20);
  const bitDepth = b[24];
  const colorType = b[25];
  assert.equal(bitDepth, 8, `${file}: expected 8-bit`);
  assert.equal(colorType, 2, `${file}: expected truecolor RGB`);
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
  const bpp = 3;
  const stride = N * bpp;
  const px = Buffer.alloc(N * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < N; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const up = prev[i];
      const ul = i >= bpp ? prev[i - bpp] : 0;
      const x = line[i];
      let v;
      if (ft === 0) v = x;
      else if (ft === 1) v = x + a;
      else if (ft === 2) v = x + up;
      else if (ft === 3) v = x + ((a + up) >> 1);
      else {
        const p = a + up - ul;
        const pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - ul);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? up : ul);
      }
      cur[i] = v & 0xff;
    }
    cur.copy(px, y * stride);
    prev = cur;
  }
  return { N, px };
}

// A pixel counts as "ink" when it is at least half-covered by the fuchsia glyph
// (fuchsia has green=0, white green=255; the AA midpoint is 128).
function isInk(px, N, x, y) {
  return px[(y * N + x) * 3 + 1] < 128;
}

// Measures glyph geometry: coverage fraction, thinnest stroke, widest bar, and
// the farthest ink pixel from centre (maskable safe-zone check).
function analyze(icon) {
  const { N, px } = icon;
  let ink = 0, minStroke = Infinity, maxRun = 0, maxRadius = 0;
  const cx = N / 2, cy = N / 2;
  for (let y = 0; y < N; y++) {
    let run = 0, initRun = -1, sawInk = false;
    for (let x = 0; x < N; x++) {
      if (isInk(px, N, x, y)) {
        ink++;
        run++;
        sawInk = true;
        const dx = x - cx, dy = y - cy, r = Math.sqrt(dx * dx + dy * dy);
        if (r > maxRadius) maxRadius = r;
      } else {
        if (run > maxRun) maxRun = run;
        if (initRun < 0 && run > 0) initRun = run; // first contiguous ink run = stroke
        run = 0;
      }
    }
    if (run > maxRun) maxRun = run;
    if (initRun < 0 && run > 0) initRun = run;
    if (sawInk) minStroke = Math.min(minStroke, initRun);
  }
  return {
    N,
    coverage: ink / (N * N),
    minStroke: minStroke / N,
    maxRun: maxRun / N,
    maxRadius: maxRadius / N
  };
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

// ---- 2. boldness guard -----------------------------------------------------

const ICONS = [
  { file: 'icon-v2-192.png', size: 192, maskable: false },
  { file: 'icon-v2-512.png', size: 512, maskable: false },
  { file: 'icon-v2-maskable.png', size: 512, maskable: true }
];

for (const spec of ICONS) {
  test(`${spec.file} is a bold, correctly-coloured E`, () => {
    const icon = decodePNG(path.join(PUB, spec.file));
    assert.equal(icon.N, spec.size, `${spec.file}: wrong dimensions`);

    // Opaque white background: all four corners must be pure white.
    for (const [cx, cy] of [[0, 0], [icon.N - 1, 0], [0, icon.N - 1], [icon.N - 1, icon.N - 1]]) {
      const o = (cy * icon.N + cx) * 3;
      assert.deepEqual(
        [icon.px[o], icon.px[o + 1], icon.px[o + 2]],
        WHITE,
        `${spec.file}: corner (${cx},${cy}) is not white`
      );
    }

    // The ink must be fuchsia, not some other colour: the most saturated ink
    // pixel should match #e500a4 closely.
    let best = 1e9, bestRGB = null;
    for (let i = 0; i < icon.N * icon.N; i++) {
      const g = icon.px[i * 3 + 1];
      if (g < 40) {
        const r = icon.px[i * 3], bl = icon.px[i * 3 + 2];
        const d = Math.abs(r - FUCHSIA[0]) + Math.abs(g - FUCHSIA[1]) + Math.abs(bl - FUCHSIA[2]);
        if (d < best) { best = d; bestRGB = [r, g, bl]; }
      }
    }
    assert.ok(best <= 12, `${spec.file}: ink colour ${bestRGB} is not fuchsia ${FUCHSIA}`);

    const g = analyze(icon);

    // Coverage: a real E fills a good chunk of the canvas — not blank, not solid.
    assert.ok(g.coverage >= 0.15, `${spec.file}: coverage ${g.coverage.toFixed(3)} too low (icon too thin/blank)`);
    assert.ok(g.coverage <= 0.45, `${spec.file}: coverage ${g.coverage.toFixed(3)} too high (icon too heavy/solid)`);

    // Boldness: the thinnest stroke must be at least ~13% of the canvas.
    assert.ok(
      g.minStroke >= 0.13,
      `${spec.file}: thinnest stroke ${g.minStroke.toFixed(3)}·N is not bold (need >= 0.13·N)`
    );

    // A wide horizontal bar (the E's arms) proves it is an E, not a stripe.
    assert.ok(g.maxRun >= 0.40, `${spec.file}: widest bar ${g.maxRun.toFixed(3)}·N too narrow for an E arm`);

    // Maskable safe zone: the whole glyph must sit inside the central 80% circle
    // (radius 0.40·N) with white padding to the edge.
    if (spec.maskable) {
      assert.ok(
        g.maxRadius <= 0.40,
        `${spec.file}: glyph reaches ${g.maxRadius.toFixed(3)}·N from centre — outside the maskable safe zone (0.40·N)`
      );
    }
  });
}
