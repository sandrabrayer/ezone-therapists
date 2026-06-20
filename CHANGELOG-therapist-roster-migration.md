# Therapist roster — final full-name seed + short→full migration

## The bug

Deleted therapist names (the SHORT names עידו, דליה, חנן, מעיין, איתן, מרים, תמר,
שחר, יסמין) kept reappearing in the Therapists tab and the dropdown. Root cause:
they were hard-coded in `THERAPISTS_SEED`, and `_ensureSeededList` re-appends any
seed name that is **missing** on every `getData` (`Code.gs:_getData`). A **hard
row delete** makes the name missing → it gets re-seeded as `active='true'`. (The
dropdown reads the Therapists sheet only — `Scheduling.activeNames(state.therapists)`
— it does **not** union names from Assignments/Schedule, so stale rows were never
the re-seed source; the seed list was.)

## The fix

### 1. Seed replaced with the final 19 full-name roster
`THERAPISTS_SEED` is now exactly the final roster — full names, **all old short
names removed**, so a hard delete stays deleted (nothing short can re-seed):

```
מעיין דלומי, תמר גנץ, אורן כביר, אביב מלכה, רמי, כנרת, הילה, עידו בוזגלו, אלה,
שירן, דנה, יפעת, איתן דשה, דליה מלמד, נועה זיפמן, אסתר, ד״ר שפרינץ, ד״ר נטליה, ד״ר דנגור
```

`_ensureSeededList` only ADDS missing names (never deletes), so on next load the
19 full names are ensured present; any leftover short-name rows already in the
sheet should be deleted by the admin once — they will **not** be re-added.

### 2. One-time short→full migration of existing rows
Renames the `therapist` field on existing **Assignments** + **Schedule** rows
using ONLY this explicit mapping (no mapping is invented):

| short | full |
| ----- | ---- |
| דליה | דליה מלמד |
| מעיין | מעיין דלומי |
| תמר | תמר גנץ |
| איתן | איתן דשה |
| עידו | עידו בוזגלו |
| נועה | נועה זיפמן |

A name **not** in the mapping is left untouched. After migration, existing rows
carry full names so pay/credit matching lines up with the new roster.

**How to run** (pick one):
- **Apps Script editor:** open the therapists Apps Script → Run ▸
  **`migrateTherapistNamesNow`**. The full report is written to the execution log.
- **HTTP:** POST `{ "action": "migrateTherapistNames" }` to the `/exec` (via the
  Node proxy `/api/sheets`).

**Idempotent:** `_migrateTherapistName` returns a full name (or any non-short
name) unchanged, and only changed cells are written — so re-running rewrites
nothing (`migrated: 0`). Verified by tests
(`planMigration` second pass → 0 changes).

### Report (so you decide the leftovers)
The action returns:
```jsonc
{ "ok": true,
  "assignments": { "scanned": N, "migrated": n },
  "schedule":    { "scanned": N, "migrated": n },
  "changes": [ { "sheet": "Schedule", "id": "...", "from": "עידו", "to": "עידו בוזגלו" }, … ],
  "unmapped": [ { "name": "חנן", "rows": 3 }, … ],            // NOT in the final 19 — decide manually
  "punctuationVariants": [ { "name": "ד\"ר נטליה", "rows": 2 }, … ] }  // matches a roster name only after ד״ר/ד" normalization; left as-is
```
- **`unmapped`** — therapist names on existing rows with no full-name equivalent
  (e.g. חנן, מרים, יסמין, שחר). **Left as-is and flagged** — no mapping invented.
  Decide per name whether to retire, reassign, or add to the roster.
- **`punctuationVariants`** — names that match a roster entry only after
  normalizing the Hebrew gershayim `״` vs ASCII `"` (e.g. an old `ד"ר נטליה` row
  vs the seed's `ד״ר נטליה`). Left as-is; standardize later if you want byte-exact
  matching.

> Scope: **Assignments + Schedule** only (per request). **Approvals** (audit
> trail) is intentionally not migrated. Restoring/recreating bookings is unrelated.

## Canonical logic + tests

- **`public/therapist-migration.js`** — the single source of truth
  (`FINAL_THERAPISTS`, `SHORT_TO_FULL`, `migrateName`, `planMigration`), MIRRORED
  in `apps-script/Code.gs` (`THERAPISTS_SEED`, `_THERAPIST_SHORT_TO_FULL`,
  `_migrateTherapistName`, …). Not browser-loaded — it's the server mirror + test
  source.
- **`test/therapist-migration.test.js`** — 13 tests: the 19-name roster, old short
  names absent, each mapping, idempotency, the unmapped/variant report, and a
  **mirror guard** asserting the Code.gs seed + mapping match the module (so they
  can't drift). Full suite **195/195**.

## ⚠️ Deploy / ops

1. **Redeploy the therapists Apps Script** (new seed + the migration action live in
   `Code.gs`).
2. **Run the migration once** (`migrateTherapistNamesNow`) and review the
   `unmapped` / `punctuationVariants` report.
3. **Delete any leftover short-name rows** still in the Therapists sheet — they
   will not re-seed. No new secret / Railway var.
