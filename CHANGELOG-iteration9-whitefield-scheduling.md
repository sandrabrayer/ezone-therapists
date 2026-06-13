# Changelog — iteration 9: white-field fix + scheduling unblock

Two approved fixes (paused while outpatient PR #14 was merged; now resumed).
**Frontend-only — no `Code.gs` change.**

## 1. No control is ever white-on-white

The dark base style added in iteration 8 only covered `<select>`. The
**תדירות (frequency) `<input type="number">`** in the **«שיבוץ ותוכנית»** modal
(which is not a `.form-grid`) still used the browser-default white background with
light inherited text → invisible value. Extended the dark base to **text-like
`<input>` + `<textarea>`** (`input:not([type=checkbox]):not([type=radio])`), so
any control outside a `.form-grid` is readable. Kills the whole bug class.

## 2. Scheduling no longer dead-ends when the debt endpoint is down

When the outpatient debt check is unavailable, every patient evaluated to
**flag / `lookup_failed`**, and the flow looped forever on **«נסה שוב»** —
scheduling could never save.

- `lookup_failed` now **saves as `flagged`** («לבירור»), exactly like any other
  flag — never-fail-open (flagged ≠ clear), never a retry dead-end.
- Removed the `lookup_failed` retry reset in `handleScheduleSubmit`; the save
  button is **«אשר ושמור»** (a debtor needs approval) or **«שמור»** otherwise.
- Success toast when saved unverified: **«נשמר לבירור — לא ניתן לאמת חוב כרגע»**;
  updated the `lookup_failed` copy accordingly.
- New pure **`Scheduling.gateStatusForDecision`** (`allow→clear`, `block→approved`,
  `flag→flagged`) drives the persisted status and is unit-tested (incl.
  `lookup_failed → flagged`).

> With the debt endpoint down, every scheduled treatment is saved as **«לבירור»**
> until the gate is reachable — expected; they re-resolve once it works. The
> backend already accepts `flagged` rows regardless of debt config, so **no Apps
> Script change** is needed.

## 3. Tab-3 buckets — confirmed no render bug

`renderMine()` filters by the picked therapist, `bucketMine(rows, today, today+7)`
partitions correctly, `fill()` un-hides any panel with rows, and `mineRow` +
the `#view-mine` handler wire «התקיים / לא התקיים»(+reason) to the report flow.
The empty buckets were **only** because fix #2's loop blocked all saves — once a
treatment persists for the picked therapist it renders (today → «קרובים»).

## Tests

`npm test` — 74 passing. Added `gateStatusForDecision` coverage incl. the
`lookup_failed → flagged` path; existing `treatment-guard` tests already prove the
backend accepts `flagged` when debt is `unconfigured`.

## Deploy

**Frontend-only** → Railway redeploy + **Ctrl+Shift+R**. **No Apps Script
redeploy** this round.
