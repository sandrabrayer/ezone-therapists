# CHANGELOG — palette application (theme-lab spec) + theme-lab removal

**Date:** 2026-07-17
**Branch base:** `claude/inspiring-tesla-jipobw` (Railway live branch)

## What

Applies the color palette Sandra chose visually in `/theme-lab` (screenshot
readout, 2026-07-17) app-wide, and deletes the temporary theme-lab in the same
PR, per the plan in CHANGELOG-theme-lab.md.

### Chosen spec

- Scheme: **accent per section**; chips **filled**; cards/panels **filled**
- Base: bg position 0/100, tint 40%
- `accent.primary #9d6b8a` (muted rose) · `accent.plan #2dd4bf` (teal) ·
  `accent.sched #38bdf8` (sky blue)
- `bg #2c1a28` · `bg-elev #3f2b3a` · `panel #4a3644` · `card #564150` ·
  `border #826478` · `panel.plan #3a5d60` · `panel.sched #3d5770`
- `reserved.red #ff7676` — unchanged, errors/danger only

### Derived values (same mix math the theme-lab used)

`--panel-2 #503c4a`, `--card-hover #624e5c`, `--card-border #8e6780`,
`--accent-2 #b38ca4`, `--accent-deep #6e4b61`, `--muted #ceb5c5`,
`--text-soft #ede4ea`, gradient highlight `#5b4153` (replaces `#3a1530`).
Hardcoded pink/violet text tints remapped to the new hues: `#ffd0e6→#dac7d3`,
`#c89bf5→#92dbfb`, `#b9a9f5→#a5e1fc`, notif bg `#2e1840→#3e4157`,
`rgba(236,72,153,x)→rgba(157,107,138,x)`, `rgba(160,108,242,x)→rgba(56,189,248,x)`.
`--purple` now carries the scheduling (sky) accent — its two usages are
scheduling-context (assigned rows, notification banner), so the remap is
semantic, not just cosmetic.

## Files

- `public/style.css` — both `:root` blocks + gradients + stray hardcoded
  accents (assertion-guarded replacements; exact occurrence counts verified)
- `public/index.html` — `<meta theme-color>` → `#2c1a28`
- `public/manifest.webmanifest` — `theme_color`/`background_color` → `#2c1a28`
- `public/sw.js` — cache `ezone-therapists-v5` → `v6` (forces stylesheet refresh)
- **Deleted:** `public/theme-lab.html`, `/theme-lab` route in `server.js`,
  `test/theme-lab.test.js`, `CHANGELOG-theme-lab.md`
- `test/palette.test.js` — NEW guard tests

## Untouched (deliberately)

- `--red #ff7676`, `--amber`, and the semantic `.chip-paid/partial/unpaid`
  payment colors — guard-tested to stay byte-identical.
- PWA icons remain fuchsia (`icon-v2-*`) — regenerating icons in the new rose
  tone is a separate follow-up if wanted (needs a new icon rename + SW bump).

## Tests

`test/palette.test.js`: chosen hexes present in BOTH `:root` blocks; zero old
fuchsia hexes anywhere in the frontend; red + payment chips untouched; accents
verifiably distinct from the reserved red; PWA colors match; SW bumped;
theme-lab fully gone (file, route, tests, changelog).
Full suite after change: **312 pass, 0 fail** (the 7 deleted theme-lab guards
are replaced by 7 new palette guards).

## Post-merge verification

1. Railway auto-deploys; hard-refresh (or wait for SW v6 to activate).
2. `/theme-lab` must now return the main app (SPA catch-all), not the lab.
3. Spot-check: tabs/buttons muted rose, plan panel teal, scheduling panel sky
   blue, debt warnings still red.
