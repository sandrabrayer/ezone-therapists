# Changelog — iteration 3: restructure from real-use feedback

Restructures the tabs, the intake flow, and fixes several bugs found in use. All
cross-app wiring, the tri-state debt gate, phone rules, and the Ron/Sandra
approval + audit are preserved.

## Access — simplified

Removed the separate assigner PIN (`6060`) and the assigner-vs-therapist role
split. Now **one editor code (`5555`) + viewer**, no per-role gating: any editor
can assign and schedule. The work order (Vered assigns first, therapist schedules
after) is **procedure, not software-enforced** — therapists are paid per
treatment and self-enforce getting properly assigned/approved.

- `app.js`: dropped `ASSIGNER_PIN` / `ROLE_CAPS` / `canSchedule` / `canAssign` /
  `ensureSchedule` / `ensureAssigner`; back to `isEditor()` + `ensureEditor()`.
- Gating collapses to `.edit-only` (removed `.schedule-only` / `.assign-only` and
  the `can-schedule` / `can-assign` body classes).

## Tabs — 2 total

- **דשבורד מטופלים** (renamed from the active-patients tab) — now also shows the
  treatment-plan data that used to live in the separate Plans tab (patient,
  treatment type, sessions/week). The plan view prefers the locally-set main plan
  and falls back to the outpatient roster's `serviceType` / `sessions`.
- **שיבוץ מטפלים** (new) — the workflow tab: assign a therapist + set the main
  treatment plan (editable later), schedule a treatment (when + where + type), and
  the per-treatment did-it-happen status (not a separate tab). Debt block/flag and
  the post-scheduling debt alert surface here.
- The **מטופלים באשפוז** (inpatient) tab and the standalone **Plans** tab are
  gone. (Spec said "3 total"; the content describes two surviving tabs — confirmed
  2 with the requester.)

## Intake — «רישום מטופל חדש»

Renamed from «רישום טיפול חוץ». Vered registers a new patient in one larger form:
identity (name + canonical phone), origin (where they came from / **still
admitted** + which house), main treatment type, weekly frequency, and the assigned
therapist. The same form edits the record later (title switches to «עריכת
מטופל/ת»), so the **main plan is editable** after it is set.

### Patients sheet schema (Apps Script)

`fromInpatient` / `admittedLocation` / `outpatientStartDate` → `mainTreatmentType`,
`frequencyPerWeek`, `origin`, `stillAdmitted`, `admittedHouse`. `savePatient`
writes the new fields. (Pre-production schema change; documented here.)

## Bug fixes

- **Therapist is a dropdown everywhere** — both the «מי המטפל» identity prompt and
  the scheduling form read from the Sheet `Therapists` list (was free text in the
  originally-deployed build).
- **Top edit affordance responds** — with a single editor role there is no
  capability mismatch; the therapist chip and the per-card edit button both fire
  for any editor.
- **Main treatment plan editable after Vered sets it** — re-opening the intake
  form on an existing patient edits `mainTreatmentType` / `frequencyPerWeek`.

## Lists

- Therapists seed += אלה, שירן, ד"ר שפרינץ, דנה, רמי, ד"ר נטליה, מרים, יסמין, תמר,
  שחר, יפעת (דליה stays single; `activeNames` also de-dupes by name).
- TreatmentTypes seed += פסיכודינמי, פסיכותרפי ממוקד טראומה, עיסוי טיפולי, מעקב
  פסיכיאטרי, טיפול ממוקד התמכרויות, טיפול אינטגרטיבי.
- `_ensureSeededList` now appends MISSING seed names to an existing list (by name)
  so these additions reach live sheets; retired (active=false) names stay present
  and are never re-added.

## Display relabel

`Scheduling.displayServiceType` maps **מרכז יום → ליווי יומי בקהילה** for display
only (stored value untouched). Tested in `test/scheduling.test.js`. **Flagged:**
the outpatient SOURCE data should eventually adopt the new term too — see
`docs/DEPENDENCIES.md`.

## Theme

Lightened the navy base from near-black (`#08111c`) to a comfortable slate-blue
(`#16263d`) — the iteration-2 navy was too dark to use comfortably. The cyan
accent (distinct from the indigo dashboard app) and component structure are
unchanged.

## Tests

`npm test` — 55 passing. Added `displayServiceType` coverage; all prior
scheduling / debt-alert / gate / phone / approval / forwarding tests still pass.
