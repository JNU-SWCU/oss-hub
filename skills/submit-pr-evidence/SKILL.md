---
name: submit-pr-evidence
description: Run this before opening any OSS Hub PR from a ticket — it resolves the Issue contract, implements only the minimum, proves completion, runs the public-safety check, and blocks the PR until required evidence is present, since frontend changes need Before/After captures attached in the PR body and backend logic changes need a mermaid/DOT diagram of the changed flow. Mention triggers include "PR 열기 전", "PR 제출", "증거 첨부", "Before/After", "다이어그램".
metadata:
  version: "1.0.0"
---

# Submit PR Evidence

모든 OSS Hub PR을 열기 전에 통과해야 하는 필수 게이트다 — 증거가 없으면 PR을 열지 않는다.

`oss-hub 티켓 #<번호> 진행해줘`를 받았을 때, 또는 이미 구현된 변경을 PR로 제출해야 할 때 이 스킬을 쓴다.
성공 기준은 하나다: PR이 티켓 계약이 요구한 것과 정확히 일치하고, 완료 조건의 모든 항목이 PR을 열기 전에 실증되며, 절대 금지 경계 밖의 어떤 파일도 건드리지 않는다.

## 절차

1. 티켓을 가져온다 — `gh issue view <번호>` (이 repo 안에서 실행하면 `--repo` 지정은 불필요하다).
2. 계약을 파싱한다. 아래 세 섹션이 작업 범위의 유일한 원본이다.
   - `최소 요구 (기능)` — 구현해야 할 최소 범위. 그 이상도 이하도 만들지 않는다.
   - `완료 조건 (기능 검증)` — PR을 열기 전 실제로 증명해야 하는 체크리스트.
   - `절대 금지 (이 티켓의 경계)` — 이 티켓이 건드리면 안 되는 파일·동작.
