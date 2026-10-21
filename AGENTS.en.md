# Repository Guidelines

[한국어](AGENTS.md) | **English**

English translation of the [Korean source](AGENTS.md).
The Korean document remains authoritative.

## Project Overview

OSS Hub is a Korean-language web service for discovering open-source programs, applying, submitting and reviewing work, managing role-based operations, and collecting GitHub repository and activity data.
This PUBLIC monorepo manages the Next.js frontend (Vercel), NestJS backend, PostgreSQL, private managed R2 storage, nginx, and deployment contracts together (`object-storage` is a local substitute in `compose.dev.yml` only).
Before working, read each applicable `AGENTS.md` from the repository root down to the target path, giving precedence to the nearest rules.
Do not duplicate detailed rules here; follow `docs/rules/`, `docs/decisions/`, and the `AGENTS.md` for the relevant path.

## Architecture & Data Flow

- Requests flow from the browser → canonical Vercel frontend → authenticated origin nginx → `/api/v1` backend → PostgreSQL/managed R2.
- `apps/frontend` owns the Next.js App Router UI.
  Keep cookie-based shell initialization in server layouts and handle `window` and browser state in client component effects.
- The sole boundary for frontend HTTP calls is `apps/frontend/src/lib/api-client.ts`.
  Use `apiPath`, `apiClient`, and `apiFileClient`; do not reimplement `/api/v1`, `fetch`, or download-filename parsing at call sites.
- `apps/backend/src/main.ts` installs the `api/v1` prefix, transform and whitelist validation, and the global ProblemDetail filter.
- Assemble backend features as Nest modules in `AppModule`, and obtain runtime configuration through the `RUNTIME_CONFIG` DI token.
  Inject E2E substitutes only in `apps/backend/test/e2e-program-authoring/main.ts`.
- The business-layer flow is Controller → Service → Repository → Prisma.
  Only backend repositories may access PostgreSQL directly; controllers and ordinary services must not access Prisma.
- When a public endpoint reads a private table, use an owner-approved public query repository with explicit `select`, a public DTO allowlist, and the same 404 response for private and nonexistent resources.
  Wildcard `include`, private joins, and fetch-then-redact are prohibited.
- Preserve the backend ProblemDetail and frontend `ApiError` contracts for API failures.
  Fail explicitly instead of inventing fallbacks or swallowing errors.
- The system map in `docs/architecture.md`, the index in `docs/decisions/README.md`, and the relevant ADRs are the sources of truth for architecture and long-term decisions.
  English versions: [system map](docs/architecture.en.md) and [ADR index](docs/decisions/README.en.md).

## Key Directories

| Path | Purpose |
| --- | --- |
| `apps/frontend` | Next.js UI, route composition, feature state, shared UI, browser E2E |
| `apps/backend` | NestJS REST API, domain modules, workers, persistence adapters |
| `apps/backend/prisma` | Prisma schema and serialized migration history |
| `scripts` | CI contracts, local integration, diagnostics, deploy helpers; `scripts/AGENTS.md` applies |
| `docs/decisions` | Canonical ADRs for technical and operational decisions |
| `docs/rules` | Security, frontend, local development, data modeling, and CI path rules |
| `skills` | Canonical repository-owned skills; runtime directories (.codex/.claude/.cursor/.gjc) contain only symlinks pointing here |
| `.github/workflows` | Required CI and public-safe execution boundaries |
| `deploy`, `compose*.yml`, `Jenkinsfile` | nginx, local/production containers, and release deployment contracts |

## Development Commands

Use Node.js 24 or later and pnpm 11.0.0; enable pnpm with `corepack enable`.
The package workspace is `apps/*`, and installation generates the backend Prisma client.

| Goal | Command |
| --- | --- |
| Install | `pnpm install` |
| Host hot reload | `pnpm dev` |
| Development DB only | `pnpm db:up` |
| Create development migration | `pnpm db:migrate:dev` |
| Focused package check | `pnpm --filter frontend <script>` or `pnpm --filter backend <script>` |
| Whole workspace | `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test` |
| Formatting | `pnpm format:check` (`pnpm format` only when formatting is intended) |

