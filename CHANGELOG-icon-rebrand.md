# PWA icon rebrand — bold fuchsia "E"

## Why
The home-screen icon was replaced with a purpose-drawn, bold geometric letter
"E" so the installed PWA reads clearly at small sizes (48–96px) and matches the
E-ZONE fuchsia identity. The app name is unchanged.

## What changed
- **scripts/gen-icons.js** (new): a self-contained icon generator. It draws the
  "E" from scratch as a spine + three arms (stroke ~18.5% of the canvas, glyph
  ~65–70% of the canvas, centred), anti-aliased via 4×4 supersampling, and
  encodes opaque truecolor PNGs by hand using Node's built-in `zlib` — **no new
  dependencies**. Background `#ffffff`, letter `#e500a4` (fuchsia).
- **public/icon-v2-192.png**, **public/icon-v2-512.png** (regenerated): the new
  bold E at 192px and 512px (`purpose: any`).
- **public/icon-v2-maskable.png** (regenerated): the same glyph scaled to 0.82
  so the whole letter sits inside the maskable safe zone (central 80% circle)
  with white padding to the edge (`purpose: maskable`).
- **public/sw.js**: bumped the cache name `ezone-therapists-v3` → `-v4`. On next
  load every device's service worker activates the new cache and deletes the old
  one (the activate handler already prunes non-current caches), so the stale
  cached icon and shell are dropped.
- **test/icon-rebrand.test.js** (new): two guards —
  1. *cache-version floor*: `sw.js` must be at least `v4`.
  2. *boldness guard*: decodes each committed PNG (hand-rolled inflate +
     unfilter) and asserts opaque white corners, fuchsia ink (`#e500a4`),
     coverage in a bold-but-not-solid range, a thinnest stroke ≥ 0.13·N, a wide
     E-arm bar, and — for the maskable icon — the glyph staying inside the
     0.40·N safe-zone radius.

## Verification
- Rendered the glyph at 48/64/96px and confirmed the E is bold and readable.
- `npm test` — full suite green (305 tests).

## Security
- No data/endpoint/secret change. Frontend assets + cache-versioning only.

## Deploy note
- Frontend only — Railway auto-deploy. On a device that already has the app
  installed, the cache bump refreshes the shell; remove and re-add the app to
  force the OS to re-fetch the home-screen icon.

---

# Correction — restore the original brand logo, recolor only (not a block E)

## Why
The previous pass drew a block-letter "E" from scratch. That was wrong: the app
has an established E-ZONE brand mark (the stylised "e" glyph + Hebrew wordmark).
This correction discards the drawn E and instead recovers the **original
brand-logo icons** and recolors them — the glyph shape and anti-aliasing are
preserved exactly; only the palette changes.

## What changed
- **scripts/gen-icons.js** — removed (the block-E generator).
- **scripts/recolor-icons.js** (new) — a self-contained, no-dependency recolor.
  It reads the untouched original logos (`public/icon-192.png`,
  `public/icon-512.png`, `public/icon-maskable.png`) and writes the recolored
  `public/icon-v2-*.png`. Each pixel's background→logo blend factor is recovered
  by projecting it onto the old `#1a0d18`→`#bc5586` line and remixed between the
  new colours; the **alpha channel is copied through untouched**, so the
  silhouette and every soft edge are identical — only the hue changes.
    - background `#1a0d18` → **`#071410`** (dark)
    - logo `#bc5586` → **`#ff2fd6`** (fluorescent fuchsia)
- **public/icon-v2-{192,512,maskable}.png** (regenerated) — original glyph,
  recolored. Maskable padding stays dark `#071410`.
- **public/sw.js** — bumped the cache name `ezone-therapists-v4` → `-v5`.
- **test/icon-rebrand.test.js** — removed the block-E boldness guard; now
  asserts the palette (`#071410` background dominates, exact `#071410` and
  `#ff2fd6` pixels present) and a logo-presence guard (fuchsia ink > 5%).
- App name unchanged.

## Verification
- Rendered the recolored logo at 48/64/96px and confirmed the original "e" glyph
  is intact and legible in fluorescent fuchsia on dark.
- `npm test` — full suite green (305 tests).

## Security
- No data/endpoint/secret change. Frontend assets + cache-versioning only.
