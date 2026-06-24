# Changelog — iteration 13: phone leading-zero recovery, duplicate guard, times-per-week dropdown

Three fixes, all keyed on the patient phone (the matching key):

1. **Phone leading-zero — keep it on save AND recover it on read.**
2. **No duplicate patients** — creating a patient with an existing phone is rejected.
3. **Times-per-week is a fixed dropdown** (blank + 1–7) everywhere it's entered.

## 1. Leading-zero: persist + recover

**Root cause.** Sheets coerced a canonical phone (`"0501234567"`) written to a
*number*-formatted cell into the number `501234567`, dropping the leading zero —
corrupting the matching key.

**Fix — both sides:**
- **Persist (new writes):** `Code.gs` `_ensureSheet` now pins every phone column
  (`Patients.phone`, `Schedule.patientPhone`, and any `patientPhone` column) to the
  `'@'` plain-text number format via `_forcePhoneColumnsText` / `setNumberFormat('@')`,
  across the whole column. A canonical string saved into a text cell keeps its zero.
- **Recover (already-corrupted rows, on read):** new shared helper
  **`Phone.recoverStored(raw)`** restores the lost zero — a 9-digit run **not**
  starting with `0` (the unambiguous lost-zero signature) → `0` + digits → canonical.
  Everything else (already-canonical, blank, legacy free-form, wrong length) passes
  through as a trimmed string, untouched. Mirrored in `Code.gs` as
  `_recoverStoredPhone` and applied in `_readAll` for every phone column, so all
  server read paths (load, duplicate check, gates) see the repaired value. The client
  also recovers on load (`loadAll`, `normalizeScheduleRow`) so the UI is correct even
  before the Apps Script redeploy lands.

**Recovery is not an entry path.** A human typing a no-leading-zero number is still
rejected by `validateCanonical` / `toCanonical` (unchanged). `recoverStored` only
repairs data Sheets mangled.

## 2. Duplicate-patient guard (create mode)

- **`Phone.duplicateOf(phone, patients)`** (shared, tested): returns the first
  existing patient that already owns the phone (tolerant match; an inactive patient
  still owns its key), else `null`.
- **`savePatient` gets a mode.** Client sends `mode: 'create' | 'edit'`
  (`apiSavePatient(patient, mode)`), set from the modal (`openNewPatient` →
  `create`, `openPatientModal` → `edit`). On **create**, an existing canonical phone
  is rejected — backend returns `duplicate_phone` with a Hebrew `message` naming the
  existing patient; the form blocks it first with the same named message. **Edit still
  upserts by phone**, and multiple assignments per patient are unaffected (Assignments
  is a separate sheet keyed by `id`).
- Enforced on **both** the form (immediate, named) and the backend (safety-net).

## 3. Times-per-week dropdown

`frequencyPerWeek` is now a `<select>` with a **blank default + 1–7** in both the
intake modal (`index.html`) and the assignments modal (`assignmentRowHtml`, via the
shared `freqOptions` builder). Bind/save paths are unchanged — `.value` is still `''`
or `'1'..'7'`.

## Tests
`test/phone.test.js` adds: `recoverStored` (9-digit restore, numeric round-trip,
already-canonical untouched, non-signature passthrough) and `duplicateOf`
(canonical/legacy match, inactive still owns, no-match/blank/bad-input → null).
`npm test` — all passing (96 with deps installed).

## Deploy
`Code.gs` changed (text-format pinning, read recovery, duplicate enforcement) →
**Apps Script redeploy required** (Manage deployments → Edit → New version). Pinning
the phone columns to text and the read-side recovery both take effect after redeploy;
the client-side recovery covers the UI in the meantime.