The default entry point for daily development is `pnpm dev`.
Frontend and backend applications run on the host with hot reload; Docker is used only for development infrastructure such as PostgreSQL and object storage.
Agents must not build application containers for ordinary implementation, debugging, or UI checks.
Production uses Vercel for the frontend and Docker Compose/Jenkins for the backend, so do not describe all deployment as Docker-based.
Required CI checks and the Jenkins release path handle production-like integration verification before deployment (image build, `prisma migrate deploy`, `nginx -t`, and health/rollback smoke checks); do not introduce a separate local procedure.

`pnpm dev` uses `.envrc` and the host `localhost` boundary.
Follow [local development rules](docs/rules/local-dev.en.md) for detailed selection criteria.
`compose.yml` requires a prebuilt release image and production secrets, so do not use it as the local development entry point.
In sessions that change code or configuration, check related open PRs once and enable repository hooks with `bash scripts/setup-hooks.sh`.
Do not perform these prerequisites for information-only, planning, or reporting tasks.

## Code Conventions & Common Patterns

- Preserve TypeScript type boundaries and reuse the existing feature/module structure.
  Do not introduce parallel conventions, speculative abstractions, or silent compatibility fallbacks.
- Comments are prohibited in new JS/TS code.
  `local/no-comments` is enforced only in the `apps/frontend` and `apps/backend` paths checked by `pnpm lint`; root `scripts/`, `.design-sync/`, and `commitlint.config.cjs` are outside that lint scope.
  `.githooks/pre-commit` runs the same ESLint on staged content (the index) within the two applications' lint scope, and blocks the commit if ESLint is unavailable.
- In the frontend, keep state, types, and APIs close to their screen or business feature under `features/`; move them to `components/` or `lib/` only when multiple features share them.
- Read browser-only values in hydration-safe effects, and show explicit retry UI for recoverable session failures.
- Use Nest DI and module ownership in the backend; do not bypass DTO validation, repository projection, or ProblemDetail.
- Prefer `set -euo pipefail` and fail-closed behavior in shell scripts, and use only synthetic fixtures in contract tests.
- Do not resolve `pnpm-lock.yaml` conflicts by hand.
  Regenerate it with pnpm after merging.
- Commits must be atomic Conventional Commits, using only `feat`, `fix`, `docs`, `refactor`, `style`, `test`, `chore`, or `ci`.
  Write the summary as one line in Korean; split the change if the summary needs “그리고” or “및” (“and”).
- Write one sentence per source line in documents, and do not duplicate policy text across files.

Ownership and collaboration rules:

- Reserve shared libraries, configuration, and CI work with an Issue before starting, and handle it in an independent small PR.
  Do not work on DB migration PRs concurrently.
- Open PRs as Ready; only a lower PR in a stack may be Draft while its base is an unmerged upstream branch.
- Follow [PR scope rules](docs/rules/pr-scope.en.md) and [ADR-005](docs/decisions/ADR-005-agent-driven-review-cycle.en.md) for commit, push, and PR procedures.
  Required `ci` and `public-safe` results and GitHub's mergeable status are the sources of truth for merge decisions.

PUBLIC safety:

- Assume that code, Issue/PR bodies, CI logs, screenshots, and fixtures are all public.
- Do not bring secrets, real names, personal information, real data (including masked copies), personal hostnames, or machine paths into the repository or external LLMs.
  Identify people only by GitHub `@handle`.
- Do not call write APIs with student tokens.
- The full deny-list and credential-update contract are defined in the [security rules](docs/rules/security.en.md).

## Important Files

| File | Why it matters |
| --- | --- |
| `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` | Node/pnpm contract, workspace scripts, install permissions |
| `apps/frontend/src/app/layout.tsx` | Server root layout and global shell |
| `apps/frontend/src/lib/api-client.ts` | Browser API path, JSON/file responses, ProblemDetail boundary |
| `apps/backend/src/main.ts` | HTTP bootstrap and global validation/error policy |
| `apps/backend/src/app.module.ts` | Backend module/DI composition root |
| `apps/backend/prisma/schema.prisma` | Current persistence model; migrations remain the historical source |
| `.env.example` | Environment variable names only; no values |
| `compose.dev.yml`, `compose.yml` | Development DB and production runtime contracts |
| `.github/workflows/ci.yml` | Always-created required checks and internally path-selective lanes |
| `Jenkinsfile` | Stable GitHub Release → exact main SHA production deployment |
| `docs/rules/ci-path-verification.md` | Required verification matrix for changed paths |

