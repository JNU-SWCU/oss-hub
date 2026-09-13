---
slug: ADR-013-runtime-test-boundary
date: 2026-09-13
author: GoBeromsu
status: Accepted
references:
  - ADR-003-backend-architecture
  - ADR-005-agent-driven-review-cycle
---

# ADR-013: 프론트엔드 런타임과 테스트 의존 경계

## Status

Accepted

## Date

2026-09-13

## Context

프론트엔드 런타임이 local-review API·persona 경로와 활성화/세션 헬퍼, 상태 있는 지원 그래프에 의존하면 제품 경로가 테스트 전용 입력을 읽게 된다.
그 결합은 증거를 실제 백엔드와 섞어 보이게 만들고, 비활성 에뮬레이터나 호환 플래그로 남기면 경계가 흐려진다.
검증은 주장에 비례해야 하며, 문서·스킬 절차는 작업 표면에 맞게 라우팅해야 한다.

이 결정은 마이그레이션 위험 처분과 동작 감사가 끝난 뒤의 아키텍처 경계다.
삭제 실행의 완료나 스위트 통과를 이 문서가 주장하지 않는다.

## Decision

Next.js 런타임에서 local-review API·persona 경로, 활성화/세션 헬퍼, 상태 있는 지원 그래프를 제거한다.
에뮬레이터를 다른 경로로 옮기거나 호환 플래그로 남기지 않는다.
백엔드 없이 제품을 미리 보는 경로는 의도적으로 사라진다.

영속·인증·권한 주장은 실제 격리 백엔드로 증명한다.
순수 표현·레이아웃·오류 표면은 Vitest/컴포넌트와 범위가 좁은 UI 전용 Playwright 응답으로 증명할 수 있다.
UI 전용 interception은 백엔드 정확성을 증명하지 않는다.

프론트엔드 런타임이 테스트 모듈에 의존하지 못하게 기존 ESLint에 프로젝트 경로 해석을 둔다.
린트가 막는 것은 리터럴·해석 가능한 정적·재export·동적·require·별칭 의존이다.
임의 계산 import, 미확인 모듈 경로, 나쁜 테스트 오라클의 의미 품질은 이 정적 경계가 보장하지 않는다.

테스트 입력은 최소·범위 한정이다.
문서·스킬은 보편 레시피를 복제하지 않고 해당 표면의 canonical 라우터만 연다.

## Drivers

신뢰할 수 있는 증거.
강제 가능한 아키텍처.
안전과 의미 있는 커버리지를 약화하지 않는 유지 범위.

## Alternatives considered

### A. Vitest/컴포넌트 + 범위 한정 UI 전용 Playwright 응답 + 실제 격리 백엔드

- Pros: 저비용 레이아웃·오류 증명과 독립된 영속/인증 검증을 기존 도구로 유지한다.
- Cons: UI 전용 응답과 실제 백엔드 증거를 같은 주장에 섞으면 안 된다.
- **채택:** 런타임 결합을 끊으면서 기존 runner를 재사용한다.

### B. 브라우저 설정을 실제 백엔드만 사용

- Pros: 표현 증명도 실제 백엔드를 탄다.
- Cons: 순수 표현 증명 비용이 크다.
- **기각:** 표현 전용 주장은 더 싼 경로를 남긴다.

### 기각한 다른 경로

비활성 에뮬레이터 유지, 이름만 바꾼 preview 서버, 복사한 E2E 백엔드, 어휘적 fixture 금지, 광역 검사기 프레임워크.

## Why chosen

A는 런타임 결합을 제거하면서 기존 도구로 저비용 UI 증명과 실제 백엔드 검증을 분리한다.

## Consequences

### Enables

- 일상 `pnpm dev`는 실제 백엔드를 쓴다.
- 자동 브라우저 회귀는 기존 격리 Playwright runner를 쓴다.
- 해석 가능한 런타임→테스트 의존을 패키지 ESLint가 거부한다.

### Costs / trade-offs

- 옛 local-review URL·쿠키·플래그는 의도적으로 사라진다.
- 백엔드 없는 제품 preview는 없다.

### New constraints

- 의미 있는 테스트가 이전되기 전에 대상·테스트를 지우지 않는다.
- 미이전 의미 있는 공백은 cutover를 막으며 미완성 stub나 호환 경로로 메우지 않는다.
- 이 ADR은 번들 크기나 성능 수치를 주장하지 않는다.

## Changelog

- 2026-09-13: 런타임-테스트 의존 경계를 Accepted로 기록했다.
- 2026-09-13: 실제 백엔드와 범위 한정 UI 증명, 린트 한계, 에뮬레이터 이전·플래그 금지, 백엔드 없는 preview 상실을 본문에 명시했다.

## References

- [ADR-003](ADR-003-backend-architecture.md)
- [ADR-005](ADR-005-agent-driven-review-cycle.md)
