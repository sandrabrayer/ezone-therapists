[CHANGELOG-purple-pink-theme.md](https://github.com/user-attachments/files/29174188/CHANGELOG-purple-pink-theme.md)
# CHANGELOG — therapists app: purple/pink theme + invisible-text fixes

## Summary
Restyled the E-Zone Therapists app to its own signature color — purple/pink on a
deep aubergine base — while keeping the shared E-ZONE structure (cards, panels,
badges, layout) identical to the other apps. Also fixed two invisible dark-blue
text bugs and one CSS syntax error. Single file changed: `public/style.css`.

## Design principle
Every E-ZONE app shares the same component structure but has its own dominant
accent: outpatient = green, dashboard = indigo, therapists = purple/pink. The
component CSS references `--green` / `--green-2` / `--green-deep`; those legacy
names are aliased to the new violet accent, so the whole UI re-themes from the
`:root` block without touching any markup or component rules.

## Changes (public/style.css)
Palette (`:root`):
- Base/elevation/panels: `#16263d/#1d3252/#243a5c/#2d456a` → `#150d1f/#1e1430/#2a1c42/#34244f` (aubergine).
- Border: `#3c557d` → `#5a3d7a`. Soft/muted text retoned to lilac (`#f3ebfa` / `#c9b8dd`).
- Accent: sky-blue `#38bdf8/#7dd3fc/#0284c7` → violet `#a855f7/#c77dff/#7c3aed`.
- Added `--pink: #ec4899` for highlights. Updated the `:root` comment to explain the per-app color principle.

Backgrounds:
- Body and PIN-screen radial gradients: blue `#1f4063` → purple `#2e1a47` (×2).

Button text on the violet accent:
- `.btn-primary` and `.outcome-btn.is-active` dark text `#04212e` (green-theme teal) → `#1a0820` (aubergine), so it reads correctly on violet.

Re-themed leftover hardcoded blue UI to variables (so they follow the palette):
- `.status-active`, `.charge-status-paid` backgrounds `#0c2c3f` → `var(--panel-2)`.
- `.retention-section-title`, `.ret-card`, `.ret-row`, `.ret-label` and the
  modal divider: slate-blue hexes → `var(--accent-2)` / `var(--border)` /
  `var(--text-soft)` / `var(--muted)`.
- `.recurring-tag` indigo `rgba(99,102,241,.18)`/`#c7d2fe` → violet
  `rgba(168,85,247,.18)`/`var(--accent-2)`.

### Invisible-text bugs (the reported dark-blue-on-dark issue)
- `.next-bill` text was `#004085` (dark navy) on the dark background → invisible.
  Now `var(--green-2)` (accent), contrast 5.8:1.
- `.form-section-title` text was `#1a2e4a` (very dark blue) with a light-mode
  `#e5e7eb` top border — both invisible on dark. Now `var(--text-soft)` text +
  `var(--border)` top border.

### Bug fix
- `.ret-label` was missing its `;` after `color: #7a9bbf` (a latent CSS parse
  error). Fixed as part of the retheme to `var(--muted);`.

## Intentionally left unchanged
- WhatsApp button `.btn-wa` stays brand-green `#25d366` (brand color, consistent across apps).
- Semantic payment chips `.chip-paid/partial/unpaid/next` stay their fixed status
  colors (dark text on light chip backgrounds — readable, and meaning-coded).
- `.bt-chip.bundle` / `.chip.bundle-remaining` keep their distinct periwinkle —
  the bundle payment type is deliberately a separate hue (matches outpatient).

## Verification
- Contrast (WCAG): body/muted text 8–19:1, accent-2 emphasis text 5.8:1, primary
  button text 4.7:1 — all pass AA for their roles.
- CSS structurally validated: braces balanced (274/274), no declarations left
  without a terminator.
- No JS or markup changed; no test impact (styling only).

## Deploy / manual steps (flagged)
- **Frontend only** — served by the Node app on Railway. After the PR merges,
  redeploy/restart the therapists Railway service so the new `style.css` is live.
- **Hard-refresh** (Ctrl+Shift+R) or open incognito after deploy to bypass the CSS cache.
- No Apps Script change in this PR.
