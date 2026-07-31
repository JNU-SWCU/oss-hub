---
slug: ADR-004-REST-API-규격
date: 2026-07-11
author: GoBeromsu
status: Accepted
references:
  - ADR-003-backend-architecture
refines: []
---

# ADR-004: REST API 규격

## Status

Accepted

## Date

2026-07-11

## Context

frontend와 backend가 독립적으로 변경될 수 있으므로 URL, 성공·실패 응답, 명명, 검증 규칙을 단일 계약으로 고정해야 한다. HTTP가 이미 상태 코드와 헤더의 표준 의미를 제공하므로 응답 본문은 소비자가 필요한 데이터와 오류 정보를 직접 표현해야 한다. 목록 API는 데이터 증가에도 예측 가능한 조회 비용과 UI 동작을 제공해야 한다.

## Decision

모든 REST API는 `/api/v1` 아래에 두고 URL에는 복수형 명사, kebab-case, 계층 구조를 사용한다. NestJS의 전역 접두사도 `api/v1`으로 설정한다. 성공 응답은 별도 envelope 없이 순수 DTO를 반환한다. 실패 응답은 RFC 7807 ProblemDetail에 도메인 오류 코드 `code`를 추가한다. 코드는 도메인 영문 3글자와 숫자 3자리의 `USR_001` 형식이며, 각 도메인은 자체 ErrorCode enum을 소유한다.

JSON 필드는 camelCase로 작성한다. boolean 필드는 `is`, `has`, `can` 접두사를 사용하고 enum 값은 UPPER_SNAKE_CASE로 작성한다. 모든 목록 조회는 페이지네이션을 제공한다. controller DTO 경계에서 입력값을 검증하고, 내부 도메인 모델을 API 계약으로 직접 노출하지 않는다.
라우팅 이전 전송 계층 오류(예: 431 헤더 초과, 형식이 잘못된 HTTP 요청)는 Node HTTP 파서가 처리하므로 ProblemDetail 계약 범위에서 제외한다.

| HTTP 메서드 | 용도 | 예시 |
| --- | --- | --- |
| GET | 단건 또는 목록 조회 | `GET /api/v1/users`, `GET /api/v1/users/{userId}` |
| POST | 새 리소스 생성 또는 명시적 행위 수행 | `POST /api/v1/users` |
| PUT | 리소스의 전체 교체 | `PUT /api/v1/users/{userId}` |
| PATCH | 리소스의 부분 수정 | `PATCH /api/v1/users/{userId}` |
| DELETE | 리소스 삭제 | `DELETE /api/v1/users/{userId}` |

실패 응답의 예시는 다음과 같다.

```json
{
  "type": "https://api.oss-hub.example/problems/user-not-found",
  "title": "User not found",
  "status": 404,
  "detail": "요청한 사용자를 찾을 수 없습니다.",
  "instance": "/api/v1/users/42",
  "code": "USR_001"
}
```

### 리소스 명명과 호환성 원칙

URI는 backend 구현 세부사항이 아니라 product가 다루는 리소스 명사를 표현한다. 익명 방문자에게 공개하는 canonical collection이 같은 계층에 대응하는 private collection을 따로 갖지 않는 projection 전용 자원이면 `public` 접두사·접미사를 붙이지 않는다 — 예: `GET /projects`. 이 규칙은 별도 visibility projection·디렉터리·trust boundary가 있어 `public` 표기가 실제로 필요한 다른 사례(예: 여러 API가 채택한 별도 공개 디렉터리 방식)까지 부정하지 않으며, 이 저장소가 touched하는 자원에 한정한다. 리소스의 부분집합(카테고리, 상태, 검색어 등)은 별도 endpoint나 path segment가 아니라 query parameter로 표현한다. `/me`는 REST 표준이 아니라 이 저장소의 로컬 관례이며, 호출자 자신이 소유한 자원(`GET /users/me/profile`)에 한정해 사용한다 — 같은 개념에 API마다 다른 철자(GitHub `/user`, Zalando `self`)를 쓴다는 사실을 이 결정의 근거로 남기고 보편 표준으로 주장하지 않는다. CRUD로 자연스럽게 표현되지 않는 domain command는 예외적으로 동사형 action 자원을 허용한다(`POST /repositories/{repositoryId}/publish`). 이 예외는 명시적 상태 전이처럼 표준 자원 표현이 어색한 경우로 한정하고, 일반 생성·조회·수정·삭제는 표준 CRUD 자원으로 표현한다.

기존 route의 rename·제거는 기본적으로 breaking change다. 이 저장소가 frontend·backend를 한 repo에서 함께 소유하고 pre-release 단계(운영 트래픽·확인된 외부 소비자 계약이 없음)인 동안에는, 실제 조사로 외부 소비자가 없음을 확인한 touched 경로에 한해 alias 없는 clean break 변경을 허용한다. 이 예외는 "동일 repo가 양쪽을 통제하고 조사로 외부 계약이 없음을 확인했다"는 조건에 결속하며, 그 조건이 성립하지 않는 일반적인 API rename에는 적용하지 않는다. 실행 중 실제 외부 caller(다른 저장소·서드파티 client)의 사용이 확인되거나 선언되면 clean break를 하지 않고 기존 route를 alias로 유지하며 deprecation 고지를 남기거나 버전이 다른 계약(`/api/v2`)으로 분리한다.

