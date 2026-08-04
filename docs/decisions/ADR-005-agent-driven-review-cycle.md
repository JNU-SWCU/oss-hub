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

모든 리뷰와 병합 판단은 정확한 head SHA와 대상 base ref·base full SHA를 기준으로 한다. head, base ref 또는 base SHA가 바뀌면 이전 결과를 재사용하지 않고 다시 확인한다.

PRD·IA·Accepted ADR·root와 적용되는 nested `AGENTS` 범위 안의 기술·정책·구현은 전남의 exact-head 독립 검토와 Tech Lead의 자율 범위 안에서 판단하며, 특정 PM의 PR별 확인을 일반 병합 조건으로 두지 않는다.

@GoBeromsu와 @Lumiere001은 owner 표와 무관하게 저장소 전체 경로를 사전 허락 없이 수정한다.
PR 본문에 대상 기능과 owner를 명시하고 해당 owner를 리뷰어로 지정해 통지하며, 착수 전 Issue로 선점을 선언한다.
owner의 사후 확인 코멘트는 병합 조건이 아니다.
그 밖의 비소유자는 현행대로 Issue·PR 코멘트로 제안한다.

PR #407은 직접 UI 피드백에서 시작되어 사전 Issue 선점 없이 구현된 절차 위반을 인정한다. 이미 구현과 exact-head 기술 검증이 완료된 상태에서 잘못 생성된 #480을 재사용하지 않고, 실제 범위·owner·PR 관계를 보존하는 사후 추적 Issue #484를 canonical 구현 기록으로 둔다. 이 일회성 예외는 #407에만 적용하며 사후 Issue를 일반적인 선점 대체 수단으로 허용하지 않는다. 이후 동일 규모의 변경은 착수 전에 Issue로 범위와 owner를 선언해야 하고, 누락 시 구현 완료 여부와 관계없이 blocker로 처리한다.

전남은 이 저장소의 독립 PR 검토 역할을 맡는 코드리뷰 에이전트이며, 수동 파일럿에서는 @GoBeromsu, @Lumiere001 또는 리뷰 증거 전용 계정 @Lumeire002가 실행 결과를 GitHub에 기록한다.
@Lumeire002의 권한은 `MERGE_READY` 기록에 한정하며 병합 권한은 위임하지 않는다.
Ponytail은 기존 라이브러리 재사용, 중복과 불필요한 복잡도만 확인하는 검토 렌즈이며 기능 존재·동작 여부를 판정하거나 실제 QA를 대체하지 않는다.

일반 PR은 전남의 exact-head `MERGE_READY`가 병합 검토의 단일 수렴 결과다.
`MERGE_READY`에는 일반 코드·계약 검토, Ponytail 복잡도 검토, 실제 UI/API QA, 재현 가능한 계약 검증(`CLI:`)과 required CI 결과를 함께 기록한다.
실제 UI/API QA는 티켓의 화면·API 시나리오를 테스트 명세로 읽고, 변경에 적용되는 정상 흐름·권한 차단·마감/중복/stale 상태·성공 뒤 상태 변화를 직접 확인한다.
UI로 확인할 수 없는 backend-only 계약은 격리 환경의 실제 API·DB 경로로 확인하며, CI·단위·통합 테스트는 그 뒤의 보조 증거다.
관찰 가능한 UI/API 동작이 없는 변경만 구체적인 N/A 사유를 허용한다.
실행 환경·선행 PR·외부 자원 때문에 직접 확인하지 못한 동작 변경은 `BLOCKED/UNVERIFIED`로 기록하고 `MERGE_READY`를 남기지 않는다.

