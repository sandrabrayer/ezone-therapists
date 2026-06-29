[CHANGELOG-leads-and-notifications.md](https://github.com/user-attachments/files/29476353/CHANGELOG-leads-and-notifications.md)
# Sub-step 3d: new-leads grouping + new-assignment notifications

## Why
- The שיבוץ tab should surface NEW LEADS (approved plan, zero assignments) first
  so Yarden assigns them, with already-assigned patients below.
- When a patient is assigned, everyone should see a notification until a therapist
  marks «ראיתי» (dismiss). Dismiss is global.

## What changed
- **apps-script/Code.gs**
  - New `Notifications` sheet (`NOTIFICATIONS_HEADERS`), read into `getData`.
  - `_saveAssignment`: on CREATE of an assignment that has a therapist, appends a
    notification row (best-effort; never fails the save).
  - New `_dismissNotification` + `dismissNotification` action: flips `dismissed`
    to true with who/when. Idempotent.
- **public/app.js**
  - Loads `state.notifications`; `renderNotifications()` shows a banner in the
    therapists tab listing live (undismissed) new-assignment alerts, each with a
    «ראיתי» button; dismiss calls the API and hides globally on next load.
  - `renderAssign()` now splits into two sections: «לידים חדשים — טרם שובצו» on
    top and «מטופלים משובצים» below.
  - Added `apiDismissNotification`.
- **public/index.html**: `#notifBanner` element in the therapists tab.
- **public/style.css**: notification banner + assign section-title styles.

## Tests
- Backend notification logic lives in Apps Script (not unit-testable here);
  client filtering is a simple dismissed!=true filter. Full suite green except
  the 2 pre-existing unrelated failures.

## Deploy note (IMPORTANT)
- Code.gs changed → paste merged Code.gs into the THERAPISTS Apps Script editor
  and deploy a NEW VERSION to the EXISTING deployment (keep /exec stable). The
  `Notifications` sheet is auto-created on first read.

## Security
- No new secret/endpoint exposure. `dismissNotification` only flips a flag; no
  patient/billing data is exposed.