The sources of truth are the Notion Decision Log for product and planning decisions, ADRs for technical and operational decisions, GitHub Issues/PRs for implementation status, and the operations vault alone for secret values.
GitHub Issues are the sole source of truth for tickets and QA findings; do not duplicate them in another repository.
The canonical rules for skill applicability, runtime loading, and versions are in [agent skill routing](docs/rules/agent-skill-routing.en.md).
Implementation, ticket publication, release QA execution, PR submission, and comments are incomplete unless the applicable skill in that table has been read and followed.
For information-only, planning, or reporting tasks, do not install or update plugins, read irrelevant SKILL files, or conduct interviews.
The five repository skills (`run-release-qa`, `manage-qa-tickets`, `submit-pr-evidence`, `build-oss-hub-handbook`, `write-github-comment`) are maintained in `skills/`; Claude Code, Codex, Cursor, and GJC load the same content through symlinks in their runtime directories.
For craft-skills updates in implementation sessions, the runtime-native marketplace is authoritative: Claude Code uses project marketplace `autoUpdate`, Codex uses project `INSTALLED_BY_DEFAULT`, and GJC uses the install command in the routing document.

## Runtime/Tooling Preferences

- Required: Node.js `>=24`, pnpm `11.0.0`, and Docker/Compose; host development uses direnv.
- Do not use Bun for package or runtime commands.
  The pnpm scripts in root `package.json` define the execution contract.
- The Prisma client is an install/build artifact; verify schema changes together with their migrations.
- Frontend browser E2E uses the installed Chrome channel, not bundled Chromium.
- In GitHub Actions, only the lanes within a PR workflow are path-selective; do not add workflow-level `paths` filters.
  Pushes to `main` run every lane.
- Jenkins deploys the exact main SHA from a stable SemVer GitHub Release, not a branch head or mutable `latest`.

## Testing & QA

- The canonical verification commands for each path are in the [CI verification rules](docs/rules/ci-path-verification.en.md).
  The canonical local execution paths are in the [local development rules](docs/rules/local-dev.en.md).
- Frontend unit/helper tests use Vitest's default Node environment.
  Specify happy-dom only for files that require the DOM.
- Playwright owns browser specs in `apps/frontend/e2e/**/*.spec.ts`, while Vitest owns `e2e/support/**/*.test.ts`.
  Playwright uses a fresh isolated stack, installed Chrome, `workers: 1`, and `retries: 0`; GitHub Actions does not replace it.
  The automated regression command for UI or browser behavior changes is `pnpm --filter frontend e2e`.
- For manual UI checks, use the browser tool explicitly requested by the user.
  If none is specified, follow the installed craft `browser` routing; its default can change between versions and is not duplicated here.
  Manual checks do not replace Playwright regression tests (`pnpm --filter frontend e2e`), and a specified tool must not be replaced with another tool.
- The backend's default `test` command runs Jest unit tests and excludes `*.integration.spec.ts`.
  For integration tests, use only the isolated runner invoked by `pnpm --filter backend test:integration`; do not connect it to an arbitrary PostgreSQL instance.
  A focused script that calls an integration/E2E wrapper is not a cheap test.
- Test observable behavior, edge values, branch conditions, and error handling; do not add default or tautological tests.
- Required CI checks and the Jenkins release path handle production-like integration verification.
  Do not manually run backup pruning or Jenkins deploy helpers outside the approved Jenkins path.
- Record only verification that actually ran in a PR; do not hide warnings or tests to make a result pass.
  Do not submit without the applicable evidence.
  [submit-pr-evidence](skills/submit-pr-evidence/SKILL.en.md) is authoritative for PR evidence at submission time.
