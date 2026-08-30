# 수행 워크플로 — Issue를 PR로 만든다

`oss-hub 티켓 #<번호> 진행해줘`를 받았을 때 따르는 절차다.
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
4. 코드를 쓰기 전에 [루트 AGENTS.md](../../../AGENTS.md)와 관련 경로의 중첩 AGENTS.md(예: `apps/AGENTS.md`, `apps/frontend/AGENTS.md`, `apps/backend/AGENTS.md`)를 읽는다.
   이 문서는 브랜치·커밋·PR 흐름이나 보안 규칙을 복제하지 않는다 — 원본과 사본이 어긋나는 drift를 막기 위해서다.
   실제 규칙은 항상 AGENTS.md와 그 링크 문서([docs/rules/security.md](../../../docs/rules/security.md), [docs/rules/pr-scope.md](../../../docs/rules/pr-scope.md))에서 확인한다.
5. 최소 요구 섹션이 요구하는 것만 구현한다.
   지금 같이 고치면 편해 보이는 인접 기능이나 스키마 변경도 그 자체의 티켓 몫으로 남긴다.
6. 절대 금지 섹션을 문자 그대로 지킨다 — 그 섹션이 이름을 언급한 파일·영역은 0건 수정한다.
7. 완료 조건 체크리스트를 한 항목씩 실제로 구동해 증명한 뒤에만 체크한다(테스트 실행, 화면·플로우 직접 확인 등).
   검증하지 않은 체크리스트로 PR을 열지 않는다.
   frontend의 시각 또는 상호작용을 바꿨다면 PR을 제출하기 전에 실제 실행 화면에서 Before/After 캡처를 만들어 [아래 절차](#frontend-beforeafter-캡처를-pr에-올린다)대로 PR 본문에 렌더되게 올린다.
   frontend 시각 변화가 없으면 PR 본문에 `N/A`와 그 사유를 적는다.
8. PR을 열기 전 `bash scripts/check-public-safe.sh`로 변경 파일·커밋 메시지의 public-safe 위반(실명·전화번호·개인 머신 경로 등, [docs/rules/security.md](../../../docs/rules/security.md) deny-list)을 사전 검사한다.
   이 repo는 PUBLIC이므로 PR 본문·코멘트에도 같은 기준을 적용한다.
9. [AGENTS.md](../../../AGENTS.md)가 정한 흐름대로 PR을 연다 — 브랜치명·Conventional Commits·PR 본문 형식은 AGENTS.md §5가 원본이다.
10. PR이 열리면 [프로젝트 보드](https://github.com/orgs/JNU-SWCU/projects/1)에서 해당 티켓 카드를 In Review로 옮긴다.
11. 티켓이 Notion 행에서 발행된 것이면(Issue 본문에 `QA<번호>` 참조가 있다) PR URL을 Issue에 코멘트로 남긴다.
    Notion 행은 손대지 않는다 — 행은 `GitHub Issue` URL 하나만 들고 Issue가 나머지 진행 상태를 들고 있다.

## frontend Before/After 캡처를 PR에 올린다

"첨부한다"로는 부족하다 — 로컬 파일 경로(`/tmp/before.png`)를 PR 본문에 적으면 아무 이미지도 렌더되지 않고, 리뷰어는 화면을 못 본 채로 승인한다.
그래서 이 절에서 실제로 렌더되는 경로 하나를 고정한다.

### 1. 같은 조건으로 두 장을 찍는다

Before는 변경 전 코드, After는 변경 후 코드에서 찍고 나머지 조건은 전부 같게 둔다 — 같은 URL, 같은 페르소나, 같은 viewport, 같은 합성 데이터 상태.
변경한 컴포넌트를 식별할 수 있는 범위만 담는다. 화면 전체를 찍고 캡션으로 대상을 설명하지 않는다.
요소 단위 캡처 방법과 상태별 촬영은 [`qa-dom-capture`](../agents/qa-dom-capture.md)가 원본이다.
목업, Figma 시안, 테스트 출력, 코드 diff는 실제 실행 화면을 대신하지 못한다.

### 2. 올리기 전에 사람이 직접 개인정보 게이트를 통과시킨다

저장된 두 이미지를 열어 실명, 실제 이메일, 실제 팀명, 실제 저장소 이름이 보이는지 눈으로 확인한다.
하나라도 보이면 올리지 않고 합성 fixture 상태에서 다시 찍는다.
`scripts/check-public-safe.sh`는 이 이미지를 검사해 주지 않는다 — 스캐너는 PR diff의 텍스트를 보고, 증거 이미지는 아래 절차대로 제품 브랜치 밖에 두기 때문이다.
이 게이트는 자동화가 없는 수동 확인 지점이다.

### 3. 증거 전용 브랜치에 올려 SHA로 고정한 raw URL을 쓴다

증거 이미지는 제품 브랜치에 커밋하지 않는다 — 리뷰 대상 diff에 바이너리가 섞이고([pr-scope.md](../../../docs/rules/pr-scope.md) §1), 병합되면 저장소 이력에 영구히 남는다.
대신 병합하지 않는 증거 전용 브랜치에 올린다.

```bash
# <n>은 티켓 Issue 번호. 브랜치는 열지도, 병합하지도 않는다.
git switch --orphan evidence/ticket-<n>
mkdir -p evidence && cp <before.png> <after.png> evidence/
git add evidence && git commit -m "chore(evidence): 티켓 #<n> Before/After 캡처"
git push -u origin evidence/ticket-<n>
git rev-parse HEAD   # 이 SHA를 URL에 박는다
```

PR 본문에는 그 SHA로 고정한 raw URL을 쓴다.

```markdown
| Before | After |
| --- | --- |
| ![before](https://raw.githubusercontent.com/JNU-SWCU/oss-hub/<SHA>/evidence/before.png) | ![after](https://raw.githubusercontent.com/JNU-SWCU/oss-hub/<SHA>/evidence/after.png) |

촬영 조건: `<URL>` · `<페르소나>` · viewport `<가로>x<세로>` · 합성 seed 데이터
```

브랜치 이름이 아니라 SHA로 고정하는 이유는, 브랜치를 나중에 덮어쓰면 PR 본문의 이미지가 조용히 다른 화면으로 바뀌기 때문이다.
`evidence/**` 브랜치는 orphan이라 제품 이력과 공통 조상이 없고, `ci.yml`은 `pull_request`와 `main` push에서만 돌기 때문에 이 push는 CI를 돌리지 않는다.
증거 브랜치는 PR이 병합된 뒤에도 남긴다 — 지우면 병합된 PR 본문의 이미지가 깨진다.

### 하지 않는 것

- `gh`로 PR 본문에 이미지를 첨부하려 하지 않는다 — `gh`에는 그 명령이 없고, 첨부 업로드는 브라우저 세션 전용 endpoint다. 없는 플래그를 추측해 만들지 않는다.
- `gh release create`·`gh release upload`로 이미지를 호스팅하지 않는다 — 이 저장소는 공개 Release 발행(published)을 production 배포 트리거로 쓴다([ADR-002](../../../docs/decisions/ADR-002-CI-CD-파이프라인.md), `.github/workflows/deploy.yml`). 캡처를 올리려다 배포가 나간다.
- `/artifacts/`에 두지 않는다 — gitignore 대상이고 학생별 원시 수치의 자리다(ADR-010 §5). 커밋되지 않으므로 URL도 생기지 않는다.
- 증거 브랜치로 PR을 열지 않는다. 리뷰 대상이 아니다.

## 이스케이프 해치

- 선행 의존성이 미충족 → 어떤 의존성인지 정확히 보고하고 멈춘다. 부분 구현을 시작하지 않는다.
- 선행 의존성이 순환을 이룸 → 순환에 포함된 티켓 번호들을 보고하고 멈춘다. 티켓 본문의 의존성 수정은 티켓 발행자 몫이다.
- 캡처를 찍을 수 없음(로컬에서 그 화면을 띄울 수 없거나, 합성 데이터로 그 상태를 만들 수 없음) → 추측 이미지나 목업으로 대신하지 않고, 무엇을 못 띄웠는지와 왜인지를 PR 본문에 적고 그 사실을 보고한다.
- 계약이 구현에 필요한 지점에서 침묵하거나 모호함 → 무관한 문서·코드 주석·비슷한 과거 티켓의 기억으로 추론하지 않고 사용자에게 묻는다.
  티켓 본문은 그 자체로 완결된 설계로 간주한다.
- 세 실행 계약 섹션 중 하나가 비어 있음 → 구현을 시작하지 않고 발행자에게 채워 달라고 요청한다. 빈 `절대 금지`는 "경계 없음"이 아니라 "미기록"이다.

## 요구사항

- `gh` — issue view, PR 생성, 프로젝트 보드 카드 이동.
- `git` — 브랜치·커밋 메커니즘은 [AGENTS.md](../../../AGENTS.md)를 따른다.
- `bash scripts/check-public-safe.sh` — PUBLIC repo 텍스트 안전 사전 검사.
