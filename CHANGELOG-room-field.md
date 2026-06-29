[CHANGELOG-room-field.md](https://github.com/user-attachments/files/29470527/CHANGELOG-room-field.md)
# Sub-step 3a: add treatment room (חדר) field

## Why
Every session needs a treatment room alongside its location. Yarden fills it; it
is visible to everyone. Foundation for the dashboard "bible" card and the
therapist scheduling that follow.

## What changed
- **apps-script/Code.gs**
  - `SCHEDULE_HEADERS`: appended a `room` column (append-only — existing columns
    and rows are untouched, keeping the sheet stable).
  - `_updateBooking`: writes `room` when provided.
  - `_materializeOccurrenceRow`: carries `room` from the recurring slot.
  - (`_saveScheduleRow` needs no change — `_upsertByKey` writes any header-matching
    key, so `room` flows through automatically.)
- **public/recurring.js**: `validateSlots` now normalizes/trims an optional `room`
  per slot; `generateOccurrences` carries `room` into each occurrence.
- **public/scheduling.js**: session row payload includes `room`.
- **public/app.js**: schedule-row read, new-booking submit, single-booking edit
  (open + save), and `updateBooking` API all thread `room`. Slot editor rows get a
  free-text `חדר` input (`readSlotRows` reads it).
- **public/index.html**: room input added to the schedule modal and the
  booking-edit modal.

## Tests
- **test/recurring.test.js**: updated the slot-shape assertion to include `room`;
  added a case proving room is preserved/trimmed and is optional (empty when
  omitted). Full suite green except the 2 pre-existing unrelated failures.

## Deploy note (IMPORTANT)
- Code.gs changed → after merging, paste the merged Code.gs into the THERAPISTS
  Apps Script editor and deploy a NEW VERSION to the EXISTING deployment (keep the
  /exec URL stable). The new `room` column is created automatically on first read
  via `_ensureSheet`. Frontend deploys via Railway as usual.

## Security
- No new endpoint or secret. `room` is non-sensitive free text.
