# 증거를 실제로 만들어 내는 방법

캡처를 「찍는다」고만 적어 두면 매번 다시 헤맨다.
이 문서는 이 저장소에서 화면 증거가 나오는 경로와, 그 과정에서 조용히 틀리는 자리를 적는다.
게시·공개 안전·파일명 규칙은 [frontend-capture.md](frontend-capture.md)가 원본이다.

## 두 경로를 섞지 않는다

| 목적 | 경로 | 쓰지 않는 것 |
| --- | --- | --- |
| 일상 확인·수동 Before/After | 실제 backend를 붙인 `pnpm dev`, 합성 역할 계정, 사용자가 고른 브라우저 도구 | 백엔드 없는 검토 서버, 새 preview 포트, 에뮬레이터 카탈로그. 명시한 도구를 다른 도구로 바꾸기 |
| 브라우저 자동 회귀 | 기존 `pnpm --filter frontend e2e` (fresh stack, Chrome, workers 1, retries 0) | 스위트 통과만으로 PR 화면 첨부를 대신하기. 캡처 전용 서버를 새로 띄우기 |

통과한 e2e 실행은 회귀 증거지 이미지 첨부가 아니다.
그 실행이 [frontend-capture.md](frontend-capture.md)를 만족하는 Before/After 파일을 남겼으면 그 파일은 PR 증거로 재사용한다.

수동 점검이 해당되면 사용자가 명시한 브라우저 도구를 쓴다.
명시한 도구가 없으면 설치된 craft `browser` 라우팅을 따른다. 그 기본값을 여기에 고정하지 않는다.

Aside를 선택했을 때만 아래를 쓴다.

```bash
aside "Open http://localhost:3000/<path> and inspect the changed control with the synthetic staff actor"
aside repl "const p = await openTab('http://localhost:3000/<path>')"
```

