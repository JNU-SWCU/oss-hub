# Deployment Server Runbook — Bringing the Jenkins Release Pipeline into Operation

[한국어](server-runbook.md) | **English**

English translation of the [Korean source](server-runbook.md).
The Korean document remains authoritative.

This runbook is the single owner of the manual procedure for bringing the ADR-002 Jenkins Release deployment pipeline into operation on the deployment server **for the first time**.
The repository-root `Jenkinsfile` owns the pipeline definition; this runbook describes steps and verification criteria rather than duplicating its commands.
[ADR-002](../decisions/ADR-002-CI-CD-파이프라인.en.md) owns authorization units, triggers, and the rollback contract.

## 0. Absolute boundaries (read first)

- **There is only one target server.** Every connection and command in this runbook applies solely to the JNU OSS Platform deployment EC2 instance in `ap-northeast-2`.
- **Do not connect to any other host in the Tailscale network, including servers unrelated to production.** This runbook has no procedure for connecting to another tailnet host, and none may be added.
- **Do not record actual secrets, tokens, PATs, public IP addresses, instance IDs, or other access details in this repository.** Resolve the `<...>` placeholders below through the **operations credentials vault** (§8). Do not record vault-internal paths or note names here: this document is tracked in a public repository.

## 1. Notation

- `<INSTANCE_ID>` — deployment EC2 instance ID (actual value: operations credentials vault).
- `<EC2_TAILSCALE_HOST>` — deployment EC2 Tailscale hostname (actual value: operations credentials vault).
- `<GITHUB_OWNER>/<GITHUB_REPO>` — deployment repository (see the release-validation URL in `Jenkinsfile`).
- `<JENKINS_ADMIN_USER>` — individual Jenkins administrator account (actual value: operations credentials vault).

- Each step has three parts: **command → expected output → verification**. Adapt distribution/version differences while preserving the intent of the step.
- Use one of two connection methods: AWS SSM Session Manager or Tailscale SSH. Do not open public SSH port 22.
- Compose ingress smoke checks use `http://127.0.0.1:8081`. Public TLS smoke checks follow the host nginx contract in `Jenkinsfile`.

## M1. Connect to the server (deployment EC2 only)

```sh
# SSM Session Manager
aws ssm start-session --target <INSTANCE_ID> --region ap-northeast-2
# Or Tailscale SSH
ssh ubuntu@<EC2_TAILSCALE_HOST>
```

- Expected output: `Starting session with SessionId: ...` or an SSH prompt.
- Verification: first confirm **the correct target server** by checking `hostname` and `curl -s http://169.254.169.254/latest/meta-data/instance-id` (IMDS) against `<INSTANCE_ID>`. Exit immediately if they do not match.

## M2. Install Docker, Jenkins, and the build toolchain

