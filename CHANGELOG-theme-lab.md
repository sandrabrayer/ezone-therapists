# CHANGELOG — theme-lab (TEMPORARY)

**Date:** 2026-07-17
**Branch base:** `claude/inspiring-tesla-jipobw` (Railway live branch)
**Status:** TEMPORARY — delete in the palette-application PR

## What

A dev-only palette comparison page at `/theme-lab` for choosing the app's
color scheme visually. Direct URL only — not linked from any menu.

- Realistic mock of the app's three main views side by side (dashboard patient
  cards, workflow plan+scheduling panels incl. the debt-approval warning state,
  therapist personal view with outcome buttons).
- Live client-only controls: background slider (current plum → dark greys →
  near-black) + accent-tint slider; 8-swatch rows (muted → neon) for primary /
  plan / scheduling accents; scheme toggle (per-section vs single accent);
  filled-vs-outlined toggles for chips and cards/panels.
- Screenshot-ready readout box with all selected hex values and modes.
- Red (`#ff7676` / `chip-unpaid`) is reserved for errors: excluded from every
  swatch row, shown only as a fixed reference; guard-tested.

## Files

- `public/theme-lab.html` — NEW, self-contained page (own gate check, CSS, JS)
- `server.js` — route `GET /theme-lab` (no-store) added before the SPA catch-all
- `test/theme-lab.test.js` — NEW guard tests (see below)

## Security

- Behind the same shared password gate as the app: the page checks
  `GET /api/gate` and verifies via `POST /api/gate` (server-side, constant-time
  compare) before revealing content. When `APP_PASSWORD` is unset the gate is
  off, matching the app.
- No patient data: all mock content is hard-coded fake data. No reads of
  `/api/sheets` or any cross-app endpoint. `noindex, nofollow`.
- No persistence: no browser storage, no cookies, no API writes.

## Tests (all in `test/theme-lab.test.js`; full suite: 312 pass)

- route registered before the catch-all + no-store
- gate wiring present (GET check + POST verify)
- no persistence / no data APIs referenced
- temporary markers + noindex present
- no red-dominant hex in any selectable swatch row; reserved `#ff7676` not selectable
- not linked from `index.html`

## Removal plan

The follow-up PR that applies the chosen palette app-wide MUST, in the same PR:
delete `public/theme-lab.html`, the `/theme-lab` route in `server.js`,
`test/theme-lab.test.js`, and this file.
