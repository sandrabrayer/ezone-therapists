# Cross-app dependencies

`ezone-therapists` consumes three read-only projections from sibling apps and
makes **three cross-app WRITEs** (deps #4, #5, #6). The browser never sees a secret —
reads are proxied by the Node server, and the writes originate server-to-server
from the therapists Apps Script (which holds its own secret copies). All must be
deployed on the sibling side for the corresponding feature to work end-to-end.

| # | Dependency | Sibling repo | Status | Blocks |
| - | ---------- | ------------ | ------ | ------ |
| 1 | `getDebtStatus` | `ezone-outpatient` | **Open, unmerged** — PR #14 (`claude/nice-edison-5bvwiz`). Must be merged **and the Apps Script redeployed**. | Outpatient debt gate |
| 2 | `getTreatmentPlans` | `ezone-outpatient` | **Not started.** Patch + tests ready in [`outpatient-getTreatmentPlans.patch.md`](outpatient-getTreatmentPlans.patch.md). Apply + redeploy. | Treatment-plan / dashboard plan data; **patient status** (active vs `סיים טיפול`) for the stop flow |
| 3 | `getAdmittedRoster` | `E-Zone-Dashboard` | **Not started.** Patch + tests ready in [`dashboard-getAdmittedRoster.patch.md`](dashboard-getAdmittedRoster.patch.md). Apply + redeploy. | (no UI consumer since the inpatient tab was removed) |
| 4 | `recordTreatmentGiven` (**WRITE**) | `ezone-outpatient` | **Not started.** Patch + tests ready in [`outpatient-recordTreatmentGiven.patch.md`](outpatient-recordTreatmentGiven.patch.md). Apply + set the shared secret on **both** Apps Scripts + redeploy. | Did-it-happen → therapist pay / patient billing write-back |
| 5 | `flagStop` (**WRITE**) | `ezone-outpatient` | **Receiver exists on the outpatient side** (fail-closed, secret `STOP_FLAG_SECRET`). Set the matching `STOP_FLAG_SECRET` Script Property here + redeploy. | «הפסקת טיפול» — sends a stop request (pending Vered's confirmation) |
| 6 | `setClinicalType` (**WRITE**) | `ezone-outpatient` | **Not started.** Patch + tests ready in [`outpatient-setClinicalType.patch.md`](outpatient-setClinicalType.patch.md). Apply + set the shared secret on **both** Apps Scripts + redeploy. | On assignment save, pushes the patient's clinical treatment type so outpatient's per-patient billing rate follows the clinical plan |

## Env vars on the therapists Railway service

| Var | Points at | Used by |
| --- | --------- | ------- |
| `SHEETS_URL` | therapists' own Apps Script `/exec` | `/api/sheets` (logs + approvals) |
| `OUTPATIENT_SHEETS_URL` | outpatient Apps Script `/exec` | `/api/debt-status`, `/api/treatment-plans` |
| `DEBT_STATUS_SECRET` | matches outpatient `DEBT_STATUS_SECRET` Script Property | dep #1 |
| `TREATMENT_PLANS_SECRET` | matches outpatient `TREATMENT_PLANS_SECRET` Script Property | dep #2 |
| `DASHBOARD_SHEETS_URL` | dashboard Apps Script `/exec` | `/api/admitted` |
| `OCCUPANCY_SECRET` | matches dashboard `OCCUPANCY_SECRET` Script Property | dep #3 |
| `APP_PASSWORD` | (this app only) | optional shared UI-gate password — `/api/gate`. Unset = no gate. Never sent to the browser. |

> **Needed at deploy time (from the project owner):** outpatient's `SHEETS_URL`
> (`OUTPATIENT_SHEETS_URL` here) and the `DEBT_STATUS_SECRET` value, so the debt
> gate works end-to-end. Per spec these are env vars, never hardcoded.

### Also on the therapists **Apps Script** (Script Properties)

The backend enforces the debt gate authoritatively by re-reading live debt on
save (see [`server-side-gate-enforcement.md`](server-side-gate-enforcement.md)),
which is its **own** call to outpatient — independent of the Node proxy env
above. Set on the therapists Apps Script:

- `OUTPATIENT_SHEETS_URL` — outpatient `/exec` (used for both the debt re-check
  and the write-back).
- `DEBT_STATUS_SECRET` — debt re-check. Until set (and dep #1 deployed),
  outpatient `clear`/`approved` saves are rejected fail-closed; `flagged` saves
  still work.
- `TREATMENT_GIVEN_SECRET` — the **did-it-happen write-back** (dep #4); must match
  the value on the outpatient Apps Script. Until set (and dep #4 deployed),
  marking a treatment saves locally and leaves it `syncStatus='pending'`; the app
  retries via `syncPending` ("סנכרן עכשיו" / on refresh). The local mark is the
  source of truth and is never lost.
- `STOP_FLAG_SECRET` — the **stop-request write** (dep #5, `flagStop`); must match
  the value on the outpatient Apps Script. **Fail-closed:** until it's set (and the
  outpatient `flagStop` receiver deployed), «הפסקת טיפול» returns
  `stop_flag_unconfigured` and changes nothing — no local stop flag, no booking
  cancellation — so a patient is never hidden until the request actually reaches
  Vered. Reuses `OUTPATIENT_SHEETS_URL`; no new Node env var (server-to-server).
- `CLINICAL_TYPE_SECRET` — the **clinical billing-type push** (dep #6,
  `setClinicalType`); must match the value on the outpatient Apps Script.
  **Fail-open-with-flag** (NOT fail-closed like the stop flow): the assignment is
  always saved locally; if the secret is unset, the outpatient receiver isn't
  deployed, or it returns `no_match` / `multi_match` / `unknown_type`, the save
  still sticks and the UI **warns** that billing-type sync failed (and why) — never
  silently swallowed. Reuses `OUTPATIENT_SHEETS_URL`; **no new Node/Railway env
  var** (the write goes Apps Script → Apps Script). Requires an Apps Script
  redeploy on **both** sides once the receiver patch is applied.

## Source-data follow-up (outpatient side)

The outpatient roster still reports the service term **מרכז יום**. This app
relabels it to **ליווי יומי בקהילה** on display only
(`Scheduling.displayServiceType`) without mutating the stored value. The
outpatient SOURCE data (the `getTreatmentPlans` / roster `serviceType`) should
eventually be updated to the new term; once it is, the relabel here becomes a
no-op and can be retired.

## Graceful degradation (never-fail-open)

- **Debt gate (#1) down/unset:** `DebtGate.evaluate` returns `flag /
  lookup_failed` — the log is NOT silently allowed; the therapist must re-check
  or send it for manual resolution.
- **Treatment plans (#2) down/unset:** the dashboard shows a clear "not
  available yet" notice instead of an empty patient list (plan data is merged
  into the dashboard as of iteration 3).
- **Admitted roster (#3) down/unset:** no UI impact — the inpatient tab was
  removed; the route/secret/env remain wired but unsurfaced.

## Verification after each sibling deploy

Confirm via DevTools → Network that the sibling `/exec` returns the documented
JSON for the new action (with the secret), then confirm the therapists route
(`/api/debt-status`, `/api/treatment-plans`, `/api/admitted`) returns it through
the proxy. Live-verify on Railway after merge.
