# Frontend + Apps Script (step 2)

The three-tab UI, the indigo theme, and the therapists' own Google Sheet
backend.

## Theme — `public/style.css`
Carried over from `ezone-outpatient` verbatim; the **only** change is the
accent token remap green→indigo/violet. The legacy `--green/--green-2/
--green-deep` custom-property names are aliased to the new `--accent*` indigo
values so all the component CSS (`.btn/.panel/.card/.chip/.kpi/.modal/.toast/
.tab`, layout, fonts, spacing) stays byte-for-byte unchanged and simply renders
violet. A handful of hardcoded green accent values (two radial gradients, the
primary-button text color, the focus glow, two accent-tinted status
backgrounds) were recolored to indigo. The `.chip-paid/partial/unpaid` semantic
colors are left untouched.

## Markup — `public/index.html`
- PIN screen → `enterApp()`; role badge; therapist chip; relative asset URLs;
  `app.js?v=__BUILD__` (plus the three logic modules, also build-busted).
- Three tabs: **טיפולי חוץ**, **מטופלים באשפוז**, **מטופלי חוץ — תוכנית טיפול**.
- Outpatient log modal carries the inline debt-gate banner and the inline
  approval section (Ron/Sandra dropdown + note), revealed only when blocked.
- Inpatient log modal (no gate). Therapist-identity modal. `datalist`s for
  name autocomplete from the debt roster / admitted roster.

## App logic — `public/app.js`
- Conventions carried over: `sessionStorage` role (`ez_role`), `body.viewer
  .edit-only` hiding, `fmtDate` strips `T…Z`, `toast` with no silent fallback,
  submit buttons disable on click / re-enable on failure, relative `/api/...`
  only, `setView` tab switching.
- **Outpatient logging is a two-phase gate flow.** Phase 1 validates the
  canonical phone (`Phone.validateCanonical`), then re-reads debt status LIVE
  and runs `DebtGate.evaluate`. `allow` saves immediately as `clear`; `block`
  reveals the approval section and only saves with a valid `Approval` stamp as
  `approved`; `flag` saves as `flagged` for manual resolution (and a
  `lookup_failed` flag forces a re-check rather than a blind save). Editing the
  patient name/phone invalidates a pending gate result.
- Inpatient logging validates the same canonical phone but has no gate.
- Treatment-plan tab is read-only from `/api/treatment-plans`; shows a clear
  notice when the endpoint isn't deployed yet. Inpatient roster from
  `/api/admitted` feeds autocomplete; absent → free-text still works.
- Therapist must identify themselves (stored in `ez_therapist`) before logging;
  every saved row is stamped with the therapist.

## Backend — `apps-script/Code.gs`
- This app's own sheet. `Treatments` (one upsert-by-id row per log, with
  embedded approval columns) and `Approvals` (append-only debtor-approval audit
  trail). `_ensureSheet` append-only schema, `LockService` on writes.
- `doGet`: `getData`. `doPost`: `saveTreatment` (guards `approved` rows must
  carry an approver + timestamp — a flagged/debtor log can't masquerade as
  clean), `removeTreatment`.
- `app.start()` exported and `app.listen` guarded by `require.main` in
  `server.js` so the test runner exits cleanly.

All 25 tests still pass; server boots and serves the build-busted page.