이 원칙은 실제로 변경하는 route에만 적용하는 boy-scout 규칙이다. 이번 결정이 손대지 않은 기존 route는 그대로 유효한 계약으로 남으며 소급 rename을 요구하지 않는다.

## Alternatives considered

### 응답 봉투(envelope)

- Pros: 성공 여부와 메타데이터를 모든 응답에 같은 모양으로 넣을 수 있다.
- Cons: HTTP 상태 코드와 오류 의미를 본문에 중복하고, 순수 DTO 소비를 복잡하게 한다.
- **Rejected:** HTTP 표준을 이중화하지 않고 성공 데이터는 순수 DTO, 실패는 RFC 7807로 명확히 표현한다.

### 임의 문자열 오류 코드

- Pros: 초기 구현에서 빠르게 오류 메시지를 추가할 수 있다.
- Cons: 도메인 소유권, 검색 가능성, 클라이언트 분기 규칙이 불명확해진다.
- **Rejected:** 도메인별 ErrorCode enum과 고정 형식 코드가 안정적인 클라이언트 계약을 제공한다.

### `/me`를 보편 REST 표준으로 채택

- Pros: 자기 자신의 자원을 가리키는 짧고 널리 알려진 철자다.
- Cons: GitHub `/user`, Zalando `self` 등 API마다 다른 철자를 쓰므로 보편 표준이라고 주장하면 근거가 부정확해진다.
- **Rejected:** 이 저장소의 로컬 관례로 명시하고 caller-owned 자원에 한정해 사용한다.

### 모든 route rename에 버전 접두사 증가

- Pros: API 버전이 항상 명시적이고 호환성 판단에 사람 조사가 필요 없다.
- Cons: pre-release 단계에서 확인된 외부 소비자가 없는 상태로 매 rename마다 `/api/v2`를 만들면 유지 비용이 실제 이득보다 크다.
- **Rejected:** 조사로 외부 소비자가 없음을 확인한 touched 경로는 clean break를 허용하고, 외부 소비자가 확인되는 시점에 버전 분리 또는 alias를 도입한다.

## Consequences

### Enables

- frontend가 HTTP 상태와 DTO·ProblemDetail 형태를 예측 가능하게 처리한다.
- API 문서, 로그, 클라이언트 오류 처리를 도메인 코드로 연결한다.
- 목록 API가 페이지네이션을 기본 계약으로 제공한다.

### Costs / trade-offs

- 새 endpoint마다 DTO 검증, 오류 코드, 페이지네이션 계약을 설계해야 한다.
- 단순 endpoint도 envelope를 통한 공통 메타데이터에 의존할 수 없다.

### New constraints

- URL은 `/api/v1` 아래의 복수형 kebab-case 리소스 경로를 사용한다.
- 성공 응답에 성공 여부를 감싼 envelope를 추가하지 않는다.
- 실패 응답은 RFC 7807 ProblemDetail과 `AAA_000` 형식 `code`를 포함한다.
- JSON 명명은 camelCase, boolean은 `is`·`has`·`can`, enum 값은 UPPER_SNAKE_CASE를 사용한다.
- 목록 endpoint는 페이지네이션을 제공하고 DTO 경계에서 입력을 검증한다.
- URI는 product 리소스 명사를 표현하며 구현 세부사항을 노출하지 않는다.
- private counterpart가 없는 canonical anonymous collection에는 `public` 접두사·접미사를 붙이지 않는다(예: `/projects`) — 이는 이 저장소가 touched하는 자원에 한정한 규칙이다.
- 리소스 부분집합은 query parameter로 표현하고 별도 path segment를 만들지 않는다.
- `/me`는 이 저장소의 로컬 관례이며 caller-owned 자원에만 사용한다 — 보편 REST 표준으로 주장하지 않는다.
- 표준 CRUD로 표현되지 않는 domain command에 한해 동사형 action 자원을 예외적으로 허용한다.
- route rename·제거는 기본적으로 breaking change다. touched 경로의 clean break는 동일 repo가 frontend·backend를 함께 소유하고 조사로 외부 소비자가 없음을 확인한 pre-release 조건에서만 허용한다.
- 확인되거나 선언된 외부 caller가 있으면 clean break 대신 alias 유지 + deprecation 고지 또는 버전이 다른 계약으로 분리한다.
- 이 원칙은 touched 경로에만 적용하며 이번 결정이 손대지 않은 기존 route는 grandfather되어 그대로 유효하다.

## Changelog

- 2026-07-11: initial decision
- 2026-07-11: 전송 계층 오류 제외 조항 추가
- 2026-07-31: 제품 리소스 명명, query filter, repo-local `/me`, 예외적 command 자원, route rename의 breaking 기본값과 touched pre-release clean break 조건, 외부 소비자 확인 시 alias/deprecation 규칙을 추가했다.

## References

- [RFC 7807: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc7807)
- [Pullit API 설계 가이드라인](https://pullit-docs-server.vercel.app/index.html#02-api-design)
- [addyosmani/agent-skills — api-and-interface-design](https://github.com/addyosmani/agent-skills/tree/main/skills/api-and-interface-design)
