---
slug: ADR-005-agent-driven-review-cycle
date: 2026-07-15
author: GoBeromsu
status: Proposed
references:
  - ADR-002-CI-CD-파이프라인
refines: []
---

# ADR-005: Agent-Driven Review Cycle

## Status

Proposed

## Context

사람과 에이전트가 함께 PR을 다루면 알림과 로컬 상태가 실제 GitHub 상태보다 늦을 수 있다. 이전 commit의 리뷰나 CI 결과로 최신 변경을 병합하면 판단을 재현할 수 없다.

## Decision

GitHub의 PR, commit, review, check를 개발 변경과 병합 판단의 기준으로 삼는다. 알림과 메신저는 작업을 시작하는 신호일 뿐이다.

모든 리뷰와 병합 판단은 정확한 head SHA를 기준으로 한다. head가 바뀌면 이전 결과를 재사용하지 않고 다시 확인한다.

다음 조건을 모두 충족한 PR만 병합한다.

- draft와 merge conflict가 없다.
- 관련 CI와 required check가 통과했다.
- 해결되지 않은 security·correctness blocker가 없다.
- required review와 review conversation이 완료됐다.
- GitHub가 병합 가능한 상태로 표시한다.

병합 권한의 기본값은 금지다. PR별 승인이나 명시된 standing scope 안에서만 병합하며 admin bypass로 gate를 우회하지 않는다. 배포는 병합과 별개로 release마다 사람의 승인을 받는다.

검증한 head SHA, check 결과와 review URL을 남긴다. 병합한 경우 merge SHA도 기록한다.

## Consequences

- 최신 변경에 대한 검증 근거를 GitHub에서 다시 확인할 수 있다.
- head가 바뀌면 검증을 반복해야 한다.

## References

- [AGENTS.md](../../AGENTS.md)
- [ADR-002: CI/CD 파이프라인](ADR-002-CI-CD-파이프라인.md)
- [Pull request template](../../.github/pull_request_template.md)
