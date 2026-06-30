[CHANGELOG-card-contrast.md](https://github.com/user-attachments/files/29489942/CHANGELOG-card-contrast.md)
# Color/contrast pass: cards stand out; assigned vs unassigned clearly differ

## Why
Across the dashboard, therapists, and assignment tabs the cards blended into the
dark background, and in the assignment tab assigned vs. new-lead rows looked nearly
identical.

## What changed
- **public/style.css**
  - New elevated surface tokens in :root (both root blocks): `--card` /
    `--card-hover` / `--card-border`, plus distinct `--panel-plan(.-border)` and
    `--panel-sched(.-border)` for the two card panels.
  - `.client-card` (dashboard + therapist tabs): lifted to `--card` with a drop
    shadow and a lighter hover; the two inner panels now use the plan/sched tokens
    so «תוכנית טיפול» (pink) and «לוז שבועי» (purple) read as distinct.
  - Assignment tab: base row lifted to `--card` with shadow; NEW LEADS
    (`.assign-row-pending`) get a thicker amber bar, stronger amber wash and glow
    so they pop; ASSIGNED (`.assign-row-assigned`) get a distinct purple-tinted
    card — the two states are now obviously different.
- **public/app.js**: assigned rows carry the `assign-row-assigned` class.

## Tests
- Visual-only; full suite green except the 2 pre-existing unrelated failures.

## Deploy note
- Frontend only — Railway auto-deploy.
