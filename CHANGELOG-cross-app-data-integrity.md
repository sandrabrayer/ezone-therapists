# Cross-app data integrity — canonical assignment phone + delete propagation

Two cross-app integrity fixes so the therapists app and the outpatient app stay
in sync on patient identity (phone) and patient existence (delete).

## (a) Canonicalize the assignment phone on save

### The bug
`_savePatient` canonicalizes the phone (`_toCanonicalPhone` → reject non-canonical
as `invalid_phone`) and stores only the clean 10-digit leading-zero key.
`_saveAssignment`, however, stored `patientPhone` **as-is** —
`String(a.patientPhone).trim()` — validating only that it was non-empty. So an
assignment saved with a messy or zero-dropped phone keyed by a DIFFERENT value
than the patient it links to. The roster build (`public/roster.js`) keys every
source by normalized phone, so one patient could split into two rows — the
**רון מנחם** bug: an assignment that never attached to its patient.

### The fix
- **`apps-script/Code.gs` `_saveAssignment`** now mirrors `_savePatient` exactly:
  reject an empty phone (`missing_phone`), then `_toCanonicalPhone` and reject a
  non-canonical one (`invalid_phone`), and **store the canonical value**. An
  assignment row now always keys by the same canonical phone as its patient.
- The clinical-type push that follows the save already canonicalized
  independently, so its behavior is unchanged; only the STORED row is corrected.

## (b) Cross-app patient-delete propagation

### The bug
Deleting a patient here (`_removePatient`) removed the local `Patients` row and
resolved any outpatient StopFlag — but left the matching **outpatient Client**
untouched. The therapists roster (`public/roster.js`) unions the outpatient
`getTreatmentPlans` / `getDebtStatus` rows as a **base** source, so the deleted
patient was immediately **re-added** from outpatient. The delete never stuck.

### The fix — deactivate (not hard-delete) on the outpatient side
Deactivation was chosen over a hard delete: it is reversible, preserves the
outpatient billing / session history, and `getTreatmentPlans` already filters by
status — so a deactivated Client simply drops out of the active roster union
without destroying the sibling's source data. Safer than a hard delete.

- **SENDER — `apps-script/Code.gs` `_postDeactivateClient`** (new): server-to-
  server `deactivateClient` POST (UrlFetchApp), same pattern as `_postFlagStop` /
  `_postResolveStopFlag`. Sends the **canonical** phone with a **dedicated** shared
  secret `DEACTIVATE_CLIENT_SECRET` (its own secret — NOT reused from
  `STOP_FLAG_SECRET`; least-authority, since deactivating a Client is more
  destructive than clearing a stop flag). The secret never reaches the browser.
- **Wiring — `_removePatient`** now calls `_postDeactivateClient` **fail-closed**,
  after resolving the StopFlag and **before** the local row delete: if outpatient
  can't be reached/authed, nothing changes locally (no half-state where the patient
  is gone here but still active on Vered's side). **Orphan-safe**: a phone matching
  no Client returns `deactivated:0` and the local delete proceeds.
- **RECEIVER — `docs/outpatient-deactivateClient.patch.md`** (new): the matching
  outpatient endpoint (soft-deactivate by phone alone, orphan-safe, fail-closed
  auth) plus a reference test. **Ships as a separate PR into the outpatient repo
  (`claude/youthful-volta-laarnk`)** — this session can only push to
  `ezone-therapists`. Tracked as dep #8 in `docs/DEPENDENCIES.md`.

## Tests — `test/delete-sync.test.js` (new, +18)
- assignment phone canonicalized on save / empty rejected `missing_phone` /
  non-canonical rejected `invalid_phone` (mirror guards on `_saveAssignment` +
  the `Phone.toCanonical` rule it applies);
- `public/delete-sync.js` (new pure module mirrored by `_postDeactivateClient`):
  `buildPayload` emits the `deactivateClient` contract with a canonical phone +
  secret; `interpretResponse` is fail-closed on non-2xx / `ok:false` and
  **orphan-safe** on `deactivated:0`;
- mirror guards: `_postDeactivateClient` sends the canonical phone + dedicated
  secret and fails closed; `_removePatient` aborts the local delete on a failed
  deactivate and runs it **before** `_deleteLocalPatient`;
- pure mirror of the outpatient receiver: deactivates the match (incl. a
  zero-dropped orphan phone) and is orphan-safe (no match → `deactivated:0`, no
  crash).

Full suite: **213 pass / 0 fail** (was 195; +18).

## Deploy / ops flags
- **Redeploy the therapists Apps Script** (new `Code.gs` action + `_saveAssignment`
  change).
- **New secret `DEACTIVATE_CLIENT_SECRET`** — provision the SAME value as a Script
  Property on **both** Apps Scripts (therapists sender + outpatient receiver).
  **No new Node/Railway env var** (the write is Apps Script → Apps Script). Until
  it's set and the outpatient receiver deployed, delete-patient is fail-closed and
  changes nothing locally.
- **Separate outpatient PR required** (dep #8) — apply
  `docs/outpatient-deactivateClient.patch.md`, ensure `getTreatmentPlans` /
  `getDebtStatus` exclude inactive Clients, and redeploy the outpatient Apps Script.
