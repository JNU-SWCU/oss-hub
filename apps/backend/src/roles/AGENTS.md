<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-30 · Updated: 2026-07-31 (테스트 파일명 인벤토리 제거) -->

# apps/backend/src/roles — 역할 온보딩·RoleRequest workflow

## Purpose

역할 선택과 교직원 RoleRequest 생성·승인·반려·회수 흐름을 담는다.
같은 `RoleRequest` 테이블을 다루더라도 액터 권한과 트리거에 따라 서비스를 분리한다.

## Key Files

| 파일 | 역할 |
| --- | --- |
| `roles.service.ts` | 본인 `selectRole`(STUDENT 즉시 확정, STAFF는 pending 요청 생성) · `retryStaffRequest`(REJECTED 후 재시도) |
| `roles.repository.ts` | `withTransaction` — `findUserByGithubId`는 `FOR UPDATE` 행 잠금으로 동시 역할 선택 경쟁을 막음 |
| `staff-role-requests.service.ts` | ADMIN의 교직원 요청 승인/반려/철회 — `AuditLogService`로 결정을 기록 |
| `role-request-transition-rules.ts` | 요청 상태 전이 규칙(PENDING→APPROVED/REJECTED, APPROVED→REVOKED)의 원본 |
| `roles.controller.ts` | `OnboardingController`(`selectRole`) · `RoleRequestsController`(`getMe` 조회·`retry` 재시도) |
| `roles-error-code.enum.ts` | `ROL_*` 코드 레지스트리 |

## Subdirectories

| 경로 | 내용 |
| --- | --- |
| `domain/` | `role-onboarding.ts`(선택 가능 역할·결과 타입) · `staff-role-request.ts` |
| `dto/` | 역할 선택·교직원 요청 DTO |

## For AI Agents

- 기존 `STUDENT`가 다시 학생을 선택하는 경로는 멱등 성공한다.
- 다른 역할이 이미 있거나 역할 보유자가 STAFF를 선택하면 `ROLE_ALREADY_CONFIRMED`를 던진다.
- 확정된 역할 직접 변경과 관리자 사용자 목록·상세·접근 변경은 `users/`가 소유한다.
- `selectRole`은 호출 전 `ConsentsService.requireCurrent`·`UsersService.requireCompleteProfile`을 선행 검사한다 — 이 모듈이 동의·프로필 완성 로직을 재구현하지 않는다(ADR-003 공개 표면만 참조).
- 교직원 요청 결정은 `AuditLogService.record`를 같은 트랜잭션의 `store.auditLogWriter`로 넘겨 커밋 원자성을 보장한다 — 감사 로그를 별도 트랜잭션으로 쓰지 않는다.

## Dependencies

- [apps/backend/src/AGENTS.md](../AGENTS.md) — 모듈 경계·에러 코드 규약.
- `auth/`(`AuthModule`), `audit-log/`(`AuditLogModule`), `consents/`(`ConsentsService`), `users/`(`UsersService`).
