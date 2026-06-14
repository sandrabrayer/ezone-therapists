# Changelog — iteration 13: leading-zero fix, no duplicate patients, frequency dropdown

Three connected issues, all keyed on the patient phone.

## 1. Leading-zero phone bug (root cause: Sheets number format)

The dashboard showed phones with no leading zero (`782374928` instead of
`0782374928`). The iteration-12 enforcement was **correct** — it hands the sheet
a clean `0XXXXXXXXX` string. The zero was lost in the **Google Sheets layer**:
the phone columns had no number format, so Sheets coerced the numeric-looking
string to a **number** on write, dropping the leading zero (and silently breaking
debt matching, since a 9-digit key never equals the 10-digit roster key).

**Fix — two parts:**
- **Force the phone columns to plain text** (`setNumberFormat('@')`) in
  `_ensureSheet` (`Patients.phone`, `Schedule.patientPhone`), applied to the
  whole column so every future write keeps the zero.
- **Recover already-corrupted rows on read** — `Phone.restoreStored` (shared,
  mirrored in `Code.gs` as `_restoreStoredPhone`): a stored 9-digit value — the
  lost-zero signature — gets its leading `0` restored; a genuine non-phone is
  left untouched. Applied to `Patients.phone` + `Schedule.patientPhone` on read
  (`_getData`, `_markAttendance`) and again client-side on load (idempotent).

This is **recovery of data Sheets mangled at rest** — *not* the entry path: a
human-typed no-leading-zero number is still **rejected** by `toCanonical`.

## 2. One record per patient — block duplicates

A patient must be created only once. `savePatient` gained a **create mode**: on
`mode:'create'`, an existing **canonical phone** → `duplicate_phone` rejection
(with the existing patient's name), enforced on **both** the form (names the
existing patient, points to edit) and the backend (defense-in-depth). Editing an
existing patient still upserts the same row; **multiple treatments/assignments
per patient are unaffected** (separate `Assignments` sheet). Decision logic is a
pure module — `public/patient-dedupe.js` `isDuplicateCreate` — mirrored inline in
`Code.gs`.

## 3. Times-per-week as a dropdown

The free-number תדירות field became a `<select>` (blank default + **1–7**) in
both the intake modal (`index.html`) and the per-row assignments editor
(`assignmentRowHtml` → `freqOptions`). Binds + saves through the unchanged
`.value` read.

## Tests
`npm test` — **97 passing**. New: `test/patient-dedupe.test.js` (create-with-
existing → blocked; edit → allowed; new → allowed; empty/edge), and
`restoreStored` cases in `test/phone.test.js` (intact survives; 9-digit number/
string recovers the zero; `+972` normalizes; non-phone untouched).

## Deploy
`Code.gs` changed (text format + read recovery + duplicate block) →
**Apps Script redeploy required** (Manage deployments → Edit → New version), then
Railway redeploy + Ctrl+Shift+R. The text-format fix applies to **new** writes;
existing rows are recovered on read until next re-save.
