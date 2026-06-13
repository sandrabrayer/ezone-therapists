# Changelog — iteration 10 (step 1): the 1899-12-30 date bug

## Root cause

`_readAll` in `apps-script/Code.gs` formatted **every** Date cell as `yyyy-MM-dd`.
The `time` column holds a **time-only** value; Google Sheets stores a time on its
epoch day (**1899-12-30**), so reading it as a date produced the string
`"1899-12-30"`, shown next to the booking via `displayDateTime(date, time)`. The
booked *date* itself was fine — the bogus value was the mangled **time** cell.

## Fix

A time-only Date (year < 1900) now formats as **`HH:mm`**; real dates stay
`yyyy-MM-dd`; non-Date values pass through. The decision lives in a pure, tested
module **`public/sheetdate.js`** (`formatCell`) and is mirrored inline in
`_readAll` (using `Utilities.formatDate` with the script timezone).

Because the underlying serial still encodes the real time, this **read-side fix
also recovers already-saved bookings** — no data re-entry needed.

## Tests

`test/sheetdate.test.js`: a 10:30 time cell → `"10:30"` (not `"1899-12-30"`),
single-digit padding, real date → `yyyy-MM-dd`, non-Date pass-through. `npm test`
— 78 passing.

## Deploy

Touches `Code.gs` → **Apps Script redeploy required** (Manage deployments → Edit →
New version). Frontend served as usual.
