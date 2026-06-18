# Iteration 18 (step 3) — push the session outcome to outpatient pay

## What & why

Step 2 made the therapist's **three-state session outcome** (`happened` /
`therapist_cancelled` / `patient_no_show`) storage-only — stamped on the
`Schedule` row and nothing else. This step wires that outcome to **therapist
pay**: on a successful outcome save, the marked outcome is pushed to the
outpatient app's **`recordSessionOutcome`** endpoint, which computes pay / session
status **per outcome** and upserts by `sessionId`.

This is the third sender in the same family as the stop-flag and the clinical
billing-type push — server-to-server (Apps Script → Apps Script), shared secret,
the secret never reaching the browser.

## The push (sender)

- New **`_postSetSessionOutcome(o)`** in `apps-script/Code.gs`, called from
  `_setSessionOutcome` **after** the local stamp commits and **outside** the lock
  (no network round-trip held under lock — same shape as `_saveAssignment` →
  `_postSetClinicalType`).
- Same server-to-server pattern as `_postSetClinicalType` / `_postFlagStop`:
  `UrlFetchApp` to `OUTPATIENT_SHEETS_URL` with the **`SESSION_OUTCOME_SECRET`**
  Script Property. The secret is read from config and **never reaches the
  browser**.
- Fires on **all three** outcomes (`happened` / `therapist_cancelled` /
  `patient_no_show`) — outpatient computes pay/status per outcome.
- POST body is the documented contract:
  `{ action:'recordSessionOutcome', secret, sessionId, phone:<canonical>,
  therapist, clinicalTreatmentType:<treatmentType>, date:<scheduledDate>,
  outcome }`. The phone is normalized to the **canonical 10-digit leading-zero
  key**; `action` + `secret` are also on the query string to match the existing
  outbound calls.
- **`frequency` is NOT sent** — the Schedule row doesn't carry it (weekly
  frequency lives on the Assignment); outpatient handles its absence (e.g. for
  ליווי), so the therapists side never invents it.

## Response handling — fail-open-with-flag, never swallowed

The outcome **always saves locally**. The push outcome is attached to the save
response as `outcomeSync` and surfaced to the user:

| Outcome | UI |
| ------- | -- |
| `{ ok:true }` | proceeds silently |
| `unknown_therapist` / `unknown_type` / `unauthorized` | outcome kept; **warns** with the reason |
| `unconfigured` / `http_<code>` / `unreachable` / `non_ok` / `invalid_phone` | outcome kept; **warns** |

Deliberately **NOT** fail-closed like the stop flow — the outcome is owned here,
so the local stamp is authoritative and the push is a best-effort pay-sync that
must never be silently lost. Only an explicit `{ ok:true }` is success (no
`matched` count — outpatient upserts by `sessionId`).

**Idempotent by design:** re-marking the same session re-sends the same
`sessionId`; outpatient upserts on it, so a corrected outcome overwrites the prior
pay computation. No therapists-side dedupe.

## Files

- `public/outcome-sync.js` — new pure module (mirror of `clinical-sync.js`):
  `buildPayload` (canonical phone, secret from config), `interpretResponse`
  (`ok:true`-only success), `warningFor` (failed reason → Hebrew). Loaded in
  `index.html`.
- `apps-script/Code.gs` — `_postSetSessionOutcome` + `_setSessionOutcome`
  restructured to push outside the lock and attach `outcomeSync`.
- `public/app.js` — `outcomeSyncWarning` helper; the outcome toast now flags a
  failed pay-sync (`'נרשם: … — אך <reason>'`) instead of only the success line.
- `test/outcome-sync.test.js` — push fires on each of the three outcomes with the
  canonical-phone payload; secret from config (never hardcoded); every response
  outcome handled (ok vs each flag); a clean/absent sync warns nothing.
- `docs/outpatient-recordSessionOutcome.patch.md` — receiver-side contract +
  reference code + deploy steps.

## Deploy

- **Set the `SESSION_OUTCOME_SECRET` Script Property** on the **therapists** Apps
  Script (Apps Script editor → Project Settings → Script Properties), **same
  value** as on outpatient. The secret never reaches the browser.
- **Redeploy the therapists Apps Script web app** (new `_postSetSessionOutcome`
  call path).
- No new Railway env var — the push is Apps Script → Apps Script. Until the secret
  is set (or the outpatient receiver is live), the outcome saves locally and the
  UI **warns** that the pay-sync failed; the local outcome is never lost.
