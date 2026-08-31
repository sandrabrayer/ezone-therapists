# Renewal alerts (חידוש חבילה) — 7 days before package end

Yarden now sees which outpatients reach their package end (`renewalDate`)
within 7 days, so she can talk to them about continuing. Same 7-day rule as
Vered's `due_soon` in the outpatient app — both apps flag the same patient on
the same day. When Vered renews, outpatient moves `nextBillingDate` forward and
the alert here clears on the next load. **Date only** — no payment state is
shown or fetched, no new endpoint, no new secret. SW cache **v18**.

Prerequisite: the outpatient `getTreatmentPlans` projection returning
`renewalDate` (Handoff 3). Until that deploy is live the field is simply blank
— the card shows «—», nothing alerts, nothing breaks.

## `public/renewal.js` (new)

Pure UMD module (browser global `Renewal`, unit-tested under `node --test`):

- `renewalStatus(renewalDate, todayIso)` → `{ status, daysLeft }` —
  `unknown` (blank/malformed), `overdue` (daysLeft < 0), `due_soon`
  (0 ≤ daysLeft ≤ 7), `ok` (> 7).
- `daysBetween` is a **verbatim mirror of outpatient `app.js` `daysBetween`**
  (`Math.round` of ms/86400000 on ISO dates) so the two apps agree on the day
  count — parity is guard-tested against a copy of the outpatient formula.
- `renewalAlerts(rosterItems, todayIso)` — the due/overdue items, sorted
  `daysLeft` ascending (overdue first), **excluding discharged patients**
  (`treatmentEndDate` set).
- HTML builders (pure, tested): the card's third date line, the days-left chip
  (amber `בעוד X ימים` / `היום` / `מחר`; red `באיחור`), the alerts-section list
  with the `אין חידושים השבוע` empty state.

## `public/roster.js`

The roster item now carries `renewalDate: base.renewalDate || ''` from the
plans source, next to `treatmentStartDate`/`treatmentEndDate` (same
first-non-empty-wins carry). Missing field → `''` — backward compatible.

## UI (`public/app.js`, `public/index.html`, `public/style.css`)

- **Dashboard card** (`cc-plan` panel): a third date line **חידוש חבילה** under
  תחילת/סיום טיפול, formatted `DD/MM/YYYY` («—» when blank); an amber days-left
  chip when due within 7 days, a red `באיחור` chip when overdue. No chip
  otherwise.
- **התראות טיפול tab**: a new section **חידוש חבילה — השבוע הקרוב** ABOVE the
  stop alerts (kept visually separate), listing name · phone · assigned
  therapists · renewal date · days-left chip; empty state `אין חידושים השבוע`.
- **Badge** `#stopAlertsBadge`: now ONE number = unread stop alerts + renewal
  alerts, visible from any tab. Any unread stop alert keeps the badge RED
  (existing semantics); a renewal-only count shows AMBER (`.tab-badge-renew`).
- Reuses the existing amber/red tokens and the stylesheet's `renewal-row` /
  `renewals-warn` classes; minimal CSS additions, no new fonts. RTL, dark
  fuchsia theme untouched.

## `public/sw.js`

Cache bumped to `v18` (v17 was taken by the staffing roster sync); `./renewal.js` added to the SHELL precache list.

## `public/guide.html`

Short התראות טיפול paragraph describing the renewal section and the chips.

## Tests (`test/renewal.test.js`, 19 new — suite 462 green)

Status boundaries (−1/0/7/8/blank/garbage), outpatient `daysBetween` parity on
20 random date pairs, sorting, discharged exclusion, roster carry +
missing-field backward compatibility, chip/card/list rendering incl. escaping
and empty state, and source guards for the app wiring + SW version/precache.
