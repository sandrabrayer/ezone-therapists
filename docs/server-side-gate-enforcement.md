# Server-side gate enforcement (`saveTreatment`)

Closes two enforcement gaps where the Apps Script backend previously trusted the
client. The Web App is deployed **"Anyone with the link"**, so a forged POST can
reach `/exec` directly, bypassing the Node proxy and the browser gate. The
backend must therefore treat `gateStatus` and `approverId` as untrusted
**claims**.

## Gap 1 — approver allowlist

Only **Ron** (`ron` / `רון`) and **Sandra** (`sandra` / `סנדרה`) may approve a
debtor's continued treatment. `approverId` is stored as the id (see
`public/approval.js`); the Hebrew label is accepted defensively. An `approved`
treatment whose `approverId` isn't on the allowlist is rejected:

```json
{ "ok": false, "error": "invalid_approver" }
```

## Gap 2 — `gateStatus` is now server-verified, not trusted

A forged `{ gateStatus: 'clear' }` for a debtor previously bypassed the gate.
The backend now **re-reads live outpatient debt** (`getDebtStatus` via
`UrlFetchApp`), recomputes the authoritative gate for the patient's phone using
the same tri-state + matching rules as the client, and accepts the claim only if
it agrees. It **fails closed**.

| claimed `gateStatus` | authoritative re-read | result |
| -------------------- | --------------------- | ------ |
| `clear` (or empty)   | `allow` (1 match, clear) | save |
| `clear`              | `block` (owes)        | reject `debt_verification_failed` |
| `clear`              | `flag` (unknown/no/multi match) | reject `debt_verification_failed` |
| `approved` + allowlisted approver | `block` (owes) | save |
| `approved` + allowlisted approver | `allow` (debt cleared since) | save (approval harmless) |
| `approved` + non-allowlisted approver | any | reject `invalid_approver` |
| `clear`/`approved`   | lookup **unavailable** (fetch/parse error) | reject `debt_verification_unavailable` |
| `clear`/`approved`   | verification **unconfigured** | reject `debt_verification_unconfigured` |
| `flagged`            | (not checked)         | save as-is (already manual) |
| inpatient (any)      | (not checked)         | save (not debt-gated) |

The policy is the pure module `public/treatment-guard.js` (`decideSave`,
`isAllowedApprover`), **mirrored inline** in `apps-script/Code.gs`
(`_decideSave`, `_isAllowedApprover`, `_authoritativeGate`,
`_normalizePhoneForMatch`) because Apps Script can't import it.
`test/treatment-guard.test.js` guards the policy; the matching/tri-state mirrors
are already covered by `test/phone.test.js` and `test/debt-gate.test.js`. Any
change to the rule must update both sides.

## Configuration (therapists Apps Script Script Properties)

The verification re-read is the backend's **own** call to outpatient — separate
from the Node server's proxy env. Set on the therapists Apps Script
(`Project Settings → Script properties`):

| Script property | value |
| --------------- | ----- |
| `OUTPATIENT_SHEETS_URL` | outpatient Apps Script `/exec` URL |
| `DEBT_STATUS_SECRET` | matches outpatient's `DEBT_STATUS_SECRET` |

### Deploy-ordering consequence (intended, fail-closed)

Until these are set **and** outpatient `getDebtStatus` (PR #14) is merged and
redeployed, every outpatient `clear`/`approved` save is rejected
(`debt_verification_unconfigured` / `debt_verification_unavailable`). This is the
never-fail-open posture: the gate cannot be vouched for, so nothing is logged as
verified. `flagged` saves and all inpatient saves are unaffected, so the app
remains usable for manual-resolution and inpatient logging in the meantime.
