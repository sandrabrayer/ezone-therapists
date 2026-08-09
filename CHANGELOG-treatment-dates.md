# CHANGELOG — outpatient treatment start/end dates on the patient card

## Goal

For each outpatient shown in the therapists app, display the **treatment start
date** and **treatment end date** so the clinical coordinator can follow up on
treatment periods.

## What shipped (frontend)

- **`public/treatmentdates.js`** (new) — a pure, framework-free display formatter
  (`TreatmentDates.format`). Turns the outpatient date value (normally
  `yyyy-MM-dd`, sometimes an ISO `…T…` string, often blank) into `DD/MM/YYYY`.
  Missing OR malformed input renders the em-dash placeholder «—» — never `''`,
  `undefined`, `null`, or raw garbage. Out-of-range month/day is treated as
  malformed.
- **`public/roster.js`** — `build()` now carries the plan source's `startDate` /
  `exitDate` through the phone-keyed merge and exposes them on the roster item as
  `treatmentStartDate` / `treatmentEndDate`. The dates come ONLY from the
  outpatient plan source; debt-only / local-only patients get empty strings.
- **`public/app.js`** — the «תוכנית טיפול» plan panel now renders a treatment
  period block: «תחילת טיפול» and «סיום טיפול», each via `TreatmentDates.format`.
- **`public/style.css`** — `.cc-dates` / `.cc-date-line` set the period rows off
  from the plan lines with a divider.
- **`public/index.html`** — loads `treatmentdates.js` before `app.js`.

## Tests (all HTTP-free — pure logic)

- **`test/treatmentdates.test.js`** (new) — valid `yyyy-MM-dd`, ISO datetime,
  unpadded, whitespace, MISSING (`''`, whitespace, `null`, `undefined`),
  MALFORMED (wrong separator/order/shape, non-numeric), and out-of-range
  month/day. Asserts the literals `''` / `'undefined'` / `'null'` never leak.
- **`test/roster.test.js`** — passthrough of `startDate` / `exitDate` →
  `treatmentStartDate` / `treatmentEndDate`, active-patient (no `exitDate`) →
  empty end date, dates-absent default, no-plan patients get empty dates, and
  merge keeps plan dates when local/debt sources also match.

No live backends are contacted; there are no HTTP calls in this logic to mock,
and no secrets appear in any test.

## Backend dependency — outpatient Apps Script (NOT done here)

The dates are **not** in the data the therapists app currently receives. The
outpatient `getTreatmentPlans` projection returns only `sourceApp, clientId,
name, phone, serviceType, sessions, status`. The Clients sheet DOES have the
columns and `_getTreatmentPlans` already reads them — they are just not
projected. Required change on `sandrabrayer/ezone-outpatient`
(branch `claude/youthful-volta-laarnk`), `apps-script/Code.gs`, in
`_getTreatmentPlans()`'s `out.push({…})`:

```javascript
startDate: cl.startDate || '',
exitDate:  cl.exitDate  || '',
```

No sheet schema change, no new secret, no Node/Railway change. Redeploy the
outpatient Web App (new version of the existing deployment — same URL) after the
edit. See `docs/DEPENDENCIES.md`.

## Safe-to-deploy-first

The frontend is defensive: until the outpatient projection includes the two
fields, `treatmentStartDate` / `treatmentEndDate` arrive empty and the card
shows «—» for both. Shipping this before the Apps Script change is harmless.
