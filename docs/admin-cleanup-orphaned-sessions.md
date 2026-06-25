# Admin cleanup — orphaned scheduled sessions (one-time)

**Function:** `cleanupOrphanedScheduledSessions()` in `apps-script/Code.gs`
**Type:** one-time admin run from the Apps Script editor (NOT wired into
`doPost`/`doGet` — there is no web/HTTP trigger for a destructive operation).

## What it does

Test patients that were deleted (their **Patients** rows removed by
`_removePatient`) left behind **Schedule** rows that still render under
«טיפולים שנקבעו — קביעה וסימון ביצוע» and «טיפולים שנקבעו» in "המטופלים שלי".
Those rows are meaningless. This function removes them.

The list is backed by the **Schedule** sheet (`SCHEDULE_HEADERS`); each row carries
`patientPhone`, `patientName`, `therapist`, `scheduledDate`. A row is **orphaned**
when its `patientPhone` matches **no** patient in the **Patients** sheet, using the
same tolerant phone match as the rest of the app — `_matchPhone` =
`_normalizePhoneForMatch(_recoverStoredPhone(...))`, which recovers a Sheets-dropped
leading zero before normalizing.

### Per-row decision (fail-closed)

| Patients matching the row's phone | Action |
| --------------------------------- | ------ |
| exactly **1** | **KEEP** — a live patient; never deleted |
| **0** (valid phone) | **DELETE** — orphaned |
| **> 1** (duplicate patient rows) | **KEEP + FLAG** in the log (ambiguous → never fail open) |
| empty / unparseable phone | **KEEP + FLAG** (cannot classify → never delete) |

It deletes by **orphaned-patient match only** — never by date or by "scheduled"
status — so a **live** patient's real future sessions are never touched (a 2099
booking for a live patient is kept). Each deleted row is logged
(`patient`, `therapist`, `date`, `phone`) **before** deletion; flagged rows are
logged too. Rows are deleted **bottom-up** so row numbers stay valid. The function
returns the **count of deleted rows**. It is **idempotent** — a second run finds
nothing.

## Tests

`test/orphan-cleanup.test.js` — a faithful pure mirror of the decision (orphan →
delete, live → keep, multi-match → keep+flag, zero-dropped phone still matches a
live patient, empty → keep+flag, live future session kept) plus a Code.gs
mirror-guard asserting the real function shares the tolerant match, the
never-fail-open branches, log-before-delete, and bottom-up deletion. Run:
`npm test`.

## How to run (after merge)

This is an **Apps Script** change — the merged `Code.gs` must be copied into the
Apps Script editor:

1. Open the **E-ZONE Therapists** Apps Script project.
2. Open `Code.gs`, **select all → paste** the merged file → **save**.
3. **Deploy → Manage deployments → edit the existing therapists deployment → New
   version → Deploy.** Keep the **same `/exec` URL** (edit the existing deployment;
   do not create a new one).
4. In the editor, select **`cleanupOrphanedScheduledSessions`** from the function
   dropdown and **Run**. Authorize if prompted.
5. Open **Executions / View → Logs** and confirm the summary line:
   `deleted N orphaned row(s); kept M flagged (ambiguous/empty) row(s).`
   Each deleted row is listed as `DELETE (orphaned): patient=… therapist=… date=…
   phone=…`. Verify the deleted set is only the test patients.

> Deploying a new version is needed for the live `/exec` to serve the updated
> `Code.gs`, but the cleanup itself runs in the **editor** against the bound
> Spreadsheet — it does not require an HTTP call.
