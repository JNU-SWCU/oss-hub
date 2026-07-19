<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-20 -->

# apps/backend/src — 애플리케이션 코드

## Purpose

NestJS 모듈별 소스. 모듈마다 폴더 하나(`auth/`·`collection/`)를 쓰고, `common/`·`prisma/`는 전 모듈이 공유하는 기반 계층이다. `health/`는 헬스체크 전용 얇은 모듈이라 별도 문서 없이 이 문서가 다룬다.

## Key Files

| 파일 | 역할 |
| --- | --- |
| `app.module.ts` | 루트 모듈 — `AuthModule`·`CollectionModule`·`HealthModule`·`PrismaModule`을 조립 |
| `main.ts` | 부트스트랩(전역 `ProblemDetailFilter` 등록 등) |
| `health/health.controller.ts`, `health/health.module.ts` | 헬스체크 엔드포인트 |

## Subdirectories

| 경로 | 내용 | 문서 |
| --- | --- | --- |
| `auth/` | GitHub OAuth 로그인·세션 | **경계 참조** — 아래 For AI Agents |
| `collection/` | GitHub 활동 수집기 | [collection/AGENTS.md](collection/AGENTS.md) |
| `common/` | 전 모듈 공유 에러·필터 | [common/AGENTS.md](common/AGENTS.md) |
| `prisma/` | NestJS용 Prisma 서비스/모듈 래퍼(`prisma.service.ts`·`prisma.module.ts`) — 스키마·마이그레이션·시드는 `apps/backend/prisma/`(리포 루트 기준 다른 디렉터리)가 원본 |

## For AI Agents

- **`auth/`는 @Lumiere001 전속 경로다 (루트 AGENTS.md §3).** 다른 레인은 이 디렉터리 안에 파일을 만들거나 기존 파일을 직접 수정하지 않는다 — 변경이 필요하면 Issue 또는 PR 코멘트로 제안한다. 이 규칙은 이 문서가 아니라 루트 `AGENTS.md`가 원본이며, 이 문서는 경계를 명시할 뿐 값을 바꾸지 않는다. `collection/`도 같은 표(§3)에서 @Lumiere001 owner로 지정돼 있으니 기능 코드 변경 전에는 동일하게 Issue·PR 코멘트로 선점을 확인한다.
- 모듈 경계 lint(ADR-003)는 `apps/backend/eslint.config.mjs`가 `src/` 폴더 목록을 읽어 자동 적용한다 — `auth/domain/*`·`collection/domain/*` 등은 다른 모듈에서 직접 import 금지, 모듈이 export하는 공개 표면(서비스·DTO)만 쓴다.
- 에러 코드 prefix: `auth/auth-error-code.enum.ts` → `AUT_*`, `collection/collection-error-code.enum.ts` → `COL_*`, `common/system-error-code.enum.ts` → `SYS_*`. 모두 `DomainException`으로 던지면 전역 필터가 problem+json으로 변환한다.
- 테스트는 `pnpm --filter backend test:unit`(기본)과 `test:integration`(`*.integration.spec.ts`, 격리 DB 컨테이너) 두 트랙으로 나뉜다 — 파일명이 트랙을 결정한다.

## Dependencies

- [apps/backend/AGENTS.md](../AGENTS.md) — 실행 명령·모듈 경계 전체 개요.
- [ADR-003](../../../docs/decisions/ADR-003-backend-architecture.md) — 모듈 경계 근거.