The pipeline executor performs Docker image builds and application builds (lint/typecheck/test) on the server, so Docker and Node/pnpm/jq are all required.
The Buildx plugin is also required: cleanup before deployment and after success calls `docker buildx prune --all --force --max-used-space "$BUILD_CACHE_MAX_SPACE"`, and preflight fails unless Buildx supports that option.
This command targets only BuildKit cache, leaving running images, named volumes, and backups intact.
The verified production-server baseline is Buildx `v0.35.0`; check support for `--max-used-space` before using an older version.
`BUILD_CACHE_MAX_SPACE` was reduced from `10GB` to `5GB` on 2026-08-01: measurements showed about 2.6GB of cache growth per build generation, and the preceding build (#31) reused no records from earlier generations (last-accessed timestamps did not change), so older generations occupied space without contributing cache hits.
The limit was lowered on the evidence that keeping the latest two generations was sufficient (after `docker buildx prune --all --force --max-used-space 5GB`, usage converged to 5.64GB, only the latest two generations remained, and no problem was found).
In v0.6.124, the previous successful cleanup without `--all` excluded shared/internal BuildKit records, leaving 87.57GB and filling the production root filesystem to 100%.
The same `--all` command now runs before image building and the pre-deployment backup, and again after success, so shared/internal records are also cleaned toward the 5GB limit.
Immediately after a build, in-use layers of running images remain protected and may temporarily exceed the limit (after v0.6.1 deployment, `docker buildx du` measured 11.07GB, temporarily exceeding even the former 10GB limit); this is intentional behavior, not a defect.
One reason earlier generations failed to contribute hits was fundamental layer invalidation, rather than generation size: the backend Dockerfile's `dependencies` stage copied the entire `apps/backend/prisma` directory (43 files including eight spec files, seed scripts, and a README) before `RUN pnpm install`.
A release changing only spec files therefore invalidated everything from the approximately 732MB install layer onward (v0.6.0→v0.6.1: lockfile, package.json, and Dockerfile were byte-identical; only Prisma spec files changed; build #31 logged only four CACHED entries).
Because `@prisma/client` postinstall (`prisma generate`) needs only `schema.prisma`, narrowing COPY to that file fixed the root cause and stopped spec-file edits invalidating the install layer (P1).
Both backend and frontend Dockerfiles also pin the pnpm store through a BuildKit cache mount (`--mount=type=cache,id=pnpm-store,target=<pnpm store path>`) on `pnpm install`, so a genuine lockfile change can reuse downloaded packages without fetching them again (P2).
Local verification confirmed CACHED install layers in two consecutive builds of each image; a harmless Prisma spec-file edit still retained the cached install layer, while changing `schema.prisma` itself caused the intended miss, confirming that necessary invalidation still works.

```sh
# Docker Engine and compose/buildx plugins (Ubuntu)
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin docker-buildx-plugin jq
sudo systemctl enable --now docker

# Node 24 and pnpm 11 (corepack)
# After installing Node 24 according to distribution policy:
corepack enable
corepack prepare pnpm@11 --activate

# Jenkins (LTS). Bind the administration UI only to 127.0.0.1:8080.
# Follow organizational installation standards (package or container), then pass the checks below.
```

- Expected output: each installation command completes without error.
- Verification:

```sh
docker --version          # Docker version 2x.x.x
docker compose version    # Docker Compose version v2.x.x
docker buildx version     # github.com/docker/buildx v0.35.0 or later (--max-used-space required)
node -v                   # v24.x.x
pnpm -v                   # 11.x.x
jq --version              # jq-1.x
sudo ss -ltnp | grep 8080 # Jenkins LISTEN only on 127.0.0.1:8080, never 0.0.0.0:8080
```

- Access the Jenkins administration UI only through a Tailscale/SSM tunnel. Do not expose public port 8080.

## M3. Credentials and backup directory

```sh
# Register the production environment as a secret file in Jenkins Credentials Store (UI or JCasC).
#   credential id: oss-hub-production-env
#   Never put actual values in this repository. Operations credentials vault → Jenkins Credentials Store only.

# Backup directory (owned by Jenkins, 0700)
sudo install -d -m 700 -o jenkins -g jenkins /var/lib/oss-hub/backups
```

Inject GitHub App private keys as file secrets, not environment strings.
The root directory prepared once by an operator is shown below; the source records it as already configured on the current server.

```sh
sudo install -d -o jenkins -g 1000 -m 2750 /var/lib/oss-hub/secrets
```

- Keep ownership `jenkins:1000` and setgid mode `2750` on this directory.
- Register two file credentials in Jenkins Credentials Store: `oss-hub-collection-app-private-key` and `oss-hub-operations-app-private-key`.
- The source files for these credentials are operator-managed `collection.pem` and `operations.pem` from a new generation.
- Inside the container, `github_collection_app_private_key` and `github_operations_app_private_key` mount at `/run/secrets/github_collection_app_private_key` and `/run/secrets/github_operations_app_private_key`; the application reads only the corresponding `*_PRIVATE_KEY_FILE` variables.
- The Jenkinsfile pipeline `environment` already injects `GITHUB_COLLECTION_APP_PRIVATE_KEY_SOURCE` and `GITHUB_OPERATIONS_APP_PRIVATE_KEY_SOURCE`; do not duplicate these keys in `oss-hub-production-env`.
- Supply the same values through shell environment variables or a temporary env file only for manual Compose runs.
- The Jenkinsfile stage `개인키 검증 및 안정 경로 설치` (private-key verification and installation at stable paths) installs only keys that pass real GitHub authentication into a new generation, immediately before the `실행 중 이미지 기준 no-op...` (no-op based on the running image) stage.

`compose.yml` requires the following keys through `${VAR:?...}`.
If any is missing, Compose stops during interpolation, including commands targeting a single service such as `up -d postgres`.
All except `IMAGE_TAG` must be in `oss-hub-production-env`.
`compose.yml` is authoritative and this table is a copy; trust `compose.yml` if the lists differ.

| Key | Purpose |
| --- | --- |
| `IMAGE_TAG` | Backend image tag. **Do not put it in the env file**: Jenkins injects the SemVer tag of the latest full Release (`Jenkinsfile`). Set it in the shell only for manual production Compose runs |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | PostgreSQL service credentials |
| `DATABASE_URL` | Connection string pointing to the PostgreSQL service DNS |
| `SESSION_SECRET` | Session-signing secret |
| `TEAM_JOIN_CODE_SECRET` | Team join-code signing secret |
| `FRONTEND_URL` | Frontend base URL used for OAuth callback derivation and related purposes |
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth sign-in application |
| `GITHUB_COLLECTION_APP_ID` / `GITHUB_APP_ORG` | GitHub activity Collection App identifier and target organization |
| `GITHUB_COLLECTION_APP_PRIVATE_KEY_SOURCE` | Sole host input path for the `compose.yml` secret `github_collection_app_private_key`: `/var/lib/oss-hub/secrets/current/collection.pem` |
| `GITHUB_OPERATIONS_APP_ID` | GitHub App identifier for repository creation and configuration changes |
| `GITHUB_OPERATIONS_APP_PRIVATE_KEY_SOURCE` | Sole host input path for the `compose.yml` secret `github_operations_app_private_key`: `/var/lib/oss-hub/secrets/current/operations.pem` |
| `SUBMISSION_FILE_STORAGE_MODE` | Production permits only the exact value `managed` |
| `SUBMISSION_FILE_S3_*` | Backend storage configuration. The managed credential pair is injected only through Jenkins username/password binding, not the env file |
| `MAIL_MODE` | Exactly `send` or `dry-run`. Production delivery uses `send` and validates all four Gmail credentials below; `dry-run` permits empty values |
| `GMAIL_SENDER` / `GMAIL_OAUTH_CLIENT_ID` / `GMAIL_OAUTH_CLIENT_SECRET` / `GMAIL_OAUTH_REFRESH_TOKEN` | Deadline-notification sender credentials required when `MAIL_MODE=send`; empty values are allowed in `dry-run` |

Do not put actual `SUBMISSION_FILE_S3_*` values in this repository.
Do not put the managed credential pair in the production env file either; inject it only through Jenkins masked binding.
When adding or removing env keys in `compose.yml`, update this table in the same PR.

`GITHUB_PUBLIC_READ_TOKEN` is a fine-grained GitHub PAT dedicated to collecting external public repositories (both REST and GraphQL), and is absent from the table above.
`GITHUB_COLLECTION_APP_*` (Collection GitHub App installation tokens) cannot read repositories outside the organization's installation scope, and GitHub GraphQL v4 does not accept OAuth App client_id:client_secret Basic Auth, so this path uses one PAT.
`compose.yml` does not require it through `${VAR:?...}` because organization collection must start and operate without it.
An empty value fails closed only when external collection is actually attempted; it must not silently become a zero-result collection.
Issue this PAT through the program office's service account: a personal account risks interrupting external collection when that person leaves and tying public-repository query history to their real identity.
Set an expiry date and assign renewal responsibility.
Store the value only in the deployment secret store, like other GitHub App credentials.

#### Collection has three operational surfaces (added 2026-08-19)

The hourly scheduler runs three sweeps per tick.
When investigating a failure, first identify which surface has stopped.

| Sweep | Reads | Populates | Credentials |
| --- | --- | --- | --- |
| org | Organization repository inventory and details (REST) | `Contribution` and the three fact tables | `GITHUB_COLLECTION_APP_*` installation token |
| external | Registered repositories outside the organization (REST) | Same as above | `GITHUB_PUBLIC_READ_TOKEN` |
| **person** | Annual activity of registered ACTIVE users (GraphQL) | `GithubUserActivityHistory` | `GITHUB_PUBLIC_READ_TOKEN` (the same PAT) |

**The person sweep is the third surface.**
Public rankings now read only this surface, so rankings can keep updating while org/external collection is stopped; conversely, the ② program screen may work while rankings stop.
Do not interpret them as the same symptom.
The read-only `scripts/diagnose-collection.sh` shows both at once.
The rationale for these axis boundaries is in the 2026-08-19 revision note of [ADR-010](../decisions/ADR-010-contribution-tracking-context.en.md).

#### Rotate GitHub App private-key file secrets

- Generation layout: `${SECRETS_DIR}/gen-<BUILD_NUMBER>/{collection,operations}.pem`; active pointer: the `${SECRETS_DIR}/current` symlink.
- If both Jenkins file credentials match the active generation, skip creating a generation and recreating the backend. Create `gen-${BUILD_NUMBER}` only if at least one differs; old generations are not automatically deleted. Clean them manually if necessary, but never delete a generation referenced by `current` or a running rollback target.
- Point a new symlink to the new generation with `ln -sfn`, then atomically replace the pointer with `mv -T`.
- Use file mode `0640` only, never `0644`.
- A host check using `sudo -u '#1000' cat /var/lib/oss-hub/secrets/current/*.pem` always fails because the parent `/var/lib/oss-hub` is `700 jenkins:jenkins`. This is blocked path traversal, not a permissions defect.
- Always verify readability through the container.
- Jenkins verifies the symlink replacement, recreates the backend with `--force-recreate`, and checks that both mounted files match the active generation.
- There is no value-based fallback. If key rotation fails, restore both the previous generation symlink and the backend.

### Submission-file storage configuration

Explicitly set production storage mode to `SUBMISSION_FILE_STORAGE_MODE=managed`.
The backend uses `SUBMISSION_FILE_S3_ENDPOINT`, `SUBMISSION_FILE_S3_REGION`, `SUBMISSION_FILE_S3_BUCKET`, `SUBMISSION_FILE_S3_ACCESS_KEY_ID`, `SUBMISSION_FILE_S3_SECRET_ACCESS_KEY`, and `SUBMISSION_FILE_S3_FORCE_PATH_STYLE`.

In managed mode, Jenkins username/password binding supplies the access-key pair; approved runtime configuration supplies endpoint, region, bucket, and path-style.
Operators verify the applied key names and matching configured endpoint/bucket without printing secret values.
Missing values, default fallback, or target mismatches fail closed.

- Verification:

```sh
stat -c '%a %U %G %n' /var/lib/oss-hub/backups
# 700 jenkins jenkins /var/lib/oss-hub/backups
```

- Confirm that `oss-hub-production-env` appears in Credentials Store and that secret-file contents are not printed in logs or the workspace.

## M4. Parameterless Jenkins job

`Jenkinsfile` retrieves the latest full Release without input parameters and deploys on the `oss-hub-production` agent.

- The Pipeline job reads only the root `Jenkinsfile` from main SCM.
- Do not define Jenkins parameters.
- Assign `oss-hub-production` to an executor with Docker privileges; schedule no work other than this job and authorized operator tasks on it. `Jenkinsfile` enforces `disableConcurrentBuilds()`.
- `cron('H/10 * * * *')` outbound convergence owns automatic execution. For manual recovery, run a parameterless build through tailnet Jenkins. There is no public build endpoint.
- Verification: confirm script path `Jenkinsfile`, branch `main`, and zero parameter definitions in the job configuration.

## M5. Prepare GitHub API access

Release validation in `Jenkinsfile` calls GitHub API `releases/latest`.
Because the repository is public, unauthenticated access (60/hour) also works.

- **Prepare and document** a read-only PAT in Jenkins Credentials Store for rate limits and possible future private access.
- **Changing `Jenkinsfile` to add an authentication header is outside this runbook's scope.** The current pipeline uses unauthenticated curl.
- Never leave the PAT value in the repository, PRs, or logs. Operations credentials vault → Jenkins Credentials Store only.

## M6. Pre-deployment verification (local → EC2 dry run)

Before the first Release end-to-end run, pass the [pre-deploy-verify](./pre-deploy-verify.en.md) stages in order: ⓪ destructive migration rehearsal where applicable, then ① a server-local dry run on the deployment EC2 instance.
Proceed only after the preceding stage passes.

- Verification: ① reads the deployment server's current backend image metadata, loopback root 404, `/api/v1/health` 200, and submission-file authentication boundary without modifying state. The `Jenkinsfile` rollout smoke test owns expected upload responses.

## M7. First manually triggered Release end-to-end run

1. Publish a full GitHub Release (for example, `v0.1.0`) for an exact commit on main (`draft=false`, `prerelease=false`, tag SHA in main ancestry). Publication authorizes deployment; do not add a separate approval comment ([ADR-002](../decisions/ADR-002-CI-CD-파이프라인.en.md)).
2. Manually trigger the M4 job without parameters.
3. Verify the sequence in console logs: exact-SHA detached checkout → production env and rollback preflight → PostgreSQL and managed-object backup → server-local backend image build → `prisma migrate deploy` → `up -d --no-build --wait` → loopback Compose ingress smoke → public TLS smoke. Required pre-merge CI owns lint/typecheck/test; Jenkins does not repeat them.

- Expected output: loopback `/` returns 404, loopback/TLS `/api/v1/health` returns 200, public TLS `/` returns the canonical 308, and submission-file paths match the expectations in [pre-deploy-verify](./pre-deploy-verify.en.md) ②. The backend image OCI version is the Release tag and its revision is the exact 40-hex SHA.
- Verification:

```sh
docker compose --env-file "$OSS_HUB_ENV_FILE" ps
test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8081/)" = 404 && echo "root closed"
curl -fsS \
  -H 'Host: jnu-oss-hub.com' \
  -H 'X-Vercel-Forwarded-For: 192.0.2.1' \
  http://127.0.0.1:8081/api/v1/health > /dev/null && echo "health OK"
# Use the exact commands for the five upload paths in pre-deploy-verify ②; copying expectations here creates divergence.
# Once host nginx and certificate contracts are ready, check public TLS smoke through the same paths as Jenkinsfile.
```

- `/api/v1/health` 200 also confirms the PostgreSQL connection. It returns 503 if the DB cannot be reached, so this step verifies DB availability as well.
- **Recheck no-op behavior:** run the job again without parameters and verify that it proves the running tag/revision matches the latest Release and finishes as a successful no-op.
- On failure: a first deployment without `PREV_TAG` has no automatic rollback target. Preserve logs and backups and recover manually. Do not use `down -v`.

## M8. Managed R2 production contract

Production submission-file storage is private managed R2 (cutover and cleanup completed 2026-09-02; receipt in [Issue #1113](https://github.com/JNU-SWCU/oss-hub/issues/1113)).
The MinIO service, volume, credentials, migration/hold branches, and AWS frontend runtime were removed.

1. `SUBMISSION_FILE_STORAGE_MODE` must be exactly `managed`.
2. Endpoint must be the approved Cloudflare R2 HTTPS endpoint, region `auto`, and path-style `true`.
3. Inject the access-key pair only through Jenkins masked binding; never record it in the production env file, console, workspace, or command arguments.
4. If candidate and running-backend non-secret storage tuples differ, fail closed before backup, build, or rollout.
5. Before replacing the backend image, a Release creates an SDK object backup using the configured endpoint/bucket, a manifest SHA-256, and a PostgreSQL backup.
6. Permit rollback only when the captured previous backend image ID, version, and revision match exactly. There is no rollback that changes object-storage mode.
7. Production Compose root and non-API paths return 404; only `/api/v1/` and the exact OAuth callback are forwarded to the backend. The local-development object-storage substitute exists only in `compose.dev.yml` and is not part of the production contract.

The [Issue #1113](https://github.com/JNU-SWCU/oss-hub/issues/1113) receipt is the historical source for the G0–G9 migration procedure and accepted deviations.
Do not rerun completed migration commands as production-runbook procedures.

### M8-E. Authenticated custom-origin transition (completed 2026-09-02)

The procedure below was completed on 2026-09-02 (Release `v0.6.140`, build 240; receipt in [Issue #1113](https://github.com/JNU-SWCU/oss-hub/issues/1113)).
Do not rerun it; follow the same ordering for credential rotation or disaster recovery.

1. Point the exact origin subdomain to current backend ingress at the DNS provider and lower its TTL. Do not use this domain as the browser origin, OAuth callback, or cookie domain.
2. Issue a certificate for the exact origin DNS name while the existing vhost's ACME webroot remains available, and verify renewal and nginx reload.
3. Create a host-only htpasswd using a high-entropy password from the operations credentials vault and the exact username `vercel`; install it root-owned and read-only to nginx. Do not record the value or verifier in the repository or command logs.
4. Install a **temporary additive configuration** on the live host that adds only the new origin server while retaining the existing vhost. Run `nginx -t`, reload, and directly probe exact DNS/SNI, Basic auth, and method/path rejection. This temporary configuration is not the repository's final configuration; remove it after recording the receipt.
5. Set sensitive `ORIGIN_BASIC_AUTH` in Vercel Production, change `BACKEND_ORIGIN` to the allowlisted exact origin domain, then explicitly promote a new production deployment. Do not inject production credentials into Preview.
6. Verify SSR, OAuth callback, host-only session cookies, public queries, unauthenticated authz, upload bodies larger than 4MiB, file flow, and health from the canonical browser origin.
7. Only after all canonical gates above pass, install final `deploy/host-nginx/oss-hub.conf` and remove the legacy vhost and IP certificate renewal. Recheck that unknown Host/SNI, non-API requests, unauthenticated direct requests, PUT, and OPTIONS remain closed.
8. Record Jenkins timer no-op success, public build endpoint 404, absence of GitHub deploy secrets, and the public port scan in the receipt; restore normal DNS TTL.

If a problem occurs before the canonical gate, leave Vercel production untouched and remove only the temporary origin server.
If a problem occurs after promotion, **first restore the legacy vhost and certificate and pass `nginx -t` and reload**, then promote the previous Vercel deployment.
Reversing that order makes the previous deployment point to an already-removed TLS origin, causing an outage during recovery.

An operator with sudo privileges replaces the configuration while preserving a backup, then applies it under supervision in this order.
Reload only if `nginx -t` succeeds.

```bash
sudo nginx -t && sudo systemctl reload nginx
```

On a problem, restore the previous `oss-hub.conf` backup and repeat the same syntax check and reload.

```bash
sudo cp /etc/nginx/conf.d/oss-hub.conf.bak-<timestamp> /etc/nginx/conf.d/oss-hub.conf
sudo nginx -t && sudo systemctl reload nginx
```

## M9. Apply host nginx configuration

Host nginx is a system service, not part of Compose, and the Jenkins account has no sudo privileges.
Merging a PR that changes `deploy/host-nginx/oss-hub.conf` therefore does not automatically apply it to the server.
Deploying before applying it stops at the fail-closed `호스트 nginx 드리프트 사전 검증` (host nginx drift preflight) stage ([#562](https://github.com/JNU-SWCU/oss-hub/issues/562)).

Use an account with sudo privileges to perform these steps in order.

```bash
# 1. Copy the repository source to the server (run locally).
scp deploy/host-nginx/oss-hub.conf <host>:/tmp/oss-hub-new.conf

# 2. Back up → replace → syntax check → reload (run on the server).
sudo cp /etc/nginx/conf.d/oss-hub.conf "/etc/nginx/conf.d/oss-hub.conf.bak-$(date +%Y%m%d-%H%M%S)"
sudo cp /tmp/oss-hub-new.conf /etc/nginx/conf.d/oss-hub.conf && rm -f /tmp/oss-hub-new.conf
sudo nginx -t
sudo systemctl reload nginx
```

If `nginx -t` fails, do not reload; restore the backup.

After applying the configuration, verify that drift is gone using the deployment account's privileges.

```bash
sudo -u jenkins bash scripts/check-host-nginx-drift.sh
```

The pre-replacement backup remains at `/etc/nginx/conf.d/oss-hub.conf.bak-<timestamp>`; copy it back unchanged when reverting.
The active configuration is `0644`, readable by the deployment account, so this check requires no new privileges.

## M10. Drain OutboxEvent before the unified-team-model migration

Before applying the D5 migration (`Application.teamId` becomes non-nullable), verify there are zero pending repository-provision outbox events.
A running provisioning queue makes queue state ambiguous during a schema change, so draining it first is mandatory.
The worker tolerates legacy events whose payload `teamId` is null (`repository-provision.worker.ts`), but do not rely on that tolerance.

```sh
# Run in the backend container or a shell with DATABASE_URL configured.
docker compose --env-file "$OSS_HUB_ENV_FILE" exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT status, count(*) AS n
   FROM \"OutboxEvent\"
   WHERE type = 'REPOSITORY_PROVISION_REQUESTED'
     AND status IN ('PENDING', 'PROCESSING')
   GROUP BY status
   ORDER BY status;"
```

- Expected output: no rows, or every `n` is 0.
- Verification: proceed with the D5 migration (M11) only when the sum of `PENDING`/`PROCESSING` is 0.
- Otherwise wait for the repository-provision worker to drain the queue, then run the same query again.
- If draining stalls, first inspect `repositories.provision.failed` in worker logs and `OutboxEvent`/`RepositoryProvisionJob` states; do not force the migration through.

### M11. Unified team model (D5) migration — single pass

The release making `Application.teamId` NOT NULL completes in **one migration**.
One `prisma migrate deploy` is sufficient; there is no separate procedure.

The former plan had three stages: structural change → Node backfill → `SET NOT NULL`.
Because `Team.joinCodeDigest` is `HMAC-SHA256(joinCode, TEAM_JOIN_CODE_SECRET)` and cannot be generated in SQL, attaching teams to existing applications with `teamId IS NULL` needed application code.
**This release deploys a newly created schema, so there are no legacy rows to preserve.**
The backfill script was removed.

The migration retains a fail-closed guard.
If even one row has `teamId IS NULL`, it stops as follows.

```
Application.teamId NOT NULL blocked: N legacy application row(s) have teamId NULL
HINT: This release assumes a schema created from scratch. Recreate the database ... and redeploy.
```

This exception means **the migration was incorrectly applied to a populated database**.
It has stopped without changing anything rather than silently corrupting data; recreate the database and redeploy.

```bash
# Roll back the failed migration record; otherwise subsequent deployments are rejected.
docker run --rm --network "${COMPOSE_PROJECT_NAME}_default" \
  --env-file "$OSS_HUB_ENV_FILE" "oss-hub-backend:${IMAGE_TAG}" \
  npx prisma migrate resolve --rolled-back 20260804200000_application_require_team
```

The entire migration is inside one `BEGIN`/`COMMIT`, so no partially applied state remains.

The M10 outbox-drain check remains valid: the reason concerning null `teamId` in pre-backfill events no longer applies, but clearing in-progress provisioning before a schema change remains a safe practice.

## 8. Access-information checklist for the operations credentials vault (delegate to aside)

The **actual values** below belong in the **operations credentials vault**, not this repository (corrected 2026-08-19: the document previously pointed elsewhere, causing operators to search the wrong place; [AGENTS.md Important Files](../../AGENTS.en.md#important-files) — one fact, one source).
Do not publish the vault's name, internal paths, or note names here; ask the operations owner if the location is unknown.
Delegate recording to craft-skills aside, leaving only field names, never values, in this repository, PRs, and logs.

- [ ] Deployment EC2 instance ID, Tailscale hostname, and connection method (SSM/Tailscale).
- [ ] Individual Jenkins administrator account (do not share a common account).
- [ ] Field list for the `oss-hub-production-env` secret file, without values.
- [ ] Location and permission scope of the GitHub read-only PAT, without its value.
- [ ] Backup-directory path, ownership, and permission policy.
- [ ] Location of exact-origin DNS/TLS, host-only verifier, and Vercel sensitive credentials, without values.

## 9. Outside today's scope (follow-up / separate PR)

- Apply GitHub API authentication (PAT) in **`Jenkinsfile`** — a code-change follow-up.
