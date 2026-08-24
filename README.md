# E-ZONE Therapists

Hebrew/RTL dark-theme app where **therapists self-schedule follow-up treatments
for active outpatients** — recording treatment type, location, and date — and
later mark whether each treatment happened. The cross-app outpatient **debt
gate** blocks new scheduling for a debtor and alerts on already-scheduled
treatments when a patient falls into debt. All therapists have access.

Same stack as the E-ZONE siblings (`ezone-outpatient`, `ezone-managers`,
`ezone-staffing`, `E-Zone-Dashboard`): Node.js + Express serving a vanilla
HTML/JS frontend, Google Sheets via an Apps Script Web App (`doGet`/`doPost`),
deployed on Railway. The accent is **cyan/sky** (distinct from the indigo
dashboard app) on a comfortable slate-blue base. Redesign notes:
[`CHANGELOG-scheduling-redesign.md`](CHANGELOG-scheduling-redesign.md) (iteration
2) and [`CHANGELOG-iteration3-restructure.md`](CHANGELOG-iteration3-restructure.md).

## Tabs (no login, no roles)

The app opens directly — **no identity screen, no PIN, no roles**. All three tabs
are visible to everyone (`public/access.js` is just the tab list):

1. **דשבורד מטופלים** — view-only overview of **all** patients + plan(s). A patient
   may have **multiple parallel treatments with different therapists**; each card
   shows assigned therapists, plans (type + weekly frequency), debt status, a
   "still admitted" badge, origin, and any post-scheduling debt alert.
2. **שיבוץ מטפלים** — **«רישום מטופל חדש»**, patient **«פרטים»** (identity/origin),
   and per-row **«עריכה»** to add/edit/remove a patient's therapist + plan. Plus a
   read-only oversight list of scheduled treatments. Filterable by therapist +
   patient. Open to all.
3. **המטופלים שלי** — a therapist **picks their name from the in-tab dropdown**
   (`#mineTherapist`) — a fresh pick every open, **never persisted**; until then a
   «בחר/י את שמך» prompt shows. Scoped to their **own assigned patients**, each
   with **«+ קביעת טיפול»** (treatment type + **day + time** + location; therapist
   locked to the picked name), and their treatments in four buckets —
   **טיפולים שנקבעו** (overdue / beyond-week) / **קרובים** (the **coming week**,
   today…+7) / **שבוצעו** / **שנקבעו ולא בוצעו**. Each session is marked with a
   **3-state outcome** — **התקיים** / **המטפל ביטל / לא הגיע** / **המטופל לא הגיע**
   (see below). Each booking also has inline **«עריכה»** (change day / time /
   location) and, while unreported, **«ביטול טיפול»** (cancel).

Identity is self-asserted (anyone can pick any therapist name); the real controls
are the outpatient **debt gate** + the **Ron/Sandra approval audit**.

### Session outcome — 3-state (storage-only)

The therapist marks what actually happened to a scheduled session as exactly
**one of three** mutually-exclusive outcomes (`public/outcome.js`, mirrored by
`apps-script/Code.gs:_setSessionOutcome`):

| stored token          | label                    |
| --------------------- | ------------------------ |
| `happened`            | התקיים                   |
| `therapist_cancelled` | המטפל ביטל / לא הגיע      |
| `patient_no_show`     | המטופל לא הגיע            |

English tokens are stored (the app's enum convention); Hebrew is display-only.
One click on the picker in «המטופלים שלי» records the outcome **stamped** with
the session's identity — `patient`, `therapist`, `treatmentType`, `scheduledDate`,
`outcome`, `outcomeAt` (timestamp) — on the patient's `Schedule` row (new
`outcome` / `outcomeAt` columns). The token set is **closed**: the backend
rejects anything else (`invalid_outcome`).

This step is **storage-only**: marking an outcome does **no** pay computation and
triggers **no** outpatient write-back. Wiring the outcome to therapist pay / the
outpatient receiver is a **follow-up step**; until then the legacy binary
`attendance` field + its write-back (below) are left in place, untouched. The
«המטופלים שלי» buckets do follow the outcome, though: `happened` → **שבוצעו**,
`therapist_cancelled` / `patient_no_show` → **שנקבעו ולא בוצעו**, and a session
with an outcome set can no longer be cancelled.

### Post-treatment report → outpatient write-back (legacy binary, pre-3-state)

