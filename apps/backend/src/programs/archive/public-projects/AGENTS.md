<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-01 -->

# apps/backend/src/public-projects — 공개 프로젝트·프로필 read API

## Purpose

인증 없이 호출 가능한 공개 read 전용 API다.
구 `showcase`/`profiles` 공개 read 라우트를 대체하며 그 라우트들은 이제 404를 반환한다.
공개 여부 판정은 이 모듈이 직접 하지 않고 `public-eligibility/`의 `PublicEligibilityService`에 위임한다.

## Key Files

| 파일 | 역할 |
| --- | --- |
| `public-projects.module.ts` | 모듈 조립 — `PublicEligibilityModule`·`CollectionModule` import |
| `public-projects.controller.ts` | `GET /projects`(`category` 선택), `GET /projects/category-counts`, `GET /projects/:projectId` |
| `public-user-profile.controller.ts` | `GET /users/:userId/public-profile` |
| `public-projects.service.ts` | `findPage`·`categoryCounts`·`findDetail`·`findProfile` |
| `public-project-cursor.ts` | opaque base64url keyset cursor 인코딩/디코딩 |
| `public-project-result.ts` | 응답 DTO 형태 정의 |
| `public-projects-error-code.enum.ts` | 도메인 실패 enum |
| `dto/` | 요청/응답 DTO |

## keyset cursor 설계

`public-project-cursor.ts`는 `Repository_visibility_publishedAt_id_idx` 인덱스의 정렬 키(`publishedAt`, `id`)를 그대로 opaque base64url cursor로 인코딩한다.
offset 페이지네이션이 아니므로 페이지가 깊어져도 스캔 비용이 늘지 않는다.
cursor 페이로드는 클라이언트가 해석할 수 없는 불투명 토큰으로 취급하고, 형식을 API 계약으로 노출하지 않는다.

## 상수 쿼리 수 설계

`PublicProjectsService`의 세 메서드는 페이지 크기·프로젝트 수와 무관하게 고정된 쿼리 수만 실행한다.

- `findPage`: 2 쿼리 (목록 + 다음 페이지 존재 여부)
- `findDetail`: 4 쿼리
- `findProfile`: 5 쿼리

N+1을 만드는 변경(반복문 안 쿼리, 관련 엔티티별 추가 조회)은 이 설계를 깨므로 리뷰에서 반려한다.

## 의존성

- `public-eligibility/` (`PublicEligibilityService`) — 공개 노출 가능 여부의 유일한 판정자.
- `collection/` (`CollectionReadPort`의 `getRepositoryCumulativeMetrics`·`getContributorCumulativeMetrics`) — 누적 지표 조회.
- `users/`의 `UsersModule` — 공개 프로필은 `/users/:userId/public-profile`, 내 프로필은 `/users/me/profile`로 마지막 세그먼트가 달라 어떤 import 순서에서도 충돌하지 않는다(#551). 이 경로 분리를 되돌려 `/users/:userId/profile`로 합치면 모듈 등록 순서가 곧 라우팅 계약이 되므로 되돌리지 않는다 — Express 5(path-to-regexp v8)는 `:param` 정규식 제약을 지원하지 않아 순서 무관성을 다른 방법으로 확보할 수 없다. 회귀 고정은 `public-user-profile-route.http.spec.ts`가 두 등록 순서 모두에서 검증한다.

## For AI Agents

- 이 모듈은 read 전용이다 — 쓰기 경로를 추가하지 않는다.
- 공개 판정 로직을 이 모듈 안에 재구현하지 않는다. 항상 `PublicEligibilityService`를 통한다.
- private 테이블 직접 조회·wildcard `include`는 루트 AGENTS.md §4 금지 목록을 따른다.
