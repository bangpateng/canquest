# Canton Network Review Guide

**Purpose:** reviewer entry point for an independent technical review of this repository. This document is orientation and evidence tracking; it is **not** a security audit, production attestation, or claim that deployed artifacts match this checkout.

## Review baseline

- Repository: CanQuest npm-workspace monorepo (`apps/api`, `apps/web`, `packages/daml`).
- Record the exact Git commit SHA reviewed; do not use a mutable branch name as the only baseline.
- Current checked-in DAML manifest declares SDK `3.4.11`, package `canquest-v29`, package version `1.0.0` (`packages/daml/daml.yaml`).
- Checked-in DAML source and tests: `packages/daml/daml/Main.daml` and `packages/daml/daml/Test.daml`.
- API: NestJS + Prisma; web: Next.js. The GitHub Actions workflow is validation-only and contains no deployment step.

## Important source/version discrepancy to resolve

The repository contains documents describing different generations and, in one case, different source locations:

- `packages/daml/daml.yaml` declares `canquest-v29` version `1.0.0`, SDK `3.4.11`, `daml-script` as a package dependency, and three Splice `data-dependencies`.
- `HANDOFF_DAML_V31.md` explains that v31 iterations were consolidated under production package name `canquest-v29`, but also states that the latest files were outside the repository and describes the repository copy as v28 in its status section.
- `RUNBOOK_V29_MAINNET_SMOKE.md` describes a v28 → v29 rollout and environment-specific operations.
- `docs/AUDIT_DAML_MAINNET_REPORT.md` identifies itself as an audit of `canquest-v6`, dated 2026-06-08. It is historical context, not approval of the current package.
- `HANDOFF_DAML_V23.md`, `HANDOFF_DAML_V27.md`, and `HANDOFF_DAML_V28.md` describe earlier iterations and should be treated as historical unless independently reconfirmed.

**Reviewer/maintainer action:** confirm which source tree and package revision correspond to the deployed Canton participant before assessing production parity. This guide intentionally does not resolve that discrepancy or repeat deployment claims from older handoffs.

## Suggested reading order

1. `README.md` — repository overview, prerequisites, and workspace entry points.
2. `docs/ARCHITECTURE_LAYERS.md` — documented responsibility split between Canton wallet infrastructure and application/quest layers. Verify its operating mode/flags against the review target; it describes a Web2 + wallet mode.
3. `packages/daml/daml.yaml` — package name/version, SDK, dependencies, and source path.
4. `packages/daml/daml/Main.daml` and `packages/daml/daml/Test.daml` — checked-in contract source and tests.
5. `HANDOFF_DAML_V31.md` — read with the discrepancy above in mind; compare claims with the checked-in manifest/source.
6. `RUNBOOK_V29_MAINNET_SMOKE.md` — operational procedure only after target environment, package, and commit are confirmed. Do not execute mainnet steps as part of source review.
7. `CANTON_REALTIME_SPEC.md`, `docs/CANTON_TRANSFER_OFFER_FLOW.md`, and `docs/EARN_FLOW_CURRENT.md` — integration and flow context.
8. Older version-specific handoffs/runbooks and `docs/AUDIT_DAML_MAINNET_REPORT.md` — historical context only.

## Validation commands

Run from the repository root unless noted. Record the commit SHA, tool versions, commands, outcomes, and warnings/errors with the review record.

### JavaScript/TypeScript workspace

```bash
node --version
npm --version
npm ci
npm run prisma:generate -w api
npm run lint -w api
npx tsc -p apps/api/tsconfig.build.json --noEmit
npm test -w api -- --runInBand
npm run build -w api
npm run lint -w web
npx tsc --noEmit -p apps/web/tsconfig.json
npm test -w web -- --runInBand
npm run build -w web
```

CI uses the **root `package-lock.json`** for the npm workspace install. The API build regenerates Prisma Client. Unit-test passes do not establish Canton integration behavior unless a test explicitly exercises that boundary. The workflow does not use production credentials or deploy.

### DAML package

```bash
cd packages/daml
daml --version
daml test
daml build
```

This requires the DAML/DPM toolchain and the Splice DAR data-dependencies named in `daml.yaml`. A local build/test proves the checked-in package builds against those local inputs; it does **not** prove that the participant has the same packages or that deployed code matches the checkout.

At the current review baseline, I ran `daml test` and `daml build` with SDK 3.4.11: tests reported 120 transactions; build created `.daml/dist/canquest-v29-1.0.0.dar`. The build emitted a warning that this package includes `daml-script` and recommends separating scripts/tests from production templates to avoid uploading that dependency into the participant package store. This warning is recorded for reviewer consideration and was not changed as part of this repo-readiness work.

## Artifact and dependency inventory

- `packages/daml/dars/` contains five tracked Splice dependency DARs referenced by or supporting the manifest.
- `packages/daml/.daml/` is generated/local output and ignored by Git. A local `canquest-v29-1.0.0.dar` build is not itself a tracked release artifact.
- Do not treat old DARs under generated `.daml/dist/` as the review target without matching package/version/hash to the selected source commit and target participant inventory.
- Record provenance/version of each external DAR and verify compatibility with the target participant release.

## CI scope and limitations

`.github/workflows/ci.yml` runs API/web lint, typecheck, unit tests, and builds; it has **no deployment job**. The workflow is included in this review-readiness change. Branch protection and required status checks are GitHub settings outside this repository; the repository owner must verify/configure them separately. A green workflow alone does not establish that merges require it.

The workflow uses root `package-lock.json` with npm workspaces. Separate lockfiles also exist under `apps/api` and `apps/web`; inspection found app-level lock entries missing several currently declared dependencies, and the web app lock resolves Next.js 15.5.18 while the web manifest and root workspace lock resolve 15.5.25. Root workspace CI does not use these app-level locks. Treat standalone app installs using those locks as unverified; do not delete/regenerate them without a separate compatibility check.

Node 20 is declared by the root `engines`, pinned in `.nvmrc`, and used by CI. Third-party GitHub Actions are pinned to verified v4 tag commit SHAs. Review those pins intentionally when upgrading the actions.

## Review bundle checklist

Build a review bundle from the selected commit’s **tracked files** and inspect its file list before sharing. Exclude local/runtime material, including:

- `.env*` files and credential-bearing local configuration;
- application logs, database dumps/backups, uploads, and local caches;
- `node_modules/`, `.next/`, generated Prisma client, and `packages/daml/.daml/` build/cache output;
- local screenshots/design captures and editor/session/agent metadata;
- Git remote URLs if the local remote contains embedded authentication material.

Do not paste, attach, or include secret values in this guide or the review bundle. If a credential may have been exposed in a remote URL or diagnostic output, the repository owner should revoke/rotate it and switch to a credential-free remote URL.

**Tracked screenshot note:** `.reskin-shots/` contains tracked design screenshots in this checkout. They are not needed for a Canton source review; exclude them from any review bundle unless reviewers explicitly request UI design material.

## Evidence status

For the review record, classify each statement as one of:

- **Verified in this checkout:** file content, manifest value, command executed, or CI run tied to an exact commit.
- **Environment-dependent:** requires Canton participant access, deployment inventory, or mainnet/devnet credentials.
- **Historical/unverified:** copied from older handoffs/runbooks or claims not independently reproduced for the selected commit.

A repository review is not a substitute for an independent contract/security review or for confirming deployed package IDs, participant package inventory, configuration, and operational controls.