# Cross-app endpoint patches + dependency tracking (step 3)

Documented, ready-to-apply Apps Script patches for the two sibling-side
endpoints this app consumes, plus the dependency tracker. We can't push to the
sibling repos from this session, so these are delivered as patches and tracked.

- `docs/outpatient-getTreatmentPlans.patch.md` — outpatient `getTreatmentPlans`
  (minimal plan projection: clientId, name, phone=`treatmentContactPhone`,
  serviceType, sessions, status; no payer/billing). Secret
  `TREATMENT_PLANS_SECRET`. Includes Code.gs additions, doGet/doPost dispatch,
  and a reference test asserting payer/billing fields are never exposed.
- `docs/dashboard-getAdmittedRoster.patch.md` — dashboard `getAdmittedRoster`
  (currently-admitted patients with phone recovered by joining
  `Patients.fromLead → Leads.id`; `direct_admin` patients come back with
  `phone:''`). Normalizes phone to canonical. Secret `OCCUPANCY_SECRET`.
  Includes Code.gs additions, the single `handle_` dispatch line, and a
  reference test covering fromLead recovery, normalization, release exclusion,
  and the no-lead blank-phone case.
- `docs/DEPENDENCIES.md` — the three deps (outpatient PR #14 `getDebtStatus`
  unmerged; `getTreatmentPlans` and `getAdmittedRoster` not started), the env
  var table, the never-fail-open degradation behavior, and post-deploy
  verification steps.
