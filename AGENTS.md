# Repository Guidelines

## Project Overview

OSS Hub는 오픈소스 프로그램 탐색·신청·제출·리뷰, 역할 기반 운영, GitHub 저장소·활동 수집을 제공하는 한국어 웹 서비스다.
이 저장소는 PUBLIC monorepo이며 Next.js frontend(Vercel), NestJS backend, PostgreSQL, private managed R2, nginx와 배포 계약을 함께 관리한다(MinIO는 `compose.local.yml`의 local substitute만).
작업 전 루트부터 대상 경로까지의 `AGENTS.md`를 순서대로 읽고 가장 가까운 규칙을 우선한다.
상세 규칙은 이 문서에 복제하지 않고 `docs/rules/`, `docs/decisions/`, 해당 경로의 `AGENTS.md`를 따른다.

## Architecture & Data Flow

- 요청 흐름은 브라우저 → canonical Vercel frontend → authenticated origin nginx → `/api/v1` backend → PostgreSQL/managed R2다.
- `apps/frontend`는 Next.js App Router UI를 소유한다.
  쿠키 기반 shell 초기화는 server layout에 두고 `window`·브라우저 상태는 client component effect에서 다룬다.
- frontend HTTP 호출의 유일한 경계는 `apps/frontend/src/lib/api-client.ts`다.
  `apiPath`, `apiClient`, `apiFileClient`를 사용하고 `/api/v1`, `fetch`, 다운로드 파일명 파싱을 callsite에서 재구현하지 않는다.
- `apps/backend/src/main.ts`는 `api/v1` prefix, transform + whitelist validation, global ProblemDetail filter를 설치한다.
- backend 기능은 `AppModule`에 Nest module로 조립하고 runtime 설정은 `RUNTIME_CONFIG` DI token으로 받는다.
  주석으로 정한 module import 순서와 E2E 전용 feature gate를 보존한다.
- 업무 계층은 Controller → Service → Repository → Prisma다.
  PostgreSQL 직접 접근은 backend repository만 하며 controller와 일반 service의 Prisma 접근을 금지한다.
- 공개 endpoint가 private table을 읽을 때는 owner-approved public query repository에서 명시적 `select`, public DTO allowlist, private/nonexistent 동일 404를 적용한다.
  wildcard `include`, private join, fetch-then-redact는 금지한다.
- API 실패는 backend ProblemDetail과 frontend `ApiError` 계약을 유지한다.
  임의 fallback이나 오류 삼키기보다 명시적으로 실패한다.
- 전체 시스템 지도는 `docs/architecture.md`, 장기 결정은 `docs/decisions/README.md`와 관련 ADR이 원본이다.

## Key Directories

| Path | Purpose |
| --- | --- |
| `apps/frontend` | Next.js UI, route composition, feature state, shared UI, browser E2E |
| `apps/backend` | NestJS REST API, domain modules, workers, persistence adapters |
| `apps/backend/prisma` | Prisma schema와 직렬화된 migration history |
| `scripts` | CI contract, local integration, diagnostics, deploy helpers; `scripts/AGENTS.md` 적용 |
| `docs/decisions` | 기술·운영 결정의 canonical ADR |
| `docs/rules` | security, frontend, local-dev, data-modeling, CI path 규칙 |
| `docs/handoff/team-state` | GitHub handle별 append-only 작업 저널 |
| `skills` | repo-owned skill 원본; runtime 디렉터리(.codex/.claude/.cursor/.gjc)는 여기를 가리키는 symlink만 둔다 |
| `.github/workflows` | required CI와 public-safe 실행 경계 |
| `deploy`, `compose*.yml`, `Jenkinsfile` | nginx, local/production container, release deploy 계약 |

## Development Commands

Node.js 24 이상과 pnpm 11.0.0을 사용하고 `corepack enable`로 pnpm을 활성화한다.
패키지 workspace는 `apps/*`이며 설치 시 backend Prisma client가 생성된다.

| Goal | Command |
| --- | --- |
| Install | `pnpm install` |
| Host hot reload | `pnpm dev` |
| Development DB only | `pnpm db:up` |
| Production-like local stack | `pnpm local:up` |
| Verify / stop local stack | `pnpm local:verify` / `pnpm local:down` |
| Create development migration | `pnpm db:migrate:dev` |
| Focused package check | `pnpm --filter frontend <script>` or `pnpm --filter backend <script>` |
| Whole workspace | `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test` |
| Formatting | `pnpm format:check` (`pnpm format` only when formatting is intended) |