Marking a treatment saves locally (**source of truth**) and the therapists Apps
Script writes the result back to outpatient's new `recordTreatmentGiven` endpoint
(shared-secret, the first cross-app **write**). It is **idempotent by treatment
id** and re-sends the whole session, so unmarking/editing can't drift downstream
pay. A **group (קבוצה) is one therapist-payment record at the group rate** (not
one per patient), while per-patient attendance is still captured for billing. If
outpatient is unreachable the row is left `syncStatus='pending'` and surfaced as
"ממתין לסנכרון" with a **«סנכרן עכשיו»** retry — never dropped. See
[`docs/outpatient-recordTreatmentGiven.patch.md`](docs/outpatient-recordTreatmentGiven.patch.md).

The old **מטופלים באשפוז** (inpatient) tab is gone — inpatient treatment is
handled in another app. Where a patient *came from* is now an **origin** field on
the patient record, with an optional "still admitted" + which house. The separate
treatment-plan tab is merged into the dashboard.

### Intake — «רישום מטופל חדש» (dashboard only)

Vered registers a new patient in one form: identity (name + canonical phone),
origin (where they came from / still admitted + which house), and an **optional
initial assignment** (therapist + treatment type + weekly frequency). The patient
then flows to **שיבוץ מטפלים**, where a patient can hold several parallel
therapists (stored one row per assignment in the `Assignments` sheet). Editing an
existing patient from the dashboard updates identity + origin; assignments are
managed in שיבוץ.

**Treatment types + per-type weekly frequency are LOCKED to the approved
outpatient plan.** The plan (`getTreatmentPlans` → `state.plans`, projected by
`public/plan.js`) is the **single source of truth**. A plan can hold **several
treatment types** — the `sessions` JSON-blob **keys ARE the types**
(e.g. `{"מרכז יום":3,"טיפול משפחתי":1}` = two types), each with its **own weekly
frequency** and assignable to a **different therapist**. The plan is projected as a
**list of `{treatmentType, frequencyPerWeek}`**, and the שיבוץ assignments modal
renders **one locked row per type**: type + frequency **read-only**
(`svc()`-relabeled), an editable therapist, and a weekly-slot editor sized to that
type's frequency — **no free add/remove** (the rows are exactly the plan's types).
When a therapist schedules (`+ קביעת טיפול`), the type is locked to the **specific**
plan type they are working (read-only) and they enter only day/time/location. Both
flows **BLOCK** (never fail open) when there is no single approved plan to read — no
match / ambiguous multi-match / a plan with zero types (*"אין תוכנית טיפול מאושרת —
על ורד להגדיר תחילה תוכנית במערכת הקליטה"*) or the plans endpoint is down (*"לא ניתן
לאמת…"*). See
[`CHANGELOG-iteration19-lock-plan.md`](CHANGELOG-iteration19-lock-plan.md).

## Scheduling, lists & groups

- **Therapist + treatment-type lists are Sheet-driven and active-flagged.** An
  admin adds/retires/reactivates entries in the `Therapists` / `TreatmentTypes`
  sheets with no code change. Retiring an entry only removes it from the dropdown
  going forward; past records keep their original therapist/type string.
- **Locations** are a fixed list of six (id stored, Hebrew shown): שדה אליעז,
  קיסריה ריהאב, קיסריה עפרוני, רעננה אשר, רעננה הפרדס, רמות השבים. **Time** is a
  30-minute dropdown 07:00–21:00. *(Older note below predates this list.)*
- **House enumerations live in [`public/houses.js`](public/houses.js)** — the
  single source of truth for the scheduling `LOCATIONS` and the intake
  `ORIGIN_HOUSES` lists, including the canonical↔internal key mapping for the
  ecosystem's **five houses** (canonical ids `asher`, `ramot`, `arfoni`,
  `rehab`, `pardes`). The new house **רעננה הפרדס** (opened Aug 2026,
  תחלואה כפולה) uses canonical id **`pardes`** on the intake list and the
  pre-existing scheduling-location id `raanana_pardes` (already stored on live
  bookings — never rename stored ids). `test/houses.test.js` guards that every
  enumeration covers all five canonical houses.
- **(legacy)** earlier locations were: רמות השבים (`ramot`),
  רעננה (`raanana`), אשר (`asher`), קיסריה ערפוני (`arfoni`), קיסריה ריהאב
  (`rehab`). Location is the therapist's scheduling choice, independent of the
  patient's roster house.
