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

---

## PR B — enable the write path

The Therapists sheet is now **synced from the staffing feed on every `getData`**.
There is no seed anymore; names are edited in the staffing app, and `active` is
overwritten by every sync.

### `apps-script/Code.gs`

- `_getData`: the old `_ensureSeededList('Therapists', THERAPISTS_SEED…)` is
  replaced by **`_syncTherapistsFromStaffing()`**:
  - `_ensureSheet('Therapists', THERAPISTS_HEADERS)` (no seed).
  - Feed `unconfigured`/`unavailable` → **no writes**, the last-synced sheet is
    served as-is, and the response carries
    `rosterSource:'unconfigured'|'unavailable'` so the UI can warn.
  - Feed ok → `planRosterSync` + `applyPlan(plan, {allowDeactivate:true})`,
    writing **only changed cells** (the `active` cell of an existing row —
    upsert by trimmed name, first occurrence wins — and appended rows for new
    names) under `LockService`. **Never a row delete, never a rename, never a
    touch on Assignments/Schedule/Approvals.**
  - A successful sync is cached in `CacheService` for **120s** (key
    `staffingRosterSync`, same TTL as outpatient `TherapistRates`) so a burst
    of `getData` calls doesn't refetch/rewrite. The cached value is ONLY the
    applied sync's timestamp — never the roster; a cache hit returns
    `rosterSource:'staffing'` with `rosterSyncSummary:null`.
  - Applied-sync responses carry `rosterSource:'staffing'` +
    `rosterSyncSummary:{added, deactivated, reactivated}`, and every APPLIED
    sync also `console.log`s the summary server-side — so the first sync after
    the deploy is visible in the Apps Script log.
- **Removed**: `THERAPISTS_SEED` (no seed exists — guard-tested) and
  `cleanupTherapistRosterNow` (its job is the sync now).
- **Kept**: `migrateTherapistNames*` for future renames — `_rosterKeySet` now
  reads the LIVE Therapists sheet instead of the seed.
- `previewStaffingRosterSync` / `previewStaffingRosterSyncNow` stay read-only
  and unchanged — still useful before renaming someone in staffing.

### `public/therapist-migration.js`

`FINAL_THERAPISTS` removed (it mirrored the removed seed); `SHORT_TO_FULL`,
`migrateName`, `normalizeKey` stay. Membership checks (`planMigration`,
`isInRosterExact`, `isInRosterNormalized`) now take the roster as a
**parameter** — Code.gs passes the live sheet names, tests pass fixtures.

**New rename mapping** (a real rename made in staffing, both quote styles):
`ד"ר ילנה` / `ד״ר ילנה` → **`ד"ר ילנה זבניאצקובסקי`**, in `SHORT_TO_FULL` and
its Code.gs mirror, so `migrateTherapistNames` moves existing
`Assignments`/`Schedule` rows. The old name is deactivated by the sync
automatically — never deleted.

### Frontend

- `public/app.js`: reads `data.rosterSource`; anything but `'staffing'` (while
  the field exists — an older backend stays silent) shows ONE non-blocking
  **amber** toast per page load:
  `רשימת המטפלים לא סונכרנה מאפליקציית כוח האדם — מוצגת הרשימה האחרונה`.
  `rosterSyncSummary` is logged to the console. `toast()` gained a `'warn'`
  kind (amber, `.toast.warn`).
- `public/sw.js`: cache bumped **v16 → v17**.

### Tests (suite 450 green)

- vm-sandbox `_getData`: feed ok → **exactly** the planned cell writes (active
  flips + appends with `active='true'`), zero writes on
  Schedule/Approvals/Patients/Assignments/TreatmentTypes; feed
  unavailable/unconfigured → zero writes, `rosterSource` set, sheet served
  unchanged; a second execution inside the 120s cache window performs zero
  fetches and zero writes; `Scheduling.activeNames` over the synced list equals
  the feed's active names.
- Source guards: `THERAPISTS_SEED` and `cleanupTherapistRosterNow` absent from
  `Code.gs`; `FINAL_THERAPISTS` no longer exported; SW cache ≥ v17.

### After PR B merges (operator checklist)

1. clasp CI green; Railway deploy done; hard-refresh → DevTools ▸ Application
   shows the new SW version.
2. DevTools ▸ Network → `getData` response has `rosterSource:"staffing"`.
3. The therapist dropdown shows exactly staffing's active therapists.
4. **The ילנה rename**: the first sync deactivates `ד"ר ילנה` and adds
   `ד"ר ילנה זבניאצקובסקי`. Then run Apps Script editor → Run ▸
   `migrateTherapistNamesNow` so existing `Assignments`/`Schedule` rows move to
   the new name, and rename the matching outpatient `TherapistRates` row so
   pay matching keeps lining up.
5. Any future rename: same recipe — rename in staffing, add the mapping to
   `SHORT_TO_FULL` (+ Code.gs mirror), run `migrateTherapistNames`, rename the
   `TherapistRates` row.
