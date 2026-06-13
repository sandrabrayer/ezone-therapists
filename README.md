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

## Tabs

1. **דשבורד מטופלים** — **view-only for everyone**: active patients with their
   treatment plan(s). A patient may have **multiple parallel treatments with
   different therapists**; each card shows all assigned therapists and plans (type
   + weekly frequency), debt status, a "still admitted" badge, origin, and any
   post-scheduling debt alert. No edit controls here.
2. **שיבוץ מטפלים** — the editable workflow (in edit mode): **«רישום מטופל חדש»**,
   a patient list where each patient's details/origin («פרטים») and assignments
   (therapist + plan, via the **«שיבוץ ותוכנית»** modal) are edited, plus the
   scheduled treatments (when + where + type) with did-it-happen marking.
   Filterable by **therapist and by patient**. Scheduling is gated by the **debt
   gate** (see below), per patient; debt alerts surface here.
3. **המטופלים שלי** — a real third tab: the therapist picks their name from the
   **«שם המטפל/ת»** dropdown **inside the tab** (no personal PIN — the picker is
   code-free; the per-patient payment check deters false reporting) and sees only
   their own treatments in four buckets — **טיפולים שנקבעו / טיפולים קרובים /
   טיפולים שבוצעו / טיפולים שנקבעו ולא בוצעו**. In edit mode each is marked
   **happened / didn't happen** — this mark is the **payment trigger** (no mark =
   no pay) and writes back to
   outpatient.

### Did-it-happen → outpatient write-back

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
- **Locations** are a fixed list (id stored, Hebrew shown): רמות השבים (`ramot`),
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

## Access — entry code, edit mode, and tab roles

PIN screen on load (`sessionStorage` for the session). A **shared editor code**
lets Vered/therapists edit; **"המשך כצופה בלבד"** enters read-only.

| Role | PIN | Can do |
| ---- | --- | ------ |
| **עורך** (editor) | `5555` | everything below, once **edit mode** is on |
| **צופה** (viewer) | "המשך כצופה בלבד" | read-only everywhere |

Editing is gated by an explicit **«עריכה» edit-mode toggle** in the header
(`public/access.js`):

- The toggle is **editor-only** and appears **only** on שיבוץ מטפלים and
  המטופלים שלי. Edit controls (registration, assignments, scheduling, marking)
  appear only when edit mode is **on**.
- **דשבורד מטופלים is view-only for everyone** — no toggle, no edit controls.

**Tab roles:**

1. **דשבורד מטופלים** — everyone; a view-only overview of all patients + plans.
2. **שיבוץ מטפלים** — editors (in edit mode): register a new patient, edit a
   patient's details/origin, add/edit/remove assignments (therapist + plan), and
   schedule. A therapist **filter** dropdown (default «כל המטפלים») is *not* an
   identity picker.
3. **המטופלים שלי** — a therapist picks their own name (**no personal PIN** — the
   name-picker «שם המטפל/ת» is code-free), then turns on edit mode to **mark
   did-it-happen** (the payment trigger; *no mark = no pay*).

The work order (Vered assigns, then the therapist schedules) is **procedure, not
software-enforced** — pay-per-treatment self-enforces it. The code is client-side
UX gating (the real enforcement is the server-authoritative debt gate); change it
in `public/app.js` (`EDITOR_PIN`).

## Local development

```bash
npm install
export SHEETS_URL="https://script.google.com/macros/s/.../exec"          # this app's sheet
export OUTPATIENT_SHEETS_URL="https://script.google.com/macros/s/.../exec" # outpatient
export DEBT_STATUS_SECRET="..."
export TREATMENT_PLANS_SECRET="..."
export DASHBOARD_SHEETS_URL="https://script.google.com/macros/s/.../exec"  # dashboard
export OCCUPANCY_SECRET="..."
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