- **Group treatments (קבוצה)** allow several patients in one session (one
  therapist, one time/location). The debt check and attendance both run **per
  patient** — a debtor is blocked/approved individually while the session
  proceeds for everyone else.
- **Post-scheduling debt alert** — debt is re-checked live on every load/refresh
  for upcoming, unmarked treatments, so a patient who falls into debt *after*
  booking is surfaced on the dashboard and the affected schedule row.
- **Display relabel** — the legacy outpatient service term **מרכז יום** is shown
  as **ליווי יומי בקהילה** (`Scheduling.displayServiceType`); the stored value is
  untouched. The outpatient SOURCE data should eventually adopt the new term too
  (see [`docs/DEPENDENCIES.md`](docs/DEPENDENCIES.md)).

## Weekly recurring pattern (set once)

A therapist sets a **weekly recurring pattern per assignment**: N slots
(N = `frequencyPerWeek`), each `{ weekday, time, location }` — e.g. CBT 3×/week =
ראשון 10:00 רעננה אשר · שלישי 10:00 · חמישי 10:00. It's edited in the per-patient
assignments modal and stored as a `slots` JSON column on `Assignments` (empty =
no recurrence; existing assignments are unaffected).

Generation is **rolling and virtual**: `Recurring.generateOccurrences`
([`public/recurring.js`](public/recurring.js)) materializes only the **coming
week's** occurrences into the therapist's «קרובים» view — nothing is pre-written to
the sheet. Each occurrence has a **deterministic id**
`occ_<assignmentId>_<YYYYMMDD>_<HHMM>` that doubles as the Schedule row id and the
write-back `treatmentId`, so re-viewing a week **never duplicates** (an occurrence
already materialized as a real row is dropped). Reporting is unchanged — on report
the backend **materializes** the booking row (create-only, idempotent by id) then
runs the same authoritative report-time debt gate; materialization itself is
ungated. The pattern keeps generating until the patient is **stopped/discharged**
(stop halts generation and cancels future bookings). A one-off session is still
booked exactly as before.

## Stopping a patient (stop / discharge flow)

A patient is **stopped** when they're **discharged in outpatient**
(`getTreatmentPlans` reports `status: "סיים טיפול"`) **or locally flagged** via
the **«הפסקת טיפול»** action (Vered in שיבוץ, or a therapist on their own
patient). The action does **not** discharge directly — it POSTs `flagStop` to
outpatient (server-to-server from the therapists Apps Script, shared secret
`STOP_FLAG_SECRET`), a **pending request Vered confirms in outpatient**
(«נשלחה בקשת הפסקה לאישור ורד»). It is **fail-closed**: only on a successful send
does the app set a local stop flag and **cancel the patient's future, unreported
bookings** (past + reported bookings are kept for the record); if the flag can't
be sent, nothing changes. Stopped patients leave the active list and appear in a
read-only **«מטופלים שביקשו לסיים טיפול»** dashboard section. Pure logic in
[`public/stopflow.js`](public/stopflow.js) (mirrored in `Code.gs`). Config: set
the `STOP_FLAG_SECRET` Script Property to match outpatient's; reuses
`OUTPATIENT_SHEETS_URL` (see [`docs/DEPENDENCIES.md`](docs/DEPENDENCIES.md)).

The row matchers that apply the local move (update the Patients row) and cancel
future bookings **recover a leading zero Sheets may have dropped** before matching
(mirroring the iteration-13 read-path repair) — otherwise a patient whose stored
phone was mangled (`501234567`) wouldn't match the canonical key `0501234567`, so
their row and bookings would be missed.

## Clinical billing-type push (assignment → outpatient)

