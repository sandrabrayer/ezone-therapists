# Async loading spinners

## Why
The app talks to a Google Apps Script backend whose /exec endpoint can
**cold-start for 10–30 seconds**. Until data arrived, sections rendered as empty
"no data" lists and KPI tiles read a misleading `0`, with no signal that a load
was in flight — the app looked broken or empty rather than loading. Saves already
disabled their buttons, but gave no visible "working…" cue.

## What changed
A CSS-only spinner pattern, themed to the dark UI and the fuchsia accent
(`--accent-vivid` / `#e873bc`). No libraries, no images.

- **public/spinner.js (new)** — tiny framework-free, unit-testable helper:
  - `Spinner.html(label)` — accessible spinner markup (`role="status"`,
    `aria-live="polite"`, `aria-hidden` glyph); the optional label is
    HTML-escaped.
  - `Spinner.isInitialLoading(state)` — pure decision: show the whole-app
    first-load spinner only on the very first load (`initialLoading && !loaded`),
    never again once data has been seen.

- **public/app.js**
  - New state flags `initialLoading` and `stopAlertsLoading`.
  - **First load (the priority case):** `startApp()` sets `initialLoading` and
    calls `render()` **synchronously before** the first (possibly cold) Apps
    Script round-trip, so a spinner appears **immediately on open**, not after a
    delay. `render()` short-circuits to `renderInitialLoading()`, which paints an
    inline spinner into every section list (`#patientsList`, `#assignList`,
    `#scheduleList`, `#myPatientsList`, `#stopAlertsUnread`) and shows a neutral
    `…` placeholder in the KPI tiles instead of a premature `0`.
  - `loadOwn()` clears `initialLoading` on both success and failure (and
    re-renders on failure), so a spinner never sticks after an error.
  - **Tab re-pull:** opening «התראות טיפול» re-pulls the outpatient alerts; the
    list now shows a spinner (`stopAlertsLoading`) while that runs, keeping the
    prior alerts until fresh ones land.
  - **Save buttons:** new `setBtnBusy(el, busy)` toggles `disabled` **and** an
    `is-busy` class (inline CSS spinner). Wired into every save round-trip —
    schedule, session report, booking edit, weekly schedule, assignments, new/
    edit patient, and the "sync now" banner button — replacing the bare
    `disabled` toggles.

- **public/style.css** — `@keyframes ez-spin`, `.spinner-wrap` / `.spinner`
  (fuchsia head on a faint fuchsia track, matching `.billing-empty`'s surface so
  it drops into list containers cleanly), `.spinner-label`, and `.btn.is-busy`
  (white head on solid buttons, fuchsia head on ghost buttons). Respects
  `prefers-reduced-motion` (slows the spin rather than freezing a partial ring).

- **public/index.html** — loads `spinner.js` before `app.js`.

- **public/sw.js** — cache bumped `ezone-therapists-v8` → `v9` (stylesheet + new
  script changed, so the old shell cache must bust).

## Tests
- **test/spinner.test.js (new)** — covers `isInitialLoading` state logic
  (first-load true, post-load false, missing state) and `html` markup
  (accessibility attributes, label inclusion, label escaping).
- **test/palette.test.js** — updated the service-worker cache assertion to `v9`.
- Full suite: 309 pass. The only 4 failures are pre-existing, environmental
  (network/secret-dependent server suites) and fail identically on the untouched
  base branch.

## Deploy note
- Frontend only — Railway auto-deploy. No Apps Script redeploy. The SW cache bump
  ensures clients pick up the new stylesheet/script.
