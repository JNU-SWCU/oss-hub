<!-- init:managed id=init-frontend sha256=131b295cf381bbfd826a1e6fefbce3c9a6da6302057f44208e33e2f1b4b88c72 -->
# `apps/frontend/` scope

## Package entry points

- Package scripts are declared in `package.json`: `dev`, `build`, `lint`, `typecheck`, `test`, `e2e`, and `e2e:program-authoring`.
- Run package scripts from the workspace with `pnpm --filter frontend <script>`.
- `next.config.ts` is the production/development Next configuration; it rewrites development `/api/v1/:path*` requests to `BACKEND_ORIGIN` (default `http://localhost:4000`).
- Runtime modules and runtime configuration must not import test-owned code; `eslint.config.mjs` owns enforcement and `e2e/**/*.spec.ts` owns browser journeys.
- `playwright.config.ts` and `e2e/` define browser coverage; `vitest.config.mts` defines unit-test coverage.
- `Dockerfile` is this package's container build entry point.

## Source layout

- Application source lives under `src/`; its local guide is `src/AGENTS.md`.
- App Router routes live in `src/app/`; feature-owned code lives in `src/features/`.
- Shared UI belongs in `src/components/`; shared lower-level code belongs in `src/lib/`.
- Static assets are in `public/`; test helpers stay with their owning tests, including `e2e/support/`.

## Package-local boundaries

- Keep route composition, feature implementation, shared UI, and lower-level utilities in the source layers above.
- `eslint.config.mjs` contains supporting restricted-import checks, but review relative imports against the same ownership boundaries instead of assuming lint covers every path form.

## Configuration evidence

- TypeScript path and compiler settings: `tsconfig.json`.
- Tailwind PostCSS integration: `postcss.config.mjs`.
- shadcn component settings: `components.json`.
- Next test configuration: `next.config.test.ts`.
<!-- /init:managed id=init-frontend -->

## Production ingress boundary

- `vercel.json` owns the production-only request-header transform that replaces browser `Authorization` with Vercel sensitive `ORIGIN_BASIC_AUTH` before the existing external rewrite; never move this path into Middleware or a Function because uploads exceed those body limits.
