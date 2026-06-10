# Cross-app dependencies

`ezone-therapists` consumes three read-only projections from sibling apps. The
browser never sees a secret — the Node server injects each shared secret and
forwards to the sibling Apps Script (see `server.js`). All three must be
deployed on the sibling side for the corresponding feature to work end-to-end.

| # | Dependency | Sibling repo | Status | Blocks |
| - | ---------- | ------------ | ------ | ------ |
| 1 | `getDebtStatus` | `ezone-outpatient` | **Open, unmerged** — PR #14 (`claude/nice-edison-5bvwiz`). Must be merged **and the Apps Script redeployed**. | Outpatient debt gate |
| 2 | `getTreatmentPlans` | `ezone-outpatient` | **Not started.** Patch + tests ready in [`outpatient-getTreatmentPlans.patch.md`](outpatient-getTreatmentPlans.patch.md). Apply + redeploy. | Treatment-plan tab |
| 3 | `getAdmittedRoster` | `E-Zone-Dashboard` | **Not started.** Patch + tests ready in [`dashboard-getAdmittedRoster.patch.md`](dashboard-getAdmittedRoster.patch.md). Apply + redeploy. | Inpatient roster autocomplete (free-text fallback works without it) |

## Env vars on the therapists Railway service

| Var | Points at | Used by |
| --- | --------- | ------- |
| `SHEETS_URL` | therapists' own Apps Script `/exec` | `/api/sheets` (logs + approvals) |
| `OUTPATIENT_SHEETS_URL` | outpatient Apps Script `/exec` | `/api/debt-status`, `/api/treatment-plans` |
| `DEBT_STATUS_SECRET` | matches outpatient `DEBT_STATUS_SECRET` Script Property | dep #1 |
| `TREATMENT_PLANS_SECRET` | matches outpatient `TREATMENT_PLANS_SECRET` Script Property | dep #2 |
| `DASHBOARD_SHEETS_URL` | dashboard Apps Script `/exec` | `/api/admitted` |
| `OCCUPANCY_SECRET` | matches dashboard `OCCUPANCY_SECRET` Script Property | dep #3 |

> **Needed at deploy time (from the project owner):** outpatient's `SHEETS_URL`
> (`OUTPATIENT_SHEETS_URL` here) and the `DEBT_STATUS_SECRET` value, so the debt
> gate works end-to-end. Per spec these are env vars, never hardcoded.

## Graceful degradation (never-fail-open)

- **Debt gate (#1) down/unset:** `DebtGate.evaluate` returns `flag /
  lookup_failed` — the log is NOT silently allowed; the therapist must re-check
  or send it for manual resolution.
- **Treatment plans (#2) down/unset:** the plans tab shows a clear "not
  available yet" notice instead of an empty list.
- **Admitted roster (#3) down/unset:** the inpatient tab loses autocomplete but
  free-text entry (with canonical phone validation) still works.

## Verification after each sibling deploy

Confirm via DevTools → Network that the sibling `/exec` returns the documented
JSON for the new action (with the secret), then confirm the therapists route
(`/api/debt-status`, `/api/treatment-plans`, `/api/admitted`) returns it through
the proxy. Live-verify on Railway after merge.
