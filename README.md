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
   today…+7) / **שבוצעו** / **שנקבעו ולא בוצעו**. Each is **reported happened /
   didn't-happen** (reason required for didn't) — the **payment trigger** (no
   report = no pay), **debt-gated at report time** and written back to outpatient.
   Each booking also has inline **«עריכה»** (change day / time / location) and,
   while unreported, **«ביטול טיפול»** (cancel — a reported one must be marked
   «לא התקיים» first).

Identity is self-asserted (anyone can pick any therapist name); the real controls
are the outpatient **debt gate** + the **Ron/Sandra approval audit**.

### Post-treatment report → outpatient write-back

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
then flows to **שיבוץ מטפלים**, where assignments are fully editable — a patient
can hold several parallel treatments/therapists, and both the plan (type +
frequency) and the therapist are editable after being set (stored one row per
assignment in the `Assignments` sheet). Editing an existing patient from the
dashboard updates identity + origin; assignments are managed in שיבוץ.

## Scheduling, lists & groups

- **Therapist + treatment-type lists are Sheet-driven and active-flagged.** An
  admin adds/retires/reactivates entries in the `Therapists` / `TreatmentTypes`
  sheets with no code change. Retiring an entry only removes it from the dropdown
  going forward; past records keep their original therapist/type string.
- **Locations** are a fixed list of six (id stored, Hebrew shown): שדה אליעז,
  קיסריה ריהאב, קיסריה עפרוני, רעננה אשר, רעננה הפרדס, רמות השבים. **Time** is a
  30-minute dropdown 07:00–21:00. *(Older note below predates this list.)*
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

## Phone — one enforced format

Phone is the patient-matching key. This app accepts exactly **one** canonical
format: 10 digits, no separators, leading zero (e.g. `0501234567`). Input is
validated and a wrong shape is a hard error — we never silently reformat. The
canonical string is the only thing stored.

Sibling apps stored phones freely, so their values are normalized **at
compare time** (strip spaces/dashes/parens; `+972`/`972` → `0`) before matching
against the canonical key. See [`public/phone.js`](public/phone.js).

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
session), `Approvals`, `Patients` (identity + origin, keyed by phone),
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
