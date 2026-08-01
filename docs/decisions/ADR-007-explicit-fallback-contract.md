---
slug: ADR-007-explicit-fallback-contract
date: 2026-08-01
author: GoBeromsu
status: Accepted
references:
  - ADR-004-REST-API-규격
refines: []
---

# ADR-007: 명시적 fallback 계약(Explicit Fallback Contract)

## Status

Accepted

## Date

2026-08-01

## Context

같은 날 서로 다른 축에서 같은 유형의 결함이 발견됐다. 데이터 축에서는 append-only 감사 원장의 구버전(schemaVersion 1·legacy) 행에 대상(target)의 사람이 읽을 수 있는 이름이 없다는 이유로, 읽기 시점(read time)에 현재 User 테이블을 조회해 GitHub login을 역산·합성(read-time enrichment/backfill)하려는 접근이 제안됐다. UI 축에서는 백엔드 가용성을 확신할 수 없을 때 로그인 버튼을 아예 렌더링하지 않는 방식으로, 추측된 런타임 상태(speculative runtime state)를 근거로 사용자 행위 가능성(affordance)을 숨기는 접근이 있었다.

두 접근 모두 "실패나 결측을 사용자에게 그대로 보여주지 않기 위한 선의의 보정"이라는 동기를 공유하지만, 결과적으로 시스템이 실제로 아는 것과 다른 사실을 말하게 만든다. 감사 원장 사례는 point-in-time snapshot이어야 할 과거 사실을 현재 상태로 덮어써 rename·삭제 이후 역사를 왜곡한다. affordance 은폐 사례는 실패를 액션 시점의 명시적 오류로 표면화(fail-fast)하는 대신 침묵으로 숨겨(silent fallback), 사용자가 재시도 여부를 판단할 근거 자체를 빼앗는다.

ADR-004(REST API 규격)는 실패 응답의 형태(RFC 7807 ProblemDetail + 도메인 오류 코드)를 계약으로 고정했지만, "언제 보정값을 보여줘도 되는가"·"실패를 언제 어떻게 노출해야 하는가"라는 상위 원칙은 명시하지 않았다. 이 결정은 그 공백을 메우는 ADR-004의 일반화이며, 데이터 읽기 경로와 UI 렌더링 경로 모두에 적용되는 공통 계약을 정의한다.

## Decision

> 모든 fallback은 명시적으로 설계된 계약이어야 한다. 읽기 시점의 즉흥 보정과 실패의 은폐는 fallback이 아니라 위조다.

1. **Fallback은 계약이다** — fallback은 설계·쓰기 시점에 선언하고, 코드에서는 타입으로, 문서에서는 규칙으로 드러낸다. 읽기 시점에 즉흥적으로 만들어내지 않는다.
2. **Fallback은 자신을 숨기지 않는다** — fallback을 소비하는 쪽(사용자·다른 개발자)이 지금 보고 있는 값이 fallback임을 식별할 수 있어야 한다. 원본 데이터와 구분 불가능하게 위장하지 않는다.
3. **즉흥 보정은 fallback이 아니다** — 읽기 계층이 현재 상태를 차용해 과거 사실을 재구성하는 것(read-time enrichment/backfill), 상태를 추측해 affordance를 숨기는 것(speculative runtime state에 의한 capability hiding)은 이 결정이 말하는 fallback이 아니라 위조다. 금지한다.

### Antipattern 예시

- **데이터 축**: append-only 감사 원장의 v1/legacy 행에 대해, 읽기 시점에 현재 User 테이블을 조회해 대상의 GitHub login을 합성하는 것. 사용자가 로그인명을 바꾸거나 계정이 삭제되면 과거 행이 가리키던 사실과 다른 값을 보여주게 되어 역사가 왜곡된다.
  - **올바른 설계**: `schemaVersion`을 올려 쓰기 시점에 대상 스냅샷을 함께 기록한다(v2). 스냅샷이 없는 구버전 행은 합성하지 않고 원시 `targetType` / `targetId`라는, 코드로 선언된 fallback을 그대로 노출한다.
