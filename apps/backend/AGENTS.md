<!-- init:managed id=craft-init-backend sha256=b9901ea7f6eedb2e4fbeb09d5ca2da1cd69d42c0b796ecca35685c561668c53e -->
# Backend service

`apps/backend/` is the NestJS API package. Start from `package.json`, then follow the nearer guide in `src/` or `prisma/`.

## Commands

```bash
pnpm --filter backend dev
pnpm --filter backend build
pnpm --filter backend typecheck
pnpm --filter backend test:unit
pnpm --filter backend test:integration
pnpm --filter backend db:migrate:dev
pnpm --filter backend db:reset
pnpm --filter backend db:seed
```

- `dev` runs `nest start --watch`; `build` runs `nest build` through `nest-cli.json`.
- `test:unit` excludes `*.integration.spec.ts`; `test:integration` invokes `../../scripts/run-backend-integration.sh`.
- `db:migrate:dev`, `db:reset`, and `db:seed` run `db:guard` before Prisma and target the local host database configured by `DATABASE_URL`.

## Package boundaries

- `src/main.ts` bootstraps the HTTP app, applies validation, and registers the global problem-detail filter.
- `src/app.module.ts` composes Nest modules. Add a module import there only when it belongs in the running application.
- Keep HTTP transport in controllers, use-case orchestration in services, and database queries in repositories using `src/prisma/prisma.service.ts`.
- Inject exported Nest providers or modules for cross-module use; do not import another module's internal DTO or domain implementation.
- `src/prisma/prisma.module.ts` is global. The database schema, migrations, and seed entry point belong in `prisma/`, not in this wrapper.

## Important paths

- `src/app.module.ts` — application module composition.
- `src/main.ts` — bootstrap and global HTTP configuration.
- `src/prisma/prisma.module.ts` and `src/prisma/prisma.service.ts` — injectable Prisma client lifecycle.
- `prisma/schema.prisma` — PostgreSQL schema source of truth.
- `prisma/migrations/` — ordered migration history.
- `prisma/seed.ts` — Prisma seed hook entry point.
<!-- /init:managed id=craft-init-backend -->
