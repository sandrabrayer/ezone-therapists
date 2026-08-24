# Changelog

## New house: רעננה הפרדס (canonical id `pardes`)

The fifth E-ZONE house (רעננה הפרדס, תחלואה כפולה) is now selectable everywhere
this app enumerates houses. SW cache v16.

- **`public/houses.js` (new)** — house/location enumerations extracted from
  `app.js` into a single testable UMD module: scheduling `LOCATIONS` (already
  contained רעננה הפרדס as `raanana_pardes` since iteration 10 — unchanged, the
  id is stored on live bookings), intake `ORIGIN_HOUSES` (**now includes
  `pardes` / רעננה הפרדס**, placed before the non-house `external`), the legacy
  location relabels, and both label helpers. The module documents the
  canonical↔internal key mapping for all five houses (`asher`, `ramot`,
  `arfoni`, `rehab`, `pardes`).
- `public/app.js` — consumes `window.Houses` instead of inline lists; behavior
  otherwise unchanged. Unknown stored ids still render verbatim (honest
  fallback, never an error), so pre-existing rows are unaffected.
- `public/index.html` — loads `houses.js` before `app.js`;
  `public/sw.js` cache bumped v15 → v16 so installed clients refetch the shell.
- **No Apps Script change** — the Sheet is row-keyed (no per-house tabs) and
  stores `location` / `admittedHouse` as pass-through values, so no backend
  redeploy is needed.
- Tests: `test/houses.test.js` guards that every enumeration covers the
  canonical 5-house list, that stored ids stay frozen, the honest unknown-id
  fallback, and the index.html/app.js wiring; `test/guide.test.js`'s SW pin
  relaxed to a ≥ v15 floor.

## In-app user guide

Added in-app user guide (guide.html) + header link; SW cache v15.

- `public/guide.html` — static RTL Hebrew user guide (מדריך משתמש), dark theme
  matching the app; no scripts, no data access, only the existing Google Fonts
  stylesheet.
- Header: a «מדריך» link in the top bar (visible on all tabs) opens the guide;
  the guide's «חזרה לאפליקציה» link returns to the app.
- `public/sw.js` — `./guide.html` added to the precache shell; cache bumped
  v14 → v15 so installed clients pick up the new shell (guide works offline
  after first visit).
- Tests: `test/guide.test.js` guards the guide's presence/RTL, the header link,
  and the SW precache + v15 version.

## Follow-up tasks (משימות מעקב) — phase 2

Per-patient follow-up tasks with due dates + an overdue badge, inside the
existing «ניהול מטופל» panel. No financial data anywhere in this feature.

**Backend (`apps-script/Code.gs`)** — new APPEND-ONLY sheet `FollowUps`
(`phone | id | createdAt | createdBy | dueDate | text | done | doneAt | doneBy`;
`id` server-generated, timestamp-based). Four actions, gated by the **existing**
`PATIENT_MGMT_SECRET` (no new secret), fail-closed:
- `getFollowUps(phone)` → `{ open, done }` — open sorted by dueDate ascending,
  done by doneAt descending
- `addFollowUp(phone, createdBy, dueDate, text)` — canonical phone, non-empty
  text, valid ISO `dueDate`; server stamps `id`/`createdAt`
- `setFollowUpDone(phone, id, done, doneBy)` — single-row update by id, under
  `LockService`
- `getOpenFollowUpCounts()` → `{ phone: {open, overdue} }` for **all** patients
  in **one** read (the per-card badge source — no N per-card calls)

**Node (`server.js`)** — `GET /api/followups/:phone`, `POST /api/followups`,
`POST /api/followups/done`, `GET /api/followup-counts`. Secret injected
server-side; phone validated before forwarding; fail-closed when the secret is
unset.

**UI** — a «משימות מעקב» subsection in the panel: add form (text + due date),
open list (overdue rows highlighted, due date DD/MM/YYYY, checkbox to mark done),
and a collapsed «משימות שהושלמו» list. Empty text / invalid date are blocked
client-side with inline RTL errors. A per-card **amber-red «מעקב באיחור» badge**
next to the status chip when overdue > 0, populated from the one bulk
`/api/followup-counts` fetch at list load. **Overdue = dueDate < today (local)
and not done** — a task due *today* is not overdue.

**Shared logic** lives in `public/patient-mgmt.js` (validation, `isISODate`, the
overdue boundary, the counts aggregation) mirrored inline in `Code.gs`, and
`public/patient-mgmt-ui.js` (DD/MM/YYYY formatting, badge visibility). Service
worker cache bumped **v13 → v14**.