3. 선행 의존성을 확인한다.
   `선행 의존성` 섹션이 미충족 의존성을 명시하면 부분 작업을 시작하지 않고 그 사실을 그대로 보고한다.
   의존성 그래프는 비순환이어야 한다 — 티켓들이 직접으로든 다른 티켓을 거쳐서든 서로를 선행 조건으로 요구하면(예: #A→#B→#A) 어느 쪽도 착수할 수 없다.
   순환을 발견하면 작업을 시작하지 않고 순환에 포함된 티켓 번호들을 보고한다.
4. 코드를 쓰기 전에 [루트 AGENTS.md](../../AGENTS.md)와 관련 경로의 중첩 AGENTS.md(예: `apps/AGENTS.md`, `apps/frontend/AGENTS.md`, `apps/backend/AGENTS.md`)를 읽는다.
   이 문서는 브랜치·커밋·PR 흐름이나 보안 규칙을 복제하지 않는다 — 원본과 사본이 어긋나는 drift를 막기 위해서다.
   실제 규칙은 항상 AGENTS.md와 그 링크 문서([docs/rules/security.md](../../docs/rules/security.md), [docs/rules/pr-scope.md](../../docs/rules/pr-scope.md))에서 확인한다.
5. 최소 요구 섹션이 요구하는 것만 구현한다.
   지금 같이 고치면 편해 보이는 인접 기능이나 스키마 변경도 그 자체의 티켓 몫으로 남긴다.
6. 절대 금지 섹션을 문자 그대로 지킨다 — 그 섹션이 이름을 언급한 파일·영역은 0건 수정한다.
7. 완료 조건 체크리스트를 한 항목씩 실제로 구동해 증명한 뒤에만 체크한다(테스트 실행, 화면·플로우 직접 확인 등).
   검증하지 않은 체크리스트로 PR을 열지 않는다.

## 증거 게이트

완료 조건을 증명한 뒤, PR을 열기 전에 변경 영역에 맞는 증거를 갖춘다.
영역별 요구가 다르므로 아래에서 해당하는 절만 따른다.

### frontend 변경 → Before/After 캡처

시각 또는 상호작용을 바꿨다면 동일한 URL·페르소나·viewport·합성 데이터 상태에서 실제 실행 화면의 Before/After 캡처를 만들어 GitHub PR 본문에 직접 첨부하고 렌더되는 것을 확인한다.
로컬 파일 경로를 적으면 아무 이미지도 렌더되지 않으므로 캡처를 올렸다고 보지 않는다.
시각 변화가 없으면 PR 본문에 `N/A`와 그 사유를 적는다.
절차와 촬영 조건, 하지 않는 것은 [references/frontend-capture.md](references/frontend-capture.md)가 원본이다.

### backend 로직 변경 → 흐름 다이어그램

분기·상태 전이·인가 경로·재시도 처리·호출 순서·계층 경계 중 하나라도 바뀌었다면 변경된 흐름을 mermaid(우선) 또는 DOT(대체)로 그려 PR 본문 `## 4b. Backend 흐름 다이어그램`에 넣는다.
다이어그램이 필요한 변경 범위, 형식, 노드 작명 규칙은 [references/backend-diagram.md](references/backend-diagram.md)가 원본이다.

### infra/docs-only 변경

해당 없음 — 위 두 게이트를 적용하지 않는다.

## PR을 연다

8. PR을 열기 전 `bash scripts/check-public-safe.sh`로 변경 파일·커밋 메시지의 public-safe 위반(실명·전화번호·개인 머신 경로 등, [docs/rules/security.md](../../docs/rules/security.md) deny-list)을 사전 검사한다.
   이 repo는 PUBLIC이므로 PR 본문·코멘트에도 같은 기준을 적용한다.
   Issue 초안 단계에서 텍스트만 검사하려면 [references/public-safety-check.md](references/public-safety-check.md)의 `--text-only` 절차를 쓴다.
9. [AGENTS.md](../../AGENTS.md)가 정한 흐름대로 PR을 연다 — 브랜치명·Conventional Commits·PR 본문 형식은 AGENTS.md §5가 원본이다.
10. PR이 열리면 [프로젝트 보드](https://github.com/orgs/JNU-SWCU/projects/1)에서 해당 티켓 카드를 In Review로 옮긴다.
11. 티켓이 Notion 행에서 발행된 것이면(Issue 본문에 `QA<번호>` 참조가 있다) PR URL을 Issue에 코멘트로 남긴다.
    Notion 행은 손대지 않는다 — 행은 `GitHub Issue` URL 하나만 들고 Issue가 나머지 진행 상태를 들고 있다.

## 이스케이프 해치

- 선행 의존성이 미충족 → 어떤 의존성인지 정확히 보고하고 멈춘다. 부분 구현을 시작하지 않는다.
- 선행 의존성이 순환을 이룸 → 순환에 포함된 티켓 번호들을 보고하고 멈춘다. 티켓 본문의 의존성 수정은 티켓 발행자 몫이다.
- 증거를 만들 수 없음(로컬에서 그 화면을 띄울 수 없거나, 합성 데이터로 그 상태를 만들 수 없거나, 흐름이 다이어그램으로 표현하기 어려움) → 추측 이미지나 목업, 대략적인 다이어그램으로 대신하지 않고, 무엇을 못 만들었는지와 왜인지를 PR 본문에 적고 그 사실을 보고한다.
- 계약이 구현에 필요한 지점에서 침묵하거나 모호함 → 무관한 문서·코드 주석·비슷한 과거 티켓의 기억으로 추론하지 않고 사용자에게 묻는다.
  티켓 본문은 그 자체로 완결된 설계로 간주한다.
- 세 실행 계약 섹션 중 하나가 비어 있음 → 구현을 시작하지 않고 발행자에게 채워 달라고 요청한다. 빈 `절대 금지`는 "경계 없음"이 아니라 "미기록"이다.

## 하지 않는 것

- 로컬 파일 경로(`/tmp/before.png`)를 PR 본문에 적고 첨부했다고 하지 않는다 — 아무 이미지도 렌더되지 않는다.
- 증거 이미지를 제품 브랜치에 커밋하지 않는다 — 리뷰 대상 diff에 바이너리가 섞인다([pr-scope.md](../../docs/rules/pr-scope.md) §1).
- 증거 전용 브랜치를 만들지 않는다 — 그 브랜치를 영구히 보존해야 병합된 PR 본문의 이미지가 깨지지 않는다. 별도 worktree에서 orphan 브랜치를 만들면 그 작업트리에 `package.json`이 없어 `pre-push`의 `pnpm format:check`가 실패해 push까지 막힌다.
- `gh release create`·`gh release upload`로 호스팅하지 않는다 — 이 저장소는 공개 Release 발행(published)을 production 배포 트리거로 쓴다([ADR-002](../../docs/decisions/ADR-002-CI-CD-파이프라인.md), `.github/workflows/deploy.yml`). 증거를 올리려다 배포가 나간다.
- `/artifacts/`에 두지 않는다 — gitignore 대상이고 학생별 원시 수치의 자리다(ADR-010 §5). 커밋되지 않으므로 주소도 생기지 않는다.
- 목업·Figma 시안·테스트 출력·코드 diff로 실제 실행 화면이나 실제 흐름을 대신하지 않는다.

## 요구사항

- `gh` — issue view, PR 생성, 프로젝트 보드 카드 이동.
- `git` — 브랜치·커밋 메커니즘은 [AGENTS.md](../../AGENTS.md)를 따른다.
- `bash scripts/check-public-safe.sh` — PUBLIC repo 텍스트 안전 사전 검사.

## 완료 체크리스트

- [ ] 세 계약 섹션을 읽었고, 선행 의존성이 미충족이거나 순환이면 착수하지 않고 보고했다.
- [ ] 첫 수정 전에 루트와 관련 중첩 AGENTS.md를 읽었다.
- [ ] 금지 섹션 밖 파일을 0건 수정했다.
- [ ] 완료 조건 각 항목을 실제 증거로 실증했다.
- [ ] `frontend` 시각·상호작용 변경이면 실제 Before/After 캡처를 동일 조건으로 만들어 사람이 공개 안전·메타데이터를 확인하고, PR 본문에 첨부해 렌더된 것을 다시 열어 확인했고, 시각 변화가 없으면 `N/A`와 사유를 적었다.
- [ ] `backend` 로직 변경이면 mermaid 또는 DOT 다이어그램을 PR 본문 `## 4b. Backend 흐름 다이어그램`에 넣었고, 변경 노드를 강조했으며, 실데이터·시크릿을 노드에 넣지 않았다.
- [ ] `bash scripts/check-public-safe.sh`를 PR 전에 실행했다.
- [ ] AGENTS.md가 정한 흐름대로 PR을 열고 보드 카드를 In Review로 옮겼다.
- [ ] Notion에서 발행된 티켓이면 Issue에 PR URL을 코멘트로 남겼다.
