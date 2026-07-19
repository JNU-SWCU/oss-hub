<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-20 -->

# apps/frontend — 에이전트 라우팅

## Purpose

`apps/frontend/**` 작업에 적용된다. 더 가까운 `AGENTS.md`가 있으면 그 파일이 우선한다. Next.js 15(App Router) + React 19 프런트엔드로, Tailwind v4·radix-ui/shadcn 기반 UI를 쓴다.

### 규칙 원본 링크

- [루트 AGENTS.md](../../AGENTS.md)
- [Frontend 구현 규칙](../../docs/rules/frontend.md)
- [ADR-004 — REST API 규격](../../docs/decisions/ADR-004-REST-API-규격.md)
- [보안 규칙](../../docs/rules/security.md)

## Key Files

| 파일 | 역할 |
| --- | --- |
| `package.json` | 스크립트(dev/build/lint/typecheck/test)·의존성 원본 |
| `next.config.ts` / `next.config.test.ts` | Next.js 빌드·테스트 설정 |
| `vitest.config.ts` | 단위테스트 러너 설정 |
| `eslint.config.mjs` | feature 경계·단일 API 클라이언트 lint(아래 For AI Agents) |
| `components.json` | shadcn CLI 설정(`radix-nova` 스타일) |
| `postcss.config.mjs` | Tailwind v4 PostCSS 파이프라인 |
| `Dockerfile` | 컨테이너 이미지 빌드 정의 |

## Subdirectories

| 경로 | 내용 | 문서 |
| --- | --- | --- |
| `src/` | 애플리케이션 코드(app·features·components·lib) | [apps/frontend/src/AGENTS.md](src/AGENTS.md) |

## For AI Agents

- 실행 전 `nvm use 24` 필요. 명령은 `pnpm --filter frontend <script>` 형태(`dev`/`build`/`lint`/`typecheck`/`test`).
- **의존 방향은 `app → features → lib` 단방향**이다(`docs/rules/frontend.md`). `features/`는 다른 `features/*`의 내부 경로나 `app/`에 의존할 수 없다 — `eslint.config.mjs`가 `no-restricted-imports`로 이를 강제하며, 새 feature 폴더를 추가해도 이 설정 파일은 손댈 필요 없다(폴더 목록을 런타임에 읽음).
- **HTTP 요청은 `lib/api-client.ts`만 사용한다.** `axios`/`ky` import, 직접 `fetch` 호출, `/api/v1` 문자열 리터럴은 그 파일 밖 어디서든 lint 에러(`no-restricted-imports`/`no-restricted-globals`/`no-restricted-syntax`)로 차단된다.
- `src/features/auth/`는 @Lumiere001 전속 경로다(루트 AGENTS.md §3) — 다른 레인은 직접 수정하지 않고 Issue·PR 코멘트로 제안한다.
- 테스트는 Vitest(`*.test.ts(x)`), 컴포넌트 곁에 위치.

## Dependencies

- 루트 workspace(`pnpm-workspace.yaml`)의 `-r` 스크립트가 이 패키지를 포함한다.
- `next` 15.x, `react`/`react-dom` 19.x, `radix-ui`/`shadcn`, `tailwind-merge`, `class-variance-authority`.
- 백엔드 API 계약: [ADR-004](../../docs/decisions/ADR-004-REST-API-규격.md), `application/problem+json` 에러 형식(`apps/backend/src/common/problem-detail.filter.ts`와 짝을 이루는 `lib/api-client.ts`의 `ProblemDetail` 타입).