**Tests** (20 new): backend validation + enum, done-toggle single-row, counts
aggregation with the due-today boundary, fail-closed on all four routes, the
`FollowUps` header-order guard, and UI helpers (overdue boundary, DD/MM/YYYY,
badge visibility). Full suite 400 passing; verified end-to-end in a headless
Chromium run (badge at load → add task → mark done moves it to done and clears
the badge).

## PWA icons — recolored to the app's fuchsia-on-plum identity

The home-screen / PWA icons were the E-ZONE "e" brand glyph in a neon
`#ff2fd6` on a teal-black `#071410` — off from the running app's plum `--bg`
(`#2c1a28`) and `--accent-vivid` fuchsia (`#e873bc`). Regenerated the full icon
set (192, 512, and 512 maskable — every size the manifest references) so the
icon reads as the same brand as the app.

Reproducible + committed, no hand-made binaries: `scripts/recolor-icons.js`
(the existing "outpatient recipe" — a per-pixel blend-remap that preserves the
brand glyph's exact shape and anti-aliasing, only shifting hue) retargeted to
`NEW_BG = #2c1a28` / `NEW_LOGO = #e873bc`. Re-run with `node scripts/recolor-icons.js`.
The glyph is **not** redrawn — same mark as before (and as the outpatient app),
now rose/fuchsia instead of green, matching the in-app logo text color
(`var(--green-2)` = `#e873bc`).

Icon filenames are unchanged (`icon-v2-192/512/maskable.png`), so the
manifest / `index.html` / SW precache references need no edit; the
service-worker cache is bumped **v12 → v13** so installed clients pull the new
icons. `manifest` `theme_color` / `background_color` already match the current
dark token (`#2c1a28`) — left as-is.

Tests: `test/icon-rebrand.test.js` retargeted to the `#2c1a28` / `#e873bc`
palette (dominant-background, logo-presence, exact-color, and maskable
dark-corner pixel guards), plus a new guard that **every manifest icon (and the
apple-touch-icon) exists on disk**. The generation script is a dev tool, not run
in CI. Full suite 381 passing.

## style.css — de-duplicate the concatenated stylesheet

`public/style.css` had accumulated **two full copies** of the base stylesheet
concatenated (two `:root` blocks), with the later single-copy blocks (spinners,
treatment dates, the ניהול מטופל panel) appended once at the end. The first copy
(lines 1–870) was an **older** version: 254 of its selectors were byte-identical
to the second copy, and 16 diverged — always with the first copy holding the
*older* value (pre-fuchsia palette, smaller fonts, no `.assign-row-assigned`).
Because that first copy sat entirely earlier in the cascade, the second copy
already won every conflict, so the first copy was **fully-overridden dead code**
and defined **zero** selectors that don't also appear later.

Removed the first copy (the 870 duplicated lines), keeping the second copy + all
appended blocks — the file drops from 2170 to 1300 lines (~40% smaller). This is
a **zero-visual-change** cleanup: a before/after full-page dashboard screenshot
rendered in headless Chromium is **byte-identical**, and the selector analysis
proves no computed style can change (nothing unique was lost; the removed rules
were already overridden). Brace count stays balanced (464/464); one `:root`
remains.

Service-worker cache bumped **v11 → v12**. `test/palette.test.js` updated: the
palette-var and vivid/hot-accent assertions now expect **one** occurrence each
(they previously asserted two — an artifact of the duplication) and the SW-cache
guard tracks v12.

## Patient management panel (ניהול מטופל) — readability + «ממשיך לעוד חודש» status

Two refinements on the step-2 panel.

**Readability.** The «ניהול מטופל» panel header and the notes/meta subsection
titles were too pale (`--accent-2`, 11–12px). They now use the fuchsia accent
`#e873bc` at 13px/600, and the meta field labels move from the muted token to
the primary `--text-soft` — all scoped to the patient-management panel, no
global-token change. The note type tags are slightly brighter for AA contrast.

**New status «ממשיך לעוד חודש».** A `continuing` value is added to the status
enum across all four layers, kept 1:1: `public/patient-mgmt.js` (source of
truth), the `apps-script/Code.gs` `setPatientMeta` mirror (accepts `continuing`,
still rejects unknown values), `public/patient-mgmt-ui.js` (label map + chip),
and the app.js dropdown (auto-populated from the enum). Unlike `active`,
`continuing` **shows** a chip — a saturated **emerald** chip next to the debt
chip, distinct from the debt red/green, the sky scheduling accent, the fuchsia
accents, and the slate/mauve of מוקפא/הסתיים. The מוקפא (slate) and הסתיים
(mauve-gray) chips were also made a touch more saturated so the status stands
out, still clearly not the debt color.

Service-worker cache bumped **v10 → v11**. Tests updated: enum label-map/chip 1:1
(now four statuses), `continuing` chip class, and backend `setPatientMeta`
acceptance of `continuing` while unknown values are still rejected. Header-order
guards untouched (no sheet change). Full suite 380 passing.

## Patient management panel (ניהול מטופל) — UI (step 2)

The frontend for the per-patient management panel, on top of the step-1 backend.
Each patient card in «מטופלים ותוכנית טיפול» gains a collapsible **«ניהול מטופל»**
panel below the plan/schedule grid, styled in the fuchsia accent family (distinct
from the teal plan panel and the sky schedule panel), RTL, Rubik, dark theme.

**Lazy-loaded.** A card fetches its meta + notes only on the **first expand**
(standard loading spinner), then reads from per-session in-memory caches keyed by
normalized phone; a successful save refetches the authoritative row. The list
still opens with **zero** patient-management calls — no N per-card fetches.

**Meta form.** Status dropdown (פעיל / מוקפא / הסתיים) + reason, guardian
contact name/phone, referral (גורם מפנה / מסגרת), and goals (מטרות טיפול).
`contactPhone` is validated with the shared module (`/^0\d{9}$/` or empty) —
inline RTL error, save blocked. Optimistic save via `POST /api/patient-meta`
(`updatedBy` = the acting therapist, same source as the session-outcome flow),
with revert + inline error on failure and a muted «עודכן לאחרונה» line.

**Status chip.** A muted **מוקפא** (slate) / **הסתיים** (dim gray) chip next to
the debt chip (active = no chip). Distinct from the debt-warning red and the sky
scheduling accent, AA-contrast on the dark card. Rendered from cached meta only
— it appears after the first expand, never triggering a load on its own.

**Notes log.** Newest-first list (author, tinted type tag קלינית /
אדמיניסטרטיבית / קשר עם משפחה / אחר, Hebrew relative date with the absolute
date on hover, text) + an append-only add form (type dropdown + textarea; empty
text blocked client-side). No edit/delete UI.

**New pure modules** (framework-free, unit-tested, mirrored globals):
`public/patient-mgmt-ui.js` — enum↔Hebrew label maps (1:1 with the canonical
enums), the status-chip class logic, a Hebrew relative-date formatter
(«היום» / «אתמול» / «לפני יומיים» / «לפני N ימים» / absolute DD/MM/YYYY), and
the contactPhone UI guard (reuses `phone.js`, no duplicate regex). Wired into
`app.js` (lazy fetch/render, optimistic save, delegated events on the stable
`#patientsList`).

**PWA.** Service-worker cache bumped **v9 → v10** so the new assets take on a
plain refresh.

**Tests** (`test/patient-mgmt-ui.test.js`, `node --test`): label maps complete +
1:1 with the enums; status-chip mapping; relative-date cases (today / yesterday /
N days / absolute fallback / unparseable); contactPhone guard (empty ok,
canonical ok, separators / 9-digit / +972 rejected). Full suite: 380 passing.

## Patient management panel (ניהול מטופל) — backend (step 1)

Backend for the per-patient management panel: an **append-only notes log**
(יומן הערות) and an **editable patient-meta** row. No UI yet — that ships in a
separate step-2 PR — so this change is safe to deploy on its own.

**Apps Script (`apps-script/Code.gs`)** — two new sheets, created lazily via the
existing `_ensureSheet` init with APPEND-ONLY headers:

- `Notes` — `phone | timestamp | author | type | text`
- `PatientMeta` — `phone | status | statusReason | statusDate | contactName | contactPhone | referral | goals | updatedBy | updatedAt`

Four new actions (routed in both `doGet` for reads and `doPost`):

- `getPatientNotes(phone)` → the patient's notes, **newest first**
- `addPatientNote(phone, author, type, text)` → appends one row; the **server**
  stamps the ISO `timestamp` (a client clock is never trusted). Rejects a
  non-canonical phone, a `type` outside `clinical|admin|family|other`, or empty
  text.
- `getPatientMeta(phone)` → the single row, or empty defaults (`status:"active"`)
- `setPatientMeta(phone, fields, updatedBy)` → **single-row upsert by phone**
  (via `_upsertByKey`, not a full-sheet rewrite), **last-writer-wins** with
  `updatedBy`/`updatedAt` stamped on every save. Guarded by `LockService`.

All four are **fail-closed** on a shared secret `PATIENT_MGMT_SECRET` (Script
Properties): a missing property, or a missing/wrong provided secret, is an error
— never an open read/write. Phone validation is server-side (`/^0\d{9}$/`), with
the existing leading-zero recovery applied to values read back from Sheets.

**Node/Express (`server.js`)** — four proxy routes inject `PATIENT_MGMT_SECRET`
(a Railway env var) server-side so it never reaches the browser:
`GET /api/patient-notes/:phone`, `POST /api/patient-notes`,
`GET /api/patient-meta/:phone`, `POST /api/patient-meta`. Each validates the
phone (and, on meta, a non-empty `contactPhone`) **before** forwarding (defense
in depth) and is fail-closed when the secret is unset.

**Shared module** — `public/patient-mgmt.js` is the single source of truth for
the header order and validation rules (`validateNote` / `validateMeta`, the type
and status enums), mirrored inline in `Code.gs` (same pattern as `phone.js` /
`treatment-guard.js`).

**Tests** (`node --test`) — `test/patient-mgmt.test.js` (type-enum + empty-text
rejection, phone accept/reject incl. separators / 9-digit / +972, leading-zero
recovery round-trip, status enum, contact-phone rule, and a **header-order
guard** asserting the module and the `Code.gs` mirror agree exactly),
`test/patient-mgmt-routes.test.js` (secret injected server-side, phone validation
before forwarding, secret never echoed), and `test/patient-mgmt-failclosed.test.js`
(every route is a clear 500 and never calls the sibling when the secret is unset).

**CI** — new `.github/workflows/tests.yml` runs the suite on pushes to and PRs
targeting the deployed branch (`claude/inspiring-tesla-jipobw`; main is not
deployed). The clasp deploy (`deploy-apps-script.yml`) now gates its `deploy`
job on a `test` job (`needs: test`) so a red test can never redeploy the live
Apps Script.

**Config to set before use:** `PATIENT_MGMT_SECRET` as a Script Property on the
therapists Apps Script AND as a Railway env var (same value). Until both are set,
the routes fail closed (clear 500) and nothing is read or written.

## Dashboard — outpatient treatment start/end dates on the patient card

Each patient card's «תוכנית טיפול» panel now shows the outpatient **treatment
period**: «תחילת טיפול» (start) and «סיום טיפול» (end), formatted **DD/MM/YYYY**.
Missing or unparseable dates render the «—» placeholder (never blank,
`undefined`, or `null`) — an active patient has no end date yet, so «סיום טיפול»
shows «—» until discharge.

Data path: the dates are the outpatient Clients `startDate` / `exitDate`,
delivered by `getTreatmentPlans` and surfaced on the roster item as
`treatmentStartDate` / `treatmentEndDate`. New pure module
`public/treatmentdates.js` does the display formatting (guarded by
`test/treatmentdates.test.js`: valid, ISO, missing, malformed, out-of-range);
`public/roster.js` carries the two dates from the plan source through the
phone-keyed merge (new passthrough tests in `test/roster.test.js`).

**Backend dependency (outpatient Apps Script):** the `_getTreatmentPlans()`
projection must add `startDate` and `exitDate` to its `out.push({…})` object —
both columns already exist on the Clients sheet and are already read into `cl`,
so it is a two-line addition with no sheet schema change. See
`docs/DEPENDENCIES.md`. Until that ships and the outpatient Web App is
redeployed, both dates display «—» harmlessly — the frontend is safe to deploy
first.

## CI — Apps Script deploy: post-deploy anonymous smoke check

Added a guardrail after the redeploy step in `deploy-apps-script.yml` so a lost
**"Anyone, even anonymous"** access on the Web App fails CI immediately instead
of shipping silently. Context: the sibling **ezone-staffing** app had exactly
this outage on 2026-07-30 — ~12 min after a green `clasp deploy`, its `/exec`
started serving Google's sign-in HTML instead of JSON (consumers got the
`accounts.google.com` login page); root cause is a Google-side side effect of
minting a **new Web App version programmatically**, which does not reliably
carry over anonymous access even though the committed `appsscript.json`
(`ANYONE_ANONYMOUS` / `USER_DEPLOYING`) is correct. This repo's deploy is the
same shape (`clasp push -f` → `clasp deploy -i <DEPLOYMENT_ID>`), so it has the
same exposure. The new step `curl`s the `/exec` URL **anonymously** (follows
redirects) and requires a JSON body — a healthy app returns JSON even
unauthenticated (e.g. `{"error":"unauthorized"}`), while a broken one redirects
to `accounts.google.com` / `ServiceLogin` and returns HTML. It **retries up to
3× with 20s gaps** (propagation lags a deploy) and, on failure, prints a loud
`::error::` with the exact click-path to restore access (script.google.com →
open the project → Deploy → Manage deployments → pencil → Version = New version
→ Who has access = Anyone → Deploy) and exits 1. The `/exec` URL is read from a
non-secret repository **variable** `APPS_SCRIPT_EXEC_URL` (Settings → Secrets
and variables → Actions → Variables tab), never hardcoded; if it is unset the
step fails loudly telling you to add it. **The `clasp push` and `clasp deploy`
steps are UNCHANGED.** CI/tooling only.

