# Changelog — iteration 17: clinical billing-type push + nested פרטני menu

On assignment save, the patient's **clinical treatment type** is pushed to the
outpatient app so its per-patient billing rate follows the clinical plan chosen
here. Plus: the 5 individual-billing types are nested under **פרטני** in the
treatment-type picker (display only).

## The push (sender)

- New `_postSetClinicalType(phone, clinicalTreatmentType)` in
  `apps-script/Code.gs`, called from `_saveAssignment` **after** the local
  upsert and **outside** the lock (no network round-trip held under lock). Fires
  for every non-empty `treatmentType`.
- Same server-to-server pattern as `_postFlagStop` / `_postTreatmentsGiven`:
  `UrlFetchApp` to `OUTPATIENT_SHEETS_URL` with the **`CLINICAL_TYPE_SECRET`**
  Script Property. The secret is read from config and **never reaches the
  browser**.
- POST body is the documented contract:
  `{ action:'setClinicalType', secret, phone:<canonical>, clinicalTreatmentType }`.
  The phone is normalized to the **canonical 10-digit leading-zero key** (the
  outpatient matching key); `action` + `secret` are also on the query string to
  match the existing outbound calls.

## Response handling — fail-open-with-flag, never swallowed

The assignment **always saves locally**. The push outcome is attached to the
save response as `clinicalSync` and surfaced to the user:

| Outcome | UI |
| ------- | -- |
| `{ ok:true, matched:1 }` | proceeds silently |
| `no_match` / `multi_match` / `unknown_type` | save kept; **warns** with the reason |
| `unconfigured` / `http_<code>` / `unreachable` / `non_ok` / `invalid_phone` | save kept; **warns** |

This is deliberately **NOT** fail-closed like the stop flow (where nothing
changes locally unless the flag lands) — the clinical plan is owned here, so the
save is authoritative and the push is a best-effort sync that must never be
silently lost.

## Nested פרטני menu (display only)

The 5 newly-billable individual types — פסיכודינמי, פסיכותרפי ממוקד טראומה,
עיסוי טיפולי, טיפול ממוקד התמכרויות, טיפול אינטגרטיבי — are grouped under a
single `<optgroup label="פרטני">` in the treatment-type picker. **Grouping is
display only:** each option keeps its own distinct value, so the saved
`treatmentType` is always the specific clinical name, never the group label.

## New module + tests

- `public/clinical-sync.js` (UMD, framework-free) holds the pure pieces:
  `shouldPush`, `buildPayload` (canonical phone + config secret),
  `interpretResponse` (only `ok:true/matched:1` is success), `warningFor` (reason
  → Hebrew), and `partitionTypes` / `isIndividualBillingType` (menu grouping).
  `apps-script/Code.gs` mirrors `buildPayload` + `interpretResponse`; `public/app.js`
  delegates to it.
- `test/clinical-sync.test.js` locks: push fires with the correct canonical-phone
  payload; the secret flows from config (and isn't hardcoded in the module); every
  response outcome is handled (success vs each flag case, never fail-open); and the
  menu grouping keeps the specific value, never the label.

## Deploy

- **`CLINICAL_TYPE_SECRET`** must be set as a **Script Property on the therapists
  Apps Script** (where the write originates) and the **same value** on outpatient.
  **No new Railway/Node env var** — the write goes Apps Script → Apps Script.
- The outpatient receiver is already **live** (outpatient PR #30); contract
  documented in
  [`docs/outpatient-setClinicalType.patch.md`](docs/outpatient-setClinicalType.patch.md)
  (dep #6 in [`docs/DEPENDENCIES.md`](docs/DEPENDENCIES.md)). So the only remaining
  work is on the therapists side: set the secret + redeploy the therapists Apps
  Script. Until that's done, saves stick locally and warn `unconfigured`.