When an assignment is saved, the patient's chosen **clinical treatment type** is
pushed to outpatient (`setClinicalType`) so its **per-patient billing rate**
follows the clinical plan picked here. Server-to-server from the therapists Apps
Script (`_postSetClinicalType`, same `UrlFetchApp` pattern as `flagStop`), shared
secret **`CLINICAL_TYPE_SECRET`**, the phone sent as the canonical 10-digit key.
Unlike the stop flow it is **fail-open-with-flag**: the assignment **always saves
locally** — only `{ok:true, matched:1}` proceeds silently, while `no_match` /
`multi_match` / `unknown_type` / unreachable / unconfigured each **warn** the user
that billing-type sync failed (and why), never silently swallowed. The 5
individual-billing types (פסיכודינמי, פסיכותרפי ממוקד טראומה, עיסוי טיפולי, טיפול
ממוקד התמכרויות, טיפול אינטגרטיבי) are nested under one **פרטני** group in the
picker — display only, the saved value stays the specific clinical name. Pure logic
in [`public/clinical-sync.js`](public/clinical-sync.js) (mirrored in `Code.gs`).
Config: set the `CLINICAL_TYPE_SECRET` Script Property to match outpatient's;
reuses `OUTPATIENT_SHEETS_URL`. The outpatient receiver is already **live**
(outpatient PR #30), so once the secret is set here and the therapists Apps Script
is redeployed, the push works end-to-end (see
[`docs/DEPENDENCIES.md`](docs/DEPENDENCIES.md) and
[`docs/outpatient-setClinicalType.patch.md`](docs/outpatient-setClinicalType.patch.md)).

## Phone — one enforced format

Phone is the patient-matching key, stored in exactly **one** canonical format:
10 digits, no separators, leading zero (e.g. `0501234567`). On entry the app
**normalizes then validates** (`Phone.toCanonical`): strip spaces/dashes/parens,
convert a `+972`/`972` prefix to a leading `0`, and if the result is a valid
10-digit leading-zero number, **store the normalized form**; otherwise reject the
save with a clear Hebrew message (a number with no leading zero is rejected, not
auto-prepended). The **normalizer is shared** with the debt-match comparison
(`normalizeForMatch`) — one implementation. Both the browser forms and the Apps
Script `savePatient`/`_saveScheduleRow` enforce it, so a non-canonical number is
never stored (even via a direct POST). See [`public/phone.js`](public/phone.js).

Sibling apps stored phones freely, so their values are normalized at **compare
time** before matching against the canonical key.

**Keeping (and recovering) the leading zero.** Google Sheets would coerce a
canonical phone written to a number-formatted cell into a number, dropping the
leading zero (`"0501234567"` → `501234567`). Two-part fix: `_ensureSheet` pins
every phone column to the `'@'` (plain-text) format so new saves keep the zero,
and `Phone.recoverStored` (shared, mirrored in `Code.gs`, applied on read both
server- and client-side) restores the zero on already-mangled 9-digit rows. This
is **read-side recovery of corrupted data only** — typed input is still strictly
validated. `_readAll` recovers automatically, but **raw-grid reads**
(`sh.getRange(...).getValues()` row scans in `_setSessionOutcome` and
`_markAttendance`) bypass it, so each must call `_recoverStoredPhone` itself
before the phone feeds a canonical-key push or debt-roster match — otherwise the
strict validator (`_toCanonicalPhone`) rightly rejects the zero-less number and
the push fails `invalid_phone`.

**No duplicate patients.** Registering a *new* patient (`savePatient` with
`mode:'create'`) whose phone already belongs to someone is rejected
(`duplicate_phone`) with a Hebrew message naming the existing patient
(`Phone.duplicateOf`), enforced on the form and the backend. Editing an existing
patient still upserts by phone, and a patient may still hold several assignments.

## Cross-app debt gate — tri-state, never fail open

Before an outpatient treatment log saves, the app reads debt status from
outpatient's `getDebtStatus` endpoint (proxied through this server so the
shared secret never reaches the browser). Outcomes
([`public/debt-gate.js`](public/debt-gate.js)):

| situation | gate | UI |
| --------- | ---- | -- |
| 1 match, `clear` | allow | save |
| 1 match, `debt` | block | require Ron/Sandra approval |
| 1 match, `unknown` (no payment rows) | flag | manual resolve |
| phone matches no client | flag | manual resolve |
| phone matches >1 client | flag | manual resolve |
| debt lookup failed/missing | flag | manual resolve |

A debtor may continue treatment **only** with an explicit approval by Ron
(רון) or Sandra (סנדרה), captured as an audit stamp (patient, therapist,
approver, note, timestamp) — see [`public/approval.js`](public/approval.js).

## Architecture / data sources

This app has its **own** Google Sheet — `Schedule` (one row per patient per
session; carries both the legacy binary `attendance` and the 3-state `outcome` /
`outcomeAt`), `Approvals`, `Patients` (identity + origin, keyed by phone),
`Assignments` (one row per patient↔therapist↔plan, so a patient can have several),
and the editable `Therapists` / `TreatmentTypes` lists. It also reads three sibling
projections through server-side proxy routes — the browser only ever calls
relative `/api/...` URLs and never sees a secret:

