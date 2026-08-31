<!-- init:managed id=craft-init-4-applications sha256=520760ebb5893cb47098d31ee283510c5d42d20abc4419620f8a5cc954b0ed86 -->
# applications — 신청과 판정

## 범위와 흐름

- `applications.module.ts` 조립 아래 프로그램 신청 생성, 학생 본인 관리, 교직원 목록/대시보드, 판정을 소유한다.
- `program-applications.controller.ts`가 프로그램별 GET/POST를, `applications.controller.ts`가 상세·판정을, `student-applications.controller.ts`가 본인 신청 관리를 받는다.
- 생성 트랜잭션은 기간·중복·양식·팀 조건을 검증한다.
  기존 team membership이 있으면 그 팀을 잠그고 재사용하며, 없을 때만 1인 기본 팀과 join code를 만든다.
- 생성은 Application과 필요한 Team을 함께 커밋하고 `TEAM_CREATED`·`APPLICATION_SUBMITTED` audit을 같은 트랜잭션에 기록한다.
- 판정은 상태 전이, typed audit, 승인 outbox를 원자적으로 남긴다; outbox가 GitHub 프로비저닝의 비동기 입력이며 service가 GitHub를 직접 호출하지 않는다.
- 재승인은 미완료 outbox/job을 정리한 뒤 stable idempotency key로 새 provision event를 발행한다.
  과거 eventId 재사용은 orphan job을 영구 실패로 굳힐 수 있으므로 복원하지 않는다.

## 접근과 경계

- 판정은 `ApplicationsStaffGuard`, 교직원 목록은 `ApplicationsStaffListGuard`를 쓴다; 외부 오류 계약이 달라 guard를 합치지 않는다.
- 학생 경로는 session 사용자 소유 Application만 읽고 변경한다.
- 본인 관리와 교직원 통계는 각각 `student-application-management.service.ts`, `staff-insights.service.ts`의 별도 흐름이다.
- `APP_*` 오류는 `applications-error-code.enum.ts`와 `DomainException` 계약을 유지한다.
- audit에는 committed 신청/판정 사실을 기록하고 outbox consumer·worker의 retry 상태를 업무 audit으로 합성하지 않는다.

## 진입점과 검증

- 구현: `applications.service.ts`, `applications.repository.ts`, `applications.controller.ts`, `program-applications.controller.ts`, `student-application-management.service.ts`.
- 생성/판정: `applications.create.service.spec.ts`, `applications.decision-audit.service.spec.ts`.
- 상세/목록/본인 관리: `applications.detail.service.spec.ts`, `applications.list.service.spec.ts`, `student-application-management.service.spec.ts`.
- HTTP/통합: `program-applications-create-body.http.spec.ts`, `applications-publication-planned.http.spec.ts`, `applications.service.integration.spec.ts`, `student-application-management.service.integration.spec.ts`.
<!-- /init:managed id=craft-init-4-applications -->