## CI — Apps Script deploy: guard against clasp 3.x false-green redeploy

Hardened the redeploy step: clasp 3.x can print a rejection (e.g. `Invalid
deployment ID`) and still exit 0, which made a **no-op redeploy report success**.
The step now trims stray whitespace from `DEPLOYMENT_ID`, requires clasp's
`Deployed …@<version>` confirmation, and on failure prints `clasp list-deployments`
and exits non-zero — so a rejected/incorrect deployment ID fails loudly instead of
passing as green. `DEPLOY.md` gains guidance for finding the correct `AKfyc…` ID.
CI/tooling + docs only.

## CI — Apps Script deploy: manual trigger + pin clasp 3.x

Added a `workflow_dispatch` trigger to `deploy-apps-script.yml` for on-demand
runs, and switched the pinned clasp version from `2.4.2` to **`3.3.0`** so CI
matches the clasp 3.x major that produced the `CLASPRC_JSON` secret (clasp 3.x's
`~/.clasprc.json` is a different, per-user-keyed format that clasp 2.x cannot
read — the mismatch surfaced as `Error retrieving access token: Cannot read
properties of undefined (reading 'access_token')`). `clasp push -f` and
`clasp deploy -i <DEPLOYMENT_ID>` are unchanged (`deploy` is a 3.x alias of
`create-deployment`, still `-i/--deploymentId` + `-d/--description`), so the
deploy still publishes a **new version of the existing deployment** and the
`/exec` URL stays stable. Runner Node bumped 20→22. `DEPLOY.md` updated for the
3.x version + credential-format note. CI/tooling + docs only.

