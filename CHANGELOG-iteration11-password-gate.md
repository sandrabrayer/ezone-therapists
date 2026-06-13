# Changelog — iteration 11: shared password gate (UI)

A single shared password, entered on open before anything shows. **UI gate only**
(not API-level auth), verified **server-side**, **never persisted**.

## Behavior
- On open, the app calls **`GET /api/gate`** → `{ required }`. If a password is
  configured it shows a **password screen** (`#gateScreen`, reusing the pin-card
  styles); otherwise it opens directly.
- Submitting posts to **`POST /api/gate` `{ password }`** → `{ ok }`. Correct →
  the app reveals and runs the normal flow (dashboard + load). Wrong → inline
  «סיסמה שגויה».
- **Not persisted** — nothing in storage; the gate is re-prompted every open.
- The password is **only a gate** — it does not identify anyone; the therapist
  still picks their name in **«המטופלים שלי»** afterward.

## Where the secret lives / security
- Stored as the Node env var **`APP_PASSWORD`** (Railway) — **never in frontend
  source** and **never sent to / echoed by** the browser.
- Compared with **`crypto.timingSafeEqual`** over SHA-256 digests (constant-time).
- When `APP_PASSWORD` is **unset, the gate is OFF** (app opens directly) — so
  deploying the code before setting the var never locks anyone out; setting it
  activates the gate.
- **Scope (accepted):** this gates the **UI**, not the data API. `/api/sheets`,
  `/api/debt-status`, etc. remain reachable directly (Apps Script "anyone with
  the link"). True API auth would be a larger change.

## Tests
`test/gate.test.js` (stub-env + real HTTP, like `sheets-secret-forwarding.test.js`):
`GET /api/gate` reports `required` from the env; correct password → `ok:true`;
wrong / empty / missing → `ok:false`; and the secret never appears in any
response body. `npm test` — 83 passing.

## Deploy
**Frontend + Node only — no Apps Script redeploy.** Railway redeploys on merge;
**set `APP_PASSWORD` in the Railway service env** to turn the gate on.
