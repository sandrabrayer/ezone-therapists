# Changelog — iteration 2: scheduling redesign

Redesigns the app from **treatment logging** into a **scheduling** app:
therapists self-schedule follow-up treatments for active outpatients (treatment
type + location + date) and later mark whether each happened. The cross-app
debt gate, phone rules, approval allowlist + audit, server-authoritative
re-check, and never-fail-open behavior are all **kept** — this changes the
UI/flow and the data model, not the security architecture.

## Data model (new)

**One row PER PATIENT PER SESSION.** A single-patient treatment is a session
with one patient row; a group (קבוצה) session is one therapist / date / location
shared by several patient rows via a common `sessionId`. Every patient row keeps
its **own** debt-gate result and its **own** attendance flag, so the debt gate
and did-it-happen both run per patient.

New/changed Apps Script sheets (`apps-script/Code.gs`):
- `Schedule` — replaces `Treatments`. Columns: `id, sessionId, therapist,
  treatmentType, location, scheduledDate, patientName, patientPhone, attendance,
  attendanceMarkedAt, gateStatus, gateReason, amountOwed, approver*, created`.
- `Patients` — per-patient record **extras** keyed by canonical phone:
  `assignedTherapist` (set by Vered at intake, reassignable), `fromInpatient`
  flag + `admittedLocation` + `outpatientStartDate`. The active-outpatient
  roster itself still comes from the outpatient sibling; this sheet only layers
  local extras on top (left-joined by phone).
- `Therapists` / `TreatmentTypes` — **admin-editable, active-flagged** lists,
  seeded on first install. Retiring a row removes it from the dropdown going
  forward and **never** rewrites a `Schedule` row that already references it by
  string. `TreatmentTypes` carries an `isGroup` flag (robust to renames).

New POST actions: `saveSession` (per-patient server-authoritative gate; one live
debt snapshot reused across a group; per-row pass/fail), `markAttendance`,
`savePatient`, `removeSchedule`. `server.js` default POST action → `saveSession`.

## UI

- Tabs: **מטופלים פעילים** (active-patients dashboard) / **לוח טיפולים**
  (schedule) / **תוכנית טיפול**. The inpatient tab is removed (handled in another
  app); came-from-inpatient is now a flag on the patient record.
- Dashboard lists active outpatients with the assigned therapist, debt chip,
  came-from-inpatient badge, and any post-scheduling debt alert. Editors edit the
  patient record (Vered's assignment + inpatient details) and schedule from here.
- Schedule modal: therapist/type/location/date; group sessions add multiple
  patients with a per-patient inline gate + Ron/Sandra approval. Attendance is
  marked per patient (occurred / didn't occur) on the schedule tab.
- **Accent moved indigo → cyan/sky** (+ cooler navy base) so this app is
  distinct from the indigo dashboard app at a glance. Dark RTL theme and
  component structure unchanged; only the accent family moved.

## Post-scheduling debt alert (new)

`public/debt-alert.js` re-runs the **live** debt gate against upcoming, unmarked
scheduled rows on every load/refresh and surfaces patients who fell into debt
**after** booking — on the dashboard banner, the patient card, and the affected
schedule row. Never false-alarms when the roster is unavailable; never re-alerts
rows already `approved`/`flagged`.

## New pure modules + tests (`npm test`)

- `public/scheduling.js` — `activeNames` (Sheet-driven dropdowns; retiring is
  dropdown-only), `isGroupType`, `validateSession`, `buildSessionRows`
  (one-row-per-patient), `evaluateGroup` (per-patient gate across a group).
- `public/debt-alert.js` — `evaluateAlerts` / `isUpcomingUnmarked`.
- `test/scheduling.test.js`, `test/debt-alert.test.js` — cover the Sheet-list
  add/retire behavior, group multi-patient per-patient debt handling, attendance
  state, and the post-scheduling alert. All prior tests still pass.

## Access roles (follow-up)

Added a **separate assigner capability** so Vered's intake role is distinct from
the therapist/editor role — capabilities are kept apart, not nested:

- **מטפל/ת** (editor, PIN `5555`) — schedule treatments + mark attendance.
- **משבצת** (assigner / Vered, PIN `6060`) — assign patients to therapists at
  intake and edit patient records (came-from-inpatient details). Does **not**
  schedule.
- **צופה** (viewer) — read-only.

Gating is capability-based (`can-schedule` / `can-assign` body classes; the
`.schedule-only` / `.assign-only` controls); the assigner has no therapist
identity prompt. PINs are client-side UX gating (`EDITOR_PIN` / `ASSIGNER_PIN`
in `public/app.js`) — the real enforcement remains the server-authoritative gate.

## Origin houses vs scheduling locations (follow-up)

The came-from-inpatient "where admitted" field now uses its **own** origin-house
list (`רעננה אשר`, `רמות השבים`, `קיסריה עפרוני`, `קיסריה ריהאב`, `חיצוני`),
separate from the scheduling LOCATIONS — an admission house need not match any
scheduling location and vice versa.

## Findings flagged during the read-only investigation

- Treatment types changed (`פרטני` → `פרטני כללי`; `מעקב פסיכיאטרי` dropped).
  Because the list is now Sheet-driven, these are just seed values an admin can
  edit later.
- Locations are a **new independent list** distinct from the old `house` labels
  (e.g. `אשר`/`רעננה` now separate; `קיסריה ערפוני` ≠ old `efroni`). Location is
  the therapist's scheduling choice, independent of the patient's roster house;
  `רעננה` has no roster-house equivalent (expected).
- `GET /api/admitted` (dashboard admitted roster) loses its UI consumer when the
  inpatient tab is removed. Per "keep all cross-app wiring," the route, secret,
  and env wiring are **kept unchanged** — simply not surfaced in the new UI.
