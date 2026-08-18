<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-01 -->

# apps/backend/src/audit-log — 불변 감사 원장

## Purpose

append-only ADMIN ledger of committed web state transitions
버전이 다른 행이 섞여 있어도 과거 사실을 왜곡하지 않고 그대로 읽어낼 수 있어야 한다.

## Key Files

| 파일 | 역할 |
| --- | --- |
| `audit-log-metadata.ts` | `schemaVersion` 판별 유니온 타입과 `isAccessAuditMetadata` 검증 가드 — v1(액터만 스냅샷)·v2(액터+대상 스냅샷)·legacy(`{}`)를 모두 정의. 접근 변경 밖의 typed action(`REPOSITORY_PUBLISHED` · `PROGRAM_ARCHIVED`/`PROGRAM_RESTORED` · `COLLECTION_SYNC_TRIGGERED` · `SUBMISSION_FILE_CLEANUP_RETRY_RESET` · `APPLICATION_APPROVED`/`APPLICATION_REJECTED`)도 여기서 정의한다 — 새 action을 쓰기만 하고 읽기 가드를 빠뜨리면 목록 조회 전체가 `InvalidAuditLogMetadataError`로 깨진다 |
| `audit-log.repository.ts` | Prisma 행을 `AuditLogRecord`로 매핑 — `resolveAuditTargetLabel`이 버전별 대상 표시 규칙을 결정 |
| `audit-log.service.ts` | ADMIN 전용 조회·기간 필터·`record` 쓰기 헬퍼 |
| `audit-log.controller.ts` | `/api/v1/audit-logs` 엔드포인트 |
| `dto/audit-log-query.dto.ts` | 조회 쿼리 파라미터 검증 |

## For AI Agents

원칙 원본은 [ADR-007: 명시적 fallback 계약](../../../../docs/decisions/ADR-007-explicit-fallback-contract.md)을 참조한다 — 여기서는 이 디렉터리에 적용한 결과만 명시한다.

- 이 디렉터리는 append-only 감사 원장이다. 과거 행(schemaVersion 1, legacy `{}`)은 절대 다시 쓰지 않는다.
- **금지(antipattern)**: 구버전 행의 읽기/표시 fallback에서 현재 DB 상태(User 테이블 등)를 조회해 사람의 GitHub id/login이나 실명을 합성·복원하는 것(ADR-007 원칙 위반). 원장은 이벤트 시점 사실만 말해야 하며, 현재 상태를 빌려오면 rename/탈퇴 이후 역사가 왜곡된다. → 그래서 `ROLE_REQUEST`/`USER`(access-audit) 대상은 스냅샷 없는 과거 행에 join fallback을 두지 않는다. 이 두 targetType은 2026-08-01부터 모든 새 행이 스냅샷을 남기므로 문제도 더 늘지 않는다.
- **예외로 취급하는 join**: `PROGRAM`/`REPOSITORY`는 스냅샷 없는 과거 행에 한해 배치 join(`resolveProgramNames`/`resolveRepositoryNames`, `audit-log.repository.ts`)으로 **현재** 엔티티 이름을 보여준다. 이는 사람 신원(로그인·개명) 재구성이 아니라 엔티티(프로그램/저장소) 표시 이름일 뿐이라, "지금 이름이 다르면 지금 이름을 보인다"는 오차가 감사 목적(누가 무엇을 했는지 추적)을 해치지 않는다는 판단이다.
- **APPLICATION join은 프로그램 이름만 예외로 취급한다**: `resolveApplicationLabels`(`audit-log.repository.ts`)는 스냅샷 없는 과거 행에 한해 `Application.program.name`만 join한다. `applicant`(신청자)는 `User`이고 그 `nickname`은 GitHub 로그인 — 즉 사람 신원이라 위 예외에 들지 못한다. select에 `applicant`를 넣는 순간 ADR-007이 금지하는 "조회 시점에 현재 User 테이블을 다시 읽어 과거 사실을 재구성"이 된다. (#790 리뷰가 이 select에서 `applicant.nickname`을 실제로 읽어 라벨에 합성하던 버그를 잡았다 — 프로그램 이름 예외를 사람 신원까지 잘못 확장한 사례였다. select에서 `applicant` 자체를 제거해 재발을 막았다.) v2(작성 시점 스냅샷) 행은 `applicantGithubLogin`을 이미 기록해 뒀으므로 이 제약과 무관하게 `프로그램 이름 · @신청자로그인`을 그대로 보여준다.
- 그 밖의 구버전 행(예: `ROLE_REQUEST`/`USER`의 v1) 대상 표시는 원시 `targetType / targetId` 그대로 노출한다(현행 `resolveAuditTargetLabel` 동작이 기준).
- 사람이 읽을 수 있는 스냅샷이 필요하면 스키마 버전을 올려 **작성 시점에** 기록한다. 위 예외(PROGRAM/REPOSITORY/APPLICATION의 엔티티 이름 join)를 벗어나는 읽기 시점 보강은 금지.

## Dependencies

- [apps/backend/src/AGENTS.md](../AGENTS.md) — 모듈 경계·에러 코드 규약.
- `users/`(`admin-access-audit.ts` 등 쓰기 호출자), `roles/`(`staff-role-requests.service.ts` 쓰기 호출자).
