<!-- init:managed id=craft-init-backend-src-common sha256=18cd711990468998469bc5f3cc58fa045bb5bcfcb1e9c3a495e6d4ce8a88afc1 -->
# Shared backend common layer

`apps/backend/src/common/` owns infrastructure contracts used by multiple feature modules; it must not absorb one feature's business policy.

## Problem Detail contract

- `error-code.ts` defines `ErrorCode`, `DomainException`, and shared Problem Detail extensions.
- `controller/problem-detail.filter.ts` is the global `@Catch()` filter registered by `../main.ts` and emits `application/problem+json`.
- Preserve explicit client exposure: statuses below 500 are exposed, and an `ErrorCode` with `exposeToClient: true` may deliberately expose a reviewed 500/503 detail.
- Other 5xx failures are logged and sanitized to `SYS_001`; never leak arbitrary exception messages.
- `system-error-code.enum.ts` distinguishes missing route, validation, and ordinary bad-request framework failures.
- Keep `ProblemDetailExtensions` compatible with `apps/frontend/src/lib/api-client.ts` instead of adding another error shape.

## Shared locking

- `../prisma/lock-program-tree.ts` owns staged locks for `Program`, `Milestone`, and `MilestoneDocument` rows.
- The global order remains `Program` → `Milestone` → `MilestoneDocument` by ascending id.
  Repositories carry opaque witnesses between stages without reacquiring locks.
- Feature paths may use the ordered subset they need but must never acquire the same rows in reverse order.
- Reuse the prisma helper for milestone-document collection changes; do not copy raw lock SQL into another feature.

## Placement and checks

- Shared additions require multiple real consumers and no dependency on feature modules or repositories.
- Feature-specific DTOs, exceptions, controllers, services, repositories, and error codes stay with their owner.
- GitHub URL 파싱은 `../github/domain/github-repository-url.ts`, 팀 참여코드 digest는 `../programs/domain/join-code-digest.ts`, secret 해석은 `../runtime-config/join-code-secret.ts`가 소유한다.
- Focused error conversion coverage: `controller/problem-detail.filter.spec.ts`.
- Lock semantics and ordering are tested with `lock-program-tree.ts` consumers under `programs/` and `milestone-documents/`.
<!-- /init:managed id=craft-init-backend-src-common -->
