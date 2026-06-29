[CHANGELOG-dashboard-schedule.md](https://github.com/user-attachments/files/29474558/CHANGELOG-dashboard-schedule.md)
# Sub-step 3c: dashboard "bible" cards show the fixed weekly schedule

## Why
The general dashboard is the single source of truth for every active patient. Each
card now shows, per treatment type, the fixed weekly schedule (day · time ·
location · room) under the type/therapist line — so a patient's full schedule is
visible in one place.

## What changed
- **public/app.js**
  - `planPanelHtml`: per treatment type now also renders the fixed weekly slots
    from the assignment (was therapist-only before).
  - New `slotsLineHtml(slots)`: parses the assignment slots and renders one chip
    per session — «יום · שעה · מיקום · חדר» (weekday via WEEKDAY_LABELS, location
    via locationLabel, room appended). Empty when no schedule is set yet.
- **public/style.css**: `.cc-slots` / `.cc-slot` chip styles under each plan line.

## Tests
- Covered by existing `Recurring.parseSlots` tests (slot parsing) and the card
  render path; full suite green except the 2 pre-existing unrelated failures.

## Deploy note
- Frontend only — Railway auto-deploy. No Apps Script redeploy.
