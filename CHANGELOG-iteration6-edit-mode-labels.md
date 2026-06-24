# Changelog — iteration 6: label + edit-mode + picker fixes

UI / labeling / permission corrections found in use. All functionality preserved.

## 1. Working «עריכה» edit-mode toggle (was a broken badge)

The header «עורך» control was a non-clickable `<span>` that did nothing. Replaced
it with a real **«עריכה» edit-mode toggle button** (→ «סיום עריכה» when active):

- **Editor-only**, and shown **only** on שיבוץ מטפלים and המטופלים שלי; **hidden on
  דשבורד מטופלים**.
- Edit controls (`.edit-only` — registration, «פרטים», assignments, scheduling,
  and the did-it-happen mark buttons on tab 3) appear **only when edit mode is on**
  (`body.edit-mode`); previously they keyed off the viewer/editor role.
- **דשבורד מטופלים is now view-only for everyone**: its card action buttons were
  removed and **«רישום מטופל חדש» moved to שיבוץ**. Editing a patient's
  identity/origin is reachable via a new **«פרטים»** action in the שיבוץ list.

Encoded as pure predicates in **`public/access.js`** (`isEditableView`,
`editToggleVisible`, `editControlsVisible`), unit-tested in
`test/access.test.js`.

## 2. Finished the «נקבעו» rename

- Panel **«טיפולים מתוזמנים»** → **«טיפולים שנקבעו»**.
- Empty state **«לא תוזמנו טיפולים»** → **«אין טיפולים שנקבעו»**.
- Toasts: **«הטיפול תוזמן»** → **«הטיפול נקבע»**; **«…לא תוזמנו»** → **«…לא נקבעו»**.
- Debt-alert copy **«לאחר תזמון»** → **«לאחר קביעת הטיפול»**.
- Swept the whole app — no remaining «תוזמנו»/«מתוזמנים»/«תוזמן»/«תזמון».

## 3. Clearer, correctly-placed name-picker

- The identity picker label **«אני:»** → **«שם המטפל/ת:»**, and it exists **only**
  in המטופלים שלי (the global-header picker was already removed in iteration 5).
- The שיבוץ therapist dropdown is a **filter**, not an identity picker — relabeled
  its default to **«כל המטפלים (סינון)»** with a "סינון לפי מטפל/ת" tooltip so the
  two are not confused. (Kept — it is the iteration-4 therapist filter.)

## 4. Tab roles enforced

- **דשבורד מטופלים** — everyone, view-only overview.
- **שיבוץ מטפלים** — editors in edit mode: assignments, plans, scheduling,
  registration, details. No identity picker.
- **המטופלים שלי** — therapist picks own name, marks done (in edit mode).

## Tests

`npm test` — 71 passing (added `test/access.test.js`). All prior tests still pass.
