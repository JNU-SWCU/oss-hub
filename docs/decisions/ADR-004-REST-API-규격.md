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

모든 REST API는 `/api/v1` 아래에 두고 URL에는 복수형 명사, kebab-case, 계층 구조를 사용한다. NestJS의 전역 접두사도 `api/v1`으로 설정한다. 성공 응답은 별도 envelope 없이 순수 DTO를 반환한다. 실패 응답은 RFC 7807 ProblemDetail에 도메인 오류 코드 `code`를 추가한다. 코드는 도메인 영문 3글자와 숫자 3자리의 `MEM_001` 형식이며, 각 도메인은 자체 ErrorCode enum을 소유한다.

JSON 필드는 camelCase로 작성한다. boolean 필드는 `is`, `has`, `can` 접두사를 사용하고 enum 값은 UPPER_SNAKE_CASE로 작성한다. 모든 목록 조회는 페이지네이션을 제공한다. controller DTO 경계에서 입력값을 검증하고, 내부 도메인 모델을 API 계약으로 직접 노출하지 않는다.
라우팅 이전 전송 계층 오류(예: 431 헤더 초과, 말형된 HTTP)는 Node HTTP 파서가 처리하므로 ProblemDetail 계약 범위에서 제외한다.

| HTTP 메서드 | 용도 | 예시 |
| --- | --- | --- |
| GET | 단건 또는 목록 조회 | `GET /api/v1/members`, `GET /api/v1/members/{memberId}` |
| POST | 새 리소스 생성 또는 명시적 행위 수행 | `POST /api/v1/members` |
| PUT | 리소스의 전체 교체 | `PUT /api/v1/members/{memberId}` |
| PATCH | 리소스의 부분 수정 | `PATCH /api/v1/members/{memberId}` |
| DELETE | 리소스 삭제 | `DELETE /api/v1/members/{memberId}` |

실패 응답의 예시는 다음과 같다.

```json
{
  "type": "https://api.oss-hub.example/problems/member-not-found",
  "title": "Member not found",
  "status": 404,
  "detail": "요청한 회원을 찾을 수 없습니다.",
  "instance": "/api/v1/members/42",
  "code": "MEM_001"
}
```

## Alternatives considered

### 응답 봉투(envelope)

- Pros: 성공 여부와 메타데이터를 모든 응답에 같은 모양으로 넣을 수 있다.
- Cons: HTTP 상태 코드와 오류 의미를 본문에 중복하고, 순수 DTO 소비를 복잡하게 한다.
- **Rejected:** HTTP 표준을 이중화하지 않고 성공 데이터는 순수 DTO, 실패는 RFC 7807로 명확히 표현한다.

### 임의 문자열 오류 코드

- Pros: 초기 구현에서 빠르게 오류 메시지를 추가할 수 있다.
- Cons: 도메인 소유권, 검색 가능성, 클라이언트 분기 규칙이 불명확해진다.
- **Rejected:** 도메인별 ErrorCode enum과 고정 형식 코드가 안정적인 클라이언트 계약을 제공한다.

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

## Changelog

- 2026-07-11: initial decision
- 2026-07-11: 전송 계층 오류 제외 조항 추가

## References

- [RFC 7807: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc7807)
- [Pullit API 설계 가이드라인](https://pullit-docs-server.vercel.app/index.html#02-api-design)
- [addyosmani/agent-skills — api-and-interface-design](https://github.com/addyosmani/agent-skills/tree/main/skills/api-and-interface-design)
