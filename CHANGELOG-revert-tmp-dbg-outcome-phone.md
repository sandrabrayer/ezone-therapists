# Revert — remove the throwaway `_setSessionOutcome` phone diagnostic

## What & why

While chasing a persistent `invalid_phone` on the session-outcome push, a
**temporary diagnostic** was added to `_setSessionOutcome` that attached
`_dbgRaw` / `_dbgType` / `_dbgRecovered` / `_dbgPhoneIdx` / `_dbgHeaderLen` /
`_dbgRowLen` to the response JSON so the live runtime phone value could be read
from the network response. It changed no logic — pure read-only instrumentation.

The phone bug is **confirmed fixed** (recovery-on-read via `_recoverStoredPhone`
in the raw-grid reads), so the diagnostic is no longer needed and is removed.

## State of the tree

The diagnostic only ever lived on the throwaway branch
`claude/tmp-dbg-outcome-phone` and on the manually-pasted live Apps Script
deployment — it was **never merged into `claude/inspiring-tesla-jipobw`**, so the
mainline `_setSessionOutcome` is already in its clean state (the `result` object
flows straight into `finally`, no `_dbg*` fields). This commit records the
removal and the confirmed-clean state; the throwaway branch is deleted.

## Deploy note

⚠️ The diagnostic still exists on the **live `/exec`** (it was pasted in to read
the runtime value). Re-paste the clean `apps-script/Code.gs` into the Apps Script
editor and **publish a new Web App deployment version** to wipe the `_dbg*`
fields from production responses.
