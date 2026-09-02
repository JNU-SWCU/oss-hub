<!-- init:managed id=init-frontend sha256=ed76e293e0b3806ac355f7ff5093d8f9046a4454b6df7dbe40db58bd969ee050 -->
# `apps/frontend/` scope

## Package entry points

- Package scripts are declared in `package.json`: `dev`, `build`, `lint`, `typecheck`, `test`, `e2e`, and `e2e:program-authoring`.
- Run package scripts from the workspace with `pnpm --filter frontend <script>`.
- `next.config.ts` is the production/development Next configuration; it rewrites development `/api/v1/:path*` requests to `BACKEND_ORIGIN` (default `http://localhost:4000`).
- `vercel.json` owns the production-only request-header transform that replaces browser `Authorization` with Vercel sensitive `ORIGIN_BASIC_AUTH` before the existing external rewrite; never move this path into Middleware or a Function because uploads exceed those body limits.
- Local-review fixture rewrites are enabled only by the guarded configuration in `next.config.ts`; do not broaden that rewrite boundary.
- `playwright.config.ts` and `e2e/` define browser coverage; `vitest.config.mts` defines unit-test coverage.
- `Dockerfile` is this package's container build entry point.

## Source layout

- Application source lives under `src/`; its local guide is `src/AGENTS.md`.
- App Router routes live in `src/app/`; feature-owned code lives in `src/features/`.
- Shared UI belongs in `src/components/`; shared lower-level code belongs in `src/lib/`.
- Static assets are in `public/`; test helpers are in `test-support/`.

## Package-local boundaries

- Keep route composition, feature implementation, shared UI, and lower-level utilities in the source layers above.
- `eslint.config.mjs` contains supporting restricted-import checks, but review relative imports against the same ownership boundaries instead of assuming lint covers every path form.

## Configuration evidence

- TypeScript path and compiler settings: `tsconfig.json`.
- Tailwind PostCSS integration: `postcss.config.mjs`.
- shadcn component settings: `components.json`.
- Next test configuration: `next.config.test.ts`.
<!-- /init:managed id=init-frontend -->
