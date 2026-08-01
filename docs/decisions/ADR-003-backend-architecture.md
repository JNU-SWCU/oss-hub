---
slug: ADR-003-backend-architecture
date: 2026-07-11
author: GoBeromsu
status: Accepted
references:
  - ADR-001-테크스택
refines: []
---

# ADR-003: Backend Architecture

## Status

Accepted

## Date

2026-07-11

## Context

NestJS backend는 기능이 늘어나도 관련 코드의 탐색 경로와 의존 방향을 유지해야 한다. API 요청의 유효성 검증, 도메인 오류 변환, 데이터 변경의 트랜잭션 범위를 일관되게 처리할 필요가 있다. 초기 단계에서 추상 계층을 과도하게 늘리면 팀의 구현·리뷰 비용이 실제 복잡도보다 커진다.

## Decision

backend는 기능 모듈 폴더를 최상위 구성 단위로 사용한다. 각 모듈 내부는 Controller → Service → Repository의 단방향 Layered 구조를 따른다. Controller는 HTTP 입력 검증, request DTO→application DTO 변환, guard/header/status와 response DTO 변환을 담당하고 Prisma와 업무 규칙을 소유하지 않는다. Service는 usecase 중심의 업무 규칙, 공개 allowlist, 404 정책, 트랜잭션과 orchestration을 담당하고 HTTP/Nest 전송 타입과 Prisma model을 노출하지 않는다. Repository는 영속성 접근과 persistence DTO를 담당하고 Prisma row를 계층 밖으로 흘리지 않는다. DTO와 도메인 모델은 분리한다.

NestJS 전역 예외 필터가 예외를 API 오류 응답으로 변환한다. 모든 데이터 변경 usecase의 트랜잭션 시작·완료·실패 처리는 service 계층에서 소유한다. Controller↔Service와 Service↔Repository 계약은 명시적 DTO를 사용하며 Controller와 Service 사이에 별도 Port를 만들지 않는다. 모든 cross-module 또는 external behavioral dependency는 반드시 Port를 통해서만 소비한다. Port의 입력·출력도 DTO로 제한한다. 기능 요구가 없는 포트·어댑터·추가 추상화는 도입하지 않는다.

공개 endpoint의 private 데이터 strict-read는 owner-approved dedicated public query repository에서만 허용한다. 이 repository는 explicit select와 public DTO allowlist를 사용하고 service allowlist, private/nonexistent 동일 404, selector/integration review evidence를 요구한다. Controller와 일반 Service의 Prisma 직접 접근, 임의 private join, wildcard include, redact-later와 forbidden field fetch는 금지한다.

## Alternatives considered

### 최상위 계층 폴더

- Pros: controller, service, repository 유형별 파일을 한곳에서 볼 수 있다.
- Cons: 하나의 기능을 이해하려면 여러 최상위 폴더를 오가야 하고 기능 응집도가 낮아진다.
- **Rejected:** 기능 모듈 폴더가 변경 단위와 탐색 단위를 일치시켜 유지보수에 유리하다.

### 클린 아키텍처

- Pros: 의존성 역전과 높은 교체 가능성을 강조한다.
- Cons: Team14_BE 경험에서 실제 요구보다 많은 계층이 생겨 인지 과부하와 구현 비용이 증가했다.
- **Rejected:** 현재 규모에서는 모듈 내 Layered 구조가 필요한 분리를 제공하면서 과잉 계층을 피한다.

## Consequences

### Enables

- 기능별로 controller, service, repository, DTO, 도메인 코드를 함께 탐색한다.
- usecase별 트랜잭션 경계와 오류 변환의 책임 위치가 명확해진다.
- HTTP·업무 규칙·영속성의 변경 영향을 분리한다.

### Costs / trade-offs

- 단방향 의존성과 DTO/도메인 분리를 코드 리뷰에서 지속적으로 확인해야 한다.
- 매우 복잡한 외부 연동이 생기면 추가 분리의 필요성을 다시 평가해야 한다.

### New constraints

- controller는 service를 거치지 않고 repository에 접근하지 않는다.
- repository는 업무 규칙과 HTTP 표현을 소유하지 않는다.
- public query repository만 owner 승인된 strict-read allowlist 경계에서 explicit select로 공개 조회를 수행한다.
- controller와 일반 service는 Prisma에 직접 접근하지 않으며 private join은 dedicated public query repository 밖에서 금지한다.
- service가 트랜잭션 경계를 소유하며 전역 예외 필터를 우회하는 개별 응답 형식을 만들지 않는다.
- NestJS는 `setGlobalPrefix('api/v1')`로 API 접두사를 설정한다.

## Changelog

- 2026-07-11: initial decision
- 2026-07-31: 공개 strict-read를 dedicated allowlist repository로 한정하고 Controller→Service→Repository DTO 및 cross-module/external behavioral dependency의 Port-only 규칙을 명문화했다.

## References

- [NestJS Modules](https://docs.nestjs.com/modules)
- [NestJS Exception Filters](https://docs.nestjs.com/exception-filters)
- [ADR-004: REST API 규격](ADR-004-REST-API-규격.md)