`CLI:` 증거는 저장소에서 재현 가능한 검증 결과이며, 전용 검사기 스크립트는 그 형태 중 하나일 뿐이다.
같은 불변식을 지키는 수단은 다음 순서로 우선한다: (1) 구조 — 타입·스키마·생성으로 위반을 표현 불가로 만든다, (2) 앱 테스트 스위트, (3) 전용 검사기 스크립트, (4) 문서 규칙.
상위 수단으로 불변식이 성립하면 하위 수단을 새로 만들지 않는다.
새 전용 검사기를 도입하는 PR은 어떤 불변식을 지키는지와 상위 두 수단으로 성립하지 않는 이유를 본문에 남긴다.
전용 검사기를 상위 수단으로 옮기는 변경은 검사 약화가 아니라 등가 이전이며, 같은 불변식이 상위 수단에서 성립함을 `CLI:` 증거로 보이면 일반 변경으로 처리한다.
단 fail-closed 보안·배포 게이트는 이 우선순위의 예외로 유지한다: public-safe·gitleaks 스캔, ADR-002의 Release 배포 검증, `merge-policy` 판정기.
이 예외 경로를 축소·우회·약화하는 변경은 계속 high risk다.

| 분류 | 의미 | 병합 영향 | 처리 |
| --- | --- | --- | --- |
| `blocker` | correctness·security·명시적 계약 위반 | 해결 전 병합 금지 | 현재 PR에서 수정하고 새 head 재검토 |
| `fix-now` | 현재 범위의 작고 실질적인 개선 | 미반영만으로 병합을 막지 않음 | 현 PR 반영을 권고 |
| `follow-up` | 현재 범위를 키우는 유효한 후속 작업 | 현재 PR 비차단 | 근거와 함께 Issue로 분리 |
| `reject` | 사실·결정·저장소 관례와 충돌하는 제안 | 적용하지 않음 | 기각 이유 기록 |

다음 변경은 high risk로 분류한다.

- 인증·세션·RBAC·권한 모델
- 개인정보·동의·공개/비공개 데이터 경계
- DB schema migration, data backfill, 삭제 또는 비가역 데이터 변경
- CI, Jenkins, 배포·rollback, branch protection, CODEOWNERS, 보안 정책
- 외부 OAuth·GitHub App·webhook 등 권한 있는 외부 연동
- 여러 도메인의 계약을 함께 바꾸는 횡단 설계 변경

high risk 여부는 파일 경로가 아니라 실제 권한·데이터·운영·공통 계약에 미치는 효과로 판정한다.
CODEOWNERS 경로는 검토 후보를 찾는 신호이며 그 자체가 high risk 확정 판정은 아니다.
나열된 경계를 생성·확장·축소·우회하거나 검사를 약화하는 변경은 경로와 무관하게 high risk이며, 분류가 모호하면 high risk로 처리한다.
검사 수단을 위 우선순위의 상위로 옮기면서 같은 불변식을 유지하는 등가 이전은 약화로 보지 않는다 — 단 fail-closed 예외 경로는 그대로 high risk다.
동작 효과가 없는 기계적 문서·테스트·리팩터링은 경로가 일치해도 일반 변경일 수 있지만, 정책 문서의 실제 계약을 바꾸면 high risk다.
다음 경로를 변경하는 PR은 배포 계약 경로로 정의한다: `Jenkinsfile`, `compose.yml`, `.env.example`, `deploy/**`, `apps/*/Dockerfile`, `.dockerignore`, `.github/workflows/deploy.yml`, `scripts/check-jenkinsfile.sh`, `scripts/check-jenkinsfile.test.sh`, `scripts/jenkins/**`.
`scripts/jenkins/**`는 Jenkinsfile의 절차 로직을 외부 script로 추출할 때 그 보호 수준이 함께 옮겨가도록 미리 포함한다 — 추출이 승인 요건을 낮추는 우회 경로가 되지 않게 한다.
수동 파일럿에서 CODEOWNERS 후보 또는 분류가 모호한 변경은 기본적으로 `HIGH_RISK`다.
risk 분류는 전남이 `MERGE_READY`에 기록하는 판단이며, accept 코멘트로 낮추는 별도 절차는 두지 않는다.

@GoBeromsu가 작성한 PR은 위 증거 요건 전체에서 면제된다 — 어떤 사람의 review·`MERGE_READY`도 요구하지 않으며 @Lumiere001의 검토도 조건이 아니다.
이 PR의 병합 조건은 required check(`ci`·`public-safe`)뿐이다.
면제는 작성자 identity에만 근거하므로 `authorLogin`이 정확히 `GoBeromsu`가 아니거나 확인되지 않으면 적용하지 않는다(fail-closed).
head·base SHA 형식 검증과 base가 default branch인지의 검사는 면제 대상이 아니며 그대로 적용한다.

