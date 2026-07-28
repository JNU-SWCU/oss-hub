# design-sync NOTES — oss-hub

claude.ai/design 프로젝트: `227d994e-82c0-4077-be29-8433717f6692` ("Design System")

## 이 repo의 특수 사정 — 왜 설정이 이렇게 생겼나

이 repo는 **디자인 시스템 라이브러리가 아니라 Next 앱**이다(`apps/frontend`).
published `dist/`도 `.d.ts` 트리도 Storybook도 없다. 그래서 converter의 기본 경로가
거의 다 빗나가고, 아래 4개를 직접 만들어 준다.

### 1. `node_modules/frontend` self-link (매 clone·매 `pnpm install` 후 재생성)

converter는 `--node-modules/<pkg>`로 패키지 디렉터리를 찾는다. 자기 자신은 설치되지
않으므로 심링크가 없으면 `ENOENT … node_modules/frontend/package.json`으로 죽는다.

```sh
ln -sfn ../../frontend apps/frontend/node_modules/frontend
```

`pnpm install`이 node_modules를 정리하면 사라진다 — **re-sync 전에 항상 확인**.

### 2. `.design-sync/emit-types.mjs` — prop 계약 생성 (빌드 전 필수)

이걸 건너뛰면 45개 컴포넌트 전부 `.d.ts`가 `[key: string]: unknown`으로 나온다.
그 파일이 design agent가 코딩하는 **API 계약**이므로 전 컴포넌트를 오용하게 된다 —
조용히 망하는 종류의 실패다. 두 산출물 모두 gitignore 대상:

- `apps/frontend/ds-types/**` — tsc 선언 emit. **디렉터리 이름에 점을 쓰면 안 된다**
  (converter의 glob이 `dot:false`라 `.ds-types`는 통째로 무시된다 — 실제로 한 번 밟았다).
- `apps/frontend/index.d.ts` — 진입 모듈. 이게 없으면 `React.ComponentProps<'button'> &
  VariantProps<…>`처럼 named interface가 아닌 inline props가 해석되지 않아
  Button·StatusBadge 등 shadcn 계열이 전부 빈 계약이 된다.

`FieldLabel`만 여전히 추출 실패(`ComponentProps<typeof Label>` → Radix cross-package)라
`cfg.dtsPropsFor`로 손으로 적었다. shadcn ui를 추가하면 같은 패턴을 의심할 것.

### 3. `.design-sync/compile-css.mjs` — Tailwind v4 컴파일 (빌드 전 필수)

converter의 `styles.css`는 `@import` 목록일 뿐 CSS를 컴파일하지 않는다. 이 repo는
Tailwind v4 css-first(`@import 'tailwindcss'`, config 파일 없음)라서 `globals.css`를
그대로 주면 유틸리티가 하나도 없는 원본이 올라간다. 앱과 **동일한 버전**의
`@tailwindcss/postcss`(apps/frontend/node_modules)로 컴파일한다.

- 입력: `.design-sync/css/ds-entry.css` (committed) → 출력: `apps/frontend/.ds-css/ds-compiled.css` (gitignored)
- `@source '../../apps/frontend/src'`만으로는 스캔 범위가 좁혀지지 **않는다** — v4에서
  bare `@source`는 자동 탐지에 소스를 **추가**할 뿐 대체하지 않는다. 자동 탐지는 켜진
  채로 남아 git repo root를 기준으로 gitignore 안 된 전체(`.design-sync/`, `docs/`,
  `apps/backend/` 포함)를 훑는다. 그래서 `ds-entry.css`의 tailwindcss import에
  `source(none)`을 걸어 자동 탐지를 꺼야 `@source`가 유일한 소스가 된다:
  ```css
  @import '../../apps/frontend/node_modules/tailwindcss/index.css' source(none);
  @import '../../apps/frontend/src/app/globals.css';
  @source '../../apps/frontend/src';
  ```
  경로 형태가 중요하다 — 패키지가 repo root가 아니라 `apps/frontend/node_modules`에
  있어서 bare `@import 'tailwindcss' source(none)`은 `.design-sync/css/`에서
  resolve되지 않는다. `source(none)`을 빠뜨리면 이 절 전체가 무효화된다는 뜻이므로,
  `ds-entry.css`를 고칠 때 가장 먼저 지켜야 할 줄이다.

