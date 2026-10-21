---
slug: ADR-002-CI-CD-파이프라인
date: 2026-07-11
author: GoBeromsu
status: Accepted
references:
  - ADR-001-테크스택
refines: []
---

# ADR-002: CI/CD Pipeline

[한국어](ADR-002-CI-CD-파이프라인.md) | **English**

English translation of the [Korean source](ADR-002-CI-CD-파이프라인.md).
The Korean document remains authoritative.

## Status

Accepted

> The production job reads the single root `Jenkinsfile` on main and deploys the latest full Release without parameters.
> Storage cutover was completed as a separate operational change on 2026-09-02.
> Production submission files now use private managed R2; MinIO and the AWS frontend rollback path have been removed.

## Date

2026-07-11

## Context

PR quality verification is necessary, but building Docker images in CI increases execution time and cost.
Branch-protection required checks must also report on every PR; skipping the entire job based on paths can deadlock merge waiting.
The deployment server runs Docker without a registry and must recover to the previous deployment on failure.
Initial deployments may be greenfield, without a previous image.

## Decision

Configure GitHub Actions as lightweight CI running on every PR, always keeping the required job name `ci`.
Handle path gates within the `ci` job so a result is reported even when no relevant paths change.
CI performs lint, typecheck, tests, and application builds, but no Docker image builds.
Under ADR-005, merge gates are only actual success of required checks (`ci` and `public-safe`) and GitHub mergeability.

GitHub Actions `ci` validates main merges; Jenkins is responsible only for production deployment.
The production deployment candidate is a public GitHub Release.
Publishing a non-draft, non-prerelease Release whose tag identifies an exact commit in main history lets Jenkins' outbound 10-minute convergence schedule discover the latest full Release.
Without external input, Jenkins **queries the current latest full Release itself** and verifies `draft=false`, `prerelease=false`, and a full SemVer tag.
The same version/SHA or a lower version succeeds as a no-op; parameterless manual execution through the tailnet is reserved for schedule delays or recovery.
Do not create a separate `deploy.yml`, public Jenkins build endpoint, GitHub deploy token, or manual GitHub dispatch surface.
Keep Jenkins UI and administration accessible only through the tailnet.
For browser APIs, the Vercel routing layer injects a production-sensitive credential and forwards to the exact origin domain; host nginx forwards only authenticated API requests to Compose nginx on loopback `127.0.0.1:8081`.
Check out the exact tag commit SHA only if it belongs to main history.
**Publishing a non-draft, non-prerelease GitHub Release is itself deployment authorization** — GitHub Release publication permissions control who can initiate deployment; Jenkins does not separately identify the authorizing actor.
Frontend deployment follows the same authorization event.
The non-required `frontend-release-deploy` job runs only on `release: published`, verifies full SemVer tag format and main ancestry, then deploys that exact SHA to Vercel production.
Git pushes, PRs, local `vercel --prod`, and dashboard Redeploy are not frontend production paths.
The repository contract is `git.deploymentEnabled: false` in `apps/frontend/vercel.json`.
Keep `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` only in GitHub repository secrets, not local env or `.env.example`.
The Git repository connection may remain for metadata; disabling dashboard auto-deploy and unused hooks is pre-merge bootstrap, not the authoritative contract.
Narrow frontend deployment scope using a diff against the single most recent SHA whose `Vercel production 배포` (“Vercel production deployment”) step actually succeeded in the GitHub Actions `frontend-release-deploy` job.
Do not treat earlier successes as current deployment state.
Successful no-ops and failed deployments are not baselines.
Skip deployment when frontend artifacts have not changed; after failure, the next release deploys the missed frontend changes again.
Serialize through a shared production concurrency group, retaining queued executions without canceling running deployments; rerunning an older release ancestral to the most recent successful deployment SHA is a no-op.
If there is no successful history or lookup/comparison is uncertain, do not infer no-op from remaining older receipts: independently confirm that the target is the latest stable Release and deploy only that target.
If the target is old or its latest status cannot be verified, fail and require retry.
Production Compose has no frontend runtime, so backend deployment is already backend-only and Jenkins convergence is unchanged by this contract.
The decision uses actual Actions deployment-success records and the diff between two commits; it does not inspect Vercel production state directly.
Checking the latest Release when Actions history is absent/unavailable also uses the GitHub API.
This job is not a required check — path-filtering a required check would leave it unreported for PRs not touching those paths and permanently block merging.
Abolish public comment-marker approval gates (`RELEASE_ACCEPT`, `RELEASE_OVERRIDE`) — adding a separate string-parsing gate on top of a platform already controlling authority only adds failure points without changing the authorizing actor.
There is no separate staging server.