`pnpm dev`는 `.envrc`와 host `localhost` 경계를, `pnpm local:*`은 `.env`와 Compose service DNS 경계를 사용한다.
두 환경의 DB/MinIO 주소를 복사하지 말고 상세 선택 기준은 `docs/rules/local-dev.md`를 따른다.
`compose.yml`은 prebuilt release image와 production secret을 요구하므로 local development entry point로 사용하지 않는다.

## Code Conventions & Common Patterns

- TypeScript 타입 경계를 유지하고 기존 feature/module 구조를 재사용한다.
  병렬 convention, speculative abstraction, silent compatibility fallback을 만들지 않는다.
- frontend는 화면/업무별 `features/`에 상태·타입·API를 가깝게 두고 여러 feature가 공유할 때만 `components/`나 `lib/`로 올린다.
- browser-only 값은 hydration-safe effect에서 읽고 recoverable session failure는 명시적 retry UI로 보인다.
- backend는 Nest DI와 module ownership을 사용하고 DTO validation, repository projection, ProblemDetail을 우회하지 않는다.
- shell script는 `set -euo pipefail`과 fail-closed 처리를 우선하고 contract test는 합성 fixture만 사용한다.
- `pnpm-lock.yaml` 충돌을 손으로 병합하지 않는다.
  merge 뒤 pnpm으로 재생성한다.
- 커밋은 atomic Conventional Commit이며 type은 `feat`, `fix`, `docs`, `refactor`, `style`, `test`, `chore`, `ci`만 쓴다.
  summary는 한국어 한 줄이고 `그리고`·`및`이 필요하면 분리한다.
- 문서는 한 문장을 한 줄에 쓰며 정책 본문을 여러 파일에 복제하지 않는다.

Ownership과 협업 규칙:

- feature code는 owner 전속이다.
  owner는 nearest `AGENTS.md`와 GitHub Issue에서 확인하고 non-owner는 Issue/PR comment로 제안한다.
- @GoBeromsu와 @Lumiere001은 ADR-005의 repository-wide free-role 예외다.
- shared lib·설정·CI는 착수 전 Issue로 선점하고 독립 소형 PR로 다룬다.
  DB migration PR은 동시에 진행하지 않는다.
- PR은 Ready로 열며 stack 하위 PR만 base가 미병합 상위 branch인 동안 Draft를 허용한다.
- PR 전 자기 `docs/handoff/team-state/<handle>.md` 끝에 새 항목을 추가한다.
  과거 항목, 다른 사람 저널, `TEAM-STATE.archive.md`를 수정하지 않는다.
- commit/push/PR 절차는 `docs/rules/pr-scope.md`와 ADR-005를 따른다.
  병합 판단의 원본은 required `ci`·`public-safe` 결과와 GitHub mergeable 상태다.

PUBLIC safety:

- code, Issue/PR 본문, CI log, screenshot, fixture가 모두 공개된다고 가정한다.
- 시크릿, 실명, 개인정보·실데이터(마스킹본 포함), 개인 hostname·머신 경로를 저장소나 외부 LLM에 반입하지 않는다.
  사람은 GitHub `@handle`로만 표기한다.
- 학생 token으로 write API를 호출하지 않는다.
- 전체 deny-list와 credential 갱신 계약은 `docs/rules/security.md`가 원본이다.

## Important Files

| File | Why it matters |
| --- | --- |
| `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` | Node/pnpm contract, workspace scripts, install permissions |
| `apps/frontend/src/app/layout.tsx` | server root layout와 global shell |
| `apps/frontend/src/lib/api-client.ts` | browser API path, JSON/file response, ProblemDetail boundary |
| `apps/backend/src/main.ts` | HTTP bootstrap와 global validation/error policy |
| `apps/backend/src/app.module.ts` | backend module/DI composition root |
| `apps/backend/prisma/schema.prisma` | current persistence model; migrations remain historical source |
| `.env.example` | environment variable names only; no values |
| `compose.dev.yml`, `compose.local.yml`, `compose.yml` | development DB, local integration, production runtime contracts |
| `.github/workflows/ci.yml` | always-created required checks와 inner path-selective lanes |
| `Jenkinsfile` | stable GitHub Release → exact main SHA production deployment |
| `docs/rules/ci-path-verification.md` | changed path별 required verification matrix |
| `docs/handoff/TEAM-STATE.md` | journal index and append format; status source is GitHub Issue/PR |