## CI — auto-deploy Apps Script via clasp (new version of the existing deployment)

Added a GitHub Actions workflow (`.github/workflows/deploy-apps-script.yml`) that,
on every push to the deployed branch `claude/inspiring-tesla-jipobw` touching
`apps-script/**`, runs `clasp push -f` then `clasp deploy -i <DEPLOYMENT_ID>` —
publishing a **new version of the EXISTING deployment** so the `/exec` URL never
changes and the outpatient/dashboard consumers keep working. This automates the
previously manual (and occasionally mis-done) redeploy step from
`EZONE-ECOSYSTEM-STATUS.md`. New `.clasp.json` (Script ID + `rootDir: apps-script`)
and `apps-script/appsscript.json` (manifest). Credentials come **only** from the
GitHub Secrets `CLASPRC_JSON` and `DEPLOYMENT_ID`; the workflow fails loudly before
touching the live deployment if either is missing, deletes the runner's credential
file afterwards, and `.clasprc.json` is git-ignored. A second workflow
(`.github/workflows/validate-workflows.yml`) validates that all workflow YAML is
parseable. Full flow + one-time secret setup in the new `DEPLOY.md`; details in
[`CHANGELOG-apps-script-ci.md`](CHANGELOG-apps-script-ci.md). **CI/tooling + docs
only — no app code/schema/runtime change.** ⚠️ The deploy workflow will fail until
both secrets are added (see `DEPLOY.md`).