#### 스캔 범위 사고 — 문서가 자기 자신을 존재하게 만들었다

nonce probe로 확인했다: `.design-sync/`에 `gap-72 text-7xl rounded-3xl`을 담은
버림용 md 파일을, `docs/`에 `py-96`을 담은 파일을 하나씩 써넣고 재컴파일하니 **넷 다**
`apps/frontend/.ds-css/ds-compiled.css`에 나타났다. 둘 다 `@source`에 없는 디렉터리다.
probe는 확인 후 삭제했다.

`conventions.md`는 클래스 이름을 예시로 나열하는 산문 문서이고, 그중 일부는 "존재하지
않는다"고 명시하며 든 예(`gap-72`, `text-7xl`, `rounded-2xl`/`3xl`/`4xl`, `rounded-sm`,
`text-5xl`, `bg-[#003399]`)였다. 그 문서가 스캔 범위 안에 있었기 때문에, **"존재하지
않는다"고 적은 문서 자체가 그 클래스들을 컴파일해 존재하게 만들었다.** `w-64`도
마찬가지였다 — 아래 "조용히 썩는 것들"의 사라짐 사건 이후, `.design-sync/previews/Card.tsx`에
그 사건을 설명하려고 남긴 **주석**에서 `w-64`라는 문자열을 다시 주웠고, 재컴파일 때
`.w-64`가 조용히 되살아났다. 컴파일된 스타일시트가 스스로를 문서화하며 자기 자신을
만들어내고 있었던 셈이다.

`source(none)` 수정 후 측정치: 컴파일된 CSS 73,350 → 70,681 bytes, 유틸리티 셀렉터
571 → 543개(28개 제거, **0개 추가**). 제거된 28개 중 `apps/frontend/src`가 실제로 쓰는
것은 **0개**다. `items-stretch`·`text-5xl`은 처음엔 실손실처럼 보였지만 아니었다 —
앱 소스에는 `md:items-stretch`(`_shell/role-panel-shell.tsx`,
`features/milestone-timeline/components/milestone-timeline-view.tsx`)와
`sm:text-5xl`(`features/landing/components/landing-hero.tsx`) 형태로만 있고, 그 variant
형태는 컴파일 결과에 그대로 남아 있다 — bare 셀렉터만 phantom이었다. `ring-2`·
`ring-primary`·`border-ring`은 앱 소스에 독립 토큰으로 아예 없다 — `conventions.md`가
`ring-2 ring-primary`를 실재 패턴으로 인용했음에도 phantom이었다. 유지 확인: `min-w-64`,
`bg-primary`, `rounded-lg`, `text-xs`, `flex`, `sm:text-5xl`, `md:items-stretch`.

**재검증 레시피(1분 내)**: `.design-sync/`와 `docs/`처럼 `@source` 밖의 디렉터리에
버림용 md 파일을 만들어 앱 소스에 없는 임의 클래스 문자열(예: `gap-72`)을 담고,
`compile-css.mjs`를 돌려 그 클래스가 `ds-compiled.css`에 나타나는지 본다. 나타나면
`source(none)`이 빠졌거나 깨진 것이다. 끝나면 probe 파일을 지운다.

### 4. 폰트 — next/font 대체

앱은 `next/font/google`로 Geist를 self-host하고 `--font-sans`를 `<html>`에 주입한다.
design 번들에는 Next가 없어 `globals.css`의 `@theme inline { --font-sans: var(--font-sans) }`가
**순환 참조**로 남아 폰트가 죽는다. `ds-entry.css` 끝에서 Geist를 원격 로드하고
`--font-sans`를 실제 스택으로 재정의해 끊는다(cascade상 뒤에 와야 이긴다 — 확인함).

`.next/`에 woff2가 없어 self-host할 파일이 없다. 원격 `@import`라 converter는
`[FONT_REMOTE]`(informational)로 처리한다.

