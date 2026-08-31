# Staffing roster sync — the Therapists roster's source of truth moves to ezone-staffing

Two PRs. **PR A (this entry): sync engine + read-only preview — no writes to the
Therapists sheet.** PR B (appended below when it ships) flips the write path on
after the live plan has been reviewed.

## Why

The Therapists sheet is admin-edited by hand while the same people are also
managed in the ezone-staffing app (role מטפל/ת). The two lists drift, and every
downstream consumer — Assignments, Schedule, the outpatient `TherapistRates`
sheet — matches therapist names as **exact strings**, so drift silently breaks
pay/credit matching. The staffing app becomes the single source of truth; this
repo syncs its Therapists sheet from the staffing feed.

## PR A — sync engine + preview only

### `public/roster-sync.js` (new)

Pure, testable planner (UMD, `node --test`; not loaded by the browser — same
role as `therapist-migration.js`):

- `planRosterSync(sheetRows, feedRows)` → `{ add, deactivate, reactivate,
  unchanged, nearMatches, possibleRenames, unknownInSheet }`.
- **Matching is byte-exact after `trim()`.** Normalization (gershayim ״→",
  trim, collapse spaces) is used ONLY to populate `nearMatches` — never to
  auto-merge — because every downstream match is exact-string.
- `possibleRenames` heuristic: exactly one sheet-only + one feed-only name
  sharing a first token (שירן → שירן כהן). Report-only.
- `applyPlan(plan, {allowDeactivate})` → row writes `[{name, active}]`
  (`'true'`/`'false'` sheet strings). Deactivation must be explicitly enabled.
  **Never emits a delete. Never renames.**

### `apps-script/Code.gs`

- `_staffingRoster()` — live fetch of the staffing feed
  (`action=getTherapistsForTherapists`), copy of the `_liveDebtRoster` pattern:
  `STAFFING_SHEETS_URL` + `STAFFING_THERAPISTS_SECRET` Script Properties,
  `muteHttpExceptions` + `followRedirects`, per-execution cache, **fail-closed**
  → `{status:'ok', therapists}` or `{status:'unconfigured'|'unavailable'}`.
  Shape validated strictly: `therapists` must be an array of
  `{name: string, active: boolean}` — anything else is `unavailable`.
- The roster-sync core (`planRosterSync`, `applyPlan` + helpers) is mirrored
  inline between `BEGIN/END roster-sync core` markers, **byte-identical** to
  `public/roster-sync.js` (guarded by `test/roster-sync.test.js` — the
  `FINAL_THERAPISTS` mirror convention, upgraded from parsed-equal to
  byte-equal).
- New POST action **`previewStaffingRosterSync`** (read-only): returns
  `{ ok:true, source:'ok'|'unconfigured'|'unavailable', plan }`. No sheet
  writes. No new secret — it rides the existing app-password gate like every
  other action and exposes only names + active flags.
- New editor function **`previewStaffingRosterSyncNow()`** — logs the plan JSON
  (same convention as `migrateTherapistNamesNow`).
- `_getData` / `THERAPISTS_SEED` **unchanged** in PR A; the stale "19-name"
  seed comment corrected to 29.

### `server.js`

Unchanged — the POST `/api/sheets` proxy passes any `action` through (no
allow-list), so `previewStaffingRosterSync` rides it as-is.

### UI

None in PR A — there is no admin surface (the roster tools all run from the
Apps Script editor), so the preview is read via
`Run ▸ previewStaffingRosterSyncNow` or the POST action. No frontend files
changed → **no SW cache bump** (stays v16).

### Tests — `test/roster-sync.test.js` (new)

- add / deactivate / reactivate / unchanged classification.
- Byte-exact: `'ד"ר נטליה סדוגין'` vs `'ד״ר נטליה סדוגין'` is NOT unchanged —
  it surfaces in `nearMatches` (reason `gershayim`) while still appearing in
  add+deactivate (nothing auto-merges); trailing-space variant → reason
  `whitespace`.
- `possibleRenames` fires for שירן → שירן כהן, not for unrelated or ambiguous
  names.
- `applyPlan` with `allowDeactivate:false` emits only add/reactivate; never a
  delete or rename in any case.
- Mirror guard: the Code.gs core block is byte-identical to the module.
- vm-sandbox of the real `Code.gs`: `_staffingRoster` fail-closed on unset
  property / non-2xx / non-JSON / wrong shape (`therapists:'x'`, entry missing
  `active`, non-boolean `active`, thrown fetch); `previewStaffingRosterSync`
  (direct and via `doPost`) performs **zero** `setValues`/`appendRow`/
  `clearContent` calls on mocked sheets; Code.gs `planRosterSync` output equals
  the Node module's on the same input.

### After PR A merges (operator checklist)

1. Set Script Properties on the therapists Apps Script:
   `STAFFING_SHEETS_URL` (staffing `/exec` URL) and
   `STAFFING_THERAPISTS_SECRET` (= staffing's `THERAPISTS_READ_SECRET`).
2. clasp CI green → Apps Script editor → Run ▸ `previewStaffingRosterSyncNow`
   → read the plan in the log.
3. Fix every `nearMatches` / `possibleRenames` entry **in the staffing app**
   (rename the worker there so it byte-matches this roster and the outpatient
   `TherapistRates` sheet). Re-run until both lists are empty.
4. Decide each `unknownInSheet` name: retire (PR B will deactivate it) or add
   the person to staffing with role מטפל/ת.
5. Paste the final plan JSON into the PR B kick-off.
