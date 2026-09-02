<!-- init:managed id=craft-init-4-audit-log sha256=8eb04806b1a2ae43641be0c24dc1e4c5870c3d44cc904fe2f8c80c9b49e77893 -->
# audit-log — 불변 감사 원장

## 범위와 기록 경계

- `audit-log.module.ts`는 `AuditLogService`를 export하고 committed 상태 전이와 승인된 maintenance action의 append-only ledger를 소유한다.
- domain mutation이 이미 Prisma transaction을 가지면 `AuditLogService.record`에 transaction writer를 넘겨 업무 상태와 audit을 원자적으로 기록한다.
- transaction 밖의 maintenance command는 실제 side effect가 성공한 순서 뒤에만 기록한다.
  실패한 시도, 단순 읽기, 비결정적 background 관측은 감사 사실로 만들지 않는다.
- `audit-log.repository.ts`는 행을 목록 record로 변환하고 기간 필터를 적용한다.
- `audit-log.controller.ts`의 `/api/v1/audit-logs`는 ADMIN 전용이며 `dto/audit-log-query.dto.ts`가 query 계약을 정규화한다.
- 새 action은 writer metadata와 `audit-log-metadata.ts` 또는 분리 metadata validator를 함께 추가한다.

## 버전과 개인정보

- ledger 행은 update/delete하지 않고 legacy `{}`와 schemaVersion 1/2 metadata를 과거 사실로 읽는다.
- snapshot 없는 legacy actor 표시는 현재 User nickname relation fallback을 사용할 수 있다; 이를 immutable target snapshot으로 오인하지 않는다.
- ROLE_REQUEST/USER target은 snapshot 없는 행에 User join fallback을 두지 않고 raw targetType/targetId를 유지한다.
- PROGRAM·REPOSITORY와 APPLICATION program name만 현재 제한된 표시 예외다; APPLICATION applicant login은 v2 snapshot에만 의존한다.
- metadata, log, 오류 응답에 token, email, 현재 계정 식별자를 새로 합성하지 않는다.

## 진입점과 검증

- 구현: `audit-log.service.ts`, `audit-log.repository.ts`, `audit-log-metadata.ts`, `access-audit-metadata.ts`, `application-decision-audit-metadata.ts`.
- unit: `audit-log.controller.spec.ts`, `audit-log.service.spec.ts`, `audit-log.repository.spec.ts`, `audit-log-metadata.spec.ts`, `independent-authority-audit-metadata.spec.ts`.
- isolated integration: `audit-log-append-only.integration.spec.ts`, `audit-log.integration.spec.ts`.
<!-- /init:managed id=craft-init-4-audit-log -->
