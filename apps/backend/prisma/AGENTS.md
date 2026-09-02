<!-- init:managed id=craft-init-backend-prisma sha256=9f8454b4c0d1fecdbc2aa021e9a71b1cf8a3a6d8c84d6824e5b33e6d73cc7ea3 -->
# Prisma persistence

`apps/backend/prisma/` owns the PostgreSQL model, immutable migration ledger, and gated seed profiles.

## Owned contracts

- `schema.prisma` defines Prisma-expressible models, enums, relations, mappings, and the generated client contract.
- `migrations/` also owns PostgreSQL-only constraints, partial indexes, backfills, checks, and triggers that Prisma schema cannot express.
- Never delete, rename, reorder, or rewrite a deployed migration directory; add a new migration and keep migration PRs serial.
- Create ordinary development migrations with `pnpm --filter backend db:migrate:dev`; the package script runs `scripts/check-host-db-url.sh` before `prisma migrate dev`.
- Hand-authored SQL is allowed only when the contract requires SQL beyond `schema.prisma`; cover it in the relevant `prisma/*migration*.spec.ts`/`*.integration.spec.ts` lane or specialized `scripts/*migration*.test.*` contract.

## Seed authority

- `README.md` is the seed profile and environment-gate contract; `seed.ts` dispatches implementations under `seeds/`.
- Run seeds through `pnpm --filter backend db:seed`; `SEED_PROFILE` or `-- --profile <name>` selects a profile.
- Keep the ordinary `oss-hub` profile non-production and deterministic.
- The approved `demo` production-capable profile remains separately gated and must not create `GithubRepository` or `Contribution` collection/ranking authority rows.
- Never hand-write ranking history, collection rows, or contribution truth in a seed; only the application sweep path owns those records.
- Preserve deterministic identifiers and idempotent upserts for profiles that declare rerun support.

## Boundaries and evidence

- Nest controllers, services, repositories, and HTTP policy stay under `src/`; repositories consume the client through `src/prisma/prisma.service.ts`.
- Do not edit generated Prisma client output.
- Current model source: `schema.prisma`.
- SQL-only example: `migrations/20260731130000_enforce_audit_log_append_only/migration.sql`.
- Seed gates and helpers: `README.md`, `seeds/helpers.ts`, `seed.integration.spec.ts`.
- Migration ledger and concurrency checks live in `scripts/prisma-migration-ledger.test.mjs` and related migration contract tests.
<!-- /init:managed id=craft-init-backend-prisma -->
