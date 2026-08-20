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

> **2026-08-20 amendment — `COLLECTION_READ_PORT` 삭제.** DEC-42가 같은 DB 읽기 앞에 둔 in-process Port는 이 개정으로 폐지한다. 아래 Decision이 현재 결정이다. 폐지 직전 DEC-42 문장은 Changelog 2026-08-20에 그대로 둔다.

## Date

2026-07-11

## Context

NestJS backend는 기능이 늘어나도 관련 코드의 탐색 경로와 의존 방향을 유지해야 한다. API 요청의 유효성 검증, 도메인 오류 변환, 데이터 변경의 트랜잭션 범위를 일관되게 처리할 필요가 있다. 초기 단계에서 추상 계층을 과도하게 늘리면 팀의 구현·리뷰 비용이 실제 복잡도보다 커진다.

DEC-42는 collection 모듈의 같은 DB 조회를 `COLLECTION_READ_PORT` 뒤로 모았다. 실제로 `CollectionReadService.getPublicRankingMetrics`는 `return this.publicRanking.findMetrics(query)` 한 줄 hop이었다. 그 Port는 Fowler Gateway를 프로세스 안 조회 버스로 쓴 것이고, 그 hop은 Service Layer와 겹치는 pass-through였다. 테이블당 Repository(Table Data Gateway / 레거시 DAL)와 쓰기 Repository 규칙으로 조회 JOIN을 막는 관행이 같이 붙어 있었다.

## Decision

backend는 기능 모듈 폴더를 최상위 구성 단위로 사용한다. 모듈 내부는 Controller → Service → Repository의 단방향 Layered 구조다. Prisma는 Repository에만 둔다. Service는 Fowler Service Layer다 — usecase와 트랜잭션(Unit of Work)을 소유하고, HTTP 전송 타입과 Prisma model을 노출하지 않는다. Controller는 HTTP 입력 검증, request DTO→application DTO 변환, guard/header/status와 response DTO 변환을 담당하고 Prisma와 업무 규칙을 소유하지 않는다. Repository는 영속성 접근과 persistence DTO를 담당하고 Prisma row를 계층 밖으로 흘리지 않는다. DTO와 도메인 모델은 분리한다.

NestJS 전역 예외 필터가 예외를 API 오류 응답으로 변환한다. 모든 데이터 변경 usecase의 트랜잭션 시작·완료·실패 처리는 Service Layer가 소유한다. Controller↔Service와 Service↔Repository 계약은 명시적 DTO를 쓰며 Controller와 Service 사이에 Port를 만들지 않는다. 기능 요구가 없는 포트·어댑터·추가 추상화는 도입하지 않는다. 한 줄 hop은 orchestration이 아니다.

모듈을 넘거나 프로세스 밖을 향하는 의존은 외부 시스템(GitHub HTTP 등)에만 Fowler Gateway/Port를 둔다. 같은 데이터베이스를 읽는 조회 앞에 `COLLECTION_READ_PORT`를 두지 않는다. `COLLECTION_READ_PORT`는 삭제한다.

읽기 Repository는 테이블이 아니라 화면 질문 하나에 답한다. Fowler Repository는 한 집합의 객체에 대한 컬렉션형 인터페이스이지, 테이블당 하나씩 두는 Table Data Gateway/레거시 DAL이 아니다. Microsoft Learn persistence layer도 repository-per-table을 금지한다. Meyer/Fowler Command Query Separation과 Microsoft Learn CQS/CQRS에서 조회는 JOIN할 수 있다. 쓰기 Repository 규칙을 읽기에 그대로 씌워 조인을 막지 않는다.

`github`는 소비자 모듈을 역import하지 않는다. 소비자 Service는 `github`의 concrete repository를 import하지 않는다. 소비자 Repository는 Prisma를 직접 쓴다.

`GET /ranking`은 전원에게 공개다. STUDENT 세션은 익명과 같다. `department`와 다음 수집 시각(clock)은 전원에게 내려간다. Staff/Admin ACTIVE 세션(`viewerClass` staff)만 실명과 CSV를 추가로 받는다.

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

