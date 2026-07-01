[CHANGELOG-icon-cache-bust.md](https://github.com/user-attachments/files/29534341/CHANGELOG-icon-cache-bust.md)
# Force-refresh the PWA icon (bust Android's cached home-screen icon)

## Why
After replacing icon-192 with the real E-ZONE logo, Android kept showing the old
cached icon on the home screen. The device couldn't be cleared/reset manually, so
the refresh has to be forced from the code side.

## What changed
- **public/sw.js**: bumped the cache name `ezone-therapists-v1` → `-v2`. On next
  load every device's service worker activates the new cache and deletes the old
  one (the activate handler already removes non-current caches), dropping any
  stale cached asset.
- **public/manifest.webmanifest**: appended `?v=2` to all three icon `src`s so the
  OS treats them as NEW icon URLs and re-fetches them instead of reusing the
  cached image.
- **public/index.html**: matched `apple-touch-icon` to `icon-192.png?v=2`.

## Security
- No data/endpoint/secret change. Cache-versioning only.

## Tests
- sw.js passes `node --check`; manifest is valid JSON; full suite green except the
  2 pre-existing unrelated failures.

## Deploy note
- Frontend only — Railway auto-deploy. To see the new icon on a device that has
  the app installed, remove the installed app and re-add it after this deploys;
  the `?v=2` ensures the fresh logo is fetched.