high risk PR도 exact-head `MERGE_READY` 확인만으로 병합 절차를 진행한다 — accept 코멘트를 병합 조건으로 두지 않는다.
누가 실제로 병합을 실행할 수 있는지는 GitHub 저장소 설정(branch protection·merge 권한 등)이 정하며, 이 ADR은 코멘트 프로토콜로 접근 제어를 대체하지 않는다(2026-08-04 결정).
Jenkins의 실패 시 중단·증적 보존·기존 이미지 복구 동작은 ADR-002의 배포 계약을 유지하며, 이 ADR은 별도의 rollback 동작 변경을 결정하지 않는다.

수동 파일럿의 canonical evidence는 PR 최상위 댓글에 아래 형식과 40자 full SHA로 남긴다.
`MERGE_READY head=<sha> base=<ref> base_sha=<sha> risk=<GENERAL|HIGH_RISK>`는 @GoBeromsu, @Lumiere001 또는 @Lumeire002 계정으로 실행한 전남 검토 결과만 허용한다.
그 댓글에는 `CODE_CONTRACT:`, `PONYTAIL:`, `QA:`, `CLI:`, `CI:` marker와 각각의 비어 있지 않은 public-safe URL 또는 요약을 한 줄씩 포함한다.
`QA:`의 `N/A`는 관찰 가능한 동작이 없다는 구체적인 사유를 함께 적고, `BLOCKED/UNVERIFIED`에는 `MERGE_READY`를 사용하지 않는다.
head, base ref 또는 base SHA가 바뀌면 이전 증거는 모두 무효다.
후속 #226의 `merge-policy` required check는 이 `MERGE_READY` 증거(actor·형식·head·base 고정·evidence marker)를 검증한다.
required check가 적용되기 전에는 병합자가 이 actor·형식·head·base를 수동으로 대조한다.
이 저장소의 기존 branch protection은 사람 리뷰를 required gate로 강제하지 않았으므로 수동 파일럿은 적용 중인 기계 게이트를 제거하지 않는다.
수동 파일럿 동안 병합 권한은 @GoBeromsu와 @Lumiere001로 제한하고 admin bypass를 사용하지 않으며, #226 병합 뒤 `merge-policy`를 required check로 전환한다.

다음 조건을 모두 충족한 PR만 병합한다.

- draft와 merge conflict가 없다.
- 관련 CI와 required check가 통과했다.
- root와 적용되는 nested `AGENTS`를 준수했다.
- @GoBeromsu 작성 PR은 required check만 통과하면 병합 가능하다(review·`MERGE_READY` 면제). 그 외 PR은 risk와 무관하게 전남의 현재 head `MERGE_READY`가 있다.
- 해결되지 않은 blocker가 없다.
- GitHub가 병합 가능한 상태로 표시한다.

전남은 risk와 무관하게 `MERGE_READY`와 현재 GitHub mergeability를 확인한 뒤 병합할 수 있다.
GitHub 상태나 승인 범위를 확인할 수 없거나 모호하면 병합하지 않으며, admin bypass로 gate를 우회하지 않는다.

ADR-002에 따라 production 배포는 release tag를 통한 별도 단계다.
production 배포의 인가·트리거·실행 검증 계약은 ADR-002를 따른다.

검증한 head SHA, check 결과와 review URL을 남긴다. 병합한 경우 merge SHA도 기록한다.

## Consequences

