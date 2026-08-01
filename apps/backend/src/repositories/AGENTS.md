<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-30 · Updated: 2026-08-01 (CAS publish 메커니즘·typed audit·showcase 프로젝션 제거 반영) -->

# apps/backend/src/repositories — GitHub 저장소 프로비저닝·공개 전환

## Purpose

승인된 신청의 GitHub 저장소 생성, 협업자 초대, 공개 전환을 담는다.
`applications/`의 outbox 이벤트를 consumer와 worker가 비동기로 처리한다.

## Key Files

| 파일 | 역할 |
| --- | --- |
| `repository-outbox.consumer.ts` | `OutboxEvent` 테이블에서 lease 기반으로 이벤트를 클레임(`SKIP LOCKED`) |
| `repository-provision.worker.ts` | GitHub 저장소 생성·협업자 초대 실행, 실패 시 재시도(`nextAttemptAt`, 최대 5회) |
| `repository-provision.scheduler.ts` | 5초 간격 polling(`@Interval`)으로 outbox→worker 배치 처리 |
| `repository-provision.github.ts` | 저장소 이름 충돌 시 fallback 이름으로 재시도하는 find-or-create 로직 |
| `repository-name.ts` | 결정적 저장소 이름 생성(`buildRepositoryNames`) — ASCII slug + stable id prefix |
| `github-app.client.ts` | GitHub App 설치 토큰으로 저장소 생성/조회/공개전환/협업자 초대 REST 호출 |
| `github-app.token.ts` | GitHub App 설치 토큰 발급·캐시 |
| `github-app.error.ts` | GitHub App REST 호출 에러 타입 |
| `github-app.response.ts` | GitHub App REST 응답 타입 |
| `github-operations.config.ts` | GitHub 저장소 조작 관련 설정 |
| `repository-provision-job.repository.ts` | provision job Prisma 접근 |
| `repository-provision-state.repository.ts`, `.helpers.ts` | provision 상태 전이 Prisma 접근·헬퍼 |
| `repository-provision.contract.ts` | provision 단계 타입 계약 |
| `repository-provision.failure.ts` | provision 실패 분류 |
| `repository-provision-event.ts` | provision 이벤트 타입 |
| `repositories.repository.ts` | `publishRepositoryIfPrivate` — CAS(compare-and-swap) 전환 구현 |
| `repositories.service.ts` | `getMyRepositories`(내 저장소 목록) · `publish`(비공개→공개 전환, CAS + 트랜잭션 내 typed audit) |
| `repositories.controller.ts` | `GET /repositories/me` |

## Subdirectories

| 경로 | 내용 |
| --- | --- |
| `dto/` | `my-repositories-response.dto.ts` |

## For AI Agents

- 이 모듈은 전용 error-code enum 대신 `GithubOperationsError`와 일반 `Error` 서브클래스를 쓴다.
- 호출 모듈이 필요한 경우 이를 자기 도메인 `DomainException`으로 변환한다.
- `publish`는 `RepositoriesController`를 통해 직접 호출되지 않는다 — 현재 유일한 호출자는 `submission-reviews/submission-reviews.service.ts`이며, `RepositoriesModule`을 import해 `RepositoriesService`의 `publish`만 `Pick`으로 노출받는다(ADR-003 공개 표면 원칙). 호출 전 다섯 게이트(수동 확정 포함)는 `submission-reviews/`가 원본이다.
- `publish`의 실제 전환은 `repositories.repository.ts`의 `publishRepositoryIfPrivate` — `WHERE {id, githubRepositoryId, visibility: PRIVATE}` 조건의 Prisma `updateMany` CAS이며 갱신 행이 0이면 "이미 전환됨"으로 보고 boolean으로 승패(`won`)를 반환한다.
- CAS에서 이긴 호출만 같은 트랜잭션 안에서 `REPOSITORY_PUBLISHED` typed audit(`audit-log/`)을 쓴다 — 진 호출은 audit을 쓰지 않는다.
- `showcase/`로의 프로젝션 트리거는 제거됐다 — 이 모듈은 더 이상 `ShowcaseProjectionService`를 호출하지 않는다(`showcase/` 테이블은 read-only, 물리 삭제는 Issue #463).
- `buildRepositoryNames`는 프로그램·대상의 정규화 slug로 preferred 이름을 만들고, 빈 slug에는 stable ID prefix를 쓰며 collision fallback에는 신청 ID의 8자 prefix를 붙인다.
- `buildRepositoryOwnershipMarker`는 신청 ID의 SHA-256으로 소유권 marker를 만든다.

## Dependencies

- [apps/backend/src/AGENTS.md](../AGENTS.md) — 모듈 경계·에러 코드 규약.
- `auth/`(`AuthModule`), `audit-log/`(`publish` CAS 승자만 쓰는 typed audit).
- `submission-reviews/` — `publish`의 유일한 호출자, 다섯 게이트를 소유.
