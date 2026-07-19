# Auto-deploy Apps Script via clasp in CI (on merge to the deployed branch)

## Why
Until now every `apps-script/Code.gs` change had to be pasted into the Apps Script
editor by hand and redeployed as a **new version of the existing deployment** — a
manual step that has been forgotten and, worse, occasionally done wrong (a *new*
deployment, which changes the `/exec` URL and breaks the outpatient/dashboard
consumers; see the hard-won pitfalls in `EZONE-ECOSYSTEM-STATUS.md`). This
automates the exact-and-only-correct path.

## What changed

### `.clasp.json` (new)
- `scriptId` for the E-ZONE Therapists Apps Script project; `rootDir: apps-script`
  so clasp pushes `apps-script/**`. The Script ID is an identifier, **not** a
  secret.

### `apps-script/appsscript.json` (new)
- The project manifest clasp requires in `rootDir`. `runtimeVersion: V8`,
  `timeZone: Asia/Jerusalem`, and the Web App config the consumers depend on —
  `executeAs: USER_DEPLOYING` ("Me") + `access: ANYONE_ANONYMOUS` ("Anyone").
  `clasp push -f` treats this file as the source of truth for the deployment's
  settings (see `DEPLOY.md`).

### `.github/workflows/deploy-apps-script.yml` (new)
- **Trigger:** push to **`claude/inspiring-tesla-jipobw`** (the Therapists
  Railway/production branch per `EZONE-ECOSYSTEM-STATUS.md`) with a `paths` filter
  on `apps-script/**`, `.clasp.json`, and the workflow file.
- **Steps:** checkout → setup-node → verify secrets → `npm i -g @google/clasp@2.4.2`
  (pinned so the `~/.clasprc.json` path stays valid) → write `~/.clasprc.json` from
  the `CLASPRC_JSON` secret (validated as JSON) → `clasp push -f` →
  `clasp deploy -i <DEPLOYMENT_ID>` (new version of the **existing** deployment →
  the `/exec` URL never changes) → remove the credential file (`if: always()`).
- **Fails loudly** with actionable `::error::` messages *before* touching the live
  deployment when `CLASPRC_JSON` or `DEPLOYMENT_ID` is missing, or when
  `CLASPRC_JSON` is not valid JSON.
- `concurrency` guard prevents two deploys racing on the same project.

### `.github/workflows/validate-workflows.yml` (new)
- CI check that every `.github/workflows/*.yml` parses as valid YAML and has the
  required `on:`/`jobs:` keys. Runs on any change under `.github/workflows/**`, so a
  malformed deploy workflow is caught in a PR instead of silently never running.

### `.gitignore`
- Ignore `.clasprc.json` and `.clasp.local.json` — these hold OAuth tokens and must
  never be committed.

### `DEPLOY.md` (new)
- Documents both deploy paths (Railway vs. Apps Script/clasp), the CI flow, and the
  one-time setup: how to get `CLASPRC_JSON` (`clasp login` → copy `~/.clasprc.json`),
  how to find `DEPLOYMENT_ID` (Manage deployments → copy the `AKfyc…` ID), how to add
  both as GitHub Secrets, the token-refresh procedure, and the manifest/security
  caveats.

## Security
- Credentials live **only** in GitHub Secrets (`CLASPRC_JSON`, `DEPLOYMENT_ID`) —
  never committed, never printed. The runner's `~/.clasprc.json` is deleted at the
  end of the job.

## ⚠️ Post-merge prerequisite
The workflow **will fail until both secrets are added** (`CLASPRC_JSON`,
`DEPLOYMENT_ID`). See `DEPLOY.md` → "One-time setup". No code/schema/runtime change
to the app itself — CI/tooling + docs only.
