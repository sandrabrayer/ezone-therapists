[CHANGELOG-dashboard-card-cleanup.md](https://github.com/user-attachments/files/29460800/CHANGELOG-dashboard-card-cleanup.md)
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