제품·기획 결정은 Notion Decision Log, 기술·운영 결정은 ADR, 구현 상태는 GitHub Issue/PR, secret 값은 운영 vault만 원본으로 삼는다.
로컬 작업 시작 시 관련 open PR을 한 번 확인하고 `bash scripts/setup-hooks.sh`로 repository hooks를 활성화한다.
스킬 사용은 선택이 아니라 게이트다 — 작업 표면에 대응하는 스킬을 `docs/rules/agent-skill-routing.md`에서 찾아 그 `SKILL.md`를 읽고 절차대로 수행하지 않은 작업은 완료로 인정하지 않는다.
repo 스킬 네 개(`run-release-qa`, `manage-qa-tickets`, `submit-pr-evidence`, `build-oss-hub-handbook`)는 `skills/`가 원본이며 Claude Code·Codex·Cursor·GJC는 각 runtime 디렉터리의 symlink로 같은 본문을 로드한다.
PR을 열기 전에 `submit-pr-evidence`를 반드시 실행한다 — frontend 변경은 Before/After 캡처, backend 로직 변경은 mermaid/DOT 다이어그램이 PR 본문에 없으면 PR을 열지 않는다.
craft-skills는 로컬 날짜 기준 첫 개발 세션에 runtime-native marketplace에서 최신본을 확인·갱신하며 Claude Code는 project marketplace `autoUpdate`, Codex는 project `INSTALLED_BY_DEFAULT`, GJC는 라우팅 문서의 install 명령을 쓴다.
스킬 이름 규칙·버전·CHANGELOG 계약과 runtime별 로드 방법의 원본은 `docs/rules/agent-skill-routing.md`다.

## Runtime/Tooling Preferences

- Required: Node.js `>=24`, pnpm `11.0.0`, Docker/Compose; host dev는 direnv를 사용한다.
- Bun을 package/runtime 명령으로 사용하지 않는다.
  root `package.json`의 pnpm scripts가 실행 계약이다.
- Prisma client는 install/build artifact이며 schema 변경은 migration과 함께 검증한다.
- frontend browser E2E는 bundled Chromium이 아니라 installed Chrome channel을 사용한다.
- GitHub Actions는 PR에서 lane 내부만 path-selective이고 workflow-level `paths` filter를 두지 않는다.
  `main` push는 모든 lane을 실행한다.
- Production은 branch head나 mutable `latest`가 아니라 stable SemVer GitHub Release의 exact main SHA를 Jenkins가 배포한다.

## Testing & QA

- 변경 파일에서 가장 싼 증명부터 실행하고 최종 명령 선택은 `docs/rules/ci-path-verification.md`를 따른다.
- frontend unit/helper test는 Vitest의 기본 Node environment다.
  DOM이 필요한 파일만 명시적으로 happy-dom을 사용한다.
- browser spec은 `apps/frontend/e2e/**/*.spec.ts`의 Playwright 소유이고 `e2e/support/**/*.test.ts`는 Vitest 소유다.
- Playwright는 fresh local stack, Chrome, `workers: 1`, `retries: 0`을 사용한다.
  UI·browser behavior 변경은 `pnpm --filter frontend e2e`를 local manual gate로 실행하며 GitHub Actions가 대신하지 않는다.
- backend default `test`는 Jest unit suite이고 `*.integration.spec.ts`를 제외한다.
  integration은 반드시 `pnpm --filter backend test:integration`의 isolated runner로 실행하며 임의 PostgreSQL에 직접 붙이지 않는다.
- 빠른 시작은 `pnpm --filter frontend test` 또는 `pnpm --filter backend test:unit`이다.
  focused script가 integration/E2E wrapper를 부르면 cheap test로 간주하지 않는다.
- observable behavior, edge values, branch conditions, error handling을 검증하고 default/tautology test를 추가하지 않는다.
- production-like validation은 `pnpm local:verify`를 사용한다.
  backup pruning과 Jenkins deploy helper는 승인된 Jenkins 경로 밖에서 수동 실행하지 않는다.
- PR에는 실제 실행한 검증만 기록하며 warning이나 test를 숨겨 통과시키지 않는다.
- PR 증거는 `submit-pr-evidence`의 영역별 게이트를 따르며 증거 없는 frontend·backend 로직 PR은 리뷰로 넘기지 않는다.