## 빌드 순서 (순서 지킬 것)

```sh
ln -sfn ../../frontend apps/frontend/node_modules/frontend   # 1. self-link
node .design-sync/emit-types.mjs                              # 2. prop 계약
node .design-sync/compile-css.mjs                             # 3. Tailwind 컴파일
node .ds-sync/package-build.mjs --config .design-sync/config.json \
  --node-modules apps/frontend/node_modules --out ./ds-bundle  # 4. converter
```

`--entry`는 쓰지 않는다(dist 없음 → src 45개 synth). `srcDir: src/components`로
범위를 좁혀 features/·app/이 컴포넌트로 잡히지 않게 한다.

### 도구별 인자 — 셋이 서로 다르다, 한 번씩 다 틀렸다

```sh
node .ds-sync/package-validate.mjs ./ds-bundle          # out-dir은 위치 인자. --out 없다
node .ds-sync/package-capture.mjs --out ./ds-bundle [--components A,B]   # --config 안 받는다
node .ds-sync/lib/preview-rebuild.mjs --config .design-sync/config.json \
  --node-modules apps/frontend/node_modules --out ./ds-bundle --components A,B   # --node-modules 필수
```

### 프리뷰 포맷은 캡처·채점보다 **먼저** 한다

`lib/sync-hashes.mjs`의 `sourceKeyFor()`는 `.design-sync/previews/<Name>.tsx`의
**원본 바이트를 그대로 해싱**한다(`hashFile(h, …, 'owned')`). 그래서 prettier가 공백만
바꿔도 grade key가 달라지고 **채점이 전부 무효화된다**. 이번 회차에 이 순서를 틀려서
8개 컴포넌트를 재채점했다.

`.design-sync/previews/`는 gitignore 대상이 **아니다**(커밋되는 손글씨 소스다).
따라서 repo의 `format:check`에 걸린다. `.prettierignore`에 넣어 회피하지 말 것 —
도구 산출물이 아니라 사람이 쓴 소스라 포맷터에서 빼면 하우스 스타일 밖으로 표류한다.

**올바른 순서**: 프리뷰 작성 → `prettier --write '.design-sync/previews/*.tsx'` →
rebuild → capture → 채점.

### 프리뷰에 사람 이름을 쓸 때

이 repo는 PUBLIC이고 AGENTS.md 4절이 실명 반입을 금지한다. 프리뷰는 커밋될 뿐
아니라 디자인 프로젝트로 업로드되므로 더 노출된다. **가공 인물임이 자명한 이름만
쓴다** — repo의 확립된 플레이스홀더는 `홍길동`이다(fixtures·테스트 16곳). 평범한
실명형 이름(예: 흔한 성+두 글자 조합)은 실제 교직원처럼 읽히므로 쓰지 않는다.

## 컴포넌트 45개의 정체

`src/components`의 파일은 20개지만 export는 45개다 — shadcn 복합 컴포넌트의 파트
(`CardHeader`, `TableRow`, `FieldSet` 등)가 각각 독립 export이기 때문이다.
과다 추출이 아니라 정상이며, design agent가 카드를 조합하려면 전부 필요하다.

## 환경

- `packageManager: pnpm@11.0.0`, `engines.node >= 24`. 로컬은 **node v24.14.1**로
  올라와 engines를 만족한다(이전 기록의 v22.22.3은 낡았다). `.nvmrc`가 없어
  버전이 표류할 수 있으니 re-sync 전에 `node -v`를 확인할 것 —
  `export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$PATH"`.
- playwright chromium 캐시는 macOS에서 `~/Library/Caches/ms-playwright`다
  (`~/.cache/ms-playwright`가 아니다 — 없다고 오판해서 불필요한 확인을 한 적 있음).
  이미 여러 빌드가 캐시돼 있으니 re-sync 때 재설치 전에 먼저 볼 것.

## Re-sync 위험 — 조용히 썩는 것들

