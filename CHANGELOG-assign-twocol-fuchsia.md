[CHANGELOG-assign-twocol-fuchsia.md](https://github.com/user-attachments/files/29490243/CHANGELOG-assign-twocol-fuchsia.md)
# Assignment tab two-column + more fuchsia cards + bolder plan text

## What changed
- **public/app.js**: `renderAssign` renders two side-by-side columns —
  «לידים חדשים — טרם שובצו» on one side, «מטופלים משובצים» on the other
  (stacks to one column under 820px).
- **public/style.css**
  - Card tokens pushed more fuchsia/pink: `--card` #52214c, `--card-border`
    #c052a0; plan panel #5e1f48 / #e0559b; schedule panel #432a66 / #a06cf2.
    This lifts cards across all three tabs (dashboard, therapists, assignment).
  - Treatment-plan text bolder/brighter: type name 800-weight pure white;
    frequency 800-weight light-pink (#ffd0e6).
  - Two-column assign layout (`.assign-columns`) with distinct column headings
    (amber for leads, purple for assigned).

## Tests
- Visual-only; full suite green except the 2 pre-existing unrelated failures.

## Deploy note
- Frontend only — Railway auto-deploy.
