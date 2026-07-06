# «עצירת טיפול» tab — stop-reason chip

## Why
The outpatient app now tags every stop-treatment alert with a **stable reason
key** (`no_payment` / `mismatch` / `other`). Yarden should see *why* each
treatment was stopped at a glance, without the raw key ever reaching the UI and
without breaking the alerts that predate the field.

## What changed

### public/stop-alerts.js — `reasonLabel` (new pure helper)
- Maps the stable key to a Hebrew label at RENDER TIME only:
  `no_payment → חוסר תשלום`, `mismatch → אי התאמה`, `other → אחר`.
- **Keys stay stable on the wire** — only the display text is localized.
- **Blank-tolerant:** `null` / `undefined` / `''` and any unknown key yield `''`
  (legacy alerts predate the field), so the tab renders **no chip** for them.
- Tolerates surrounding whitespace and case.

### public/app.js
- `normalizeStopAlert` now keeps the stable `reason` key as its own field,
  **separate from the free-text note** — the `reason` alias was removed from the
  note fallback so a raw key can never leak into the note text.
- `stopAlertCard` renders the reason chip (via `StopAlerts.reasonLabel`) next to
  the patient name in **both** the unread and the read (dimmed «נקראו») groups.
  For `other`, the note continues to carry the free-text detail as before.

### public/style.css
- `.stop-alert-reason` — a small red-tinted pill matching the tab's attention
  accent (same palette as the existing red-warn chip).

## Tests (`npm test`, Node ≥18 built-in runner)
- `test/stop-alerts.test.js` — `reasonLabel` key→label mapping, blank-tolerance
  (no chip for missing/unknown reasons), and whitespace/case tolerance.

## Notes
- Render-only change on the frontend; no server or endpoint changes.
- Fully backward-compatible: alerts without a `reason` (or with an unrecognised
  one) render exactly as they did before — just without a chip.
