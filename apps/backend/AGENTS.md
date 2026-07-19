<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-20 -->

# apps/backend — 에이전트 라우팅

## Purpose

`apps/backend/**` 작업에 적용된다. 더 가까운 `AGENTS.md`가 있으면 그 파일이 우선한다. NestJS 11 기반 REST API 서버로, Prisma 6 + PostgreSQL을 쓴다.

### 규칙 원본 링크

- [루트 AGENTS.md](../../AGENTS.md)
- [ADR-003 — Backend Architecture](../../docs/decisions/ADR-003-backend-architecture.md)
- [ADR-004 — REST API 규격](../../docs/decisions/ADR-004-REST-API-규격.md)
- [보안 규칙](../../docs/rules/security.md)

## Key Files

| 파일 | 역할 |
| --- | --- |
| `src/app.module.ts` | 루트 모듈 — 하위 모듈(auth·collection·health·prisma) 조립 |
| `src/main.ts` | 애플리케이션 부트스트랩 엔트리포인트 |
| `package.json` | 스크립트(dev/build/lint/typecheck/test 등)·의존성 원본 |
| `nest-cli.json` | Nest CLI 빌드 설정 |
| `tsconfig.json` / `tsconfig.build.json` | 컴파일러 설정(빌드용은 test 제외) |
| `eslint.config.mjs` | 모듈 경계 lint(ADR-003) — 아래 For AI Agents 참조 |
| `jest.config.js` | 테스트 러너 설정 — `src/`와 `prisma/`의 `*.spec.ts`를 모두 수집 |
| `Dockerfile` | 컨테이너 이미지 빌드 정의 |

## Subdirectories

| 경로 | 내용 | 문서 |
| --- | --- | --- |
| `src/` | 애플리케이션 코드(모듈별) | [apps/backend/src/AGENTS.md](src/AGENTS.md) |
| `prisma/` | 스키마·마이그레이션·시드 | [apps/backend/prisma/AGENTS.md](prisma/AGENTS.md) |
| `test/` | 통합테스트 공용 헬퍼(`integration-database.guard.ts`) — 모듈별 `*.spec.ts`는 `src/` 안에 함께 둔다 |

## For AI Agents

- 실행 전 `nvm use 24` 필요(루트 `engines.node >=24`). 명령은 항상 `pnpm --filter backend <script>` 형태로 실행한다.
  - `pnpm --filter backend dev` — watch 모드 실행(로컬 DB 필요, `docs/rules/local-dev.md`)
  - `pnpm --filter backend build` / `lint` / `typecheck`
  - `pnpm --filter backend test:unit` — `*.integration.spec.ts` 제외한 단위테스트
  - `pnpm --filter backend test:integration` — `scripts/run-backend-integration.sh`가 격리 컨테이너를 새로 띄워 실행(공유 DB 미사용)
  - `pnpm --filter backend db:migrate:dev` / `db:reset` / `db:seed` — 로컬 DB(`localhost:5432/oss_hub`) 대상
- **모듈 경계(ADR-003)**: `eslint.config.mjs`가 `src/` 하위 폴더를 자동으로 모듈로 인식해, 한 모듈이 다른 모듈의 `domain/*`·`dto/*`를 직접 import하면 lint 에러(`no-restricted-imports`)를 낸다. `common/`·`prisma/`는 전 모듈 공유 기반 계층이라 이 규칙에서 제외된다. 새 모듈 폴더를 추가해도 이 설정 파일은 수정할 필요 없다(폴더 목록을 런타임에 읽음).
- **에러 응답 계약**: 각 모듈은 `<module>-error-code.enum.ts`에서 자체 prefix(`AUT_*`=auth, `COL_*`=collection, `SYS_*`=system)로 코드를 정의하고 `DomainException`을 던진다. `common/problem-detail.filter.ts`(전역 `ExceptionFilter`)가 이를 `application/problem+json` 응답으로 변환한다 — 상세는 [apps/backend/src/common/AGENTS.md](src/common/AGENTS.md) 참조.
- `src/auth/`는 @Lumiere001 전속 경로다 — 그 안의 파일을 만들거나 수정하지 않는다. 경계는 [apps/backend/src/AGENTS.md](src/AGENTS.md)에 상세.
- 시드 데이터는 프로필(`auth`/`intake`/`milestones`/`repositories`/`all`) 계약을 따른다 — [apps/backend/prisma/AGENTS.md](prisma/AGENTS.md) 참조.

## Dependencies

- 루트 workspace(`pnpm-workspace.yaml`, 루트 `package.json`)의 `-r` 스크립트가 이 패키지를 포함한다.
- `@nestjs/*` 11.x, `@prisma/client`/`prisma` 6.x, `jose`(세션 토큰), `class-validator`/`class-transformer`.
