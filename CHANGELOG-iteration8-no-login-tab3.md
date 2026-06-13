# Changelog — iteration 8: remove login/roles, fix tab 3

A structural redo of access + tab 3. The treatment flow built in iteration 7 was
sound but buried behind a role/identity gate; this surfaces it and removes the
gate. **Frontend-only — no `Code.gs` change.**

## No login, no roles

- **Deleted the «מי את/ה?» identity screen.** The app opens directly to
  **דשבורד מטופלים**, with **all three tabs visible to everyone** (Vered and
  therapists alike). No PIN, no role, no edit-mode toggle, **no persistence**.
- Removed `state.role`, `ez_identity`, the role badge, and role-based tab gating.
  `public/access.js` is now just the canonical tab list (`tabs`, `defaultView`,
  `isTab`) — tests updated.
- Tab labels unchanged: **דשבורד מטופלים** / **שיבוץ מטפלים** / **המטופלים שלי**.
  Tab 2 stays plainly labeled (not marked "Vered's"); its actions (register / edit
  / assign) are open to all.

## Tab 3 — the therapist name picker is inside the tab

- The picker (`#mineTherapist`) lives **in the tab toolbar**, populated from the
  Sheet's therapist list. It's a **fresh pick every open** — never restored from
  storage.
- Until a name is picked: a **«בחר/י את שמך»** prompt shows and all panels are
  hidden. After picking, the tab shows the therapist's **assigned patients**
  (each with «+ קביעת טיפול»), the four buckets, and the report flow — all scoped
  to the picked name.
- **«טיפולים קרובים» now means the COMING WEEK** (today … today+7).
  `Scheduling.bucketMine(rows, today, weekEnd)` gained the `weekEnd` bound;
  overdue and beyond-the-week treatments fall into **«טיפולים שנקבעו»**.

## Bug fixed — blank/white dropdown

Root cause: the picker `<select>` wasn't inside a `.form-grid`, so it used the
**browser-default white background** while inheriting **light** text — the chosen
name was invisible (it *was* bound, just unreadable). Added a **dark base
`<select>` style** (background + readable text + matching `option`s), which fixes
the tab-3 picker, the schedule-modal therapist select, and the assignment selects.

## Guards

- `ensureTherapist()` now means **"a therapist name is selected"** (used by tab-3
  scheduling/report), not a role check.
- Removed `ensureVered()` — tab-2 actions are open to all.

## Tests

`npm test` — 72 passing. `access.test.js` rewritten for the tab list;
`scheduling.test.js` covers the coming-week window + the empty/no-bound cases and
tab-3 per-therapist scoping. Debt-gate / phone / approval / writeback unchanged.

## Deploy

**Frontend-only** — Railway redeploy + **Ctrl+Shift+R**. **No Apps Script
redeploy** this round. (The debt-block is still gated on ezone-outpatient PR #14 +
the therapists Apps Script Script Properties, unchanged.)
