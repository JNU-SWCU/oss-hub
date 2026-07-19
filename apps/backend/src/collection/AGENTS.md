<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-20 -->

# apps/backend/src/collection — GitHub 활동 수집기

## Purpose

GitHub API를 호출해 학생 저장소의 활동(커밋·PR 등)을 수집·저장하는 모듈. owner: @Lumiere001(루트 AGENTS.md §3) — 기능 코드 변경 전 Issue·PR 코멘트로 선점을 확인한다.

## Key Files

| 파일 | 역할 |
| --- | --- |
| `collection.module.ts` | 모듈 조립 — `AuthModule` import, `GithubApiClient`를 `CollectionConfig` 기반 factory로 생성 |
| `collection.controller.ts` | HTTP 엔드포인트 |
| `collection.service.ts` | 수집 트리거·조회 유스케이스 |
| `collection.config.ts` | GitHub 자격증명·설정(`requireCredentials()`) |
| `collection.repository.ts` | Prisma 기반 영속화 |
| `collection-run-starter.service.ts`, `collection-run-start.store.ts` | 수집 실행(run) 시작·중복 방지 상태 관리 |
| `collection-run.mapper.ts` | 도메인 ↔ DTO 매핑 |
| `github-api.client.ts`, `github-api.error.ts` | GitHub REST API 클라이언트·에러 변환 |
| `collection-error-code.enum.ts` | `COL_*` 에러 코드 레지스트리 |

## Subdirectories

| 경로 | 내용 |
| --- | --- |
| `domain/` | 내부 도메인 모델(`collection-run.ts`·`github-observation.ts`·`json.ts`) — ADR-003에 따라 다른 모듈에서 직접 import 금지 |
| `dto/` | `collection-run-response.dto.ts` — 공개 응답 계약 |
| `cli/` | `collect-batch.ts` — 배치 수집 CLI 엔트리(`pnpm --filter backend collect:batch`) |

## For AI Agents

- 에러 코드: `COL_001 RATE_LIMITED`(429), `COL_002 COLLECTION_RUN_NOT_READY`(429, 이미 진행 중이거나 재요청 대기), `COL_003 BATCH_LOGIN_NOT_ALLOWED`(400, 허용 목록 밖 GitHub 계정). `collection-error-code.enum.ts`에 등록되고 `DomainException`으로 던지면 `common/problem-detail.filter.ts`가 `application/problem+json`으로 변환한다.
- 테스트 위치·트랙:
  - 단위(`pnpm --filter backend test:unit`): `collection.controller.spec.ts`, `collection.service.spec.ts`, `collection.service.start-gate.spec.ts`, `collection.config.spec.ts`, `github-api.client.spec.ts`
  - 통합(`pnpm --filter backend test:integration`, 격리 DB 컨테이너): `collection-run-recovery.integration.spec.ts`, `collection.repository.integration.spec.ts`, `integration-database.guard.spec.ts`
- `GithubApiClient`는 `collection.module.ts`에서 `CollectionConfig.requireCredentials()`를 지연 평가하는 factory로 생성된다 — 자격증명이 없는 환경(예: 일부 테스트)에서 모듈 초기화 자체가 실패하지 않도록 하는 패턴이다.
- `domain/`·`dto/`는 이 모듈의 내부 표현이다. 다른 모듈은 `collection.module.ts`의 `exports`(`CollectionConfig`·`CollectionService`)만 통해 접근한다.

## Dependencies

- [apps/backend/src/AGENTS.md](../AGENTS.md) — 모듈 경계·auth/collection owner 경계.
- `auth/`(`AuthModule` — 인증된 요청만 수집 트리거 허용).
- `common/`(에러 코드 규약 원본).