Jenkins is idempotent work converging to the latest Release on each execution.
Read the currently running backend container's image tag; if it matches the target Release or is newer, succeed as a no-op.
CD does not read CI status (see the Anti-pattern section added in PR #1012).
**Deployment-time revalidation (lint, typecheck, tests, application build) has been abolished** — quality verification belongs to the CI layer, specifically the pre-merge required `ci` check.
Deploy a new Release in this order: PostgreSQL backup → object backup → one server-local backend image build → `prisma migrate deploy` → `up -d --no-build --wait` → smoke.
The backend Dockerfile performs `pnpm install --frozen-lockfile`, `prisma generate`, and `pnpm build`, so there is no need to repeat them in separate host steps.
Smoke checks assert `/` 404 and `/api/v1/health` 200 through Compose ingress for rollout and rollback, and verify unauthenticated submission-file access returns 401 and the canonical Vercel root returns 200.
`/api/v1/health` actually checks PostgreSQL connectivity and returns 503 if the DB is unreachable — a constant response only proves nginx and the Node process are alive, so cannot support deployment judgment.
Images are tagged with the release tag; no separate persistent deployment-state file is maintained, and running containers themselves are authoritative for deployment state.
If service replacement or smoke fails, roll back once to the `PREV_TAG` image.
Before deployment, verify `FRONTEND_URL` in the production environment file uses `https://`.
DB restore is not automatic; retain backups for manually approved recovery.
Do not use `down -v`.

The exact production choice for submission-file storage is `managed` only.
The backend reads `SUBMISSION_FILE_S3_*`; inject the credential pair only through Jenkins username/password binding, never an env file.
If the candidate and running backend have different non-secret storage tuples, fail closed before backup, build, or rollout.

Retain SDK object backup validating configured endpoint/bucket, manifest SHA-256, PostgreSQL backup, and rollback to the previous backend image.
After cleanup, MinIO mode, credentials, backup, migration holds, and frontend image build/rollback were removed from the production contract.
Local development object-storage is a substitute in `compose.dev.yml`, not part of production Compose.
Local frontend UI development runs on the host through `pnpm dev`, not Compose containers.

### Anti-pattern: putting application authorization verification in CD

CD does not understand application personas or authorization matrices.
CD does not create synthetic users or seed disposable domain state.
CD does not duplicate CI acceptance tests.
That verification belongs to CI or pre-release verification.
CD owns immutable release/image identity, backup, migration, rollout, infrastructure health/smoke, and rollback.
Builds #160/#161 demonstrated a failure mode where production deployment was blocked without test artifacts or domain fixtures even with a verified release.
This coupling makes CD depend on CI and application state, so remove the auth-matrix gate from CD.

Clean up images and backups **only after** a successful deployment.
Never delete the running image or the previous successfully deployed image, because they are rollback targets; remove only older images.
This retention rule, not an image count, is the criterion.
Store PostgreSQL and object backups in the same `BACKUP_DIR` under the same `BACKUP_RETENTION_N` discipline.
The root `Jenkinsfile` is the runtime SSoT; the currently approved value retains backups of the 30 most recent successful deployments.
Each deployment creates PostgreSQL and object snapshots together, so 30 limits same-host disk use while retaining 30 recovery points.
These backups are manual recovery material separate from previous-image rollback and do not replace long-term off-host retention.
A PR changing the value must update `Jenkinsfile` and its checker together and record backup sizes, growth rate, available budget, maximum deployment frequency, and required recovery window in review evidence.
If the value is absent or malformed, the pruner refuses cleanup (fail-closed).
If code and checker diverge, that PR is blocked at merge.

## Alternatives considered

### Build Docker images in CI

- Pros: Validates container build definitions at PR time.
- Cons: Increases CI runtime/cost and duplicates much application-quality verification.
- **Rejected:** Provide necessary rapid feedback through lint, typecheck, tests, and application builds; build images once on the deployment server.

### Registry-based deployment

- Pros: Standardizes image transfer and deployment-history management.
- Cons: Adds registry operations, permissions, transfer cost, and configuration.
- **Rejected:** For a single deployment server, server-local builds tagged by release are simpler and cheaper.

## Consequences

### Enables

- Every PR reports required `ci`, avoiding branch-protection deadlock.
- Removes Docker image-build charges from CI and limits builds to once per deployment.
- Release-tag images and `PREV_TAG` clearly identify deployment/rollback targets; sharing a tag/image namespace avoids separate mapping state.
- Publishing one non-draft, non-prerelease GitHub Release authorizes deployment; GitHub Release publication permissions control the actor.
  People initiating deployment need not memorize an out-of-repository string protocol.
- Re-delivering the same/lower Release is a no-op, so webhook redelivery does not cause duplicate deployment.
- After unblocking submission files, smoke directly asserts unauthenticated 401 and normal authenticated behavior through Compose ingress, proving access control and the normal path on each deployment.
- Because `/api/v1/health` checks PostgreSQL connectivity, a deployment unable to reach the DB cannot pass smoke.

### Costs / trade-offs

- Adds operational responsibility for Jenkins/deployment-server webhooks, Docker, and Compose.
- Deployment authorization is recorded in GitHub Release publication history and audit logs, not repository comments.
  To identify who deployed a tag, consult GitHub Releases/audit logs rather than repository comments.
- Anyone with Release publication permission can change production without a separate procedure.
  Managing that permission list is the substance of deployment control, so granting collaborator rights carries the same weight as granting deployment authority.
- Disabling frontend Git auto-deploy removes PR preview URLs.
  This is the cost of the Hobby allowance and Release-only authorization.
- `vercel.json` and dashboard auto-deploy settings may differ until the next `frontend-release-deploy` CLI application.
  The repository cannot lock down dashboard Redeploy or deploy hooks that remain in use.
- Local build images cannot be reused off-server, and greenfield failures cannot be automatically rolled back.
- DB restoration after migrations is outside automatic rollback, requiring verified backups and a responsible person for manual recovery.

### New constraints

- The GitHub Actions required job must be named `ci` and reported on every PR.
- Path-specific verification and synthetic-only boundaries follow the [CI Verification Contract by Changed Path](../rules/ci-path-verification.en.md).
- Jenkins handles production deployment only; GitHub Actions `ci` alone validates main.
  Jenkins processes only the current latest full GitHub Release.
- Production deployment is triggered by outbound convergence using `cron('H/10 * * * *')`.
  There is no public Jenkins endpoint or GitHub deploy secret; parameterless manual execution through the tailnet is the recovery path.
  Jenkins' own latest-Release lookup selects the target.
- Send deployment failure notifications through Jenkins email-ext; recipients/SMTP belong only in Jenkins UI configuration (Manage Jenkins → System → Extended E-mail Notification, Default Recipients + SMTP).
  Do not store email addresses in the repository.
- Publishing a non-draft, non-prerelease GitHub Release grants deployment authorization; Jenkins requires no separate approval marker.
  GitHub Release publication permissions control actors, so that permission list is the deployment-authority list.
- The only permitted frontend production CLI is `vercel deploy --prod` in `frontend-release-deploy`.
  Git `source=git` automatic deployment is prohibited; the repository contract is `git.deploymentEnabled: false` in `apps/frontend/vercel.json`.
- Keep `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` only in GitHub repository secrets, not local env or `.env.example`.
- Before frontend changes enter main, the owner confirms Vercel Production/Preview auto-deploy and unused deploy hooks are disabled and the three secrets above are registered.
- The tag commit must be an exact SHA passing main ancestry.
  Tag-tampering defense combines three fail-closed checks: Jenkins targets only the latest full Release it queried itself; tags must be full `vMAJOR.MINOR.PATCH`; and their exact SHA must belong to main history.
  If the running SemVer is equal or higher, execution is a no-op, so arbitrary tag rewriting cannot force a downgrade.
  Maintain no persistent deployment-state file; running-container labels are the evidence.
- Jenkins runs only on the dedicated `oss-hub-production` executor with Docker permissions; concurrent executions are prohibited.
  Inject the production environment file only at execution time through a Credentials Store file credential.
  Inject the GitHub App private key similarly as a file credential, passing it as a file, not an env value — env values appear in plaintext in `docker compose config`, `docker inspect`, and process-env dumps.
  The pipeline installs the injected key with `0640` permissions in a per-build generation directory under `SECRETS_DIR`, atomically replaces the `current` symlink, and Compose reads that path as its secret source.
  Installation must occur before the first stage invoking Compose.
- Fix `COMPOSE_PROJECT_NAME`; do not use `down -v`, which deletes `pgdata` and existing data.
- Production Compose contains the backend, PostgreSQL, and API-only nginx on `127.0.0.1:8081`; object storage is managed R2.
  Accept only canonical/loopback Hosts, return 404 for root/non-API paths, and forward only `/api/v1/` and the exact OAuth callback to the backend.
  Use the local object-storage substitute only in `compose.dev.yml`.
- The public API origin uses an exact DNS Host and domain certificate.
  Reject unknown Host/TLS SNI, non-API paths, direct unauthenticated requests, and unintended methods.
  The Vercel route overwrites browser `Authorization` and injects the sensitive credential paired with the host-only Basic verifier; host nginx strips the origin credential and Vercel identity header before forwarding to the backend.
  Rate limits key on the authenticated Vercel client header.
- Inject Compose nginx configuration through a **directory mount** (`./deploy/nginx:/etc/nginx/conf.d:ro`).
  A single-file bind mount pins the inode at container creation, while Jenkins replaces the file on each Git checkout, leaving a long-lived nginx container serving old configuration unrelated to the repository.
  A directory mount makes the container read the current file each time.
- Checks reading repository files alone do not prove running configuration matches the repository.
  Deployment smoke actually calling Compose ingress proves the running-configuration contract.
- Deployment smoke asserts `/` 404 and `/api/v1/health` 200 through Compose ingress on rollout and rollback, plus unauthenticated submission-file 401 and normal API ingress behavior.
  The implementation PR defines the exact submission-file assertions; `/api/v1/health` checks actual PostgreSQL connectivity and returns 503 if unreachable — constant 200 is not deployment evidence.
- Certbot automatically renews the exact origin DNS certificate through webroot and reloads host nginx after successful renewal.
  Certificate renewal failure must trigger an operational alert before expiry.

## Changelog

- 2026-09-25: Removed the production-like local Docker stack (`pnpm local:up`/`local:verify`/`local:down`, `compose.local.yml`, `deploy/nginx-local/`).
  Its backend image build, `prisma migrate deploy`, and `nginx -t` checks are rerun by Jenkins on every release deployment; its only unique check, object-storage smoke, targeted a service absent from production `compose.yml`, and CI checked only argument shapes through fake Docker without ever running the stack.
  Also, `.env.example`'s `MAIL_MODE=dry-run` conflicted with the backend image's fixed `NODE_ENV=production`, requiring actual Gmail credentials locally.
  CI required checks and the Jenkins release path (M7) replaced pre-deployment production-like integration verification.
- 2026-09-25: Replaced the local/CI-only object-storage substitute in `compose.local.yml`/`compose.dev.yml` from MinIO with `adobe/s3mock` (service name `object-storage`).
  This addressed the root cause of CI backend integration failures caused by 401 responses from `quay.io/minio`; production managed R2 and the SSRF-prevention allowlist structure for storage mode strings (`local`/`managed`) were unchanged.
- 2026-09-04: Prohibited frontend Git auto-deploy through the repository contract.
  `git.deploymentEnabled: false` in `apps/frontend/vercel.json` is authoritative; production CLI is limited to Release → `frontend-release-deploy`.
  `VERCEL_*` belongs only in GitHub secrets, not local env.
  Disabling dashboard auto-deploy is pre-merge bootstrap.
- 2026-09-03: Moved frontend deployment from manual `vercel --prod` on personal machines to the non-required `frontend-release-deploy` job.
  At investigation time, all five Vercel production deployments were `source=cli`, and the pipeline could not prove which commit was deployed.
  Unified deployment authorization around GitHub Release publication and narrowed scope by diff against the preceding full SemVer release tag, leaving releases without frontend changes as no-ops.
  Added a separate job within the existing single `ci.yml` rather than another workflow; required-check names (`ci`, `public-safe`) and Jenkins backend convergence were unchanged ([#1172](https://github.com/JNU-SWCU/oss-hub/issues/1172)).
- 2026-09-02: Froze the custom-domain threat model.
  Adopted Vercel request transform + origin Basic auth, exact origin Host/domain TLS, trusted client-key rate limits, unknown Host/method rejection, backend header stripping, and outbound Jenkins convergence; removed public Jenkins triggers, IP certificates, and the direct-origin browser surface.
- 2026-09-02: After an owner waiver, removed the production MinIO service, volume, credentials, and hold branch, plus AWS frontend image/runtime.
  Production retains only managed R2, backend, PostgreSQL, and API-only ingress; local substitutes were isolated in `compose.local.yml`.
- 2026-09-01: Added the private managed R2 transition contract.
  Specified then-current production MinIO state and checkpoint A; established checkpoint B's sole Vercel frontend/AWS frontend removal conditions, explicit storage mode, credential separation, configured-endpoint fail-closed backup/restore, isolated rollback drill before activation, reverse-copy/check rollback after R2 writes, observation after G8 and a one-time `ROLLBACK_HOLD_START` only when all canonical gates are green, 72-hour retention, and nondestructive cleanup.
  [Issue #1113](https://github.com/JNU-SWCU/oss-hub/issues/1113) remains authoritative for implementation progress; this amendment did not mean cutover was complete.
- 2026-08-25: Recorded `BACKUP_RETENTION_N=30` in the root `Jenkinsfile`, the runtime SSoT, as the current approved value.
  Preserve PostgreSQL/object recovery points for the latest 30 successful deployments together to limit same-host disk use; previous-image rollback and long-term off-host retention are separate contracts.
  Future value changes review code, checker, and calculation rationale together in one PR (#1027).
- 2026-08-04: First merged the `event=push` green `ci` job gate (#596) into root `Jenkinsfile` and enabled it fail-closed, then removed deployment-time revalidation (`빌드·테스트 검증`: `pnpm install --frozen-lockfile`, `prisma generate`, lint, typecheck, tests, build) **after** demonstrating the gate in both directions through actual deployment.
  Evidence: (1) the gate rejected incident commit `8cdbe05`, merged before `ci` completed; (2) `32da8e3e`, confirmed green in `ci`, deployed as Release `v0.6.24` with Jenkins build #58 SUCCESS (5 minutes 18 seconds), logging `CI_STATUS_GATE=ok run_id=30884101311 conclusion=success`, and the deployment host's running backend/frontend containers were verified as `v0.6.24` images.
  Both Dockerfiles (`apps/backend`, `apps/frontend`) independently perform `pnpm install --frozen-lockfile`, `prisma generate`, and `pnpm build` within image builds, so repeating them on the host was unnecessary from the start.
  Reversing the order — removing revalidation before the gate — could have deployed unverified commits during the unproven-gate window; therefore, the removal was prepared but not merged until the gate was demonstrated in real deployment.
- 2026-08-04: Updated merge-review wording following ADR-005's deletion of the `MERGE_READY` comment protocol and `merge-policy` evaluator — merge gates are only actual required-check (`ci`, `public-safe`) success and GitHub mergeability.
- 2026-08-03: Added submission-file object backup as a fail-closed deployment step governed by the same `BACKUP_DIR`/`BACKUP_RETENTION_N` as PostgreSQL backups.
  Restricted unblocking Compose nginx to a separate high-risk change after off-host object backup and the runbook's restore drill; changed post-unblocking smoke from upload-path 403 to unauthenticated 401 plus normal authenticated behavior, with exact assertions defined by the implementation PR.
- 2026-07-29: Demonstrated the automatic path from Release v0.4.1's `published` event → `deploy.yml` → parameterless Jenkins #27 → production health, and removed nonexistent `release.yml`, `workflow_call`, and manual deploy-dispatch targets to converge on the final operational path.
- 2026-07-29: Completed transition to the single root `Jenkinsfile` parameterless Release pipeline.
  Verified actual v0.3.1 deployment, loopback/TLS health, and an independent no-op rerun; removed the legacy pipeline, parallel `Jenkinsfile.v2`, and dual checker modes.
- 2026-07-28: Removed deployment-trigger parameters and changed the contract so Jenkins queries the latest Release itself.
  Unified image tags with release tags, abolished persistent deployment-state files and `RUN_MODE` branches, and identified `RELEASE_ACCEPT role=PM` approval binding as authoritative for tag-tampering defense.
  Separated release publication (`release.yml`) from deployment triggering (`deploy.yml`) to allow deployment-only retries.
  This amendment described the target state; implementation would proceed sequentially through follow-up PRs for [#305](https://github.com/JNU-SWCU/oss-hub/issues/305).
- 2026-07-28: Under Issue #199, changed production deployment approval to @GoBeromsu-only `RELEASE_ACCEPT role=PM` and abolished `RELEASE_ACCEPT role=TECH_LEAD` and `RELEASE_OVERRIDE role=PM`.
- 2026-07-25: In the v0.1.2 live rollout, found a failure because Nest produced `dist/src/main.js` while the backend image CMD ran `dist/main.js`; aligned runtime entrypoint and static contract with the actual output.
- 2026-07-25: In the v0.1.1 live build, found that `pnpm install` in the reused Jenkins workspace did not rerun postinstall, causing lint failure with a stale Prisma client; added explicit `prisma generate` to verification.
- 2026-07-25: Added the public exact-tag/SHA `RELEASE_OVERRIDE role=PM` exception for cases where the PM explicitly ends approval waiting and directs immediate production execution.
  Retained the default dual PM/Tech Lead approval.
- 2026-07-25: Based on Jenkins CSRF live probes, replaced the job build token with Basic authentication using the dedicated `oss-hub-deployer` API token, retaining the exact POST public boundary.
- 2026-07-25: Added production public-ingress contracts for host nginx TLS termination, loopback Compose ingress, and automatic renewal of short-lived IP certificates; separated internal and TLS smoke.
  Actual addresses belong only in the operational credentials vault.
- 2026-07-24: Changed production triggers from signed release webhooks to GitHub Actions (`deploy.yml`) → Jenkins built-in remote trigger (nginx reverse proxy/build token), and added email-ext (`$DEFAULT_RECIPIENTS`) deployment failure notifications.
  Retained the `RELEASE_ACCEPT` approval gate (deployment-trigger transition PR).
- 2026-07-23: Explicitly designated GitHub Releases as deployment candidates and fixed dual PM/Tech Lead `RELEASE_ACCEPT` on the same tag/SHA as the human production-approval point (#225).
- 2026-07-22: Changed the production approval unit to GitHub Release and added contracts for main-only verification, exact SHA, no-op, backup, and manual DB recovery (#199).
- 2026-07-16: Added the path-specific verification contract link.
- 2026-07-11: initial decision

## References

- [GitHub Actions](https://docs.github.com/actions)
- [Jenkins Pipeline](https://www.jenkins.io/doc/book/pipeline/)
- [Docker Compose](https://docs.docker.com/compose/)
