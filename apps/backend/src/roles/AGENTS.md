<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-30 · Updated: 2026-07-31 (테스트 파일명 인벤토리 제거) -->

# apps/backend/src/roles — 역할 온보딩·RoleRequest workflow

## Purpose

역할 선택과 본인이 만드는 교직원 RoleRequest 생성·재시도 흐름을 담는다.
같은 `RoleRequest` 테이블을 다루더라도 액터 권한과 트리거에 따라 서비스를 분리한다 — STAFF·ADMIN이 만드는 승인·반려와 ADMIN의 회수는 `users/`가 소유한다.

## Key Files

| 파일 | 역할 |
| --- | --- |
| `roles.service.ts` | 본인 `selectRole`(STUDENT 즉시 확정, STAFF는 pending 요청 생성) · `retryStaffRequest`(REJECTED 후 재시도) |
| `roles.repository.ts` | `withTransaction` — `findUserByGithubId`는 `FOR UPDATE` 행 잠금으로 동시 역할 선택 경쟁을 막음 |
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
- 확정된 역할 직접 변경과 사용자 목록·가입 신청 상세·접근 변경은 `users/`가 소유한다. STAFF는 대기 중인 교직원 요청의 승인·반려만 할 수 있고, 명부·역할 변경·회수는 ADMIN 전용이다.
- 요청 상태 전이(PENDING→APPROVED/REJECTED, STAFF 회수 시 REVOKED 행 삽입)의 원본은 `users/admin-access-transition-table.ts`다. 이 폴더에 있던 `role-request-transition-rules.ts`는 어디서도 호출되지 않는 죽은 규칙이었고 회수를 "APPROVED 행을 REVOKED로 바꾸는 것"으로 적고 있어(#184에서 삽입으로 확정) 삭제했다.
- `selectRole`은 호출 전 `ConsentsService.requireCurrent`만 선행 검사한다. 온보딩 순서가 약관 → 역할 → 프로필이라 역할을 고르는 시점에 프로필은 비어 있는 것이 정상이다 — 프로필 완료를 요구하면 학번이 필요 없는 교직원이 가짜 학번을 지어내야 한다. 미완료 프로필을 다음 단계로 미는 책임은 화면 게이트가 진다.
- 교직원 요청 결정은 `AuditLogService.record`를 같은 트랜잭션의 `store.auditLogWriter`로 넘겨 커밋 원자성을 보장한다 — 감사 로그를 별도 트랜잭션으로 쓰지 않는다.

## Dependencies

- [apps/backend/src/AGENTS.md](../AGENTS.md) — 모듈 경계·에러 코드 규약.
- `auth/`(`AuthModule`), `audit-log/`(`AuditLogModule`), `consents/`(`ConsentsService`).
