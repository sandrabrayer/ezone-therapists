# «התראות טיפול» — action inbox + collapsed history

The stop-treatment tab is redesigned into an **action inbox** with a collapsed
**history**, and now carries **both directions** of treatment alert. The
outpatient backend sends `type: 'stop' | 'resume'` and a lifecycle `status`
(`'unread' | 'read' | 'cancelled'`); the tab is organised around them.

## What changed

### Tab / nav
- The tab label is now **«התראות טיפול»** (treatment alerts) — it carries both
  stop and resume alerts. The tab id (`data-view="stopAlerts"`), badge, and all
  wiring are unchanged.

### Primary list — the action inbox (unread only)
- Shows **`status: 'unread'`** alerts only, both directions.
- **`type: 'stop'`** (or legacy blank) → red accent, title **«עצירת טיפול»**,
  reason chip (חוסר תשלום / אי התאמה / אחר).
- **`type: 'resume'`** → green (positive) accent, title **«חידוש טיפול»**, no
  reason chip.
- **«נקראה»** on either → `markStopAlertRead` → optimistic removal from the list
  (rollback re-shows it on a failed persist).
- The unread badge counts **both types**; read and cancelled are excluded.

### History — collapsed, 14-day window
- A collapsed **«היסטוריה — 14 ימים אחרונים»** `<details>` section, **closed by
  default** and subdued.
- **`status: 'read'`** rows (created or read within 14 days) show type, name,
  reason chip, read date, and a **«סמן כלא נקראה»** action → `markStopAlertUnread`
  → optimistically moves the row back into the primary list (rollback on
  failure). This also fixes the previously broken Hebrew label «החזר ללא נקראה».
- **`status: 'cancelled'`** rows show dimmed with a **«בוטלה»** chip and **no
  action** (the alert was voided outpatient-side).
- Rows older than 14 days are **not rendered** — the data stays in the sheet.

## Files
- `public/stop-alerts.js` (pure) — new `alertType`, `statusOf`, `typeTitle`, and
  `inbox(alerts, now, windowDays=14)` (unread-primary + read/cancelled history
  within the date window). `unreadCount` now counts `status === 'unread'` across
  both directions; `normalize` carries `type` + canonical `status`. Legacy read /
  readAt flags still derive read-state; the legacy `partition` is left intact.
- `public/app.js` — `stopAlertCard` renders by type + status (accent, title,
  chips, controls); `renderStopAlerts` uses `inbox` with a live clock and fills
  the collapsed history; the optimistic mark-read / mark-unread flips now key off
  `status`; the history click handler binds to `#stopAlertsHistory`.
- `public/index.html` — nav label → «התראות טיפול»; the read panel becomes the
  collapsed `<details id="stopAlertsHistoryPanel">` history section.
- `public/style.css` — direction accents (stop=red, resume=green), the direction
  title, the «בוטלה» chip, cancelled dimming, and the collapsed-history styling.
- `test/stop-alerts.test.js` — added: unread-only primary filter, type rendering
  (`alertType` / `typeTitle`), the 14-day history window (incl. the boundary and
  newest-of created/readAt), cancelled dimmed / no-action / badge-invisible, the
  mark-read ↔ mark-unread round-trip, and `status`/`type` normalization.

No API surface, proxy, or persisted data shape changed — the pure module accepts
the new fields defensively and legacy alerts continue to render.
