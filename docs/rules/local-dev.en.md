# Local Development Runbook

[한국어](local-dev.md) | **English**

English translation of the [Korean source](local-dev.md).
The Korean document remains authoritative.

This document describes how to run oss-hub locally.
The scripts in each `package.json` are the authoritative source for execution commands.
This runbook refers to script names rather than listing their underlying commands, so command drift can be addressed in the script definitions alone.

## Prerequisites

- Node >=24
- pnpm 11 (enabled through corepack)
- Docker (to start the local `postgres` and `object-storage` services)
- direnv (loads `.envrc` into the shell)

## Configuration source

The only configuration source for local execution is `.envrc` (direnv).
For the first run, copy `.envrc.example` to `.envrc`, fill in the entries marked "직접 채운다" (fill in manually)—two session-signing keys and the development OAuth values—and run `direnv allow`.
`.envrc` is not tracked.

`.env.example` lists the keys required by production Compose (`compose.yml`); the local execution path does not read it.
`scripts/check-env-example-coverage.mjs` checks that required Compose keys are documented, keys consumed by code are declared, and environment variables are mapped to their owning services (using the TypeScript AST and `docker compose config`).

## Execution path

`pnpm dev` is the only execution path.
The backend and frontend run with hot reload as **host processes**, while only infrastructure (PostgreSQL and object-storage) runs in Docker through `compose.dev.yml`.
Because the applications run on the host, all hostnames are `localhost`, and they use the ports published by `compose.dev.yml`.

- `pnpm dev` first validates required environment variables and checks whether ports 3000 and 4000 are occupied.
  It then starts the infrastructure, applies migrations, and starts both watchers together.
  If either watcher exits, the other shuts down as well.
- If you change the schema, use `pnpm db:migrate:dev` to create a migration file.
  `pnpm dev` only applies migrations that already exist.
- Pass the GitHub App private key as a **file path**.
  Keep the host file in the untracked `secrets/` directory and use the host file path referenced by `.envrc`.
- Caution: values such as `*_PRIVATE_KEY_FILE` that are already exported in the host shell may retain their previous values until `.envrc` exports them again.
  If values are not as expected after `direnv allow`, open a new shell.

## Startup sequence

1. `pnpm install` — install dependencies.
   The backend's `prisma generate` runs automatically during `postinstall`.
2. Copy `.envrc.example` to `.envrc`, fill in the entries marked "직접 채운다" (fill in manually), and run `direnv allow`.
3. `pnpm dev` — start the infrastructure, apply migrations, and start the backend and frontend watchers, in that order.

Open `http://localhost:3000` for the frontend.
Requests to `/api/v1/*` are forwarded to the backend (`http://localhost:4000`) through the rewrite in `next.config.ts`.

## Local GitHub OAuth sign-in

The OAuth callback is derived from `FRONTEND_URL`, so it is `http://localhost:3000/api/v1/auth/github/callback`.
This value is already registered in the development GitHub OAuth App, so no additional configuration is needed.
If you change `FRONTEND_URL` or the port, update the OAuth App registration as well.

Prepare role-specific test accounts with `AUTH_INITIAL_ROLES`.
Follow [onboarding](../onboarding.en.md) for the detailed procedure.

## Operational notes

- In production, host nginx handles public ports 80/443 and TLS, and Compose nginx binds only to `127.0.0.1:8081` ([ADR-002 (Korean)](../decisions/ADR-002-CI-CD-파이프라인.md)).
  **8081 is an internal hop and does not appear in the callback URL.**
  Local `pnpm dev` does not use nginx: the frontend binds directly to port 3000, and the rewrite in `next.config.ts` proxies requests to the backend.
- `pnpm db:up` and `pnpm --filter backend test:integration` use `compose.dev.yml` on its own.
- If you change the schema, create a migration with `pnpm db:migrate:dev`.
  This script runs the Prisma CLI directly on the host, so it uses `DATABASE_URL` from `.envrc` (host `localhost`).
- Before `db:migrate:dev`, `db:reset`, `db:seed`, or `notifications:send-digest` runs, `scripts/check-host-db-url.sh` validates `DATABASE_URL`.
  It rejects a nonlocal host or a mismatch with a `POSTGRES_PORT` or `POSTGRES_DB` override, because `db:reset` runs `prisma migrate reset --force` and could previously delete a different database when overrides were used.
  Credentials are never printed on any execution path.
- Production keeps the backend fail-closed until both the approved object-storage configuration and migrations are ready, and does not use local defaults.
- Production-like integration verification before deployment is handled by required CI checks and the Jenkins release path (image build, `prisma migrate deploy`, `nginx -t`, and health/rollback smoke checks).
  Follow [pre-deploy-verify](../deploy/pre-deploy-verify.en.md) for the detailed procedure.
