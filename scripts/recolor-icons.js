#!/usr/bin/env node
/* Recolor the original E-ZONE brand-logo icons — no redraw.
 *
 * The original brand icons (the stylised "e" glyph + Hebrew wordmark) are taken
 * verbatim from the committed source logos and recolored by a per-pixel
 * blend-remap that preserves the glyph shape and anti-aliasing EXACTLY:
 *
 *   old background #1a0d18  ->  new background #2c1a28 (the app's --bg plum)
 *   old logo       #bc5586  ->  new logo       #e873bc (the app's --accent-vivid)
 *
 * The palette is the app's own fuchsia identity (matching the in-app logo text
 * color var(--green-2) = #e873bc on the plum --bg #2c1a28), so the home-screen
 * icon reads as the same brand as the running app — the outpatient recipe, in
 * rose/fuchsia instead of green.
 *
 * Every source pixel is a linear blend between the old background and the old
 * logo colour (that is how the anti-aliased edges were stored). We recover that
 * blend factor t by projecting the pixel onto the background->logo line, then
 * re-mix the SAME t between the new background and new logo. The alpha channel
 * (the rounded-square mask / transparent corners) is copied through untouched,
 * so the silhouette and every soft edge are identical — only the hue changes.
 *
 * No third-party dependencies: PNGs are decoded and re-encoded by hand using
 * Node's built-in zlib.
 *
 * Sources (untouched originals) -> outputs (referenced by the manifest/SW):
 *   public/icon-192.png       -> public/icon-v2-192.png
 *   public/icon-512.png       -> public/icon-v2-512.png
 *   public/icon-maskable.png  -> public/icon-v2-maskable.png
 *
 * Run:  node scripts/recolor-icons.js
 */
'use strict';

var zlib = require('zlib');
var fs = require('fs');
var path = require('path');

var OLD_BG = [0x1a, 0x0d, 0x18];   // #1a0d18
var OLD_LOGO = [0xbc, 0x55, 0x86]; // #bc5586
var NEW_BG = [0x2c, 0x1a, 0x28];   // #2c1a28 — app --bg (plum)
var NEW_LOGO = [0xe8, 0x73, 0xbc]; // #e873bc — app --accent-vivid (fuchsia)

// ---- CRC / chunk helpers ---------------------------------------------------

var CRC_TABLE = (function () {
  var t = new Int32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  var c = 0xffffffff;
  for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  var body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  var len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  var crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// ---- PNG decode (8-bit; RGB/RGBA/gray/gray+alpha, non-interlaced) ----------

function paeth(a, b, c) {
  var p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
}

function decodePNG(buf) {
  var width = buf.readUInt32BE(16);
  var height = buf.readUInt32BE(20);
  var bitDepth = buf[24];
  var colorType = buf[25];
  if (bitDepth !== 8) throw new Error('only 8-bit PNGs supported');
  var ch = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 0 ? 1 : 0;
  if (!ch) throw new Error('unsupported color type ' + colorType);

  var parts = [], off = 8;
  while (off < buf.length) {
    var len = buf.readUInt32BE(off);
    var type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') parts.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  var raw = zlib.inflateSync(Buffer.concat(parts));

  var stride = width * ch;
  var px = Buffer.alloc(height * stride);
  var prev = Buffer.alloc(stride);
  for (var y = 0; y < height; y++) {
    var ft = raw[y * (stride + 1)];
    var line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    var cur = Buffer.alloc(stride);
    for (var i = 0; i < stride; i++) {
      var a = i >= ch ? cur[i - ch] : 0;
      var up = prev[i];
      var ul = i >= ch ? prev[i - ch] : 0;
      var x = line[i], v;
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
  return { width: width, height: height, ch: ch, px: px };
}

// ---- PNG encode (RGBA truecolor) ------------------------------------------

function encodeRGBA(width, height, rgba) {
  var sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: truecolor + alpha
  var stride = width * 4;
  var raw = Buffer.alloc(height * (stride + 1));
  for (var y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  var idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---- blend-remap -----------------------------------------------------------

// Recover the background->logo blend factor of a source pixel by projecting it
// onto the OLD_BG -> OLD_LOGO line, then remix the same factor between the new
// colours. Shape and anti-aliasing are preserved exactly; alpha passes through.
var DR = OLD_LOGO[0] - OLD_BG[0], DG = OLD_LOGO[1] - OLD_BG[1], DB = OLD_LOGO[2] - OLD_BG[2];
var DEN = DR * DR + DG * DG + DB * DB;

function remap(icon) {
  var w = icon.width, h = icon.height, ch = icon.ch, src = icon.px;
  var out = Buffer.alloc(w * h * 4);
  for (var i = 0; i < w * h; i++) {
    var r = src[i * ch], g = src[i * ch + 1], b = src[i * ch + 2];
    var a = ch === 4 ? src[i * ch + 3] : (ch === 2 ? src[i * ch + 1] : 255);
    if (ch < 3) { g = r; b = r; } // grayscale fallback
    var t = ((r - OLD_BG[0]) * DR + (g - OLD_BG[1]) * DG + (b - OLD_BG[2]) * DB) / DEN;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    var o = i * 4;
    out[o] = Math.round(NEW_BG[0] + t * (NEW_LOGO[0] - NEW_BG[0]));
    out[o + 1] = Math.round(NEW_BG[1] + t * (NEW_LOGO[1] - NEW_BG[1]));
    out[o + 2] = Math.round(NEW_BG[2] + t * (NEW_LOGO[2] - NEW_BG[2]));
    out[o + 3] = a;
  }
  return out;
}

function recolor(srcFile, dstFile) {
  var icon = decodePNG(fs.readFileSync(srcFile));
  var rgba = remap(icon);
  fs.writeFileSync(dstFile, encodeRGBA(icon.width, icon.height, rgba));
  return icon.width;
}

if (require.main === module) {
  var pub = path.join(__dirname, '..', 'public');
  var jobs = [
    ['icon-192.png', 'icon-v2-192.png'],
    ['icon-512.png', 'icon-v2-512.png'],
    ['icon-maskable.png', 'icon-v2-maskable.png']
  ];
  jobs.forEach(function (j) {
    var n = recolor(path.join(pub, j[0]), path.join(pub, j[1]));
    console.log('recolored', j[0], '->', j[1], '(' + n + 'px)');
  });
}

module.exports = { decodePNG: decodePNG, encodeRGBA: encodeRGBA, remap: remap };
