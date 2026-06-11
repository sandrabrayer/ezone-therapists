# Changelog

## Iteration 2 — scheduling redesign

Redesigned from treatment-logging into a scheduling app (self-scheduled
follow-up treatments, treatment type + location + date, per-patient attendance,
group sessions, post-scheduling debt alerts, Sheet-driven active-flagged
therapist/type lists, cyan accent). Security architecture unchanged. Full notes:
[`CHANGELOG-scheduling-redesign.md`](CHANGELOG-scheduling-redesign.md).

## Scaffold — backend, core modules, tests (step 1)

Initial scaffold of the `ezone-therapists` app, following sibling conventions
(`ezone-outpatient`) verbatim.

### Server
- `server.js` — Express server carried over from outpatient (static frontend,
  `/api/sheets` proxy to this app's own Apps Script, in-memory `getData` cache
  with stale fallback, `/api/debug/*` endpoints, `__BUILD__` cache-bust). Added
  **cross-app proxy routes** that inject shared secrets server-side so the
  browser only ever calls relative `/api/...` and never sees a secret:
  - `GET /api/debt-status` → outpatient `getDebtStatus` (`DEBT_STATUS_SECRET`).
    **Never cached** — a debt decision must be live.
  - `GET /api/treatment-plans` → outpatient `getTreatmentPlans`
    (`TREATMENT_PLANS_SECRET`).
  - `GET /api/admitted` → dashboard `getAdmittedRoster` (`OCCUPANCY_SECRET`).
  - `proxyGet` is never-fail-open: upstream/parse errors return `ok:false`/502
    so the consumer treats them as "couldn't determine", never "clear".
  - `app.start()` exported and `app.listen` guarded by `require.main` so tests
    own the server lifecycle.
- `package.json`, `Procfile`, `railway.json`, `.gitignore` — Nixpacks/Railway
  config, express-only deps, `node --test`.

### Core logic modules (framework-free, browser + Node)
- `public/phone.js` — the patient-matching key. Strict canonical **input**
  validation (`/^0\d{9}$/`, no silent reformat) kept separate from tolerant
  **legacy matching** normalization (strip separators; `+972`/`972` → `0`).
- `public/debt-gate.js` — the never-fail-open tri-state gate composing the
  phone match with outpatient `debtStatus`. Five outcomes; only `clear` +
  exactly one match allows a silent save. `debt` blocks (approval), everything
  else (`unknown`, no match, multi-match, lookup failure) flags.
- `public/approval.js` — debtor-override stamp restricted to Ron (רון) / Sandra
  (סנדרה); captures patient, therapist, approver, note, timestamp, amount owed.

### Tests (`npm test`, 25 passing)
- `test/phone.test.js` — canonical validation + legacy normalization/matching.
- `test/debt-gate.test.js` — all five tri-state outcomes incl. multi-match and
  lookup failure never collapsing to allow.
- `test/approval.test.js` — approver allowlist + full audit stamp.
- `test/sheets-secret-forwarding.test.js` — each cross-app proxy forwards the
  correct action + secret to the correct sibling URL, and secrets don't leak
  across routes.

### Notes / flagged findings
- Tri-state value names follow the **real** outpatient `getDebtStatus` contract
  (`clear`/`debt`/`unknown`), not the kickoff's `clear`/`owes`/`not_found`. The
  mapping is documented in `public/debt-gate.js`.
- Three sibling-side dependencies are unmerged; tracked in `README.md` and
  `docs/`. The debt gate cannot work end-to-end until outpatient PR #14 is
  merged and the Apps Script redeployed.
