<!-- init:managed id=backend-programs-public-projects sha256=2f2baab06cd922eb9f53022c93d7d0891674fc4ea084b4b43df63a55ad9d3b0c -->
# programs/archive/public-projects — 익명 공개 프로젝트 읽기

## 경계와 조립

- 이 폴더는 인증 없는 `GET /projects`, `/projects/category-counts`, `/projects/:projectId`, `/users/:userId/public-profile` read API만 소유한다.
- 조립 원본은 `public-projects.module.ts`다. 후보 행은 `public-projects.repository.ts`, 응답 조합은 `public-projects.service.ts`, HTTP 변환은 `dto/`에 둔다.
- 공개 가능성 판단은 `../public-eligibility/public-eligibility.service.ts`의 단일 책임이다. 이 폴더에서 Collection freshness 조건을 재구현하지 않는다.
- 누적 지표·기여자 조회는 `../../repository/program-metrics.repository.ts`의 배치 API만 사용한다. 행 또는 기여자별 조회를 추가하지 않는다.

## 공개 투영 규칙

- `PublicProjectsRepository`의 `PROJECT_ROW_SELECT`는 공개 후보의 allowlist다. wildcard `include`, private 필드 선택, 서비스에서 읽은 뒤 삭제하는 redaction을 금지한다.
- 모든 후보 질의는 `visibility: 'PUBLIC'`와 `publishedAt: { not: null }`를 repository 경계에서 건다. private·unpublished·없는 프로젝트의 관찰 가능성을 분리하지 않는다.
- `findDetail`은 eligibility 실패도 `PROJECT_NOT_FOUND`로, `findProfile`은 사용자 없음과 공개 가능 프로젝트 없음도 `USER_PROFILE_NOT_FOUND`로 처리한다.
- 사용자 공개 프로필은 `findUserIdentity`의 최소 신원 필드와 공개 가능한 참여 프로젝트만 투영한다. 역할·연락처·학적 정보는 추가하지 않는다.
- `PublicProjectRow.projectId`는 내부 `id`가 아니라 `githubRepositoryId` 문자열이다. 외부 DTO·URL·cursor 계약에 내부 id를 노출하지 않는다.

## 페이징과 라우팅

- `public-project-cursor.ts`의 인증 암호화 cursor를 그대로 사용한다. `RUNTIME_CONFIG.SESSION_SECRET`에서 키를 파생하는 fail-closed 경로를 평문 또는 새 환경변수 fallback으로 바꾸지 않는다.
- 목록은 `(publishedAt desc, id desc)` keyset과 `pageSize + 1` lookahead를 쓴다. 다음 cursor는 eligibility 전 마지막 raw 행에서 만들며 fence 때문에 짧은 페이지가 가능하다.
- `category-counts`는 `:projectId`보다 먼저 `public-projects.controller.ts`에 등록한다.
- 공개 프로필 경로는 `public-user-profile.controller.ts`의 `:userId/public-profile` 형태를 유지한다. `/users/me/profile`과 겹치는 param 경로를 만들지 않는다.

## 변경별 검증 기준

- projection·동일 404·상수 쿼리 수 변경은 `public-projects.service.spec.ts`와 `public-projects.repository.spec.ts`를 갱신한다.
- Prisma 경계·실제 후보 필터는 `public-projects.repository.integration.spec.ts`에서, cursor 보안·순서는 `public-project-cursor.spec.ts`에서 고정한다.
- HTTP DTO·캐시·라우팅 변경은 `public-projects.controller.spec.ts`, `public-user-profile.controller.spec.ts`, `public-user-profile-route.http.spec.ts`를 확인한다.
- 공개 프로필 eligibility와 지표 변경은 `public-user-profile.integration.spec.ts`를 함께 다룬다.
<!-- /init:managed id=backend-programs-public-projects -->
