# Changelog

## Iteration 13 — phone leading-zero recovery, duplicate guard, times-per-week dropdown

Three phone-keyed fixes. **(1) Leading zero kept and recovered:** `_ensureSheet`
pins phone columns to plain text (`setNumberFormat('@')`) so new saves keep the
zero, and a new shared `Phone.recoverStored` (mirrored in `Code.gs`, applied in
`_readAll` and on the client) restores the zero on already-mangled 9-digit rows —
entry still rejects a human-typed no-leading-zero number. **(2) No duplicate
patients:** `savePatient` gains a create/edit mode; on create, an existing
canonical phone is rejected (`duplicate_phone`) with a Hebrew message naming the
existing patient — enforced on form + backend; edit still upserts. **(3)
Times-per-week** is a `<select>` (blank + 1–7) in both the intake modal and
`assignmentRowHtml`. Full notes:
[`CHANGELOG-iteration13-phone-recovery-dedupe-freq.md`](CHANGELOG-iteration13-phone-recovery-dedupe-freq.md).

## Iteration 12 — enforce canonical phone on entry

Normalize-then-validate at every entry point via one shared normalizer:
`Phone.toCanonical` (composes the existing `normalizeForMatch` → `isCanonical`)
stores the normalized 10-digit/leading-zero form and rejects the rest with a
clear Hebrew message. Inputs relaxed (drop maxlength, `inputmode=tel`) so
separators/`+972` can be typed; backend `savePatient`/`_saveScheduleRow` enforce
too (no non-canonical number ever stored). Existing data untouched. Full notes:
[`CHANGELOG-iteration12-phone-enforcement.md`](CHANGELOG-iteration12-phone-enforcement.md).

## Iteration 11 — shared password gate (UI)

A single shared password on open (server-side check via the `APP_PASSWORD` Node
env, timing-safe; never sent to the browser, never persisted — re-prompts every
open). UI gate only; the therapist still picks their name in tab 3 after. Off
when `APP_PASSWORD` is unset. Full notes:
[`CHANGELOG-iteration11-password-gate.md`](CHANGELOG-iteration11-password-gate.md).

## Iteration 10 (steps 2–4) — edit, time dropdown, locations

Inline **«עריכה»** to edit bookings (day/time/location via new `updateBooking`,
no gate re-run) and assignments; **«ביטול טיפול»** to cancel an unreported booking
(reported ones must be marked «לא התקיים» first); **«שעה»** is a 30-min dropdown
07:00–21:00; the six fixed locations. Full notes:
[`CHANGELOG-iteration10-edit-time-location.md`](CHANGELOG-iteration10-edit-time-location.md).

## Iteration 10 (step 1) — the 1899-12-30 date bug

`_readAll` formatted every Date cell as a date, so the time-only `time` cell
(stored by Sheets on its 1899-12-30 epoch day) showed as "1899-12-30" next to
bookings. Fixed: time-only cells format as `HH:mm` (pure `sheetdate.js` +
`Code.gs` mirror); recovers existing rows. Full notes:
[`CHANGELOG-iteration10-date-fix.md`](CHANGELOG-iteration10-date-fix.md).

## Iteration 9 — white-field fix + scheduling unblock

Extended the dark control style to text inputs + textarea (fixes the white/
unreadable תדירות field in «שיבוץ ותוכנית»); `lookup_failed` now saves as flagged
(«שמור לבירור») instead of an infinite «נסה שוב» retry, so scheduling completes
even when the debt endpoint is down. Confirmed the tab-3 buckets have no render
bug. Frontend only. Full notes:
[`CHANGELOG-iteration9-whitefield-scheduling.md`](CHANGELOG-iteration9-whitefield-scheduling.md).

## Iteration 8 — remove login/roles, fix tab 3

Removed the identity screen and roles entirely — the app opens directly with all
three tabs visible to everyone. The therapist name picker moved INSIDE «המטופלים
שלי» (fresh each open, not persisted); «טיפולים קרובים» tightened to the coming
week (today+7); fixed the blank/white dropdown (dark `<select>` style). Frontend
only — no Apps Script change. Full notes:
[`CHANGELOG-iteration8-no-login-tab3.md`](CHANGELOG-iteration8-no-login-tab3.md).

## Iteration 7 — name-pick roles + scheduling + post-treatment report

Replaced the PIN + edit-mode with **name-pick roles** (Vered / therapist, no
password); therapist scheduling with **time-of-day**; the **post-treatment
report** (reason for not-done) **debt-gated at report time** (Ron/Sandra inline
approval, server-authoritative). Debt-block still pending outpatient PR #14. Full
notes: [`CHANGELOG-iteration7-roles-scheduling-report.md`](CHANGELOG-iteration7-roles-scheduling-report.md).

## Iteration 6 — label + edit-mode + picker fixes

Replaced the broken «עורך» badge with a working **«עריכה» edit-mode toggle**
(editor-only, only on שיבוץ + המטופלים שלי; dashboard view-only); finished the
«מתוזמנים/תוזמנו»→«נקבעו» rename app-wide; clarified the identity picker
(«אני:»→«שם המטפל/ת:», only in המטופלים שלי). Access rules extracted to
`public/access.js` + tests. Full notes:
[`CHANGELOG-iteration6-edit-mode-labels.md`](CHANGELOG-iteration6-edit-mode-labels.md).

