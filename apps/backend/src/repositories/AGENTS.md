<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-30 · Updated: 2026-07-31 (테스트 파일명 인벤토리 제거) -->

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
| `repositories.service.ts` | `getMyRepositories`(내 저장소 목록) · `publish`(비공개→공개 전환, `showcase/`에 프로젝션 트리거) |
| `repositories.controller.ts` | `GET /repositories/me` |

## Subdirectories

| 경로 | 내용 |
| --- | --- |
| `dto/` | `my-repositories-response.dto.ts` |

## For AI Agents

- 이 모듈은 전용 error-code enum 대신 `GithubOperationsError`와 일반 `Error` 서브클래스를 쓴다.
- 호출 모듈이 필요한 경우 이를 자기 도메인 `DomainException`으로 변환한다.
- `publish`는 `RepositoriesController`를 통해 직접 호출되지 않는다 — 현재 유일한 호출자는 `submission-reviews/submission-reviews.service.ts`이며, `RepositoriesModule`을 import해 `RepositoriesService`의 `publish`만 `Pick`으로 노출받는다(ADR-003 공개 표면 원칙).
- `buildRepositoryNames`는 프로그램·대상의 정규화 slug로 preferred 이름을 만들고, 빈 slug에는 stable ID prefix를 쓰며 collision fallback에는 신청 ID의 8자 prefix를 붙인다.
- `buildRepositoryOwnershipMarker`는 신청 ID의 SHA-256으로 소유권 marker를 만든다.

## Dependencies

- [apps/backend/src/AGENTS.md](../AGENTS.md) — 모듈 경계·에러 코드 규약.
- `auth/`(`AuthModule`), `showcase/`(`ShowcaseProjectionService` — 공개 전환 시 프로젝션 트리거).
