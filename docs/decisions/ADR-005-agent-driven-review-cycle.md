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

에이전트와 팀원이 함께 PR을 검토할 때 메신저 알림, 로컬 작업 상태, 리뷰 코멘트가 서로 다른 시점의 사실을 나타낼 수 있다. 특히 이전 head에 대한 분석이나 통과 결과를 최신 변경의 근거로 재사용하면 리뷰 resolution과 병합 판단을 재현할 수 없다. 반대로 모든 도구의 프롬프트와 절차를 문서에 복제하면 규칙이 분산되고 실제 구현과 쉽게 어긋난다.

## Decision

### Canonical state

Git과 GitHub PR을 개발 변경, 리뷰 resolution, 병합 증거의 선언적 원본으로 사용한다. GitHub의 commit, review, check, merge 상태가 canonical state이며 `#dev-알림`의 15분 polling은 이 상태를 투영하고 작업을 시작시키는 trigger일 뿐이다. 알림 누락이나 중복은 canonical state를 바꾸지 않는다.

### Review state machine

각 PR은 다음 순서로 처리한다.

1. **Intake:** PR의 목적, 범위, 연결된 Issue와 QA 기대값을 확인한다.
2. **Exact-head snapshot:** base branch, head SHA, draft·conflict 상태, required checks, review와 미해결 대화를 함께 기록한다.
3. **Technical review:** Xia가 `AGENTS.md`와 변경 경로에서 가장 가까운 `AGENTS.md`, 연결된 팀 규칙·ADR·PR checklist, 마지막으로 Ponytail 원칙 순서로 변경을 검증한다.
4. **Structured response:** ossplatform/Sari가 결과를 한국어로 통합해 blocker, 근거, 요청한 resolution을 PR에 남긴다.
5. **Resolution:** 팀원은 근거 있는 반론이나 확인을 남기고, 합의된 수정만 branch에 반영한다. 코멘트는 수정 commit 또는 명시적 합의로 resolve한다.
6. **Exact-head revalidation:** 최신 head SHA에서 리뷰 findings와 QA를 다시 확인한다. head가 바뀌면 이전 snapshot과 check 결과는 병합 근거로 사용하지 않는다.
7. **Native gates:** GitHub의 draft, conflict, required review와 required checks를 확인한다.
8. **Approval and merge:** 모든 hard gate가 해소된 exact head만 `APPROVE`하고 권한 범위 안에서 병합한다.
9. **Read-back:** merged SHA와 default branch의 해당 SHA 포함 여부 및 CI 결과를 GitHub에서 다시 읽어 cycle을 닫는다.

### Ponytail adapter

Ponytail은 리뷰 harness의 YAGNI adapter다. 기존 helper, 표준 기능, 설치된 의존성, 최소 변경을 먼저 선택하고 추측성 추상화를 거부한다. hook, prompt와 `AGENTS.md`는 각 agent 실행 환경의 local constraint를 보존하되, 이 ADR과 연결 문서의 canonical prose를 복제하지 않고 링크와 역할 계약만 둔다. 도구·프로필별 명령과 내부 구현은 이 ADR의 계약이 아니다.

### Definition of Done and hard gates

다음 중 하나라도 참이면 병합하지 않는다.

- 해결되지 않은 security 또는 correctness finding
- snapshot 이후 변경되어 재검증하지 않은 stale head
- 실패하거나 완료되지 않은 required check
- draft PR 또는 merge conflict
- PR checklist가 요구하는 QA 증거 누락
- required review 또는 미해결 review conversation

모든 predicate가 거짓이고 최신 exact head의 native gates가 통과하면 추가 추측 분석 없이 승인·병합·read-back으로 cycle을 닫는다. 상태 라벨이나 알림 이벤트만으로 완료를 추정하지 않는다.

### Roles and authority

