# Changelog — iteration 16: true weekly recurring pattern

A therapist sets a **weekly recurring pattern once per assignment**; the coming
week's sessions are generated automatically (rolling), reported exactly like any
session, and keep coming until the patient is stopped/discharged. No end date, no
pre-generated rows in the sheet.

## Model

- **Pattern = N slots on the assignment** (N = `frequencyPerWeek`), each slot
  `{ weekday: 0–6 (0=Sunday), time: "HH:mm", location: "<id>" }`. E.g. CBT 3×/week
  = ראשון 10:00 רעננה אשר · שלישי 10:00 · חמישי 10:00.
- Stored as a single appended `slots` JSON column on **`Assignments`** (no new
  sheet). Empty `slots` = no recurrence (full back-compat for existing rows).

## Generation — rolling, virtual, idempotent

- `Recurring.generateOccurrences` (pure, in `public/recurring.js`) materializes the
  **coming week's** occurrences for the picked therapist's active assignments,
  skipping stopped/discharged patients. Each occurrence is **virtual** — it lives
  only in the client's weekly «קרובים» view and is **never pre-written** to the
  sheet.
- Every occurrence has a **deterministic id** `occ_<assignmentId>_<YYYYMMDD>_<HHMM>`
  that doubles as the Schedule row id and the write-back `treatmentId`. Re-viewing a
  week **never duplicates**: an occurrence whose id already exists as a real
  Schedule row is dropped (the real row shows instead).

## Reporting — unchanged, lazy materialization

- Reporting an occurrence (התקיים / לא התקיים) works exactly like today, with the
  same debt gate, phone key, and write-back. On report, the backend
  **materializes** the booking row first — `_markAttendance` accepts an
  `occurrence` payload and creates the row **create-only, idempotent by id**
  (`_materializeOccurrenceRow`) — then runs the authoritative report-time debt gate.
  Materialization itself is **ungated** (the report-time gate is the money gate, as
  agreed). Re-reporting the same occurrence reuses the same id → no duplicate
  booking or payment.
- A one-off session is still booked exactly as before.

## Stop / discharge interaction

- `generateOccurrences` skips stopped patients (discharged in outpatient OR locally
  flagged) → **generation halts** immediately. The existing stop action also deletes
  future unreported bookings, removing any already-materialized future occurrences.

## Editing / removing a pattern

- The per-patient assignments modal gains an inline pattern editor: choosing a
  frequency N reveals N slot rows (weekday + time + location). `saveAssignments`
  validates **all-or-nothing** (`Recurring.validateSlots`: either no slots, or
  exactly N complete slots) and stores the JSON. Editing slots = re-save (next view
  regenerates); removing = clear slots or remove/retire the assignment. Because
  future occurrences are virtual, pattern edits never leave stale sheet rows — only
  reported sessions persist, as history.

## Tests

`test/recurring.test.js` (11): `validateSlots` (N=frequency, valid
weekday/time/location, Sunday=0 not "missing"); `occurrenceId` determinism;
generation (N slots → N dated rows on the right weekdays, therapist/active filters);
idempotency (existing-id dropped, stable ids on re-run); the report lifecycle
(reported occurrence keeps its id, not re-generated); stop/discharge halts
generation. `npm test` — all passing (122 with deps installed).

## Deploy

`Code.gs` changed (`Assignments.slots` column, `_saveAssignment` carry-through,
`_markAttendance` occurrence materialization) → **Apps Script redeploy required**
(Manage deployments → Edit → New version). `recurring.js` + the pattern editor are
frontend-only.