## Docs — EZONE-ECOSYSTEM-STATUS.md at repo root

Added `EZONE-ECOSYSTEM-STATUS.md` at the repo root — the July 4 merged cross-app ecosystem status doc, distributed to the root of all six E-Zone repos so every project/session starts from the true state. Docs-only; no code, schema, or Apps Script change.

## Admin cleanup — delete orphaned scheduled sessions (one-time)

New one-time admin function **`cleanupOrphanedScheduledSessions()`** in
`apps-script/Code.gs` removes leftover **Schedule** rows whose patient was already
deleted (their **Patients** row is gone), which still rendered under
«טיפולים שנקבעו». A row is orphaned when its `patientPhone` matches **no** patient
in the Patients sheet, using the app's tolerant match (`_matchPhone` — recovers a
Sheets-dropped leading zero, then normalizes). Per row: exactly **one** matching
patient → **keep** (live, never deleted); **zero** (valid phone) → **delete**
(orphaned); **>1** matching rows or an **empty/invalid** phone → **keep + flag** in
the log (ambiguous → never fail open). Deletes by **orphaned-patient match only** —
never by date or status — so real future sessions of live patients are untouched.
Each deleted row is logged (patient, therapist, date, phone) **before** deletion;
deletes bottom-up; returns the deleted count; idempotent. Not exposed via
`doPost`/`doGet` — run **once from the Apps Script editor**. New
`test/orphan-cleanup.test.js` (pure decision mirror + Code.gs mirror-guard); suite
**251/0**. **Apps Script change** — paste the merged `Code.gs`, deploy a new
version of the existing deployment (keep the `/exec` URL), then run the function
once and verify the deleted-row count in the execution log. Full notes:
[`docs/admin-cleanup-orphaned-sessions.md`](docs/admin-cleanup-orphaned-sessions.md).