`aside repl`은 결정적 점검·스크린샷·다운로드용으로 문서화된 표면이다.
설치된 Aside 버전에 없는 하위명령·REPL API를 만들지 않는다.
버전에 따라 다르면 [Aside developer documentation](https://docs.aside.com/help/developers)을 확인하고, 모르면 추측하지 않고 멈춘다.

자동 회귀는 저장소에 이미 있는 엔트리다.

```bash
pnpm --filter frontend e2e
```

이 명령은 isolated PostgreSQL과 실제 backend를 띄운다.
UI만 가로챈 응답은 레이아웃·오류 문구 증명이지 저장·인가·트랜잭션 증명이 아니다.
새 미리보기 서버를 추가하지 않는다.

역할별 합성 계정은 [onboarding.md](../../../docs/onboarding.md)의 `AUTH_INITIAL_ROLES` 절차를 따른다.
실명·실데이터·개인 머신 경로를 화면이나 파일명에 넣지 않는다.

## Before / After를 같은 조건으로 얻는 방법

Before는 `origin/main` worktree, After는 작업 worktree에서 찍는다.
호스트 ingress 3000은 동시에 두 `pnpm dev`가 못 쓰므로 순차로 띄우고 끈다.
조건(URL·합성 역할·viewport·locale·timezone·합성 데이터)을 맞춘다.

`apps/frontend/playwright.config.ts`는 전역 `timezoneId`나 고정 시계를 두지 않는다.
시간·마감이 걸린 화면은 그 테스트가 시계를 명시한다.
예: `test.use({ timezoneId: 'Asia/Seoul' })` 또는 `'UTC'`, `page.clock.setFixedTime(...)`, program-authoring reset의 `now`.
`e2e/run-stack.sh`의 `E2E_FROZEN_NOW`와 `TZ=Asia/Seoul`은 스택 프로세스 환경이지 브라우저 전역 시계가 아니다.
고정 시계와 고정 달력 날짜는 유효하다. 상대 오프셋 빌더를 강제하지 않는다.

파일명은 `<이슈번호 또는 티켓없음-슬러그>-<before|after>-<element|desktop|mobile>-<무엇>.png` 로 둔다.
release 에셋은 저장소 전역 네임스페이스라 앞 토큰이 없으면 서로 덮어쓴다.

### 요소 캡처가 빈 화면으로 나올 때

- 스크롤 컨테이너가 `main`이 아닐 수 있다. 이 저장소의 일부 화면은 `main` 태그 자체가 없다.
  텍스트로 앵커를 잡고 그 조상 요소를 찍는 편이 안정적이다.
- 재제출 폼처럼 포털(dialog)로 열리는 것은 `main.innerText`에 잡히지 않는다. `form`을 직접 잡는다.
- 접근성 이름이 보이는 글자와 다를 때 역할 로케이터가 0건을 낸다. 보이는 글자로 버튼을 찾는다.

자동 회귀에서 같은 이름의 버튼이 여럿이면 첫 번째가 비활성일 수 있다.
눌리는 것을 고른다.

```js
const all = page.locator('button:has-text("수정")');
for (let i = 0; i < await all.count(); i++) {
  const b = all.nth(i);
  if (await b.isDisabled()) continue;
  await b.scrollIntoViewIfNeeded(); await b.click(); break;
}
```

## 상태가 없으면 캡처를 찍을 수 없다 — 해당되면 제출을 막는다

아무도 눈으로 확인할 수 없는 상태는 조용히 낡는다.
필요한 상태는 그 테스트 안의 작은 합성 입력, 기존 시드 역할, 또는 그 요청만 끊는 UI-only `page.route`로 만든다.
에뮬레이터 페르소나 목록을 키우지 않는다.

레이아웃·빈 화면·오류 문구는 정확한 테스트 소유 응답으로 증명할 수 있다.
저장·권한·트랜잭션·배포된 와이어는 실제 backend 증거가 따로 있어야 한다.
가로채기로 찍은 화면을 서버가 맞다는 증명으로 쓰지 않는다.

해당되는 화면을 합성 데이터로도, 범위 있는 UI 입력으로도 못 만들면 그 캡처는 없는 것이다.
PR 본문에 면제 사유를 적고 열지 않는다.

## 빈 상태·오류 상태를 실제로 만들어 보기

빈 화면이 여러 갈래면 갈래마다 다른 문구가 나오는 것을 실제로 확인한다.
같은 데이터에서 세 번 찍으면 세 장이 같다.

- 「아직 없음」 — 정말로 0건인 합성 대상을 쓴다.
- 「조건에 맞는 것 없음」 — 데이터가 있는 합성 대상에서 검색·필터로 0건을 만든다.
- 「불러오지 못함」 — 자동 회귀에서 그 요청만 끊는다. `page.route('**/…**', r => r.abort('failed'))`.
  Aside를 선택했을 때, Aside에 없는 네트워크 API를 만들어 쓰지 않는다.

## 자동 점검 4종의 거짓 양성

`ux-antipatterns.md`의 콘솔 스니펫은 DOM을 세므로, 반응형 때문에 두 벌 있는 내비게이션이나
달력이 주차 행마다 그리는 기간 라벨을 중복으로 잡는다.

숨긴 탭에서는 `offsetParent`·`getBoundingClientRect`가 전부 0이라 가시성 판정이 무너진다.
레이아웃 대신 계산된 스타일만 보면 숨긴 탭에서도 성립한다.

```js
const hidden = (el) => { let n = el;
  while (n && n.nodeType === 1) { const s = getComputedStyle(n);
    if (s.display === 'none' || s.visibility === 'hidden') return true; n = n.parentElement; }
  return false; };
```

걸린 것을 다 「위반」으로 적지 말고, **요약 표면에서 같은 사실을 두 번 말한 것**과
**구조적 반복**(마일스톤마다 하나씩인 섹션 제목, 기간이 여러 주에 걸친 달력 라벨)을 가른다.
판정 표에는 무엇을 보고 그렇게 판단했는지 한 조각을 적는다 — 「통과」만 적힌 줄은 근거 없는 통과다.

## PR 본문을 파일로 만든다

본문에 백틱이 들어가는데 셸에서 따옴표 없는 heredoc을 쓰면 셸이 명령으로 실행해 그 자리가 빈칸이 된다.
실제로 `deletionProtected`와 `allow={['staff']}`가 통째로 사라진 채 발행된 적이 있다.

```bash
cat > /tmp/pr.md <<'MDEOF'      # 따옴표가 핵심이다
… 본문 …
MDEOF
gh pr create --body-file /tmp/pr.md
```

주소처럼 값을 넣어야 하는 곳은 자리표시자를 두고 `sed`로 치환한다.
발행한 뒤 `gh pr view <번호> --json body`로 본문을 다시 읽어 빠진 자리가 없는지 확인한다.
