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
dashboard app); iteration-2 redesign notes are in
[`CHANGELOG-scheduling-redesign.md`](CHANGELOG-scheduling-redesign.md).

## Tabs

1. **מטופלים פעילים** — active-outpatients dashboard. Each patient shows the
   assigned therapist (set by Vered at intake), debt status, a "came from
   inpatient" badge, and any post-scheduling debt alert. Editors edit the
   patient record and schedule treatments from here.
2. **לוח טיפולים** — scheduled treatments, grouped by session, with per-patient
   attendance marking (occurred / didn't occur). Scheduling is gated by the
   **debt gate** (see below), per patient.
3. **תוכנית טיפול** — view each outpatient's treatment plan (read-only).

The old **מטופלים באשפוז** (inpatient) tab is removed — inpatient treatment is
handled in another app. Whether a patient *came from* inpatient is now a flag on
the patient record (with admitted location + outpatient start date).

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
session), `Approvals`, `Patients` (per-patient extras keyed by phone), and the
editable `Therapists` / `TreatmentTypes` lists. It also reads three sibling
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

## Access

PIN screen on load; the choice is stored in `sessionStorage` for the session
only. Three capability levels, kept **separate**:

| Role | PIN | Can do |
| ---- | --- | ------ |
| **מטפל/ת** (therapist / editor) | `5555` | schedule treatments, mark attendance |
| **משבצת** (assigner — Vered) | `6060` | assign patients to therapists at intake + edit patient records (came-from-inpatient details) |
| **צופה** (viewer) | "המשך כצופה בלבד" | read-only |

The assigner is **not** an editor: Vered assigns patients to therapists but does
not schedule, and therapists schedule for their assigned patients but cannot
reassign. Both PINs are client-side UX gating (the real enforcement is the
server-authoritative debt gate); change them in `public/app.js`
(`EDITOR_PIN` / `ASSIGNER_PIN`).

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
