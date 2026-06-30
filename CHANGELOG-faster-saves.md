[CHANGELOG-faster-saves.md](https://github.com/user-attachments/files/29502560/CHANGELOG-faster-saves.md)
# Faster saves: skip cross-app reloads after a write

## Why
Saving (assignment, booking, weekly schedule, session report, etc.) felt slow.
Each save POSTed the write and then ran loadAll(), which re-read ALL data AND
made two extra cross-app round-trips to the OUTPATIENT Apps Script
(loadDebtRoster + loadPlans). Apps Script /exec calls are slow, so every save
incurred ~3 sequential round-trips instead of 1.

## What changed
- **public/app.js**
  - Split `loadAll()` into:
    - `loadOwn()` — re-reads ONLY this app's own data (schedule, approvals,
      patients, assignments, therapists, types, notifications), then renders.
    - `loadAll()` — calls `loadOwn()` then the two cross-app reads
      (debt + plans). Used for the INITIAL load and the manual refresh button.
  - All post-save reloads now call `loadOwn()` instead of `loadAll()`. Debt and
    plans live in the outpatient app and don't change on a local save, so they no
    longer need re-fetching on every write. Net: ~3 round-trips per save → 1.
  - The manual «רועננו» refresh button still does a full `loadAll()` (picks up any
    upstream debt/plan changes), as does first load.

## Tests
- Full suite green except the 2 pre-existing unrelated failures. Behaviour is
  unchanged; only the post-save refresh scope is narrowed.

## Deploy note
- Frontend only — Railway auto-deploy. No Apps Script redeploy.
