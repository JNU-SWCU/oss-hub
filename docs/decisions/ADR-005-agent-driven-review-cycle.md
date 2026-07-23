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

PRD·IA·Accepted ADR·root와 적용되는 nested `AGENTS` 범위 안의 기술·정책·구현은 전남의 exact-head 독립 검토와 Tech Lead의 자율 범위 안에서 판단하며, 특정 PM의 PR별 확인을 일반 병합 조건으로 두지 않는다.

일반 PR은 전남의 exact-head `MERGE_READY`가 병합 검토의 단일 수렴 결과다.
`MERGE_READY`에는 일반 코드·계약 검토, Ponytail 복잡도 검토, 실제 UI/API QA, repository-declared CLI 검증과 required CI 결과를 함께 기록한다.
독립 리뷰는 correctness·security·명시적 계약 위반만 blocker로 분류하며, 그 밖의 개선은 비차단 의견이나 후속 Issue로 남긴다.

다음 변경은 high risk로 분류한다.

- 인증·세션·RBAC·권한 모델
- 개인정보·동의·공개/비공개 데이터 경계
- DB schema migration, data backfill, 삭제 또는 비가역 데이터 변경
- CI, Jenkins, 배포·rollback, branch protection, CODEOWNERS, 보안 정책
- 외부 OAuth·GitHub App·webhook 등 권한 있는 외부 연동
- 여러 도메인의 계약을 함께 바꾸는 횡단 설계 변경

high risk PR은 `MERGE_READY` 이후에도 PM인 @GoBeromsu와 Tech Lead인 @Lumiere001이 동일한 head SHA에 대해 각각 manual accept를 남겨야 한다.
production release 배포도 두 사람의 release tag와 exact SHA manual accept 뒤에만 시작한다.
Jenkins의 실패 시 중단·증적 보존·기존 이미지 복구 동작은 ADR-002의 배포 계약을 유지하며, 이 ADR은 별도의 rollback 동작 변경을 결정하지 않는다.

다음 조건을 모두 충족한 PR만 병합한다.

- draft와 merge conflict가 없다.
- 관련 CI와 required check가 통과했다.
- root와 적용되는 nested `AGENTS`를 준수했다.
- 일반 PR은 전남의 현재 head `MERGE_READY`가 있고, high risk PR은 PM과 Tech Lead의 현재 head manual accept가 모두 있다.
- 해결되지 않은 blocker가 없다.
- GitHub가 병합 가능한 상태로 표시한다.

전남은 일반 PR에 대해 `MERGE_READY`와 현재 GitHub mergeability를 확인한 뒤 병합할 수 있다.
high risk PR은 PM과 Tech Lead의 current-head accept가 확인되기 전에는 병합하지 않는다.
GitHub 상태나 승인 범위를 확인할 수 없거나 모호하면 병합하지 않으며, admin bypass로 gate를 우회하지 않는다.

ADR-002에 따라 production 배포는 release tag를 통한 별도 단계다.
production release·재배포는 @GoBeromsu와 @Lumiere001의 release SHA manual accept가 모두 필요하다.

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
- 2026-07-23: 일반 PR의 상호 Code Owner review를 전남 exact-head `MERGE_READY`로 대체했다. high risk PR과 production release에는 PM인 @GoBeromsu와 Tech Lead인 @Lumiere001의 동일 SHA manual accept를 추가했다.