- **self-link와 두 생성 스크립트 산출물은 전부 gitignored**다. 새 clone/`pnpm install`
  후에는 "빌드 순서" 4단계를 처음부터 다시 밟아야 한다. 하나라도 빠뜨리면 빌드가
  죽지 않고 **품질만 조용히 떨어진다**(빈 prop 계약, 유틸리티 없는 CSS) — 가장 위험한 실패 모드.
- **Geist를 원격에서 받는다.** 폰트 호스트가 막히거나 Geist가 사라지면 모든 카드가
  fallback 폰트로 렌더된다. 앱은 self-host라 이 차이를 앱에서는 못 잡는다.
- **`globals.css`가 바뀌면 CSS 재컴파일이 필요하다.** converter는 이 의존성을 모른다 —
  `cssEntry`는 컴파일 산출물만 가리키므로 `globals.css`만 고치고 재빌드하면 헌 CSS가 올라간다.
- **정적 Tailwind 빌드의 한계** — 추상적 경고가 아니라 **실제로 밟았다**. 컴파일된
  CSS는 `apps/frontend/src`에서 **실제로 발견된** 유틸리티만 담는다. 프리뷰 작성 중
  `Card.tsx`가 카드 두 장을 나란히 놓으려고 `className="w-64"`를 썼는데, `w-64`는 앱
  소스 어디에도 없어서 `.w-64` 규칙이 컴파일되지 않았고 **에러 하나 없이 조용히
  무시됐다**. 폭 지정이 사라지자 flex-wrap 컨테이너에서 짧은 카드가 최소 콘텐츠 폭까지
  줄어들어 긴 한글 문장이 한 글자씩 줄바꿈됐다. 시트를 눈으로 봤기 때문에 잡혔다.
  해결은 실제 화면(`role-selection-screen.tsx`)이 쓰는 `grid gap-3 sm:grid-cols-2`로
  바꾸는 것 — 즉 **앱에 이미 존재하는 클래스만 쓴다**. conventions.md에 실제 클래스
  어휘를 적어두는 것이 유일한 방어다. (후일담: 이 사건을 설명하려고 `Card.tsx`에 남긴
  주석 속 `w-64` 문자열이 스캔 범위 사고로 나중에 다시 컴파일됐다 — 3절 "스캔 범위
  사고" 참고. `source(none)` 수정 후 지금은 `w-64`가 컴파일된 CSS에 없다.)
- **`max-w-*`를 `<td>`(`TableCell`)에 직접 걸면 열 폭이 제한되지 않는다.** 테이블이
  기본 `table-layout: auto`라 브라우저가 셀의 `max-width`를 열 폭 계산에서 사실상
  무시한다. 긴 텍스트가 줄바꿈되지 않고 열만 넓어진다. 셀 안에 블록 요소를 하나 넣고
  거기에 건다: `<TableCell><div className="max-w-sm whitespace-normal">…</div></TableCell>`.
  `admin-users-view.tsx`가 이미 쓰는 패턴이다.

## 실사용처가 없는 export — 프리뷰에서 지어내지 않았다

`.d.ts`에는 있지만 `apps/frontend/src` 어디에서도 호출되지 않아 포팅할 원본이 없는
것들이다. 셋 다 grep으로 확인했다. 프리뷰를 지어내는 대신 비워뒀다 — 나중에 채우려면
실제 화면이 생기거나 "계약만 보고 조합해도 좋다"는 명시적 승인이 필요하다.

- `FieldSeparator`, `FieldContent`, `FieldTitle` — `ui/field.tsx`의 export지만 소비처 0.
  (`FieldSet`/`FieldLegend`/`FieldGroup`은 실사용처가 있어 프리뷰에 들어갔다.)
- `AlertAction` — `ui/alert.tsx`의 export지만 소비처 0.
- `Label`·`Separator`는 **단독** 사용처가 0이다(전부 `FieldLabel`/`FieldSeparator` 경유).
  프리뷰는 있되, 실제 호출처에서 검증된 문구를 원시 컴포넌트에 그대로 붙이는 방식으로
  작성했다.
- `AppShell`도 실제 라우트에서 쓰이지 않는다(자기 스모크 테스트뿐). 프리뷰는
  `app/layout.tsx`의 NavBar 배선 + 실제 목록/대시보드 화면 조각을 조합한 것이라, 이
  20개 중 "포팅"에서 가장 먼 케이스다.

## cardMode 오버라이드 — 추측하지 말고 validate 출력에서 받을 것

현재 `cfg.overrides`에 있는 것은 `AppShell: {cardMode: "column"}` **하나뿐**이고,
`package-validate.mjs`가 직접 지시한 값이다:

```
! [GRID_OVERFLOW] components/general/AppShell/AppShell.html: stories render wider
  than their grid cells (Default) — Merge into cfg.overrides.AppShell: {"cardMode": "column"}
```

`h-dvh`/`min-h-dvh`를 루트로 쓰는 전체 페이지 레이아웃이 후보군인 건 맞지만,
**눈대중 후보와 실제 플래그는 달랐다.** 프리뷰 작성 중 육안으로 올라온 후보는
`DataTable`(~740px), `Table`(~640-740px), `StatusMessagePage`였는데 validate에서는
셋 다 플래그되지 않았고, 반대로 `AppShell`은 후보로 지목된 `LongNotice`가 아니라
`Default`에서 걸렸다. 미리 넣었으면 근거 없는 오버라이드 3개가 박혔을 것이다.

**절차**: 전체 빌드 → `package-validate.mjs ./ds-bundle`(경로는 위치 인자다,
`--out` 아니다) → `[GRID_OVERFLOW]`가 지목한 컴포넌트만 `cfg.overrides`에 병합 →
플래그된 것 전부를 한 번의 `preview-rebuild.mjs --components A,B,...`로 재빌드.
채점은 carry forward되고 재-validate는 필요 없다(column 카드는 구조상 다시
wide로 플래그될 수 없다).

## 프리뷰 작성 관례

- **아이콘은 인라인 `<svg>`를 직접 쓴다.** `lucide-react`를 import하지 않는다 —
  번들 환경에서 검증되지 않은 의존성이고, `Button.tsx`가 이미 인라인 `PlusIcon`으로
  선례를 만들었다. 실제 화면이 lucide 아이콘을 쓰더라도 프리뷰에서는 생략하거나
  인라인으로 대체한다.
- **Radix 팝오버/포털 계열은 정적 캡처 범위 밖이다.** `role-select.tsx`의 `Select`가
  그 예 — 트리거만 찍히고 열린 상태는 담기지 않는다. 근사치를 지어내지 말 것.
## `next/*` 클라이언트 모듈은 이 번들에서 실행 불가 — 실험으로 확인함

`NavBar`는 `linkComponent`가 optional이고 기본값이 순수 `<a>`다. 앱은
`app/layout.tsx`의 `ShellNav`에서 `next/link`의 `Link`를 주입하지만, **디자인
번들에 그 주입을 재현하려 하면 안 된다.** 실제로 프리뷰에서
`linkComponent={Link}`를 넣고 캡처해본 결과:

```
✗ [CAPTURE] NavBar: ReferenceError: process is not defined
package-capture: 1 component(s) — 0 captured cells, 1 with errors
```

`next/link`의 클라이언트 모듈이 **모듈 스코프에서** `process.env`를 읽는데
브라우저 번들에는 그 글로벌이 없다. 라우터 컨텍스트 문제(`usePathname` 등)보다
더 아래 층위라 셀 하나가 아니라 **컴포넌트 캡처 전체가 죽는다**(0 cells).

`process` shim을 번들 런타임에 넣으면 통과하지만 그러지 않았다 — 라우터가 없는
환경에서 `<a>`로 렌더되는 것이 `NavBar`의 **설계된 정상 동작**이고, 라우터 주입은
앱의 책임이기 때문이다. 고칠 결함이 아니라 범위의 경계다.

**규칙: 프리뷰에서 `next/link`·`next/navigation` 등 `next/*` 클라이언트 모듈을
import하지 않는다.** 라우터 연동 동작을 보여줘야 할 일이 생기면 shim을 넣기 전에
"그게 정말 디자인 시스템 카드가 보여줄 것인가"부터 다시 물을 것.
