# Changelog — iteration 12: enforce canonical phone on entry

No badly-formatted phone number can be saved. **Normalize then validate**, store
the normalized canonical form, reject the rest with a clear Hebrew message.
**Entry enforcement only — existing stored data is not touched.**

## Canonical rule
Exactly **10 digits, leading zero, no separators** (e.g. `0501234567`).

## What changed
- **`public/phone.js` — `Phone.toCanonical(raw)`**: composes the *existing*
  `normalizeForMatch` (strip spaces/dashes/parens/dots; `+972`/`972` → leading
  `0`) → `isCanonical`. On success returns `{ ok:true, value }` (the normalized
  number to store); on failure `{ ok:false, error }`. **No duplicated logic** —
  it reuses the normalizer built for the debt match. A no-leading-zero number is
  **rejected, not auto-prepended** (don't guess).
- **Both entry forms** — patient intake/edit (`handlePatientSubmit`) and the
  schedule modal patient rows (`handleScheduleSubmit`) — now use `toCanonical`
  and **store the normalized value**.
- **Phone inputs relaxed** — dropped `maxlength="10"` and changed
  `inputmode="numeric"`→`"tel"`, so separators / `+972` can actually be typed
  before normalization.
- **Backend enforcement (defense-in-depth)** — `Code.gs` `_toCanonicalPhone`
  mirror; **`savePatient`** and **`_saveScheduleRow`** normalize + validate and
  reject `invalid_phone`, so no non-canonical number persists even via a direct
  POST. (Client `invalid_phone` → friendly Hebrew toast.)

## Why no legitimate number is rejected
This app's stored phones already came through the *strict* validator, so they're
already canonical; `toCanonical` is strictly **more lenient** at entry (it now
accepts fixable numbers by normalizing) while still guaranteeing a canonical
store. The outpatient roster's free-form phones are only *read* and matched via
`normalizeForMatch` — unchanged.

## Tests
`test/phone.test.js` adds `toCanonical`: already-canonical, separators, `+972`/
`972`, too short / too long, no-leading-zero (rejected), empty/garbage. `npm test`
— 89 passing.

## Deploy
`Code.gs` changed (backend enforcement) → **Apps Script redeploy required**
(Manage deployments → Edit → New version). Frontend served as usual.
