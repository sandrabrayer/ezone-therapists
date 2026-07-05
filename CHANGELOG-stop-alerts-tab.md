# «עצירת טיפול» tab — persistent stop-treatment alerts

## Why
The outpatient app can raise a **stop-treatment** alert for a patient (treatment
must be halted). Yarden needs these surfaced in the therapists app and needs
them to **persist** until she has actually seen each one — they must never
vanish on their own.

## What changed

### server.js — two fail-closed proxies (new secret `STOP_ALERTS_SECRET`)
- `GET  /api/stop-alerts`      → outpatient `getStopAlerts`
- `POST /api/stop-alerts/read` (body `{ id }`) → outpatient `markStopAlertRead`
- Both inject `STOP_ALERTS_SECRET` server-side (never sent to the browser) and
  forward to `OUTPATIENT_SHEETS_URL`, the same shared-secret pattern as the
  existing debt-status / treatment-plans proxies.
- **Fail-closed:** when either `OUTPATIENT_SHEETS_URL` or `STOP_ALERTS_SECRET`
  is unset the routes return a clear `500` and never call the sibling
  unauthenticated. `POST …/read` without an `id` is a `400`.
- Startup logs `STOP_ALERTS_SECRET configured: <bool>` (boolean only, never the
  secret); `/api/debug/env` gains `stopAlertsSecretConfigured`.

### Frontend — new «עצירת טיפול» tab
- **public/stop-alerts.js** (new, framework-free `StopAlerts` module):
  `isRead`, `unreadCount`, and a stable unread-first `partition`.
- **public/access.js**: `stopAlerts` added to the canonical tab list.
- **public/index.html**: the tab button with a **red** unread-count badge
  (`#stopAlertsBadge`, hidden at zero); a view with an unread list and a
  collapsible dimmed «נקראו» group.
- **public/app.js**:
  - Loads the alerts on **app load** (`loadAll`) and again on **tab open**
    (`setView('stopAlerts')`), refreshing the badge each time.
  - Unread alerts render first — patient name, created date, note — each with a
    «נקראה» button. Read alerts collapse into the dimmed «נקראו» group.
  - Mark-read is **optimistic** (flip locally → badge drops) with **rollback**
    and a toast on failure.
  - Alerts **never disappear on their own** — only an explicit mark-read moves an
    alert into the read group; a transient endpoint failure keeps the last list.
- **public/style.css**: red tab badge, alert-row layout, dimmed read group, and
  a ≤560px mobile pass (full-width «נקראה», 40px+ tap targets, RTL).

## Tests (`npm test`, Node ≥18 built-in runner)
- `test/stop-alerts.test.js` — read/unread detection, unread count, partition.
- `test/stop-alerts-secret-forwarding.test.js` — GET/POST inject the secret and
  forward correctly; missing-`id` POST is a 400; the secret isn't leaked to
  other routes.
- `test/stop-alerts-failclosed.test.js` — with `STOP_ALERTS_SECRET` unset both
  routes are a clear 500 and never call upstream.
- `test/access.test.js` — updated for the new tab.

## Prerequisites — MUST be in place before this ships
1. **Outpatient Apps Script redeployed** with the alert actions `getStopAlerts`
   and `markStopAlertRead` (a NEW VERSION of the EXISTING deployment — do not
   mint a new URL). Until then `/api/stop-alerts` returns nothing and the tab
   shows the "unavailable" notice.
2. **`STOP_ALERTS_SECRET` set on BOTH sides:**
   - Outpatient **Script Properties** — the value the Apps Script checks.
   - This service's **Railway variable** — the value the proxy injects. (Railway
     variable changes apply only to deployments started after saving.)
   The two must match, exactly like `DEBT_STATUS_SECRET` / `TREATMENT_PLANS_SECRET`.

## Deploy note
- Backend + frontend. Railway auto-deploys the connected branch; set the
  `STOP_ALERTS_SECRET` variable before/at deploy so the routes are live (they
  fail closed with a clear 500 until it is set).