## Schedule modal — restrict to assigned patients + lock the plan type

Closes a generic-toolbar bypass in «קביעת טיפול». Opened from `#mineScheduleBtn`,
the modal let a therapist autocomplete over the **whole** roster. Now the schedule
patient pickers (`.patient-name-dl`) offer **only patients assigned to the
therapist** (`p.therapists.indexOf(state.therapist)!==-1`, the `renderMine` rule)
— individual **and** group — with a submit-time check that blocks an unassigned
patient (incl. inside a group) via «ניתן לקבוע טיפול רק למטופל/ת המשויך/ת אליך»; a
therapist with none sees «אין לך מטופלים משויכים» + disabled submit. The
schedule-modal treatment-type lock is now **assignment-based**
(`planLockState`/`refreshTypeLock` over `Scheduling.assignedTypesForPatient`): one
type → read-only; several → pick among only those; none → blocked (never fail
open). This **supersedes the earlier schedule-side `scheduleLockedType`** only —
the **שיבוץ assignment-modal plan lock is untouched** (`planForPhone`,
`Plan.assignmentPayload`, the read-only `a-type-lock`/`a-freq-lock` rows from
iteration 19 all remain). `readSession` reads the type from the live select so a
locked/disabled control still submits; group sessions keep a selectable shared
type. New pure `public/scheduling.js` helpers (`assignedToTherapist`,
`assignedTypesForPatient`, `planLockState`, `validateScheduledPatients`) +
`test/scheduling.test.js` (+8). **Frontend-only — no backend/secret/redeploy.**
Suite **241/0**. Full notes:
[`CHANGELOG-schedule-assigned-restriction.md`](CHANGELOG-schedule-assigned-restriction.md).

## Iteration 19 — lock שיבוץ + scheduling to Vered's approved outpatient plan (per treatment type)

The therapists app is now **fully READ-ONLY on the treatment plan**. The
**approved outpatient plan** (`getTreatmentPlans` → `state.plans`) is the
**single source of truth** for a patient's **treatment types** and their
**per-type weekly frequency**. A plan can hold **several types** (the `sessions`
JSON-blob **keys ARE the types**, e.g. `{"מרכז יום":3,"טיפול משפחתי":1}`), each
with its own frequency and its own therapist — so the plan is projected as a
**LIST of `{treatmentType, frequencyPerWeek}`** and the שיבוץ modal renders **one
locked row per type** (read-only type+freq, editable therapist + weekly slots, no
free add/remove). Neither the שיבוץ modal nor the "המטופלים שלי" `+ קביעת טיפול`
flow lets a user pick or edit type/frequency; both flows **BLOCK** (never fail
open) when there is no single approved plan to read (no match / ambiguous
multi-match / zero types → "אין תוכנית טיפול מאושרת…"; plans endpoint down → "לא
ניתן לאמת…"). New pure **`public/plan.js`** (`forPhone` → per-type array /
`typesFromSessions` — keys are types, **not summed** / `blockMessage` /
`assignmentPayload` — type+freq **forced** from one plan-type entry) +
`test/plan.test.js` (**+20**). `saveAssignments` saves one payload per type;
scheduling locks to the **specific** plan type the therapist is working and
`handleScheduleSubmit` validates the session type is one of the patient's plan
types. The "המטופלים שלי" patient filter is **preserved exactly**. **`public/` +
tests only** — `_saveAssignment` already persists the payload's
`treatmentType`/`frequencyPerWeek`, so **no Apps Script change/redeploy**;
deploys via Railway on commit. Full notes:
[`CHANGELOG-iteration19-lock-plan.md`](CHANGELOG-iteration19-lock-plan.md).

## Cross-app data integrity — canonical assignment phone + delete propagation

