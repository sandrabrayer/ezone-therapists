# Changelog — iteration 5: structural fixes from real use

Corrections found in use. All cross-app wiring, the debt gate, the did-it-happen
write-back, phone normalization, approval, and conventions are preserved.

## 1. «המטופלים שלי» is now a real tab

- Renamed from «המטפל שלי».
- The «בחר/י מטפל/ת» name-picker was floating in the **global header**, visible
  from every tab — **removed from the header** (the therapist chip + the
  therapist-identity modal are gone). The name-picker now lives **only inside**
  this tab.
- The tab shows the therapist's own treatments in **four labeled buckets**:
  **טיפולים שנקבעו** (unmarked, today or earlier) · **טיפולים קרובים** (unmarked,
  future) · **טיפולים שבוצעו** (performed) · **טיפולים שנקבעו ולא בוצעו** (missed).
  Bucketing is a pure, tested helper (`Scheduling.bucketMine`). Each treatment is
  markable happened / didn't-happen, feeding the existing write-back.

## 2. Multiple treatments/therapists per patient

The single `assignedTherapist` + `mainTreatmentType` + `frequencyPerWeek` on the
patient record is replaced by a normalized **`Assignments`** sheet — one row per
(patient, therapist, plan). A patient can hold **several active assignments**
(parallel treatments with different therapists), and **both** the plan (type +
weekly frequency) **and** the therapist are editable after being set.

- Backend: `Patients` schema reduced to identity + origin; new `Assignments`
  sheet + `saveAssignment` / `removeAssignment` actions; `getData` returns
  `assignments`.
- Frontend: the dashboard and שיבוץ list show all of a patient's therapists +
  plans; a new **«שיבוץ ותוכנית»** modal adds/edits/removes assignment rows.

## 3. New-patient registration flow

- **«רישום מטופל חדש» appears only in דשבורד מטופלים** (removed from שיבוץ).
- Intake captures identity + origin + an **optional initial assignment**; on save
  it creates the patient and (if filled) the first assignment, so the patient
  immediately flows to **שיבוץ מטפלים**, where therapist + plan are fully editable.

## 4. Label fixes

- «טיפולים שתוזמנו» → **«טיפולים שנקבעו»** (workflow KPI).
- «קרובים (טרם סומנו)» → **«טיפולים קרובים»** (workflow KPI + bucket).

## Tests

`npm test` — 68 passing. New coverage: the four buckets (`bucketMine`) and that
**multiple parallel treatments per patient with different therapists** bucket
independently. All prior tests still pass.

## Data-model migration note

The `Patients` schema dropped its plan/therapist columns (moved to `Assignments`).
This is a pre-production change; a fresh Apps Script deploy creates both sheets
with the new shape.
