# frontend Before/After 캡처를 PR에 올린다

"첨부한다"로는 부족하다 — 로컬 파일 경로(`/tmp/before.png`)를 PR 본문에 적으면 아무 이미지도 렌더되지 않고, 리뷰어는 화면을 못 본 채로 승인한다.
그래서 이 절에서 실제로 렌더되는 경로 하나를 고정한다.

## 1. 같은 조건으로 두 장을 찍는다

Before는 변경 전 코드, After는 변경 후 코드에서 찍고 나머지 조건은 전부 같게 둔다 — 같은 URL, 같은 페르소나, 같은 viewport, 같은 합성 데이터 상태.
변경한 컴포넌트를 식별할 수 있는 범위만 담는다. 화면 전체를 찍고 캡션으로 대상을 설명하지 않는다.
요소 단위 캡처 방법과 상태별 촬영은 [`qa-dom-capture`](../../manage-qa-tickets/agents/qa-dom-capture.md)가 원본이다.
목업, Figma 시안, 테스트 출력, 코드 diff는 실제 실행 화면을 대신하지 못한다.

파일명은 [`run-release-qa`](../../run-release-qa/SKILL.md)와 같은 규칙(`qa-id-role-route-viewport.png`)을 따른다 — 같은 저장소 안에서 캡처 파일명 관례가 갈리면 나중에 어느 QA 회차의 산출물인지 되짚기 어렵다.

## 2. 올리기 전에 사람이 직접 공개 안전을 확인한다

저장된 두 이미지를 열어 [보안 규칙](../../../docs/rules/security.md)의 공개 금지 범위에 걸리는 것이 화면에 보이는지 눈으로 확인한다.
그 deny-list를 여기 옮겨 적지 않는다 — 사본은 원본이 바뀔 때 조용히 갈라진다.
하나라도 보이면 올리지 않고 합성 fixture 상태에서 다시 찍는다.
화면에 세션 토큰·쿠키 값·devtools 패널·인증 관련 쿼리 파라미터가 보이지 않는 상태에서 찍는다.
이미지 파일의 메타데이터(EXIF의 기기·경로·위치)도 화면에 안 보이지만 파일에는 남으므로, 올리기 전에 제거하거나 메타데이터를 남기지 않는 방식으로 다시 저장한다.
`scripts/check-public-safe.sh`는 이 이미지를 검사해 주지 않는다 — 스캐너는 저장소 텍스트를 보고 증거 이미지는 저장소 밖에 있다.
그래서 이 게이트는 자동화가 없는 수동 확인 지점이다.

## 3. 이미 발행된 Release 에 에셋으로 올린다

```bash
TAG=$(gh release list --limit 1 --json tagName --jq '.[0].tagName')
gh release upload "$TAG" 1181-before-element-archive-dialog.png ... --clobber
```

주소는 `https://github.com/JNU-SWCU/oss-hub/releases/download/<태그>/<파일명>.png` 로 고정되므로
PR 본문에 그대로 `![Before](…)` 로 넣으면 렌더된다. `gh` 로 끝나므로 사람 손이 필요 없다.

**배포가 나가지 않는다.** production 배포를 트리거하는 것은 `release: types: [published]`
(`.github/workflows/ci.yml`) 이고, **이미 published 상태인 release 에 파일만 추가하는 것은 그 이벤트를
발생시키지 않는다.** 트리거되는 것은 새 release 를 발행할 때뿐이다.
그래서 `gh release create` 는 여전히 쓰지 않고, `gh release upload` 만 쓴다.

브라우저로 PR 본문에 끌어다 놓는 방법(`user-attachments`)도 그대로 유효하다. 그쪽은 브라우저 세션
전용이라 `gh` 로 할 수 없으므로, 에이전트가 여는 PR 은 위의 release 에셋 경로를 쓴다.

올린 뒤 주소가 실제로 200 을 주는지 한 번 확인한다 — 오타 하나로 본문 전체가 깨진 이미지가 된다.

```bash
curl -sIL -o /dev/null -w "%{http_code}\n" "https://github.com/JNU-SWCU/oss-hub/releases/download/$TAG/<파일명>.png"
```

그 뒤 PR 본문을 다시 열어 이미지가 렌더되는지 눈으로 확인한다.
파일 경로만 적힌 상태는 캡처를 올린 것이 아니다.

촬영 조건은 표 아래에 함께 적는다.

```markdown
촬영 조건: `<URL>` · `<페르소나>` · viewport `<가로>x<세로>` · 합성 seed 데이터
```

## 하지 않는 것

- 로컬 파일 경로(`/tmp/before.png`)를 본문에 적고 첨부했다고 하지 않는다 — 아무 이미지도 렌더되지 않는다.
- 증거 이미지를 제품 브랜치에 커밋하지 않는다 — 리뷰 대상 diff에 바이너리가 섞인다([pr-scope.md](../../../docs/rules/pr-scope.md) §1).
- 증거 전용 브랜치를 만들지 않는다 — 그 브랜치를 영구히 보존해야 병합된 PR 본문의 이미지가 깨지지 않는다. 별도 worktree에서 orphan 브랜치를 만들면 그 작업트리에 `package.json`이 없어 `pre-push`의 `pnpm format:check`가 실패해 push까지 막힌다.
- `gh release create`로 새 release를 발행하지 않는다 — 발행(published)이 production 배포 트리거다([ADR-002](../../../docs/decisions/ADR-002-CI-CD-파이프라인.md)). **이미 발행된 release에 `gh release upload`로 파일만 더하는 것은 그 이벤트를 쏘지 않으므로 안전하고, 3절이 쓰는 방법이다.**
- `/artifacts/`에 두지 않는다 — gitignore 대상이고 학생별 원시 수치의 자리다(ADR-010 §5). 커밋되지 않으므로 주소도 생기지 않는다.
- 목업·Figma 시안·테스트 출력·코드 diff로 실제 실행 화면을 대신하지 않는다.
