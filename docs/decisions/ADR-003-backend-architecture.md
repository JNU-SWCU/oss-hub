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

backend는 기능 모듈 폴더를 최상위 구성 단위로 사용한다. 각 모듈 내부는 controller → service → repository의 단방향 Layered 구조를 따른다. controller는 HTTP와 DTO 경계를 담당하고, service는 usecase 중심으로 업무 규칙과 트랜잭션 경계를 담당하며, repository는 영속성 접근만 담당한다. DTO와 도메인 모델은 분리한다.

NestJS 전역 예외 필터가 예외를 API 오류 응답으로 변환한다. 모든 데이터 변경 usecase의 트랜잭션 시작·완료·실패 처리는 service 계층에서 소유한다. 기능 요구가 없는 포트·어댑터·추가 추상화는 도입하지 않는다.

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
- service가 트랜잭션 경계를 소유하며 전역 예외 필터를 우회하는 개별 응답 형식을 만들지 않는다.
- NestJS는 `setGlobalPrefix('api/v1')`로 API 접두사를 설정한다.

## Changelog

- 2026-07-11: initial decision

## References

- [NestJS Modules](https://docs.nestjs.com/modules)
- [NestJS Exception Filters](https://docs.nestjs.com/exception-filters)
- [ADR-004: REST API 규격](ADR-004-REST-API-규격.md)