Two integrity fixes keeping the therapists and outpatient apps in sync.
**(a)** `_saveAssignment` (`apps-script/Code.gs`) now canonicalizes `patientPhone`
exactly like `_savePatient` — reject empty (`missing_phone`), then
`_toCanonicalPhone` (reject non-canonical as `invalid_phone`), and **store the
canonical value**. Previously it stored the raw trimmed phone, so an assignment
could key by a different phone than its patient and the roster union
(`public/roster.js`) split one patient into two — the **רון מנחם** bug.
**(b)** Deleting a patient (`_removePatient`) now **propagates** to outpatient:
new **`_postDeactivateClient`** sends a server-to-server `deactivateClient` POST
(canonical phone + the **dedicated, new** `DEACTIVATE_CLIENT_SECRET`, never reused
from `STOP_FLAG_SECRET`; the secret never reaches the browser). It runs
**fail-closed before** the local row delete, so a patient is never removed here
while still active on Vered's side, and is **orphan-safe** (no matching Client →
`deactivated:0`, local delete proceeds). We **deactivate, not hard-delete** — it's
reversible, preserves outpatient billing/session history, and `getTreatmentPlans`
already filters by status, so the deactivated Client drops out of the roster union
instead of re-appearing. New pure **`public/delete-sync.js`** (`buildPayload` /
`interpretResponse`, mirrored by `_postDeactivateClient`) + `test/delete-sync.test.js`
(+18, suite **213/0**). Receiver contract (dep #8) ships as a **separate outpatient
PR** into `claude/youthful-volta-laarnk`:
[`docs/outpatient-deactivateClient.patch.md`](docs/outpatient-deactivateClient.patch.md).
**Needs the `DEACTIVATE_CLIENT_SECRET` Script Property on both Apps Scripts + a
therapists Apps Script redeploy**; no new Railway env var (Apps Script → Apps
Script). Full notes:
[`CHANGELOG-cross-app-data-integrity.md`](CHANGELOG-cross-app-data-integrity.md).

## Iteration 18 (step 3) — push the session outcome to outpatient pay

On a successful outcome save, the marked **session outcome** is now pushed to the
outpatient app's **`recordSessionOutcome`** endpoint, which computes therapist
**pay / session status per outcome** and upserts by `sessionId`. New
**`_postSetSessionOutcome`** in `apps-script/Code.gs` fires from
`_setSessionOutcome` **after** the local stamp commits and **outside** the lock —
same server-to-server pattern as `_postSetClinicalType` / `_postFlagStop`
(`UrlFetchApp` → `OUTPATIENT_SHEETS_URL` + the **`SESSION_OUTCOME_SECRET`** Script
Property; the secret **never reaches the browser**). Fires on **all three**
outcomes (`happened` / `therapist_cancelled` / `patient_no_show`) with the
canonical-phone payload `{ action, secret, sessionId, phone, therapist,
clinicalTreatmentType, date, outcome }` (`frequency` is **not** sent — the
Schedule row doesn't carry it; outpatient handles its absence, e.g. for ליווי).
**Fail-open-with-flag** like the clinical-type push: the outcome **always saves
locally**; the push result is attached as `outcomeSync` and a failure
(`unknown_therapist` / `unknown_type` / `unauthorized` / `unconfigured` /
`http_*` / `unreachable` / `non_ok`) surfaces a Hebrew warning toast — never
swallowed; only the pay-sync is flagged. **Idempotent**: re-marking re-sends the
same `sessionId`; outpatient upserts. New pure **`public/outcome-sync.js`**
(`buildPayload` / `interpretResponse` / `warningFor`, mirror of `clinical-sync.js`)
+ `test/outcome-sync.test.js`; full suite green. **Needs the
`SESSION_OUTCOME_SECRET` Script Property + a therapists Apps Script redeploy**; no
new Railway env var (push is Apps Script → Apps Script). Receiver contract:
[`docs/outpatient-recordSessionOutcome.patch.md`](docs/outpatient-recordSessionOutcome.patch.md).
Full notes:
[`CHANGELOG-iteration18-step3-session-outcome-push.md`](CHANGELOG-iteration18-step3-session-outcome-push.md).

## Iteration 18 (step 2) — three-state session outcome (storage-only)

The therapist now marks each session instance with an explicit **3-state
outcome** — **`happened`** (התקיים) / **`therapist_cancelled`** (המטפל ביטל /
לא הגיע) / **`patient_no_show`** (המטופל לא הגיע) — replacing the old binary
happened/didn't pair in «המטופלים שלי». New pure **`public/outcome.js`** (closed
value set + `buildOutcome` stamp, mirrored by `apps-script/Code.gs`) and a new
**`_setSessionOutcome`** action that validates against the three values
(`invalid_outcome` otherwise) and stamps **patient, therapist, treatmentType,
date, outcome, timestamp** onto two new appended `Schedule` columns
(`outcome`, `outcomeAt`). **Storage-only**: no debt gate, no pay computation, no
outpatient write-back — wiring the outcome to pay / the outpatient receiver is
**step 3**, so the legacy `attendance` + `writeback.js` path is left intact and
untouched. New `test/outcome.test.js`; full suite green. **Needs an Apps Script
redeploy** (new columns + action); no new Railway env vars. Full notes:
[`CHANGELOG-iteration18-session-outcome.md`](CHANGELOG-iteration18-session-outcome.md).

## Iteration 17 — clinical billing-type push + nested פרטני menu

On assignment save, the patient's **clinical treatment type** is pushed to the
outpatient app (`setClinicalType`) so its per-patient billing rate follows the
clinical plan picked here. New `_postSetClinicalType` in `apps-script/Code.gs`
fires from `_saveAssignment` after the local upsert (outside the lock), same
server-to-server `UrlFetchApp` pattern as `flagStop` — secret
**`CLINICAL_TYPE_SECRET`** read from a Script Property, never sent to the browser,
phone sent as the canonical 10-digit key. **Fail-open-with-flag** (not fail-closed
like the stop flow): the assignment always saves locally; only `{ok:true,matched:1}`
proceeds silently, while `no_match` / `multi_match` / `unknown_type` / unreachable /
unconfigured each **warn** the user that billing-type sync failed (and why) — never
swallowed. Also: the 5 individual-billing types (פסיכודינמי, פסיכותרפי ממוקד טראומה,
עיסוי טיפולי, טיפול ממוקד התמכרויות, טיפול אינטגרטיבי) are nested under one
**פרטני** `<optgroup>` in the picker — **display only**, the saved value stays the
specific clinical name. New pure `public/clinical-sync.js` (mirrored by `Code.gs`,
used by `app.js`) + `test/clinical-sync.test.js`. Needs `CLINICAL_TYPE_SECRET` on
**both** Apps Scripts + the outpatient receiver (dep #6) + a redeploy on both sides.
Full notes:
[`CHANGELOG-iteration17-clinical-type-push.md`](CHANGELOG-iteration17-clinical-type-push.md).

## Iteration 16 — true weekly recurring pattern

A therapist sets a **weekly recurring pattern once per assignment** — N slots
(N = `frequencyPerWeek`), each `{weekday, time, location}` — stored as an appended
`slots` JSON column on `Assignments`. `Recurring.generateOccurrences` (new pure
`public/recurring.js`) materializes the **coming week's** occurrences for the
weekly «קרובים» view: **rolling, virtual** (never pre-written to the sheet) and
**idempotent** — each has a deterministic id `occ_<assignmentId>_<YYYYMMDD>_<HHMM>`
(= Schedule id = write-back `treatmentId`), so re-viewing never duplicates.
Reporting is unchanged: on report the backend **materializes** the row (create-only,
idempotent) then runs the same report-time debt gate (materialization itself
ungated). Stopped/discharged patients produce no occurrences. Pattern editor lives
in the assignments modal. Full notes:
[`CHANGELOG-iteration16-recurring-pattern.md`](CHANGELOG-iteration16-recurring-pattern.md).

## Iteration 15 — stop-flow fixes (local move + rename)

Renamed the dashboard section to **«מטופלים שביקשו לסיים טיפול»** (it's a request
pending Vered, not a completed discharge). **Fixed the local move:** the stop
backend matched rows from the raw sheet grid **without** the iteration-13
leading-zero recovery, so for a patient whose stored phone was mangled
(`501234567`) the canonical key `0501234567` never matched — the existing Patients
row wasn't updated (a duplicate stopped row was appended) and their **future
bookings were never cancelled**, even though the flagStop POST succeeded. New
`_matchPhone` (recover-then-normalize) is now used on both sides in
`_markLocalPatientStopped` and `_cancelFutureBookings`; `stopflow.js`
`futureBookingsToCancel` recovers both sides too; new tested `splitStopped`
partition drives `activePatients`/`stoppedPatients`. Full notes:
[`CHANGELOG-iteration15-stop-flow-fixes.md`](CHANGELOG-iteration15-stop-flow-fixes.md).

## Iteration 14 — patient stop / discharge flow (sender)

The therapists side of the stop flow. A patient is "stopped" when **discharged in
outpatient** (`getTreatmentPlans` `status: "סיים טיפול"`) **or locally flagged**
via the new **«הפסקת טיפול»** action (Vered in שיבוץ, or a therapist on their
patient). The action POSTs `flagStop` to outpatient (a pending request Vered
confirms there) and — **fail-closed, only on a successful send** — sets a local
stop flag and cancels the patient's future unreported bookings (past + reported
kept). Stopped patients leave the active list (KPIs/שיבוץ/«המטופלים שלי») and
appear in a read-only dashboard **«מטופלים שהופסקו / סיימו טיפול»** section. New
pure `stopflow.js` (mirrored in `Code.gs`), unit-tested. **New config:** the
`STOP_FLAG_SECRET` Script Property on the therapists Apps Script (matches
outpatient's); reuses `OUTPATIENT_SHEETS_URL`; no new Node env var. Full notes:
[`CHANGELOG-iteration14-stop-flow.md`](CHANGELOG-iteration14-stop-flow.md).

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
