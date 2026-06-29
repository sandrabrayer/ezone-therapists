[CHANGELOG-cache-bust-build.md](https://github.com/user-attachments/files/29467251/CHANGELOG-cache-bust-build.md)
# Permanent cache-busting: BUILD derived from commit SHA

## Why
After a frontend deploy the browser kept serving the OLD cached app.js/style.css,
forcing a manual DevTools "Empty Cache and Hard Reload" every time. Root cause:
the `?v=BUILD` cache-buster used `Date.now()` captured at process start, which did
not reliably change per deploy.

## What changed
- **server.js**: `BUILD` is now derived from the deployed commit SHA
  (`RAILWAY_GIT_COMMIT_SHA` / `SOURCE_VERSION` / `RAILWAY_DEPLOYMENT_ID` /
  `GIT_COMMIT`), truncated to 12 chars. Falls back to the newest file mtime in
  /public, then to process start time. The SHA changes on every deploy, so every
  `app.js?v=BUILD` (and all other assets + style.css) gets a fresh URL and a
  plain browser refresh loads the new code — no manual cache clearing.
- index.html already stamps every asset with `?v=__BUILD__` and is served with
  `Cache-Control: no-store`, so the new BUILD reaches all scripts immediately.

## Tests
- Verified BUILD derivation in both modes: with a SHA env set (uses 12-char SHA)
  and without (uses newest /public mtime). server.js passes `node --check`.

## Security
- No data, endpoint, or secret change. Build stamp is non-sensitive.

## Note
- If Railway does not expose a commit SHA env var, the mtime fallback still
  changes per deploy (files are re-checked out), so caching is fixed either way.
