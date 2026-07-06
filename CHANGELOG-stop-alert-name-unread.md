# «עצירת טיפול» tab — patient-name fix + reversible mark-read

Two changes to the stop-treatment alerts tab.

## 1. BUG — alerts rendered with no patient name

### Symptom
Live alerts showed the created date and the reason chip but **no patient name**
(the card fell back to «—»).

### Cause
The outpatient backend sends the patient name as **`clientName`** (its own
store column), but `normalizeStopAlert` only tried `patientName / name /
patient` — `clientName` was never in the alias list, so the name resolved to
`''`. (Unrelated to PR #33: the note-fallback change there did not touch the
name path — the name path never had `clientName`.)

### Fix
- **public/stop-alerts.js** — the field-aliasing is now a PURE
  `StopAlerts.normalize(alert)` that includes **`clientName`** in the name
  aliases (`patientName || clientName || name || patient`) and keeps the
  existing `created` / `note` / stable-`reason` / `read` handling.
- **public/app.js** — `normalizeStopAlert` delegates to `StopAlerts.normalize`
  and only adds the patient phone (which needs the browser-only Phone module).

## 2. Reversible mark-read — «החזר ללא נקראה»

A mark-read used to be one-way. Each alert in the dimmed «נקראו» group now
carries a **«החזר ללא נקראה»** (return-to-unread) action that moves it back into
the unread group.

- **public/app.js**
  - `apiMarkStopAlertUnread(id)` — mirror of the read call, `POST
    /api/stop-alerts/unread`.
  - `markStopAlertUnread(id)` — OPTIMISTIC: clears **both** `read` and `readAt`
    (isRead treats a lingering `readAt` as read) so the alert returns to unread
    and the badge rises; ROLLS BACK to the prior read/readAt on failure with a
    toast.
  - The read group renders the «החזר ללא נקראה» button next to the read-meta;
    a `#stopAlertsRead` click delegate dispatches it.
- **server.js** — new `POST /api/stop-alerts/unread` proxy, SAME fail-closed
  pattern as `…/read`: injects `STOP_ALERTS_SECRET` server-side, forwards
  `action: 'markStopAlertUnread'` + `id` to `OUTPATIENT_SHEETS_URL`, `400` on a
  missing id, `500` when the secret/URL is unset (never calls upstream).
- **public/style.css** — the read-group action cell stacks the read-meta above a
  low-prominence (ghost) «החזר ללא נקראה» button; full-width on ≤560px.

### PREREQUISITE — outpatient backend action still MISSING
The outpatient Apps Script currently exposes only `getStopAlerts` and
`markStopAlertRead`. This change adds the therapists-side plumbing (frontend +
proxy) that mirrors the read pattern, but the un-read is **not functional
end-to-end until the outpatient app adds a matching `markStopAlertUnread`
action** (same shared-secret contract as `markStopAlertRead`, clearing the
row's read/readAt). Until then the button fails safely: the proxy forwards the
call, the backend rejects the unknown action, and the optimistic flip **rolls
back** with a toast — no state is corrupted. No workaround was invented on the
therapists side.

## Tests (`npm test`, Node ≥18 built-in runner)
- **test/stop-alerts.test.js** — `normalize` on a realistic backend payload
  (`{id, clientId, clientName, createdAt, status, reason, note}`) resolves
  `clientName` → name; older aliases and a missing name still handled; read
  payload derives `read`/`readAt`.
- **test/stop-alerts-secret-forwarding.test.js** — `POST /api/stop-alerts/unread`
  forwards `markStopAlertUnread` + secret + id; missing-id is a 400.
- **test/stop-alerts-failclosed.test.js** — `POST /api/stop-alerts/unread` is a
  clear 500 and never calls upstream when the secret is unset.
