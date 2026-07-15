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

## Date

2026-07-15

## Context

사람과 에이전트가 함께 PR을 검토할 때 알림, 로컬 상태, 리뷰 코멘트는 서로 다른 시점의 사실일 수 있다. 이전 head의 분석이나 통과 결과를 최신 변경의 근거로 재사용하면 리뷰와 병합 판단을 재현할 수 없다. 반대로 도구별 절차를 ADR에 복제하면 정책이 구현과 함께 쉽게 어긋난다.

## Decision

### Canonical state and review cycle

Git과 GitHub PR의 commit, review, check, merge 상태를 개발 변경과 병합 판단의 canonical state로 사용한다. 메신저 polling은 이 상태를 투영하는 trigger일 뿐이며 누락이나 중복이 canonical state를 바꾸지 않는다.

PR마다 목적과 범위를 확인하고, base와 exact head SHA에서 관련 규칙·리뷰·checks·merge 상태를 검토한다. 합의된 수정 뒤에는 새 exact head에서 다시 검증하며, 이전 head의 결과는 병합 근거로 재사용하지 않는다. 병합 뒤에는 default branch의 merge SHA와 CI를 다시 읽어 cycle을 닫는다.

### Capability roles

- **기술 검증:** 관련 규칙과 변경을 읽고 security·correctness·유지보수 finding 및 QA 결과를 제시한다.
- **조정과 실행:** intake, review resolution, exact-head 재검증과 위임 범위 안의 병합을 추적한다.
- **최소성 검토:** 기존 코드·표준 기능·설치된 의존성과 최소 변경을 우선하고 추측성 복잡도를 거부한다.
- **사람 권한자:** 요구사항, Code Owner 판단, 위임 범위와 ADR 상태를 결정한다.

현재 운영 매핑은 기술 검증에 Xia, 조정과 실행에 ossplatform/Sari, 최소성 검토에 Ponytail이다. 이 매핑은 현재 도구 선택이며 영구 정책 정체성이 아니다.

### Native gates and merge authority

다음 hard gate가 모두 해소된 exact head만 병합할 수 있다.

- 해결되지 않은 security 또는 correctness finding
- 재검증하지 않은 stale head
- 실패하거나 완료되지 않은 관련 CI와 required check
- draft, merge conflict, 누락된 QA 증거
- required review 또는 미해결 review conversation

병합 권한은 기본 금지(default deny)다. 사람 권한자가 PR별로 승인하거나 standing scope를 명시적으로 위임한 경우에만 행사하며, head 변경이 권한 범위를 묵시적으로 넓히지 않는다. admin bypass로 native gate를 우회하지 않는다.

현재 standing scope는 저장소 전체의 자율 병합이다. 단, 관련 CI가 통과하고 clean context에서 기존 `AGENTS.md`, 연결 문서, Ponytail 검토와 GitHub native gates를 모두 통과해야 한다. `CODEOWNERS` 대상 경로는 해당 Code Owner의 승인 신호가 추가로 필요하며, GitHub가 self-review를 허용하지 않으므로 작성자가 Code Owner여도 다른 Code Owner가 승인해야 한다.

배포는 병합 위임과 별개다. release 단위의 사람 승인이 있어야 진행한다.

### Work-in-progress limit

`blocker 1 + improvement 1` 제한은 저장소 전체 작업량이 아니라 PR 하나의 review cycle에 적용한다. 같은 predicate를 기존 Issue, PR 또는 card가 추적하면 중복 작업을 만들지 않는다.

### Audit and recovery

각 cycle은 review URL, 검증한 exact head SHA, 관련 checks 결과를 남기고, 병합한 경우 merge SHA도 기록한다. GitHub 상태를 확인할 수 없으면 병합을 멈추고 복구 후 같은 head를 다시 검증한다. 잘못된 review나 approval은 삭제로 숨기지 않고 correction을 남기며, 병합 후 회귀는 연결된 revert PR로 되돌린다.

## Alternatives considered

### 알림 채널을 canonical state로 사용

- polling 지연, 중복과 누락 때문에 exact head와 review resolution을 재현할 수 없어 거부한다.

### 도구별 전체 절차를 ADR에 복제

- 정책이 여러 prompt와 문서에 분산되어 drift하므로 거부한다. ADR은 역할과 gate만 정의하고 구현 절차는 운영 문서에 둔다.

## Consequences

- review와 merge 판단을 exact head 및 GitHub 증거로 재현할 수 있다.
- capability와 현재 도구 매핑을 분리해 도구가 바뀌어도 권한 경계를 유지한다.
- head가 바뀔 때마다 검증을 반복하고, GitHub 상태를 읽을 수 없는 동안 병합을 멈춰야 한다.

## Changelog

- 2026-07-15: Code Owner 피드백에 따라 capability 역할, default-deny 병합 권한, PR별 WIP 범위 명시
- 2026-07-15: initial proposal

## References

- [AGENTS.md](../../AGENTS.md)
- [ADR-002: CI/CD 파이프라인](ADR-002-CI-CD-파이프라인.md)
- [Pull request template](../../.github/pull_request_template.md)
- [보안 규칙](../rules/security.md)