- **Xia:** 기술 검증, root-cause finding, 합의된 구현과 exact-head 재검증을 담당한다.
- **ossplatform/Sari:** intake 통합, 한국어 structured response, resolution 추적, 명시적으로 위임된 범위의 conditional merge를 담당한다.
- **팀원:** 근거 있는 반론, 요구사항 확인, ADR 승인과 review resolution에 참여한다.

누구도 admin bypass로 review, required check, conflict 또는 branch protection을 우회하지 않는다. merge 권한은 명시적 승인 범위와 GitHub native gates를 모두 만족할 때만 행사한다.

### Work-in-progress limits

PR 하나에는 active review pipeline 하나만 둔다. 동시에 추적하는 병목은 가장 중요한 것 하나, 비차단 improvement는 하나로 제한한다. 기존 Issue, PR 또는 card가 같은 predicate를 추적하면 새 card를 만들지 않는다. polling은 단순한 status edge가 아니라 새 head, 새 미해결 finding, check 실패, resolution 완료처럼 행동을 바꾸는 live semantic predicate를 확인한다.

### Exceptions, rollback, and audit evidence

긴급 변경도 security·correctness, exact-head, required checks와 conflict gate를 생략할 수 없다. GitHub 장애로 canonical state를 확인할 수 없으면 병합을 중단하고 복구 후 같은 head를 다시 snapshot한다. 자동화가 잘못된 review나 approval을 남기면 삭제로 이력을 숨기지 않고 correction comment를 남긴 뒤 올바른 head에서 재검증한다. 병합 후 회귀는 새 PR의 revert commit으로 되돌리고 원 PR과 회귀 증거를 연결한다.

각 cycle은 최소한 review URL, 검증한 exact head SHA, required checks 결과, merge SHA를 감사 증거로 남긴다. 병합되지 않은 cycle은 merge SHA 대신 종료 사유와 마지막 head SHA를 기록한다.

## Alternatives considered

### 알림 채널을 작업 상태의 원본으로 사용

- Pros: 팀이 한 채널에서 진행 상황을 빠르게 볼 수 있다.
- Cons: polling 지연, 중복과 누락 때문에 exact head와 review resolution을 재현할 수 없다.
- **Rejected:** 알림은 projection/trigger로만 사용하고 GitHub를 canonical state로 유지한다.

### 에이전트별 전체 절차 복제

- Pros: 각 prompt만 읽어도 모든 절차를 알 수 있다.
- Cons: 같은 규칙이 hook, prompt, `AGENTS.md`에 분산되어 drift와 중복 review pipeline을 만든다.
- **Rejected:** canonical 문서는 계약과 링크를 소유하고 harness는 local constraint와 adapter만 소유한다.

## Consequences

### Enables

- 모든 review와 merge 판단을 exact head 및 GitHub 증거로 재현한다.
- 사람과 에이전트의 역할, resolution 책임과 merge 권한을 분리한다.
- polling 중복과 speculative improvement가 review cycle을 무한히 늘리는 것을 막는다.

### Costs / trade-offs

- head가 바뀔 때마다 findings와 checks를 다시 검증해야 한다.
- GitHub 상태를 읽을 수 없는 동안에는 병합을 진행할 수 없다.
- harness 문서는 canonical 규칙을 복제하는 대신 링크의 유효성을 유지해야 한다.

### New constraints

- stale head, unresolved hard gate 또는 missing QA가 있는 PR은 병합하지 않는다.
- PR마다 active review pipeline은 하나만 유지한다.
- approval과 merge 뒤에도 merged SHA 및 default-branch CI를 read-back한다.
- admin bypass를 사용하지 않는다.

## Changelog

- 2026-07-15: initial proposal

## References

- [AGENTS.md](../../AGENTS.md)
- [ADR-002: CI/CD 파이프라인](ADR-002-CI-CD-파이프라인.md)
- [Pull request template](../../.github/pull_request_template.md)
- [보안 규칙](../rules/security.md)
