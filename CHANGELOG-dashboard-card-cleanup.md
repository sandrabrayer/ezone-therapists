[CHANGELOG-dashboard-card-cleanup (3).md](https://github.com/user-attachments/files/29463798/CHANGELOG-dashboard-card-cleanup.3.md)
# Dashboard card cleanup — remove "responsible therapist", clean plan summary

## Why
On the patients dashboard (tab 1), the card showed a "מטפל/ת אחראי/ת" line and
dumped the raw treatment-plan `sessions` JSON blob (e.g. `{"פרטני":1,"ליווי יומי
בקהילה":3}`). The dashboard is a view of patients flowing in from ezone-outpatient
after Vered closes their paid plan; there is no "responsible therapist" concept at
this stage, and the plan must read clearly.

## What changed
- **public/roster.js**
  - Each built patient now carries `planTypes`: the parsed per-type breakdown of
    the approved plan's `sessions` blob (via `Plan.typesFromSessions`), as
    `[{ treatmentType, frequencyPerWeek }]`.
  - `Plan` wired into the factory: required directly under Node/tests; resolved
    lazily from the browser global at call time (plan.js loads after roster.js).
- **public/app.js**
  - `assignmentSummary()` renders an unassigned patient's plan from `planTypes`
    ("פרטני · 1× בשבוע | ליווי יומי בקהילה · 3× בשבוע") instead of the raw blob.
  - Removed the "מטפל/ת אחראי/ת" line from the dashboard patient card. The card is
    now: name, phone, treatment plan, debt chip.

## Tests
- **test/roster.test.js**: added two cases — a multi-type `sessions` blob parses
  to a per-type `planTypes` array; an empty/unparseable plan yields `[]`.
- Full suite: 246 pass. The 2 pre-existing failures (gate, sheets-secret-
  forwarding) are unrelated and fail identically on the clean baseline.

## Security
- Display-only change. No new data exposed; no endpoint/secret touched.

## Follow-up: card redesign to match the outpatient look
The dashboard card was visually cramped (a rigid 6-column `billing-row` grid).
Redesigned to mirror the ezone-outpatient client card:
- **public/app.js**: new `planBoxHtml(p)` renders a «תוכנית טיפול» box with ONE
  stacked line per treatment type (type label + frequency). `freqUnit()` shows
  `/חודש` for מעקב פסיכיאטרי and `/שבוע` for everything else — matching outpatient.
  `patientCard()` rebuilt: header (name + phone + debt chip) above the plan box.
  Uses `assignments` when present, else the approved-plan `planTypes`.
- **public/style.css**: new `.patient-card` / `.plan-box` / `.plan-line` styles in
  the app's fuchsia/pink theme (replaces the cramped grid for this card only).
- `assignmentSummary()` retained — still used by the שיבוץ (workflow) tab rows.

## Bugfix: plan box always showed "לא נקבעה תוכנית"
The lazy Plan resolver in public/roster.js referenced `root`, which is the OUTER
IIFE wrapper's parameter and is NOT in scope inside the factory closure. In the
browser it therefore always resolved to null, so `planTypes` came back empty and
every card rendered "לא נקבעה תוכנית" — even with a valid approved plan. (Node
tests passed because they inject Plan via require, never exercising this path.)
- **public/roster.js**: `planApi()` now reaches the global via
  `globalThis`/`self`/`window` directly instead of the out-of-scope `root`.
- **test/roster.test.js**: added a browser-path regression test that loads
  roster.js with Plan as a global (not injected) and asserts planTypes is
  populated. Verified it FAILS on the old code and passes on the fix.
