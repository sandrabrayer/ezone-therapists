# Topbar brand — drop the "E-ZONE" wordmark, show emblem + Hebrew name

## Why
The topbar logo read `E-ZONE Therapists` (English wordmark). Per the brand
cleanup, the header should carry the app's own emblem next to its Hebrew name
only — no "E-ZONE" text. The emblem and colours stay exactly as they are.

## What changed
- **public/index.html** — the topbar logo is no longer text-only. It now shows
  the app's existing emblem image (`icon-v2-192.png`, one of the manifest icons,
  used **unchanged** — no recolour, no new icon) next to the Hebrew app name
  `מטפלים`. The `E-ZONE` / `Therapists` wordmark is gone.
    - `<div class="logo">E-ZONE <span>Therapists</span></div>`
    - → `<div class="logo"><img class="logo-emblem" src="icon-v2-192.png"
      alt="" width="30" height="30" /><span class="logo-name">מטפלים</span></div>`
    - `alt=""` — the emblem is decorative; the adjacent Hebrew name labels it.
- **public/style.css** — `.logo` is now a no-wrap flex row (`display: flex;
  align-items: center; gap: 8px; white-space: nowrap; flex-shrink: 0`) so the
  emblem and name sit together, stay on one line, and don't crowd the nav. In
  RTL (`dir="rtl"`) this places the emblem at the start (right) with the name to
  its left. New `.logo-emblem` sizes the image to 30px desktop / **28px** on the
  ≤560px mobile breakpoint. Colours are untouched (name keeps `--green-2`). Both
  duplicated `.logo` blocks in the stylesheet were updated to stay in sync.
- **public/sw.js** — bumped the shell cache `ezone-therapists-v7` → `-v8` so
  installed PWAs pick up the new topbar (the activate handler already prunes
  old caches). The emblem asset is already part of the cached shell.
- **test/header-brand.test.js** (new) — guards the topbar: no `E-ZONE`/English
  wordmark in the logo, the emblem reuses the existing `icon-v2-192.png`, the
  Hebrew name `מטפלים` is present, the emblem is decorative and pre-sized to
  30px, and `.logo` is a no-wrap flex row sized 30px desktop / 28px mobile.
- **test/palette.test.js** — updated the service-worker cache-version assertion
  from `v7` to `v8`.

## Verification
- Captured before/after topbar screenshots at desktop (1280px) and mobile
  (390px): the emblem sits at the RTL start with `מטפלים` beside it, one line,
  nav uncrowded.
- `npm test` — the header and palette suites pass; the only failing tests
  (`gate`, `sheets-secret-forwarding`, `stop-alerts-*-secret-forwarding`,
  `stop-alerts-failclosed`) fail identically on the base branch and are
  unrelated to this frontend change.

## Security
- No data/endpoint/secret change. Frontend markup + CSS + cache-versioning only.

## Deploy note
- Frontend only — Railway auto-deploy. The `sw.js` cache bump refreshes the
  shell on next load for already-installed apps.
