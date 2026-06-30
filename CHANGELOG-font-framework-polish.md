[CHANGELOG-font-framework-polish.md](https://github.com/user-attachments/files/29490726/CHANGELOG-font-framework-polish.md)
# Polish: app-wide Rubik font, framework type (no therapist), fuchsia leads

## What changed
- **Font**: load Rubik (clean, rounded, bold-friendly Hebrew) app-wide.
  - public/index.html: Google Fonts <link> for Rubik 400–900.
  - public/style.css: font-family now leads with "Rubik".
- **Framework type — ליווי יומי בקהילה** (a מסגרת, not a therapist session):
  - public/app.js: `isFrameworkType()` + `FRAMEWORK_TYPES`. In the plan panel,
    framework types show WHERE they happen (location from the assignment slots)
    instead of a therapist, and never «טרם שובץ».
  - `needsAssignment(p)` — a patient is a NEW LEAD only if a NON-framework type
    lacks a therapist; framework-only gaps don't make a lead. Wired into the
    assign tab's lead/assigned split and per-row flag.
- **Colors**:
  - Replaced the amber «lead» styling (made cards look "sick") with fuchsia: lead
    rows and the leads-column heading now use the accent pink.
  - Bolder/brighter plan + schedule text on the cards; bolder assign-row plan
    summary. Framework chip styled in soft purple.

## Tests
- Full suite green except the 2 pre-existing unrelated failures.

## Deploy note
- Frontend only — Railway auto-deploy. (Rubik loads from Google Fonts CDN.)