| route | upstream | env vars | purpose |
| ----- | -------- | -------- | ------- |
| `GET /api/sheets` | this app's sheet | `SHEETS_URL` | schedule, approvals, patients, lists |
| `GET /api/debt-status` | outpatient | `OUTPATIENT_SHEETS_URL`, `DEBT_STATUS_SECRET` | debt gate + active roster |
| `GET /api/treatment-plans` | outpatient | `OUTPATIENT_SHEETS_URL`, `TREATMENT_PLANS_SECRET` | active roster + treatment-plan tab |
| `GET /api/admitted` | dashboard | `DASHBOARD_SHEETS_URL`, `OCCUPANCY_SECRET` | kept/wired; no UI consumer after the inpatient tab was removed |

The debt gate is **never cached** — a debt decision must be live.

### External dependencies (sibling-side work required)

The two outpatient/dashboard endpoints this app consumes are **not yet merged**
on the sibling side. They are documented, with ready-to-apply Apps Script
patches + tests, in [`docs/`](docs/):

1. **outpatient `getDebtStatus`** — added in outpatient **PR #14**
   (`claude/nice-edison-5bvwiz`), currently **open/unmerged**. Must be merged
   and the outpatient Apps Script **redeployed**.
2. **outpatient `getTreatmentPlans`** — see
   [`docs/outpatient-getTreatmentPlans.patch.md`](docs/outpatient-getTreatmentPlans.patch.md).
3. **dashboard `getAdmittedRoster`** — see
   [`docs/dashboard-getAdmittedRoster.patch.md`](docs/dashboard-getAdmittedRoster.patch.md).
   Joins occupancy → Leads on `fromLead` to recover the phone. Admitted
   patients added directly (no originating lead) have no phone and fall back to
   manual/free-text entry in the inpatient tab.

## Access — shared password gate (UI only)

An optional **shared password** is asked on open (when the Node env
**`APP_PASSWORD`** is set), verified **server-side** via `POST /api/gate`
(`crypto.timingSafeEqual`; the value is never in frontend source and never
returned to the browser). It is **not persisted** — re-prompted every open — and
is **only a gate**: it does not identify the user. If `APP_PASSWORD` is unset the
gate is **off** and the app opens directly. This gates the **UI**, not the data
API (`/api/sheets` etc. remain reachable directly).

After the gate, there are **no roles and no per-user login** — all three tabs are
usable by anyone. The only "identity" is the therapist **name** picked inside
**המטופלים שלי** — a runtime choice, fresh every open, used to scope that tab and
to stamp scheduled/reported treatments. It is **self-asserted** (anyone can pick
any name); the real controls are the outpatient **debt gate** and the
**Ron/Sandra approval audit** (per-patient, auto-stamped).

## Local development

```bash
npm install
export SHEETS_URL="https://script.google.com/macros/s/.../exec"          # this app's sheet
export OUTPATIENT_SHEETS_URL="https://script.google.com/macros/s/.../exec" # outpatient
export DEBT_STATUS_SECRET="..."
export TREATMENT_PLANS_SECRET="..."
export DASHBOARD_SHEETS_URL="https://script.google.com/macros/s/.../exec"  # dashboard
export OCCUPANCY_SECRET="..."
export APP_PASSWORD="..."        # optional shared UI-gate password (omit = no gate)
npm start          # http://localhost:3000
npm test           # node --test
```

## Deploy to Railway

- Repo contains `Procfile` and `railway.json` (Nixpacks).
- Set the env vars above on the Railway service. None are hardcoded.
- Listens on `process.env.PORT`. Single service, one URL.

## Conventions (shared across all E-ZONE siblings)

- Relative `/api/...` URLs only — no hardcoded domains.
- Hebrew stored in Sheets ↔ English ids on load (`heToId`/`idToHe`).
- `fmtDate` strips a `T…Z` suffix before display.
- `index.html` cache-busts `app.js` with `?v=<Date.now()>`.
- Submit buttons disable on click, re-enable on failure.
- Load/save failures surface a toast — no silent empty fallback.
- Secrets (`*_SECRET`) and sheet URLs are env vars, never committed.