## Iteration 5 — structural fixes from real use

«המטופלים שלי» becomes a real third tab (name-picker removed from the global
header) with four labeled buckets; multiple parallel treatments/therapists per
patient via a new `Assignments` sheet + «שיבוץ ותוכנית» editor; «רישום מטופל חדש»
is dashboard-only and flows to שיבוץ; label fixes. Full notes:
[`CHANGELOG-iteration5-structural-fixes.md`](CHANGELOG-iteration5-structural-fixes.md).

## Iteration 4 — personal view + did-it-happen + outpatient write-back

New «המטפל שלי» tab (no-PIN per-therapist view, mark happened/didn't-happen →
payment trigger), did-it-happen write-back to outpatient's new
`recordTreatmentGiven` endpoint (idempotent, group=one therapist payment,
offline-safe with «סנכרן עכשיו» retry), and four fixes (ליווי יומי בקהילה
selectable, new patient flows to שיבוץ, filter by therapist+patient). Full notes:
[`CHANGELOG-iteration4-personal-view-writeback.md`](CHANGELOG-iteration4-personal-view-writeback.md).

## Iteration 3 — restructure from real-use feedback

2 tabs (דשבורד מטופלים + שיבוץ מטפלים, Plans merged into the dashboard), access
simplified to one editor code + viewer (assigner role removed), full
«רישום מטופל חדש» intake with origin/still-admitted + an editable main plan,
therapist-dropdown + edit-button fixes, מרכז יום→ליווי יומי בקהילה display
relabel, expanded Sheet lists, and a lighter slate-blue theme. Full notes:
[`CHANGELOG-iteration3-restructure.md`](CHANGELOG-iteration3-restructure.md).

## Iteration 2 — scheduling redesign

Redesigned from treatment-logging into a scheduling app (self-scheduled
follow-up treatments, treatment type + location + date, per-patient attendance,
group sessions, post-scheduling debt alerts, Sheet-driven active-flagged
therapist/type lists, cyan accent). Security architecture unchanged. Full notes:
[`CHANGELOG-scheduling-redesign.md`](CHANGELOG-scheduling-redesign.md).

## Scaffold — backend, core modules, tests (step 1)

Initial scaffold of the `ezone-therapists` app, following sibling conventions
(`ezone-outpatient`) verbatim.

### Server
- `server.js` — Express server carried over from outpatient (static frontend,
  `/api/sheets` proxy to this app's own Apps Script, in-memory `getData` cache
  with stale fallback, `/api/debug/*` endpoints, `__BUILD__` cache-bust). Added
  **cross-app proxy routes** that inject shared secrets server-side so the
  browser only ever calls relative `/api/...` and never sees a secret:
  - `GET /api/debt-status` → outpatient `getDebtStatus` (`DEBT_STATUS_SECRET`).
    **Never cached** — a debt decision must be live.
  - `GET /api/treatment-plans` → outpatient `getTreatmentPlans`
    (`TREATMENT_PLANS_SECRET`).
  - `GET /api/admitted` → dashboard `getAdmittedRoster` (`OCCUPANCY_SECRET`).
  - `proxyGet` is never-fail-open: upstream/parse errors return `ok:false`/502
    so the consumer treats them as "couldn't determine", never "clear".
  - `app.start()` exported and `app.listen` guarded by `require.main` so tests
    own the server lifecycle.
- `package.json`, `Procfile`, `railway.json`, `.gitignore` — Nixpacks/Railway
  config, express-only deps, `node --test`.

### Core logic modules (framework-free, browser + Node)
- `public/phone.js` — the patient-matching key. Strict canonical **input**
  validation (`/^0\d{9}$/`, no silent reformat) kept separate from tolerant
  **legacy matching** normalization (strip separators; `+972`/`972` → `0`).
- `public/debt-gate.js` — the never-fail-open tri-state gate composing the
  phone match with outpatient `debtStatus`. Five outcomes; only `clear` +
  exactly one match allows a silent save. `debt` blocks (approval), everything
  else (`unknown`, no match, multi-match, lookup failure) flags.
- `public/approval.js` — debtor-override stamp restricted to Ron (רון) / Sandra
  (סנדרה); captures patient, therapist, approver, note, timestamp, amount owed.

### Tests (`npm test`, 25 passing)
- `test/phone.test.js` — canonical validation + legacy normalization/matching.
- `test/debt-gate.test.js` — all five tri-state outcomes incl. multi-match and
  lookup failure never collapsing to allow.
- `test/approval.test.js` — approver allowlist + full audit stamp.
- `test/sheets-secret-forwarding.test.js` — each cross-app proxy forwards the
  correct action + secret to the correct sibling URL, and secrets don't leak
  across routes.

### Notes / flagged findings
- Tri-state value names follow the **real** outpatient `getDebtStatus` contract
  (`clear`/`debt`/`unknown`), not the kickoff's `clear`/`owes`/`not_found`. The
  mapping is documented in `public/debt-gate.js`.
- Three sibling-side dependencies are unmerged; tracked in `README.md` and
  `docs/`. The debt gate cannot work end-to-end until outpatient PR #14 is
  merged and the Apps Script redeployed.
