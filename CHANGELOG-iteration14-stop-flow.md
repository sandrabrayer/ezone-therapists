# Changelog — iteration 14: patient stop / discharge flow (sender)

The therapists side of the stop flow. A patient stops treatment in one of two
ways, and **both** move them out of the active list into a read-only
"stopped / discharged" list (history kept), with their future bookings cancelled.

## The two ways a patient is "stopped"

1. **Discharged in OUTPATIENT** — the source of truth. `getTreatmentPlans` (the
   shared-secret pull already used for the dashboard) reports
   `status: "סיים טיפול"`; that status now marks the patient stopped here.
2. **Locally flagged** — Vered (in שיבוץ) or a therapist (on their own patient)
   presses **«הפסקת טיפול»**. This does **not** discharge directly: it POSTs
   `flagStop` to the outpatient `/exec` (server-to-server from the therapists
   Apps Script, shared secret), creating a **pending request Vered confirms in
   outpatient**. Until then the patient is "stopped" here so we stop scheduling
   them.

## What changed

- **New pure module `public/stopflow.js`** (mirrored in `Code.gs`,
  unit-tested): `isStoppedStatus` (recognises `"סיים טיפול"`), `isPatientStopped`
  (discharged OR locally flagged), `buildFlagStopPayload` (reuses
  `Phone.toCanonical` so the outgoing phone is always canonical; a non-canonical
  phone is rejected, never sent), and `futureBookingsToCancel` / `…Ids` (future,
  **unreported** bookings only — past + reported are kept).
- **`markPatientStopped` action (`Code.gs`)** — canonicalize the phone → **POST
  `flagStop`** to outpatient → **only on success** set the local stop flag and
  **cancel the patient's future unreported bookings**. **FAIL-CLOSED:** if the
  flag can't be sent (secret/URL unset, non-2xx, or `ok:false`), the action
  aborts — no local flag, no cancellation — and returns a clear error, so nothing
  changes until the request actually reaches Vered.
- **Patients sheet** gains append-only local-flag columns: `stopped`,
  `stoppedBy`, `stoppedAt`, `stopNote`. `savePatient` now **preserves** them on
  an identity/origin edit (the row is rebuilt on upsert).
- **Active list excludes stopped patients** — `activePatients()` /
  `stoppedPatients()` are thin filters over one `buildPatientRoster()` that tags
  each patient `stopped`. KPIs, שיבוץ, and «המטופלים שלי» all drop stopped
  patients automatically.
- **Dashboard** gets a read-only **«מטופלים שהופסקו / סיימו טיפול»** section
  (name · reason · who/when/note). The reason distinguishes "סיים טיפול
  (מטופלי חוץ)" from "בקשת הפסקה ממתינה לאישור ורד".
- **«הפסקת טיפול» button** in שיבוץ (Vered) and «המטופלים שלי» (therapist),
  with a confirm + optional note, and a **«נשלחה בקשת הפסקה לאישור ורד»** toast.

## Config (the only new setting)

Set on the **therapists Apps Script → Script Properties**:

- **`STOP_FLAG_SECRET`** — set it to match the outpatient `STOP_FLAG_SECRET`.
- Reuses the existing **`OUTPATIENT_SHEETS_URL`** Script Property.
- **No new Node env var** — the `flagStop` POST is server-to-server from
  `Code.gs` (same as the `recordTreatmentGiven` write-back); the browser never
  sees the secret.

Until `STOP_FLAG_SECRET` is set (and the outpatient `flagStop` receiver
deployed), «הפסקת טיפול» fails closed with `stop_flag_unconfigured` and nothing
is changed.

## Tests

`test/stopflow.test.js` (11): `isStoppedStatus` / `isPatientStopped`;
`buildFlagStopPayload` builds a canonical phone (separators, `+972`), rejects a
non-canonical one, trims/defaults fields; `futureBookingsToCancel` cancels
future-unreported rows, keeps past + reported, matches across legacy phone
formats, ignores other patients, handles ISO datetimes and blanks. `npm test` —
all passing (107 with deps installed).

## Deploy

`Code.gs` changed (new action, Patients columns, flagStop POST) → **Apps Script
redeploy required** (Manage deployments → Edit → New version). Set the
`STOP_FLAG_SECRET` Script Property to match outpatient's. Frontend served as
usual.
