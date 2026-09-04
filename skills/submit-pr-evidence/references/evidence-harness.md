# 증거를 실제로 만들어 내는 방법

캡처를 「찍는다」고만 적어 두면 매번 다시 헤맨다.
이 문서는 이 저장소에서 증거가 실제로 나오는 경로와, 그 과정에서 조용히 틀리는 자리를 적는다.

## 촬영 환경 — local-review 하네스

합성 데이터로 도는 검토용 하네스가 있다. **백엔드·DB 없이 프런트만 띄우면 된다.**

```bash
cd apps/frontend
OSS_HUB_LOCAL_REVIEW_FIXTURES=1 corepack pnpm exec next dev -p 3200
```

페르소나 쿠키는 진입 주소가 심는다.

```
http://localhost:3200/local-review/<페르소나>?to=<경로>
```

페르소나는 `apps/frontend/src/lib/local-review-runtime.ts` 의 `LOCAL_REVIEW_FIXTURE_IDS` 가 원본이다
(`student`·`staff`·`admin`·`anonymous`·`unassigned`·`role-pending`·`error`·`error-once` 등).

**`to=` 는 쿼리스트링을 받지 않는다.** `?milestoneId=…` 같은 것을 붙이면 거부되고 루트로 튕긴다.
쿼리가 필요하면 두 단계로 간다 — 먼저 경로만으로 들어가 쿠키를 심고, 그 다음 전체 주소로 이동한다.

## Before / After 를 같은 조건으로 얻는 방법

Before 는 `origin/main` 을 체크아웃한 worktree, After 는 작업 worktree에서 각각 서버를 띄우고
**같은 스크립트로** 찍는다. 조건(URL·페르소나·viewport·locale·timezone·합성 데이터)을 코드가 강제하므로
사람이 매번 맞추지 않아도 된다.

Playwright 는 이미 저장소에 있다(`apps/frontend` devDependency). CommonJS 라 ESM 에서는
default import 로 받는다.

```js
import pw from '<repo>/apps/frontend/node_modules/@playwright/test/index.js';
const { chromium } = pw;
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },   // 그리고 390x844 를 한 번 더
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',                  // 마감·D-day 표시가 이 값에 걸린다
});
```

파일명은 `<이슈번호>-<before|after>-<element|desktop|mobile>-<무엇>.png` 로 둔다.
release 에셋은 저장소 전역 네임스페이스라 이슈 번호가 앞에 없으면 서로 덮어쓴다.

### 요소 캡처가 빈 화면으로 나올 때

- 스크롤 컨테이너가 `main` 이 아닐 수 있다. 이 저장소의 일부 화면은 `main` 태그 자체가 없다.
  텍스트로 앵커를 잡고 그 조상 요소를 찍는 편이 안정적이다.
- 재제출 폼처럼 포털(dialog)로 열리는 것은 `main.innerText` 에 잡히지 않는다. `form` 을 직접 잡는다.
- `getByRole('button', { name: '…' })` 이 0건을 내는데 화면에는 보이는 경우가 있다.
  접근성 이름이 보이는 글자와 다를 때다. `locator('button:has-text("…")')` 로 바꾼다.

### 같은 이름의 버튼이 여럿일 때

마감이 지난 것과 남은 것이 같은 이름으로 나란히 있는 화면이 있다.
첫 번째를 집으면 비활성이라 클릭이 30초 타임아웃으로 죽는다. **눌리는 것을 골라야 한다.**

```js
const all = page.locator('button:has-text("수정")');
for (let i = 0; i < await all.count(); i++) {
  const b = all.nth(i);
  if (await b.isDisabled()) continue;
  await b.scrollIntoViewIfNeeded(); await b.click(); break;
}
```

## 상태가 fixture 에 없으면 캡처를 찍을 수 없다 — 그리고 그 자체가 신호다

이번 회차에서 세 번 막혔다. 내린 프로그램이 없어서, 마감이 남은 보완 요청 서류가 없어서,
빈 상태 세 갈래를 만들 데이터가 없어서.

**아무도 눈으로 확인할 수 없는 상태는 조용히 낡는다.** 그래서 fixture 를 채우는 것은 증거 게이트의
일부다. 이 저장소는 이미 같은 이유로 페르소나를 늘려 왔다 — `local-review-runtime.ts` 의 주석들이
「이 페르소나가 없으면 …를 아무도 볼 수 없다」고 적고 있다.

fixture 를 채우다 보면 결함이 딸려 나온다. 실제로 그랬다 —
「내린 프로그램」 fixture 를 넣으려다 프런트 타입이 게시 축을 선택 필드로 두고 「없으면 PUBLISHED 로
본다」는 조용한 fallback 을 갖고 있는 것을 발견했다. 값이 실려 오지 않으면 고치려던 결함이 그대로
돌아오는 자리였고, **캡처를 찍지 않았으면 통과했을 것이다.**

시간이 걸린 fixture 는 상대 시간으로 잡는다. 고정된 미래 날짜를 박으면 그 날짜가 지나는 순간
그 fixture 는 쓸모없어지고, 아무도 그 사실을 눈치채지 못한다.

## 빈 상태·오류 상태를 실제로 만들어 보기

빈 화면이 여러 갈래로 갈렸다면 **갈래마다 다른 문구가 나오는 것을 실제로 확인해야 한다.**
같은 데이터에서 세 번 찍으면 세 장이 똑같이 나오고, 그것을 「세 갈래를 만들었다」의 증거로
착각하기 쉽다.

- 「아직 없음」 — 정말로 0건인 대상을 쓴다.
- 「조건에 맞는 것 없음」 — **데이터가 있는 대상**에서 검색·필터로 0건을 만든다.
- 「불러오지 못함」 — 그 요청만 끊는다. `page.route('**/…**', r => r.abort('failed'))`.

## 자동 점검 4종의 거짓 양성

`ux-antipatterns.md` 의 콘솔 스니펫은 DOM 을 세므로, 반응형 때문에 두 벌 있는 내비게이션이나
달력이 주차 행마다 그리는 기간 라벨을 중복으로 잡는다.

숨긴 탭에서는 `offsetParent`·`getBoundingClientRect` 가 전부 0 이라 가시성 판정이 무너진다.
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

본문에 백틱이 들어가는데 셸에서 따옴표 없는 heredoc 을 쓰면 **셸이 명령으로 실행해 그 자리가
빈칸이 된다.** 실제로 `deletionProtected` 와 `allow={['staff']}` 가 통째로 사라진 채 발행된 적이 있다.

```bash
cat > /tmp/pr.md <<'MDEOF'      # 따옴표가 핵심이다
… 본문 …
MDEOF
gh pr create --body-file /tmp/pr.md
```

주소처럼 값을 넣어야 하는 곳은 자리표시자를 두고 `sed` 로 치환한다.
발행한 뒤 `gh pr view <번호> --json body` 로 본문을 다시 읽어 빠진 자리가 없는지 확인한다.
