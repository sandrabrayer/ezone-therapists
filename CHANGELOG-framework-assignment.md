[CHANGELOG-framework-assignment.md](https://github.com/user-attachments/files/29490876/CHANGELOG-framework-assignment.md)
# Framework type: assignment modal asks for LOCATION, not a therapist

## Why
The שיבוץ modal still showed a therapist dropdown for ליווי יומי בקהילה. That type
is a framework (מסגרת) with a place, not a therapist-delivered session.

## What changed
- **public/app.js**
  - `assignmentRowHtml`: for a framework type, render a LOCATION selector + a
    «מסגרת — ללא מטפל/ת» tag instead of the therapist dropdown (current location
    read from the stored slot). Row carries `data-framework`.
  - `saveAssignments`: framework rows save with therapist='' and the chosen
    location stored as a single slot's location; the row is kept even with no
    location so the patient isn't mis-flagged as needing assignment. Non-framework
    rows behave exactly as before.
- **public/style.css**: styles for the framework tag + location select.

## Notes
- Backend `_saveAssignment` already accepts an empty therapist, so no Apps Script
  change is needed. An empty-therapist assignment does not raise a new-assignment
  notification (the notify guard requires a therapist).

## Tests
- Full suite green except the 2 pre-existing unrelated failures.

## Deploy note
- Frontend only — Railway auto-deploy.
