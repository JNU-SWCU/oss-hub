<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-20 -->

# apps/backend/src/common — 공유 에러·필터

## Purpose

전 모듈이 공유하는 기반 계층. ADR-003 모듈 경계 lint에서 명시적으로 제외된다(모듈이 아니라 공용 인프라이기 때문).

## Key Files

| 파일 | 역할 |
| --- | --- |
| `error-code.ts` | `ErrorCode` 인터페이스, `DomainException` 기반 클래스, `ProblemDetailExtensions`(예: `retryNotBeforeAt`) |
| `system-error-code.enum.ts` | `SYS_*` 코드 — `INTERNAL_SERVER_ERROR`(001)·`ROUTE_NOT_FOUND`(002)·`VALIDATION_FAILED`(003)·`BAD_REQUEST`(004) |
| `problem-detail.filter.ts` | 전역 `@Catch()` `ExceptionFilter` — 모든 예외를 RFC 7807 `application/problem+json`으로 변환 |
| `milestone-document-locks.ts` | `Milestone`·`MilestoneDocument` 행 잠금 원시(raw SQL `FOR UPDATE`)와 **전역 잠금 순서 규칙**(`Program` → `Milestone` → `MilestoneDocument` id asc) |

## For AI Agents

- 새 모듈은 이 파일들을 참조만 하고 수정하지 않는다. 자체 에러 코드가 필요하면 그 모듈 폴더에 `<module>-error-code.enum.ts`를 새로 만들고(예: `auth/auth-error-code.enum.ts`의 `AUT_*`, `collection/collection-error-code.enum.ts`의 `COL_*`) `error-code.ts`의 `ErrorCode`/`DomainException`을 재사용한다.
- `ProblemDetailFilter` 동작 규약:
  - `DomainException`이고 `status < 500`이면 해당 `errorCode`·`extensions`를 그대로 problem body에 노출한다.
  - `HttpException`이고 `status >= 500`이면 상세를 감추고 `SYS_001`로 대체하며 `logger.error`로 실제 이벤트를 남긴다.
  - `status < 500`인 일반 `HttpException`(예: Nest `ValidationPipe`)은 `SYS_003`(message가 배열)/`SYS_004`(그 외)/`SYS_002`(404)로 매핑된다.
  - 그 밖의 unknown exception은 `SYS_001` + `logger.error`.
- 응답 필드: `type`(`about:blank` 고정)·`title`·`status`·`detail`·`instance`(request path)·`code`(위 enum 값) — 프런트 `lib/api-client.ts`의 `ProblemDetail` 타입과 짝을 이룬다.
- 테스트: `problem-detail.filter.spec.ts` (`pnpm --filter backend test:unit`).
- `milestone-document-locks.ts`는 업무 규칙이 아니라 **공용 영속성 도구**다. `milestone-documents`(서류 항목 추가·삭제·순서 재부여)와 `programs`(마일스톤 삭제)가 **같은 행을 같은 순서로** 잠가야 직렬화되므로 어느 한 모듈이 소유하지 않는다 — 소유하면 형제 모듈이 계약 없이 남의 영속성 동작을 실행하게 된다(ADR-003 cross-module behavioral dependency). Port를 새로 만들지 않는 것은 ADR-003의 「기능 요구가 없는 포트·어댑터·추가 추상화는 도입하지 않는다」를 따른 것이다.
- 잠금 순서 규칙(`Program` → `Milestone` → `MilestoneDocument` id asc)은 이 파일 하나에만 둔다. 새 잠금 경로가 필요하면 문장을 복제하지 말고 여기서 export한다 — 규칙이 두 벌로 갈라지는 것 자체가 교착의 원인이다.

## Dependencies

- [apps/backend/src/AGENTS.md](../AGENTS.md)
- `@nestjs/common` 패키지 (`ExceptionFilter`·`HttpException`·`Logger`), `express` 패키지 (`Request`/`Response` 타입).
