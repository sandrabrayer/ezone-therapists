# E-ZONE Therapists

Hebrew/RTL dark-theme app where **every therapist logs the patients they
treat**. Two purposes: (1) therapists are paid from these logs, (2) the office
verifies patients receive treatment. All therapists have access.

Same stack as the E-ZONE siblings (`ezone-outpatient`, `ezone-managers`,
`ezone-staffing`, `E-Zone-Dashboard`): Node.js + Express serving a vanilla
HTML/JS frontend, Google Sheets via an Apps Script Web App (`doGet`/`doPost`),
deployed on Railway.

## Tabs

1. **טיפולי חוץ** — log outpatient treatment sessions. Gated by the cross-app
   outpatient **debt gate** (see below).
2. **מטופלים באשפוז** — log treatment for admitted/residential patients.
3. **מטופלי חוץ — תוכנית טיפול** — view each outpatient's treatment plan.

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

This app has its **own** Google Sheet (treatment logs + approvals). It also
reads three sibling projections through server-side proxy routes — the browser
only ever calls relative `/api/...` URLs and never sees a secret:

| route | upstream | env vars | purpose |
| ----- | -------- | -------- | ------- |
| `GET /api/sheets` | this app's sheet | `SHEETS_URL` | treatment logs + approvals |
| `GET /api/debt-status` | outpatient | `OUTPATIENT_SHEETS_URL`, `DEBT_STATUS_SECRET` | debt gate |
| `GET /api/treatment-plans` | outpatient | `OUTPATIENT_SHEETS_URL`, `TREATMENT_PLANS_SECRET` | treatment-plan tab |
| `GET /api/admitted` | dashboard | `DASHBOARD_SHEETS_URL`, `OCCUPANCY_SECRET` | inpatient roster |

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

- PIN screen on load. Editor PIN grants full logging access; "המשך כצופה בלבד"
  is read-only. Choice stored in `sessionStorage` for the session only.

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