- 최신 변경에 대한 검증 근거를 GitHub에서 다시 확인할 수 있다.
- head, base ref 또는 base SHA가 바뀌면 검증을 반복해야 한다.
- accept 코멘트 프로토콜을 폐지하면서 "누가 병합을 실행할 수 있는가"는 이 ADR이 아니라 GitHub 저장소 설정(branch protection·merge 권한)이 정한다 — 완화 수단은 전남의 exact-head `MERGE_READY` 증거와 required CI이며, 접근 제어 자체의 강제는 repo 소유자가 GitHub에서 구성한다(2026-08-04 결정).
- @GoBeromsu 작성 PR의 review 면제로 그 PR에는 사람 검토가 전혀 없다. 남는 통제는 required check(`ci`·`public-safe`)와 ADR-002의 Jenkins 기술 검증(full SemVer·main ancestry·실행 중 metadata·rollback·smoke)이다. 이는 PM이 자기 산출물 검토 부담을 없애는 대가로 감수한 위험이다(2026-07-30·2026-07-31 결정).
- 새 계약을 지키는 기본 수단이 전용 검사기에서 구조·앱 테스트로 이동한다. 검사기 수는 단조 증가하지 않고 상위 수단으로 흡수되며 줄어들 수 있다.
- 검사기 신설에 근거 기재 비용이 추가된다. 반대로 상위 수단으로 옮기는 정리 PR은 별도 완화 accept 없이 진행할 수 있다.
- fail-closed 보안·배포 게이트는 예외로 남아 우선순위와 무관하게 유지된다 — 이 부분의 강제 수준은 변하지 않는다.

## References

- [AGENTS.md](../../AGENTS.md)
- [ADR-002: CI/CD 파이프라인](ADR-002-CI-CD-파이프라인.md)
- [Pull request template](../../.github/pull_request_template.md)

## Changelog

