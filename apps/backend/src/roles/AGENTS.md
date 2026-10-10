<!-- init:managed id=backend-roles sha256=f47d70410d3a9ba7278a73be0cc25d5fb9166ff2eea7d2a9c8dfb74ba8c99026 -->
# roles — 회원 유형 선택과 교직원 접근 요청

## 소유 경계

- 이 모듈은 온보딩 회원 유형 선택, 자신의 교직원 접근 요청 조회·재요청만 소유한다.
- HTTP 진입은 `controller/roles.controller.ts`의 `OnboardingController`와 `StaffAccessRequestsController`, 업무 규칙은 `service/roles.service.ts`다.
- 저장과 transaction은 `users/service/onboarding.service.ts`를 통해 `users/repository/onboarding.repository.ts`가 소유하며 users는 roles를 역참조하지 않는다.
- 교직원 요청의 승인·반려, 접근 회수, 사용자 역할 관리와 명부 권한은 `users/` 소유다. 이 모듈에 결정·회수 API 또는 상태 전이를 추가하지 않는다.
- `users/repository/staff-access-request.ts`는 회원 유형 선택과 프로필 완료의 요청 생성 규칙을 같은 transaction 안에서 공유한다.
- 재요청은 `service/roles.service.ts`가 users의 onboarding transaction store에서 pending 요청을 생성한다.

## 권한과 상태 모델

- `selectedMemberKind`는 선택 기록이지 접근 권한 확정이 아니다. 최초 확정 회원 유형은 프로필 생성 경로가 소유하며, 이후 관리자 변경은 `users/`의 회원 유형 변경 경로가 소유한다.
- 선택과 재요청 전에는 `ConsentsService.requireCurrent`를 통과해야 한다. 프로필 완성을 선택의 선행 조건으로 되돌리지 않는다.
- 이미 확정된 동일 유형 선택은 멱등으로 허용하지만 다른 유형 변경은 `ROLE_ALREADY_CONFIRMED`다.
- 교직원 선택은 완료된 프로필이면 같은 transaction에서 요청을 열 수 있다. 미완료 프로필을 pending 요청으로 승격하지 않는다.
- 학생 선택은 pending 교직원 요청이 있으면 막는다. 교직원 재요청은 `REJECTED` 또는 `REVOKED` 이력에서만 새 pending 요청을 만들며 접근 권한을 직접 켜지 않는다.
- 확정 회원 유형이 학생이면 과거 교직원 회수 이력이 있어도 교직원 재요청을 열지 않는다.
- 요청 경쟁은 `UsersOnboardingService.withTransaction()`과 store의 `findUserByGithubId()`의 `FOR UPDATE` 잠금으로 직렬화한다. 읽기-검사-쓰기를 transaction 밖으로 분리하지 않는다.

## DTO와 오류 계약

- 선택 입력은 `dto/select-role-request.dto.ts`, 선택 상태·결과는 `dto/role-selection-response.dto.ts`, 요청 응답은 `dto/role-request-response.dto.ts`를 사용한다.
- 컨트롤러는 session github ID만 서비스로 전달하고 응답 DTO의 `from` 변환을 거친다. 사용자 프로필 또는 관리자 권한 필드를 응답에 붙이지 않는다.
- 역할·접근 실패는 `users/domain/roles-error-code.enum.ts`의 기존 `ROL_*` 코드로 표현한다. 인증 실패는 auth 계약을 사용한다.
- `users/domain/member-onboarding.ts`의 `MemberUser` 최소 투영을 확장할 때는 선택·프로필 완료 판정에 필요한 필드인지 먼저 확인한다.

## 변경별 검증 기준

- 선택·동의·프로필 완료 조합은 `service/roles.service.spec.ts`와 `service/roles.profile-invariant.spec.ts`에서 고정한다.
- 잠금·동시 요청·repository 투영 변경은 `repository/roles.repository.integration.spec.ts`를 갱신한다.
- 경로, OriginGuard, DTO와 cache header 변경은 `controller/roles.controller.spec.ts`에서, module wiring은 `roles.module.spec.ts`에서 다룬다.
<!-- /init:managed id=backend-roles -->
