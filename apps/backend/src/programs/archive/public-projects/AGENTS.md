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

`public-project-cursor.ts`는 `Repository_visibility_publishedAt_id_idx` 인덱스의 정렬 키(`publishedAt`, `id`)를 cursor로 왕복시킨다.
offset 페이지네이션이 아니므로 페이지가 깊어져도 스캔 비용이 늘지 않는다.

**cursor 페이로드는 서버만 열 수 있다(QA40).** 그 정렬 키는 내부 `Repository.id`와 공개 시각이고, 페이지 경계는 eligibility fence *이전*의 raw 행으로 정하므로(경계를 밀지 않으려는 의도된 설계), 평문 토큰이면 fence에 가려진 저장소의 내부 id·공개 시각이 그대로 새어 나간다.
그래서 페이로드를 AES-256-GCM으로 인증 암호화한다 — 토큰은 `base64url(VERSION(1) || IV(12) || TAG(16) || ciphertext)`이고 VERSION은 AAD로 인증하며, 평문은 64바이트 배수로 패딩해 토큰 길이가 내부 id 길이를 드러내지 않게 한다.
키는 `SESSION_SECRET`에서 HKDF-SHA256으로 파생한다 — **새 환경변수를 요구하지 않는다.** `AuthConfig`가 같은 env를 부팅 시 이미 필수로 강제하므로 앱이 뜨는 환경에는 항상 존재하며, 비었거나 32바이트 미만이면 `PublicProjectsService` 인스턴스화 시점에 실패한다(fail-closed — 평문 커서 폴백은 두지 않는다).
복호 실패(위조·다른 키·버전 변조)는 전부 동일한 `INVALID_PAGE_ID`(400)다.
형식은 API 계약이 아니므로 클라이언트는 받은 토큰을 그대로 되돌려주기만 한다.

### 남아 있는 노출 — 「빈 페이지 오라클」(QA40 ② 미해결)

`items.length < pageSize`인데 `nextPageId`가 있으면, 그 keyset 구간에 fence로 가려진 저장소가 정확히 `pageSize - items.length`건 있다는 뜻이다(`pageSize=1`이면 빈 페이지 자체가 1건 신호다).
막으려면 페이지가 찰 때까지 재조회해야 하는데 아래 「상수 쿼리 수 설계」와 정면으로 부딪히므로 지금은 막지 않는다.
현재 동작은 `public-projects.service.spec.ts`의 `QA40 — 커서를 통한 숨겨진 저장소 노출` describe가 고정한다 — 페이지 채우기를 도입하려면 그 테스트를 의도적으로 갱신하고 쿼리 수 계약도 함께 다시 쓴다.

## 상수 쿼리 수 설계

`PublicProjectsService`의 세 메서드는 페이지 크기·프로젝트 수와 무관하게 고정된 쿼리 수만 실행한다.

- `findPage`: 최대 3 쿼리 (목록 1 + eligibility의 연결 증명·관찰 2)
- `findDetail`: 최대 8 쿼리
- `findProfile`: 최대 9 쿼리

N+1을 만드는 변경(반복문 안 쿼리, 관련 엔티티별 추가 조회)은 이 설계를 깨므로 리뷰에서 반려한다.

## 의존성

- `public-eligibility/` (`PublicEligibilityService`) — 공개 노출 가능 여부의 유일한 판정자.
- `collection/` (`CollectionReadPort`의 `getRepositoryCumulativeMetrics`·`getContributorCumulativeMetrics`) — 누적 지표 조회.
- `users/`의 `UsersModule` — 공개 프로필은 `/users/:userId/public-profile`, 내 프로필은 `/users/me/profile`로 마지막 세그먼트가 달라 어떤 import 순서에서도 충돌하지 않는다(#551). 이 경로 분리를 되돌려 `/users/:userId/profile`로 합치면 모듈 등록 순서가 곧 라우팅 계약이 되므로 되돌리지 않는다 — Express 5(path-to-regexp v8)는 `:param` 정규식 제약을 지원하지 않아 순서 무관성을 다른 방법으로 확보할 수 없다. 회귀 고정은 `public-user-profile-route.http.spec.ts`가 두 등록 순서 모두에서 검증한다.

## For AI Agents

- 이 모듈은 read 전용이다 — 쓰기 경로를 추가하지 않는다.
- 공개 판정 로직을 이 모듈 안에 재구현하지 않는다. 항상 `PublicEligibilityService`를 통한다.
- private 테이블 직접 조회·wildcard `include`는 루트 AGENTS.md §4 금지 목록을 따른다.
