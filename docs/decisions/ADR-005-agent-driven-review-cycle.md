---
slug: ADR-005-agent-driven-review-cycle
date: 2026-07-15
author: GoBeromsu
status: Accepted
references:
  - ADR-002-CI-CD-파이프라인
refines: []
---

# ADR-005: Agent-Driven Review Cycle

## Status

Accepted

## Context

사람과 에이전트가 함께 PR을 다루면 알림과 로컬 상태가 실제 GitHub 상태보다 늦을 수 있다. 이전 commit의 리뷰나 CI 결과로 최신 변경을 병합하면 판단을 재현할 수 없다.

## Decision

GitHub의 PR, commit, review, check를 개발 변경과 병합 판단의 기준으로 삼는다. 알림과 메신저는 작업을 시작하는 신호일 뿐이다.

모든 리뷰와 병합 판단은 정확한 head SHA를 기준으로 한다. head가 바뀌면 이전 결과를 재사용하지 않고 다시 확인한다.

PRD·IA·Accepted ADR·root와 적용되는 nested `AGENTS` 범위 안의 기술·정책·구현은 Tech Lead가 자율적으로 판단하며, 특정 PM의 PR별 확인을 일반 병합 조건으로 두지 않는다.

독립 리뷰는 correctness·security·명시적 계약 위반만 blocker로 분류하며, 그 밖의 개선은 비차단 의견이나 후속 Issue로 남긴다.

다음 조건을 모두 충족한 PR만 병합한다.

- draft와 merge conflict가 없다.
- 관련 CI와 required check가 통과했다.
- root와 적용되는 nested `AGENTS`를 준수했다.
- required review와 review conversation이 완료됐고, CODEOWNERS 대상 경로는 그 review에 독립 Code Owner review가 포함됐다.
- 해결되지 않은 blocker가 없다.
- GitHub가 병합 가능한 상태로 표시한다.

병합 권한의 기본값은 금지다. 사람 권한자가 GitHub에 기록한 PR별 승인 또는 standing scope가 해당 PR을 명시적으로 포함할 때만 병합한다. GitHub 상태나 승인 범위를 확인할 수 없거나 모호하면 병합하지 않으며, admin bypass로 gate를 우회하지 않는다.

ADR-002에 따라 main 병합이 배포를 시작하므로, 배포되는 변경은 권한 있는 사람의 병합 승인을 받아야 한다. 수동 배포와 재배포는 별도의 명시 승인이 필요하다.

검증한 head SHA, check 결과와 review URL을 남긴다. 병합한 경우 merge SHA도 기록한다.

## Consequences

- 최신 변경에 대한 검증 근거를 GitHub에서 다시 확인할 수 있다.
- head가 바뀌면 검증을 반복해야 한다.

## References

- [AGENTS.md](../../AGENTS.md)
- [ADR-002: CI/CD 파이프라인](ADR-002-CI-CD-파이프라인.md)
- [Pull request template](../../.github/pull_request_template.md)

## Changelog

- 2026-07-17: Issue #37에 따라 root `AGENTS.md`와 PR 템플릿에 조건부 Draft/Ready와 독립 리뷰 결과 분류를 운용 규칙으로 연결했다. 권한 경계와 병합 조건은 변경하지 않았다.
- 2026-07-16: Code Owner review #4705528344의 승인 범위와 ADR-002 배포 경계를 반영하고 `Accepted`로 전환했다.
- 2026-07-16: Owner 댓글 #4991669947의 Tech Lead 위임 경계와 독립 리뷰 분류를 수용했다.
- 2026-07-17: 병합 조건의 review 항목을 required review와 CODEOWNERS 대상 경로의 Code Owner review로 이원화해 실제 CODEOWNERS 커버리지와 맞췄다.
- 2026-07-17: blocker 분류를 독립 리뷰 문단에서 한 번만 정의하고, 병합 조건은 해결되지 않은 blocker 부재로 명시했다.
