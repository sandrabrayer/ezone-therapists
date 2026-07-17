# CHANGELOG — palette polish: contrast/pop pass (post-deploy feedback)

**Date:** 2026-07-17 · **Base:** `claude/inspiring-tesla-jipobw` (post PR #38)

## What (Sandra's live-screenshot feedback)

The muted-rose primary stays for surfaces, but foreground elements were too
quiet. This pass adds a "pop layer" of two derived vars — same hue as the
chosen primary #9d6b8a, saturated/brightened:

- `--accent-vivid #e873bc` — headline role. `--green-2` now aliases it, which
  brightens ALL headline-role elements at once: KPI numbers (incl. התראות חוב),
  brand, modal titles, pipeline counts, stat values, «שבץ מטפל» button gradient.
- `--accent-hot #e33ba3` — attention role: `.tab-badge` (the "15"), «חדש»
  lead tag. White 800-weight text on hot rose; glow shadow updated to match.
- Pending patients' names (`.assign-row-pending .assign-name`) → bold white
  (dim `#dac7d3` override removed), matching the assigned side.
- Therapist line (`.assign-ther`) → bold white (label prefix stays muted).
- Treatment-plan line (`.assign-type`, both variants) → white, weight 700.

## Untouched

`--accent/--accent-2/--accent-deep`, plan teal, sched sky, all surfaces,
reserved red, semantic payment chips. Both hot/vivid hues stay clearly distinct
from the reserved error red `#ff7676`.

## Files

`public/style.css` (both `:root` blocks + 6 rules, assertion-guarded),
`public/sw.js` (cache v6→v7), `test/palette.test.js` (guards updated + new pop
guard), this file.
