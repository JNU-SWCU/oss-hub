<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-30 · Updated: 2026-07-31 (provision 이벤트 중복 처리 정정) -->

# apps/backend/src/applications — 프로그램 신청·판정

## Purpose

학생 프로그램 신청 생성, 교직원 목록 조회·요약, 신청 판정 트랜잭션을 담는다.
승인 시 설정에 따라 outbox 이벤트를 발행하고 GitHub 작업은 `repositories/` worker에 맡긴다.

## Key Files

| 파일 | 역할 |
| --- | --- |
| `applications.service.ts` | `create`(팀/개인 중복·기간·양식버전 검증) · `decide`(승인/반려 트랜잭션, idempotency key로 provision 이벤트 재생성 방지, 같은 트랜잭션에서 `APPLICATION_APPROVED`/`APPLICATION_REJECTED` typed audit 기록 — #547) · `listForProgram`/`staffSummary` |
| `applications.repository.ts` | `withCreateTransaction`/`withTransaction` — `ApplicationDuplicateError`·`RepositoryEventAlreadyExistsError` 등 트랜잭션 충돌을 타입 에러로 던짐. `ApplicationsTransactionStore.auditLogWriter`가 판정 전이와 감사 기록을 한 트랜잭션에 묶는다 |
| `applications-staff.guard.ts` | `ApplicationsStaffGuard`(판정용, `STAFF_ONLY` 문구) vs `ApplicationsStaffListGuard`(조회용, `STAFF_LIST_ONLY` 문구) — 목적별로 노출 문구를 분리해둔 것이 의도적 설계다 |
| `applications.controller.ts` | `PATCH /applications/:id` — 판정 전용 |
| `program-applications.controller.ts` | `GET`/`POST /programs/:programId/applications` — 목록·생성 thin sibling |
| `staff-dashboard.controller.ts` | 교직원 대시보드 Application 집계 |
| `applications-error-code.enum.ts` | `APP_*` 코드 레지스트리 |

## Subdirectories

| 경로 | 내용 |
| --- | --- |
| `domain/` | `application-decision.ts`(판정 액션·결과 타입) · `create-application.ts`(생성 입력 타입) |
| `dto/` | 요청/응답 DTO — `patch-application-decision-request.dto.ts`의 `toAction()`이 판정 액션으로 정규화 |

## For AI Agents

- 두 guard는 같은 STAFF/ADMIN 권한을 검사하지만 실패 시 노출 문구가 다르다(`APP_004` vs `APP_018`) — 새 엔드포인트를 추가할 때 판정 성격이면 `ApplicationsStaffGuard`, 조회 성격이면 `ApplicationsStaffListGuard`를 쓴다.
- `decide`는 중복 provision 이벤트의 기존 `eventId`를 조회해 `REPOSITORY_EVENT_ALREADY_EXISTS` `DomainException` extension에 담는다.
- 이 경로는 성공 응답이 아니며 같은 idempotency key로 새 이벤트를 만들지 않는다.
- 신청 생성은 항상 같은 트랜잭션에서 1인 팀(leader=신청자)을 만든다. 선택적 `teamName`이 없으면 신청자 표시명 기본값을 쓴다. `joinCodeDigest`는 `common/join-code-digest` + `program-teams`와 동일 발급 규칙을 applications 계층에서 재현한다(그 함수는 비export).

## Dependencies

- [apps/backend/src/AGENTS.md](../AGENTS.md) — 모듈 경계·에러 코드 규약.
- `auth/`(`SessionGuard`·`OriginGuard`), `common/`(`DomainException`).
- `repositories/`(outbox consumer가 이 모듈이 만든 이벤트를 소비 — 직접 import 없이 `OutboxEvent` 테이블로만 연결).
