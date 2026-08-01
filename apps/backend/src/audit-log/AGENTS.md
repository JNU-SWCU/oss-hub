<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-01 -->

# apps/backend/src/audit-log — 불변 감사 원장

## Purpose

관리자 접근 변경(actor·target·before/after)을 append-only로 기록하고 조회하는 원장이다.
버전이 다른 행이 섞여 있어도 과거 사실을 왜곡하지 않고 그대로 읽어낼 수 있어야 한다.

## Key Files

| 파일 | 역할 |
| --- | --- |
| `audit-log-metadata.ts` | `schemaVersion` 판별 유니온 타입과 `isAccessAuditMetadata` 검증 가드 — v1(액터만 스냅샷)·v2(액터+대상 스냅샷)·legacy(`{}`)를 모두 정의 |
| `audit-log.repository.ts` | Prisma 행을 `AuditLogRecord`로 매핑 — `resolveAuditTargetLabel`이 버전별 대상 표시 규칙을 결정 |
| `audit-log.service.ts` | ADMIN 전용 조회·기간 필터·`record` 쓰기 헬퍼 |
| `audit-log.controller.ts` | `/api/v1/audit-logs` 엔드포인트 |
| `dto/audit-log-query.dto.ts` | 조회 쿼리 파라미터 검증 |

## For AI Agents

### 일반 원칙 (Fail-Fast / No Silent Fallback)

1. 데이터가 없으면 없는 그대로 보여준다 — 그럴듯한 값을 합성해 채우지 않는다.
2. 기능이 실패하면 실패로 보여준다 — 상태를 추측해 UI/동작을 숨기지 않고, 액션 시점에 명시적 에러를 반환한다.
3. 읽기/표시 계층은 진실을 보정하지 않는다 — 보강이 필요하면 쓰기 시점에 스키마 버전을 올려 기록한다.

### 이 디렉터리 적용례

- 이 디렉터리는 append-only 감사 원장이다. 과거 행(schemaVersion 1, legacy `{}`)은 절대 다시 쓰지 않는다.
- **금지(antipattern)**: 구버전 행의 읽기/표시 fallback에서 현재 DB 상태(User 테이블 등)를 조회해 GitHub id/login이나 이름을 합성·복원하는 것(원칙 1·3 위반). 원장은 이벤트 시점 사실만 말해야 하며, 현재 상태를 빌려오면 rename/삭제 이후 역사가 왜곡된다.
- 구버전 행의 대상 표시는 원시 `targetType / targetId` 그대로 노출한다(현행 `resolveAuditTargetLabel` 동작이 기준).
- 사람이 읽을 수 있는 스냅샷이 필요하면 스키마 버전을 올려 **작성 시점에** 기록한다. 읽기 시점 보강은 금지(원칙 3).

## Dependencies

- [apps/backend/src/AGENTS.md](../AGENTS.md) — 모듈 경계·에러 코드 규약.
- `users/`(`admin-access-audit.ts` 등 쓰기 호출자), `roles/`(`staff-role-requests.service.ts` 쓰기 호출자).
