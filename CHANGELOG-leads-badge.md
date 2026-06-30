[CHANGELOG-leads-badge.md](https://github.com/user-attachments/files/29491521/CHANGELOG-leads-badge.md)
# New-lead visibility: tab badge + «חדש» tag

## Why
New leads (approved plan, no non-framework therapist) just appeared silently in
the שיבוץ tab. Yarden needs to notice them.

## What changed
- **public/index.html**: a `#leadsBadge` counter on the «שיבוץ מטפלים» nav tab.
- **public/app.js**
  - `updateLeadsBadge()`: sets the badge to the live count of patients needing
    assignment (`needsAssignment`, which already ignores framework types);
    hidden at zero. Called from `render()`, so it refreshes after every load/assign.
  - Lead rows in the assign tab get a «חדש» tag on the patient name.
- **public/style.css**: badge + «חדש» tag styles (fuchsia).

## Decisions
- Visible to everyone (the app has no roles/login; the info isn't sensitive).
- «New» = currently unassigned (until assigned) — no timestamp/backend needed, so
  this is frontend-only.

## Tests
- Full suite green except the 2 pre-existing unrelated failures. `needsAssignment`
  (framework-aware) is already covered by the assign-tab logic.

## Deploy note
- Frontend only — Railway auto-deploy.