### `COLLECTION_READ_PORT`를 유지한다

- Pros: consumer가 github 테이블을 직접 보지 않는다.
- Cons: 같은 DB 조회에 Gateway를 두면 in-process query bus가 되고, 한 줄 hop이 Service Layer와 겹친다.
- **Rejected:** 이 작업이 Port 삭제와 소비자 이관을 요구했다.

### ranking만 이관하고 programs/system-status는 다음 PR로 남긴다

- Pros: 이번 변경 폭이 작다.
- Cons: 같은 잘못된 Port가 남은 소비자에 그대로 산다.
- **Rejected:** 이 작업이 Port 삭제와 전 소비자 이관을 요구했다.

## Consequences

### Enables

- 기능별로 controller, service, repository, DTO, 도메인 코드를 함께 탐색한다.
- usecase별 트랜잭션 경계와 오류 변환의 책임 위치가 명확해진다.
- HTTP·업무 규칙·영속성의 변경 영향을 분리한다.
- 화면 질문 단위의 읽기 Repository가 같은 DB JOIN을 소유한다.
- staff-insights는 자기 Repository로 같은 활동 테이블을 읽는다. 랭킹 Service hop을 두지 않는다.

### Costs / trade-offs

- 단방향 의존성과 DTO/도메인 분리를 코드 리뷰에서 지속적으로 확인해야 한다.
- 매우 복잡한 외부 연동이 생기면 추가 분리의 필요성을 다시 평가해야 한다.
- 같은 DB 조회가 여러 소비자 Repository에 흩어진다.

### New constraints

- controller는 service를 거치지 않고 repository에 접근하지 않는다.
- Prisma는 Repository에만 둔다. repository는 업무 규칙과 HTTP 표현을 소유하지 않는다.
- Service는 Fowler Service Layer이며 한 줄 hop을 orchestration으로 치지 않는다.
- Gateway/Port는 외부 시스템에만 둔다. 같은 DB 읽기 앞에 `COLLECTION_READ_PORT`를 두지 않는다.
- 읽기 Repository는 테이블이 아니라 화면 질문 하나에 답한다.
- `github`는 소비자 모듈을 역import하지 않는다. 소비자 Service는 github concrete repository를 import하지 않는다.
- public query repository만 owner 승인된 strict-read allowlist 경계에서 explicit select로 공개 조회를 수행한다.
- controller와 일반 service는 Prisma에 직접 접근하지 않으며 private join은 dedicated public query repository 밖에서 금지한다.
- service가 트랜잭션 경계를 소유하며 전역 예외 필터를 우회하는 개별 응답 형식을 만들지 않는다.
- NestJS는 `setGlobalPrefix('api/v1')`로 API 접두사를 설정한다.
- eslint DEC-42는 이 결정에 맞게 다시 쓴다.
- CollectionReadService 조회는 소비자 Repository로 옮긴다 — RankingRepository(`ranking/`), ProgramActivityRepository·ProgramMetricsRepository(`programs/`), SystemStatusRepository. 다음 수집 tick은 `collection-schedule.ts`가 공유한다.
- `GET /ranking`은 전원 공개다. STUDENT는 익명과 같다. department와 clock은 전원에게 간다. staff만 실명과 CSV를 받는다.

## Changelog