- 2026-08-01: PR #407의 사전 Issue 선점 누락을 절차 위반으로 기록하고, 잘못 생성된 #480 대신 사후 추적 Issue #484로 범위·owner·PR 관계를 보존하는 일회성 예외를 수용했다. 이 예외는 #407에만 적용하며 향후 사후 Issue가 착수 전 선점을 대체하지 못하도록 명시했다.
- 2026-08-04: Issue #574와 운영 승인에 따라 @Lumeire002를 전남 `MERGE_READY` 기록 계정으로 추가했다. 권한은 독립 리뷰 증거 작성에만 한정하며 `PM_ACCEPT`, `TECH_LEAD_ACCEPT`, `RISK_ACCEPT`, 병합 권한과 배포 계약의 PM 전속은 변경하지 않았다.
- 2026-08-04: repo owner 결정에 따라 accept 코멘트 병합 게이트(`PM_ACCEPT`, `TECH_LEAD_ACCEPT`, `RISK_ACCEPT`)를 폐지했다. 근거: 단순함이 우선이며 접근 제어는 bespoke 코멘트 프로토콜 대신 GitHub platform 기능(branch protection·merge 권한 등)으로 옮기는 것이 낫다는 판단. `MERGE_READY` 리뷰 기록·evidence marker 검증·PM 작성 PR 면제·fail-closed 입력 검증은 그대로 유지하며, high risk PR과 배포 계약 경로 PR도 이제 accept 없이 `MERGE_READY`만으로 병합 절차를 진행한다. `merge-policy-check-lib.mjs`에서 배포 계약 경로 분류(`DEPLOY_CONTRACT_PATTERNS`)와 CODEOWNERS 후보 판정은 accept 요건에만 쓰이던 로직이라 함께 제거했다 — `merge-policy` required check 자체는 유지한다. 실제 병합 권한 제한은 이 ADR이 아니라 GitHub 저장소 설정이 원본이다.
- 2026-07-17: Issue #37에 따라 root `AGENTS.md`와 PR 템플릿에 조건부 Draft/Ready와 독립 리뷰 결과 분류를 운용 규칙으로 연결했다. 권한 경계와 병합 조건은 변경하지 않았다.
- 2026-07-16: Code Owner review #4705528344의 승인 범위와 ADR-002 배포 경계를 반영하고 `Accepted`로 전환했다.
- 2026-07-16: Owner 댓글 #4991669947의 Tech Lead 위임 경계와 독립 리뷰 분류를 수용했다.
- 2026-07-17: 병합 조건의 review 항목을 required review와 CODEOWNERS 대상 경로의 Code Owner review로 이원화해 실제 CODEOWNERS 커버리지와 맞췄다.
- 2026-07-17: blocker 분류를 독립 리뷰 문단에서 한 번만 정의하고, 병합 조건은 해결되지 않은 blocker 부재로 명시했다.
- 2026-07-23: 일반 PR의 상호 Code Owner review를 전남 exact-head `MERGE_READY`로 대체했다. high risk PR과 production release에는 PM인 @GoBeromsu와 Tech Lead인 @Lumiere001의 동일 SHA manual accept를 추가했다.
- 2026-07-25: Issue #257에 따라 PR #256에 한정된 일회성 PM 긴급 코드 승인 발행 창을 추가했고, 기존 gate 없이 병합된 PR #258은 비활성 이력으로 기록하며 별도 remediation의 기존 high risk 이중 gate 통과 전에는 권한이 발효되지 않도록 했다.
- 2026-07-28: Issue #274에 따라 high risk 병합 accept를 PM 또는 Tech Lead 중 한 명으로 완화하고 배포 계약 경로는 PM 전속으로 유지했다. `GENERAL` 하향도 같은 규칙을 따른다. @GoBeromsu와 @Lumiere001의 저장소 전체 free-role 작성권과 사후 확인 폐지를 명문화했다.
- 2026-07-28: Issue #199에 따라 production release·재배포 승인을 @GoBeromsu 단독 `RELEASE_ACCEPT role=PM`으로 전환하고 `RELEASE_ACCEPT role=TECH_LEAD`와 `RELEASE_OVERRIDE role=PM`을 폐지했다.
- 2026-07-28: PR #256에 한정되었던 일회성 긴급 PM 코드 승인 경로(PM_EMERGENCY_ACCEPT·OWNER_CONFIRM)를 삭제했다 — 단일 accept 도입으로 `TECH_LEAD_ACCEPT` 대체 기능의 존재 이유가 사라졌다.
- 2026-07-30: @GoBeromsu가 작성한 PR을 review·`MERGE_READY`·accept 요건 전체에서 면제했다 — @Lumiere001의 검토도 조건이 아니다. 병합 조건은 required check(`ci`·`public-safe`)뿐이며, 면제는 작성자 identity에만 근거하고 확인되지 않으면 적용하지 않는다(fail-closed). head·base SHA 형식과 default branch 검사는 면제하지 않는다.
- 2026-07-30: `.github/CODEOWNERS`의 모든 경로 소유자를 @GoBeromsu 단독으로 정리했다 — @Lumiere001을 co-owner로 두면 @GoBeromsu 작성 PR마다 GitHub가 자동 review 요청을 걸어 병합이 느려진다. `merge-policy` 판정기는 CODEOWNERS에서 경로 패턴만 읽고 소유자 핸들은 쓰지 않으므로 후보 경로 판정은 바뀌지 않는다(패턴 25개 동일). @Lumiere001의 `MERGE_READY`·`TECH_LEAD_ACCEPT` 권한과 저장소 전체 free-role 작성권은 그대로 유지한다 — 이 변경은 자동 요청만 없애며 검토 권한을 축소하지 않는다.
- 2026-07-30: `CLI:` 증거의 정의를 "repository-declared CLI 검증"에서 "재현 가능한 계약 검증"으로 바꾸고 검증 수단 우선순위(구조 → 앱 테스트 → 전용 검사기 → 문서 규칙)를 명문화했다. 전용 검사기만이 병합 증거를 충족하던 제약이 검사기 단조 증가를 유발했으므로 상위 수단으로의 등가 이전을 검사 약화에서 제외했다. fail-closed 보안·배포 승인 게이트(public-safe·gitleaks, Jenkins release 승인 바인딩, `merge-policy`)는 예외로 유지했고 marker 이름·형식·actor·accept 규칙은 변경하지 않았다.
- 2026-07-31: production Release 발행 자체를 배포 인가로 삼는 ADR-002 개정에 맞춰 Jenkins 댓글 marker 승인 바인딩의 현재 계약 서술을 제거하고, 남는 통제를 required check와 Jenkins의 기술 검증으로 명시했다. 과거 marker 계약과 폐지 과정은 Changelog 이력으로 보존한다.
