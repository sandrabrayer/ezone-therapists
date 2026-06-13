# Changelog — iteration 7: name-pick roles + scheduling + post-treatment report

Rebuilds the access model around **name-pick roles** (no password, no edit mode)
and adds the core treatment flow: therapist scheduling with time-of-day, and the
post-treatment report that drives payment, debt-gated at report time.

> **Blocker (unchanged):** the debt-block only enforces end-to-end once
> **ezone-outpatient PR #14** (`getDebtStatus`) is merged + deployed and the
> therapists Apps Script Script Properties (`OUTPATIENT_SHEETS_URL`,
> `DEBT_STATUS_SECRET`) are set. Until then reports are recorded and **flagged**
> (never silently "clear"). See `docs/DEPENDENCIES.md` (dep #1).

## Access — name-pick roles, no password, no edit toggle

- Entry is an **identity screen**: pick **«ורד (משרד)»** or a **therapist by name**.
  Stored as `ez_identity`. The PIN screen and the «עריכה» edit-mode toggle are
  **removed**.
- **Vered** sees **דשבורד** (all patients, view) + **שיבוץ** (register patients,
  edit details/origin, assign therapist + plan). Registration/assignment are
  **always visible** — not behind any mode.
- **Therapist** sees **only «המטופלים שלי»**, scoped to their **own assigned
  patients**: schedule + report. Cannot register/assign.
- Rules are pure predicates in `public/access.js` (`tabsForRole`, `canRegister`,
  `canSchedule`, …), unit-tested.
- Identity is **self-asserted** (no password); the controls are the debt gate +
  the Ron/Sandra approval audit.

## Scheduling — therapist action, with time-of-day

- The `Schedule` sheet gains **`time`** (and `reason`, below). The schedule modal
  has a **«שעה»** field; treatments display as date + time.
- Scheduling lives in **«המטופלים שלי»**: the tab greets the therapist, lists
  their assigned patients each with **«+ קביעת טיפול»**, and the modal **locks the
  therapist to their own identity**. Vered's שיבוץ no longer schedules.
- *(Phased — Decision 1: recurring weekly Slots come next; this ships dated + time
  first.)*

## Post-treatment report — drives payment, debt-gated at report time

- Marking opens a **report modal**: **«לא התקיים»** requires a **reason** (shown on
  the not-done bucket); **«התקיים»** runs a live debt check — clear → confirm;
  **owes → inline Ron/Sandra approval required** (auto-stamped: patient, therapist,
  approver, note, timestamp); can't-determine → recorded but **flagged**.
- **Server-authoritative** re-check in `_markAttendance`: a confirmed debtor's
  «happened» report is **blocked** (`debt_block`) unless an allowlisted approval is
  attached (written to the `Approvals` audit). Never silently "clear" — *Decision 4
  (both points, authoritative at report)*.
- The therapist's four buckets — **טיפולים שנקבעו / קרובים / שבוצעו / שנקבעו ולא
  בוצעו** — serve as the **weekly / scheduled-but-not-done** views.

## Tests

`npm test` — 73 passing. `access.test.js` rewritten for the role model; time-of-day
covered in `scheduling.test.js`. Debt-block / phone-matching / approval-override
remain covered by `debt-gate` / `treatment-guard` / `phone` / `approval` tests.

## Data-model note

`Schedule` appended `time`, `reason`. A fresh Apps Script deploy creates the
columns; **redeploy required** for the new report fields + report-time gate.