- 2026-07-11: initial decision
- 2026-07-31: 공개 strict-read를 dedicated allowlist repository로 한정하고 Controller→Service→Repository DTO 및 cross-module/external behavioral dependency의 Port-only 규칙을 명문화했다.
- 2026-08-04: DEC-42(collection 모듈의 `COLLECTION_READ_PORT` 전용 소비 경계)를 개정해, collection 수집원이 `ORG_PROVISIONED`/`EXTERNAL_PUBLIC` 두 가지로 늘어나도 그 차이(자격증명·discovery)를 흡수하는 지점은 collection 서비스 계층이며 Port 경계·delegate 접근 규칙 자체는 바뀌지 않음을 명시했다. 이 문서 본문에 `DEC-42` 식별자가 명시된 것은 이번이 처음이다 — 이전까지는 `eslint.config.mjs`·테스트·`AGENTS.md`가 이 결정을 "(ADR-003 DEC-42)"로 인용해 왔으나 ADR 본문에는 그 식별자가 없어 추적이 간접적이었다.
- 2026-08-09: DEC-42의 "새 Port를 만들지 않는다" 제약을 [ADR-010](ADR-010-contribution-tracking-context.md) §7로 개정했다. 기여 추적 port 3개 + 프로비저닝 port 별도 등재가 허용되며, Port 경계와 delegate 직접 접근 금지 규칙 자체는 변하지 않는다.
- 2026-08-20: `COLLECTION_READ_PORT`를 삭제하고 같은 DB 조회를 소비자 Repository로 옮겼다. eslint DEC-42를 다시 썼다. CollectionReadService 조회는 RankingRepository·ProgramActivityRepository·ProgramMetricsRepository·SystemStatusRepository로 이동했고, staff-insights는 자기 Repository로 같은 활동 테이블을 읽는다. 폐지 직전 DEC-42 문장은 다음이었다. 「collection 모듈의 cross-module 공개 surface는 `COLLECTION_READ_PORT` 토큰과 `CollectionReadPort`뿐이며(DEC-42), consumer 모듈(`programs`/`ranking`/`system-status` 등)은 concrete 구현이나 Prisma delegate를 직접 참조하지 않는다. collection의 수집원은 `ORG_PROVISIONED`(조직 소속 저장소)와 `EXTERNAL_PUBLIC`(학생이 등록한 조직 밖 public 저장소) 두 가지이며, 이 둘은 자격증명과 저장소 목록 discovery만 다르고 저장소 메타·commit·PR·release 수집, 커서·frontier, fact 적재, 연도 집계, 리스·전송 큐는 source와 무관하게 공유한다. 어느 source에 어떤 수집 전략을 쓸지 고르는 분기는 collection 서비스 계층의 책임이며, 이 분기가 `COLLECTION_READ_PORT`에 새 포트를 추가하거나 consumer에게 노출되는 테이블을 늘리지 않는다 — Port 경계 자체와 그 뒤의 단일 delegate 접근 규칙(DEC-42)은 이 확장으로 변하지 않는다. DEC-42의 "새 Port를 만들지 않는다"는 제약은 [ADR-010](ADR-010-contribution-tracking-context.md) §7로 개정됐다. 기여 추적 컨텍스트는 밖으로 여는 port를 기여 집계 · 공개 자격 · 건강 셋으로 두고, 프로비저닝 port(`REPOSITORIES_READ_PORT`)를 별도 등재한다 — 답하는 질문의 종류도, 변하는 주기도, 보는 사람도 넷이 서로 다르기 때문이다. Port 경계 자체와 그 뒤의 단일 delegate 접근 규칙은 그대로이며, 바뀐 것은 "port는 하나여야 한다"는 개수 제약뿐이다.」 이전 Changelog 2026-08-04·2026-08-09 항목은 그 문장의 이력을 가리킨다.

## References

- [Fowler, Patterns of Enterprise Application Architecture — Repository](https://martinfowler.com/eaaCatalog/repository.html)
- [Fowler, Patterns of Enterprise Application Architecture — Service Layer](https://martinfowler.com/eaaCatalog/serviceLayer.html)
- [Fowler, Patterns of Enterprise Application Architecture — Gateway](https://martinfowler.com/eaaCatalog/gateway.html)
- [Fowler, Patterns of Enterprise Application Architecture — Unit of Work](https://martinfowler.com/eaaCatalog/unitOfWork.html)
- [Fowler, Patterns of Enterprise Application Architecture — Table Data Gateway](https://martinfowler.com/eaaCatalog/tableDataGateway.html)
- [Fowler, Command Query Separation](https://martinfowler.com/bliki/CommandQuerySeparation.html)
- [Microsoft Learn: Designing the infrastructure persistence layer](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/infrastructure-persistence-layer-design)
- [NestJS Modules](https://docs.nestjs.com/modules)
- [NestJS Exception Filters](https://docs.nestjs.com/exception-filters)
- [ADR-004: REST API 규격](ADR-004-REST-API-규격.md)
