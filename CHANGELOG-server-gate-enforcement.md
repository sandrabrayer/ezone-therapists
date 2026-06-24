# Server-side gate enforcement in `saveTreatment`

Closed two gaps where `apps-script/Code.gs` trusted the client. The Web App is
reachable directly ("Anyone with the link"), so a forged POST could bypass the
Node proxy and the browser gate.

## 1. Approver allowlist
`saveTreatment` now rejects an `approved` treatment whose `approverId` is not
Ron/Sandra with `{ ok:false, error:'invalid_approver' }`. The approver is stored
as the id (`ron`/`sandra`, per `public/approval.js`); the Hebrew labels
`רון`/`סנדרה` are accepted defensively.

## 2. `gateStatus` is now server-verified, not trusted
A forged `gateStatus:'clear'` for a debtor previously bypassed the gate. The
backend now **re-reads live outpatient debt** (`getDebtStatus` via `UrlFetchApp`)
and recomputes the authoritative gate for the patient's phone, accepting a
`clear`/`approved` claim only if it agrees. **Fails closed**: when verification
is unavailable or unconfigured, the claim is rejected
(`debt_verification_unavailable` / `debt_verification_unconfigured`), never
saved. `flagged` and inpatient saves are unaffected.

This replaces the previous `approval_required` check and corrects the
overstated "malformed client can't bypass" comment — the guarantee is now real
(for configured deployments) and explicit about its fail-closed behavior.

## How it's structured / tested
- New pure module `public/treatment-guard.js` (`decideSave`,
  `isAllowedApprover`) is the single source of truth for the policy, **mirrored
  inline** in `Code.gs` (`_decideSave`, `_isAllowedApprover`,
  `_authoritativeGate`, `_normalizePhoneForMatch`) since Apps Script can't
  import. The matching/tri-state mirrors reuse the rules already tested in
  `phone.js`/`debt-gate.js`.
- `test/treatment-guard.test.js` — 8 tests covering the allowlist (id + Hebrew),
  the forged-clear-for-debtor rejection, fail-closed on unavailable/unconfigured,
  empty-gateStatus treated as a clear claim, and flagged/inpatient pass-through.
  Suite is now **33 passing**.
- `docs/server-side-gate-enforcement.md` documents the policy, the required
  therapists-Apps-Script Script Properties (`OUTPATIENT_SHEETS_URL`,
  `DEBT_STATUS_SECRET`), and the intended fail-closed deploy-ordering
  consequence. `docs/DEPENDENCIES.md` updated.

## Note
Verification adds a `UrlFetchApp` round-trip per outpatient `clear`/`approved`
save and a hard dependency on the outpatient endpoint. That is the cost of a
server-authoritative gate on a publicly-reachable Web App, and is intended.
