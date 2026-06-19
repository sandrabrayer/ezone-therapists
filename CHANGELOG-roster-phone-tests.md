# Dashboard phone — roster-build investigation + regression tests

## Report: where the phone flows (and the exact finding)

Reported symptom: active-patient dashboard cards show no phone, even though
`getTreatmentPlans` returns a populated `phone` per client.

Traced the full path:

- **`buildPatientRoster`** plans loop calls `add(p.name, p.phone, …)`; `add`
  stores `phone: phone || ''` on the per-key record; the final item returns
  `phone: base.phone`. **`base.phone` IS set from `p.phone`.** ✅
- **`patientCard`** renders `escapeHtml(p.phone)` — the **same** field the roster
  builds. ✅
- **Recovery on load** (`Phone.recoverStored`) never blanks a non-empty phone;
  plans phones aren't even passed through it.

Verified empirically with the real `phone.js` / `stopflow.js` modules against the
confirmed projection shape (`phone` present, leading zero, e.g. `"0501234567"`):
the full four-source merge yields cards **with** phones — never blank. A roster
item only exists when its phone produces a non-empty match key, so **a built item
always carries a non-empty phone**; a misnamed/blank phone field *drops* the
client rather than producing a phone-less card.

**Conclusion: no code defect in `buildPatientRoster` / `patientCard` for the live
data shape.** The roster carries the phone through correctly. A live "no phone"
symptom with this code therefore points at a **stale deployed/cached frontend**
(an older `app.js`), not this logic. Cache-busting is wired correctly
(`app.js?v=__BUILD__`, `__BUILD__` = server-start timestamp, `index.html` served
`no-store`), so re-deploying/restarting serves the current `app.js`.

## Change: make the roster build testable + lock the phone carry

The merge previously lived inside the `app.js` IIFE and could not be unit-tested.
Extracted it verbatim into a framework-free module so the behaviour the report
cares about is guarded:

- **`public/roster.js`** — `Roster.build(state)`, a behaviour-preserving
  extraction of `buildPatientRoster` (merge of plans + debt roster + local intake
  + assignments; `planSessionsText` and `debtEntryFor` moved in alongside it).
  UMD: browser global `Roster`, `require()` under `node --test`.
- **`public/app.js`** — `buildPatientRoster()` now delegates to `Roster.build`;
  the now-dead `planSessionsText` / `debtEntryFor` are removed.
- **`public/index.html`** — loads `roster.js` before `app.js` (after its `phone`
  / `stopflow` deps).
- **`test/roster.test.js`** — 9 tests asserting the phone carries through from
  each source (plans / debt / local), that the documented `getTreatmentPlans`
  projection shape yields a populated `phone`, that merge interactions never blank
  it, and that an unusable phone drops the client (no phone-less card).

No behaviour change: the extraction is verbatim and the full suite passes
(**175 / 175**, +9 new).

## Verify on the live app

If a card still shows no phone after this deploys, it was the stale frontend:
hard-refresh (the new `__BUILD__` busts the `app.js` cache) and confirm the
`/api/treatment-plans` response carries `phone` per client. If the phone is
present in the response but still missing on the card *after* a fresh load, send
one client object and we'll re-open — but the roster logic is proven correct for
the confirmed shape.