- **UI 축**: 백엔드 비가용을 의심할 때 로그인 버튼(affordance)을 조건부로 숨기는 것. 추측된 런타임 상태로 행위 가능성 자체를 제거해 실패를 은폐하며, 사용자는 왜 버튼이 없는지 판단할 근거가 없다.
  - **올바른 설계**: affordance는 결정적으로(deterministically) 렌더링한다. 실제 실패는 액션이 실행되는 시점에 RFC 7807 ProblemDetail과 도메인 오류 코드로 표면화한다(ADR-004).

### 허용되는 fallback의 예

"5분 전 데이터입니다"라는 라벨이 붙은 캐시 표시처럼, 원본이 아니라는 사실을 소비자가 식별할 수 있게 표시된 graceful degradation은 이 결정이 금지하는 대상이 아니다 — 원칙 1·2를 충족하는 명시적 계약이기 때문이다.

## Alternatives considered

### 읽기 시점 보정을 UX 개선으로 허용

- Pros: 데이터가 비어 보이는 화면을 줄이고 즉각적인 사용성 개선을 준다.
- Cons: 시스템이 실제로 기록한 사실과 다른 값을 진짜처럼 보여준다. append-only 원장처럼 과거 사실이 불변이어야 하는 경계에서는 감사 신뢰성 자체가 무너진다.
- **Rejected:** 보강이 필요하면 쓰기 시점에 스키마 버전을 올려 기록하고, 과거 행은 선언된 fallback으로 그대로 노출한다.

### 상태 불확실 시 안전 우선으로 affordance 숨기기

- Pros: 실패할 행동을 아예 보이지 않게 하면 사용자가 실패를 경험하지 않는다고 가정할 수 있다.
- Cons: 실제로는 상태를 추측만 한 것이라 오탐이 섞이고, 사용자는 기능이 없는 것인지 일시적으로 실패하는 것인지 구분할 수 없어 재시도 판단을 할 수 없다.
- **Rejected:** affordance는 결정적으로 렌더링하고, 실패는 액션 시점에 명시적 오류로 표면화한다.

### 모든 fallback을 전면 금지

- Pros: 위조 위험을 원천적으로 없앤다.
- Cons: 오프라인·지연 상황의 캐시 표시처럼 정당한 graceful degradation까지 막아 UX를 해친다.
- **Rejected:** fallback 자체가 아니라 자신을 숨기는 즉흥 보정만 금지한다. 라벨이 붙은 graceful degradation은 허용한다.

## Consequences

### Enables

- 원장·로그처럼 과거 사실이 불변이어야 하는 데이터 경로가 rename·삭제 이후에도 역사를 왜곡하지 않는다.
- 소비자가 지금 보는 값이 원본인지 fallback인지 항상 식별할 수 있다.
- 실패가 항상 액션 시점의 명시적 오류로 표면화되어 사용자가 재시도 여부를 판단할 수 있다.

### Costs / trade-offs

- 새로운 fallback이 필요할 때마다 즉흥 처리 대신 스키마·타입 수준의 명시적 설계가 선행되어야 한다.
- 데이터가 없거나 실패한 상태를 화면에 그대로 노출해야 하므로, "빈 화면을 보이지 않기 위한" 임기응변식 UX 땜질을 쓸 수 없다.

### New constraints

- 읽기·표시 계층은 현재 상태를 차용해 과거 사실을 재구성하지 않는다. 사람이 읽을 수 있는 스냅샷이 필요하면 쓰기 시점에 스키마 버전을 올려 기록한다.
- UI affordance는 런타임 상태 추측으로 숨기지 않는다. 실패는 액션 시점에 ProblemDetail 오류로 표면화한다.
- 라벨 없는 graceful degradation(원본과 구분 불가능한 보정값)을 도입하지 않는다 — degradation을 보여줄 때는 그것이 degradation임을 함께 표시한다.

## Changelog

- 2026-08-01: initial decision

## References

- [RFC 7807: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc7807)
- [ADR-004-REST-API-규격](ADR-004-REST-API-규격.md) — 실패 응답 계약(RFC 7807 ProblemDetail)의 일반화
