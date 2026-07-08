#!/usr/bin/env node
/* Self-contained PWA icon generator for E-ZONE Therapists.
 *
 * Draws the letter "E" from scratch as a BOLD geometric glyph and writes three
 * opaque PNGs (192, 512, maskable) into public/. No third-party dependencies —
 * the PNG is encoded by hand using Node's built-in zlib.
 *
 *   Background: #ffffff (opaque white)
 *   Letter:     #e500a4 (fuchsia)
 *
 * The glyph is a spine + three arms, anti-aliased via 4x4 supersampling.
 * Stroke thickness is ~18.5% of the canvas so the E stays bold and legible
 * even at home-screen sizes (48–96px). The maskable variant scales the glyph
 * down so its bounding box sits inside the maskable safe zone with white
 * padding all the way to the edge.
 *
 * Run:  node scripts/gen-icons.js
 */
'use strict';

var zlib = require('zlib');
var fs = require('fs');
var path = require('path');

var WHITE = [0xff, 0xff, 0xff];
var FUCHSIA = [0xe5, 0x00, 0xa4];

// ---- PNG encoding (truecolor RGB, 8-bit, opaque) --------------------------

var CRC_TABLE = (function () {
  var table = new Int32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  var c = 0xffffffff;
  for (var i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  var typeBuf = Buffer.from(type, 'ascii');
  var body = Buffer.concat([typeBuf, data]);
  var len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  var crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// rgb: Buffer of size N*N*3 (row-major). Returns a complete PNG Buffer.
function encodePNG(N, rgb) {
  var sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(N, 0);       // width
  ihdr.writeUInt32BE(N, 4);       // height
  ihdr[8] = 8;                    // bit depth
  ihdr[9] = 2;                    // color type: truecolor RGB
  ihdr[10] = 0;                   // compression
  ihdr[11] = 0;                   // filter
  ihdr[12] = 0;                   // interlace

  // Prefix each scanline with filter byte 0 (None).
  var stride = N * 3;
  var raw = Buffer.alloc(N * (stride + 1));
  for (var y = 0; y < N; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  var idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---- Glyph rasterization --------------------------------------------------

// Returns true if point (x,y) lies inside the bold "E" for canvas size N,
// scaled by `scale` (1 = full; <1 shrinks to fit a safe zone), centered.
function rects(N, scale) {
  var t = 0.185 * N * scale;          // stroke thickness (~18.5% of canvas)
  var H = 0.68 * N * scale;           // glyph height (~65-70% of canvas)
  var W = 0.60 * N * scale;           // glyph width
  var left = (N - W) / 2;
  var top = (N - H) / 2;
  var midW = 0.80 * W;                // middle arm is a touch shorter
  return [
    { x0: left, y0: top, x1: left + t, y1: top + H },                       // spine
    { x0: left, y0: top, x1: left + W, y1: top + t },                       // top arm
    { x0: left, y0: top + H - t, x1: left + W, y1: top + H },               // bottom arm
    { x0: left, y0: top + (H - t) / 2, x1: left + midW, y1: top + (H + t) / 2 } // middle arm
  ];
}

function inGlyph(rs, x, y) {
  for (var i = 0; i < rs.length; i++) {
    var r = rs[i];
    if (x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1) return true;
  }
  return false;
}

// Renders the E on an opaque white canvas of size N. `scale` shrinks the glyph
// (used for the maskable safe zone). Anti-aliased with S*S supersampling.
function renderE(N, scale) {
  var rs = rects(N, scale);
  var S = 4;
  var inv = 1 / S;
  var rgb = Buffer.alloc(N * N * 3);
  for (var py = 0; py < N; py++) {
    for (var px = 0; px < N; px++) {
      var hit = 0;
      for (var sy = 0; sy < S; sy++) {
        for (var sx = 0; sx < S; sx++) {
          if (inGlyph(rs, px + (sx + 0.5) * inv, py + (sy + 0.5) * inv)) hit++;
        }
      }
      var cov = hit / (S * S);
      var o = (py * N + px) * 3;
      for (var c = 0; c < 3; c++) {
        rgb[o + c] = Math.round(WHITE[c] + cov * (FUCHSIA[c] - WHITE[c]));
      }
    }
  }
  return rgb;
}

// ---- Outputs --------------------------------------------------------------

function write(file, N, scale) {
  var png = encodePNG(N, renderE(N, scale));
  fs.writeFileSync(file, png);
  return png.length;
}

if (require.main === module) {
  var pub = path.join(__dirname, '..', 'public');
  // Maskable safe zone: the central ~80% may be cropped by the launcher, so we
  // scale the glyph to 0.82 to keep the whole E inside it with white padding.
  var jobs = [
    ['icon-v2-192.png', 192, 1.0],
    ['icon-v2-512.png', 512, 1.0],
    ['icon-v2-maskable.png', 512, 0.82]
  ];
  jobs.forEach(function (j) {
    var bytes = write(path.join(pub, j[0]), j[1], j[2]);
    console.log('wrote', j[0], '(' + j[1] + 'px, scale ' + j[2] + ') —', bytes, 'bytes');
  });
}

module.exports = { renderE: renderE, encodePNG: encodePNG, rects: rects };
