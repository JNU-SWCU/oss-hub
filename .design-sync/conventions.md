# oss-hub 디자인 시스템 — 사용 관례

이 문서는 claude.ai/design에 올라간 이 번들로 **새 화면을 조합하는 디자인 에이전트**를
위한 것이다. `.d.ts` prop 계약과 프리뷰 캡처는 이미 갖고 있다는 전제로, 계약만 봐서는
알 수 없는 것 — 실제로 쓸 수 있는 Tailwind 클래스, 컴포넌트를 실제로 조합하는 방법,
그리고 조용히 깨지는 지점 — 을 적는다.

## 0. 가장 먼저 알아야 할 것 — 이 스타일시트는 정적으로 컴파일됐다

이 번들의 CSS는 Tailwind v4를 **`apps/frontend/src`를 스캔해 정적으로 컴파일한
결과물**이다(`apps/frontend/.ds-css/ds-compiled.css`). 실행 중 클래스를 생성하는
JIT 서버가 붙어있는 게 아니다 — 이 문서 §2에 없는 클래스(`gap-72`, `text-7xl` 같은
것)를 새로 쓰면 **에러 없이 조용히 무시**된다. 실제로 이번 작업에서 카드에
`w-64`를 썼다가 폭 선언이 통째로 사라져, 카드가 최소 콘텐츠 폭까지 줄어들고 긴 한글
문장이 한 글자씩 줄바꿈되는 사고가 있었다.

**규칙: §2에 없는 클래스는 존재하지 않는다고 가정한다.** 필요한 값이 없으면 값을
지어내지 말고, §3의 조합 패턴 중 이미 화면에 쓰이는 레이아웃(예: 고정 폭 대신
`grid sm:grid-cols-2`)으로 대체한다.

## 1. 색상 — primitive/semantic 2계층, `--palette-*`를 직접 쓰지 않는다

`apps/frontend/src/app/globals.css`가 토큰을 두 계층으로 나눈다.

- **primitive** (`--palette-navy-*`, `--palette-green-*`, `--palette-gray-*`,
  `--palette-amber-*`, `--palette-red-*`, `--palette-white`, `--palette-black`) —
  의미 없는 원시 색상 램프. **컴포넌트에서 직접 참조하지 않는다.**
- **semantic** (`--background`, `--foreground`, `--card`, `--popover`, `--primary`,
  `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`,
  `--ring`, 그리고 도메인 상태 그룹 `--status-recruiting-*` / `--status-closed-*` /
  `--status-pending-*` / `--status-approved-*` / `--status-rejected-*`) — 실제로
  `bg-background`, `text-muted-foreground`, `border-border`, `bg-status-approved-bg`
  처럼 유틸리티 클래스로 소비하는 계층. **항상 이 계층으로 조합한다.**

primitive를 직접 쓰거나(`bg-[#003399]`) 리터럴 hex를 새로 쓰지 않는다 — 라이트/다크
전환과 아래 반전 표면 메커니즘이 전부 semantic 계층 재정의로 동작하기 때문에,
primitive를 직접 참조하면 그 전환에서 빠진다.

### 반전 표면(`data-surface`) — 히어로/CTA처럼 어두운 배경 위에 얹을 때

`[data-surface='inverted']`를 감싸는 요소에 붙이면 그 스코프 안의 semantic 토큰이
어두운 배경 기준으로 재정의된다(`--background: transparent`, `--foreground`가
`--hero-foreground`로, `--destructive`가 대비 검증된 `--hero-danger`로 바뀌는 식 —
일반 `--destructive`는 어두운 히어로 배경 위에서 AA 대비를 만족하지 못한다).
그 안에 흰 배경 패널(계정 메뉴 등)을 다시 얹어야 하면 그 패널에
`[data-surface='default']`를 붙인다 — `[data-surface='inverted'] [data-surface='default']`
셀렉터가 원래 밝은 값으로 되돌린다. 이 메커니즘은 히어로/클로징 CTA 전용이며,
일반 화면 본문에서는 쓰지 않는다.

## 2. 실제로 쓸 수 있는 Tailwind 클래스 어휘

`apps/frontend/.ds-css/ds-compiled.css`(컴파일 산출물 — 실제 출하되는 파일)를
직접 파싱해 **540개** 클래스 선택자를 추출하고, `apps/frontend/src`의
실사용처와 교차 검증한 결과다. **여기 없는 값은 쓰지 않는다.**

이 540은 "화면 조립에 바로 쓸 수 있는 형태의 셀렉터" 기준이다 — CSS 안의
모든 클래스 셀렉터를 센 게 아니라, `data-[...]:` `aria-*:` `group-*:`
`peer-*:` `has-*:` 같은 컴포넌트 내부 상태 조합(버튼/체크박스 등의 cva
variant가 만들어내는 선택자)은 뺐다. 이런 조합은 CSS에는 실재하지만
컴포넌트 구현 세부사항이지 새 화면에서 조립해 쓰는 어휘가 아니다. 반응형
프리픽스(`sm:` 등)와 `motion-reduce:`는 포함한다. 재현 방법(레포 루트에서
실행):

```python
import re
css = open('apps/frontend/.ds-css/ds-compiled.css').read()
classes = set()
for chunk in re.findall(r'([^{}]+)\{', css):
    chunk = chunk.strip()
    if not chunk or chunk.startswith('@'):
        continue
    parts, depth, cur = [], 0, ''
    for ch in chunk:
        if ch == '(': depth += 1
        elif ch == ')': depth -= 1
        if ch == ',' and depth == 0:
            parts.append(cur); cur = ''
        else:
            cur += ch
    parts.append(cur)
    for part in parts:
        for m in re.finditer(r'\.((?:\\.|[A-Za-z0-9_-])+)', part):
            classes.add(re.sub(r'\\(.)', r'\1', m.group(1)))

def is_internal(tok):
    if tok in ('group', 'peer', 'dark'):
        return True
    pre = ('group-', 'peer-', 'has-', 'in-', 'not-', 'aria-', 'data-')
    return any(p.startswith(pre) for p in tok.split(':')[:-1])

vocab = {t for t in classes if not is_internal(t)}
print(len(classes), len(vocab))  # 623 540
```

이 스타일시트는 Tailwind v4 소스 스캔이 `apps/frontend/src` 한 곳으로 고정된
뒤 컴파일된다 — 이 문서나 프리뷰 파일은 스캔 대상이 아니다(정확한 기전과
이 고정을 절대 걷어내면 안 되는 이유는 §4 참고). 그래서 아래 목록에 없는
클래스는 "쓰면 안 되는 것"이 아니라 **앱이 지금까지 한 번도 쓴 적이 없다는
뜻**이다. 필요한데 목록에 없으면 값을 지어내지 말고 §3의 조합 패턴으로
대체한다.

### 레이아웃 / display
`block` `inline-flex` `hidden` `grid` `table` `table-cell` `table-row`
`table-caption` `table-fixed` `collapse` `relative` `absolute` `fixed`
`sticky` `isolate`

`inline`(비반응형 없음 — `sm:inline`/`md:inline`으로만 존재) `contents`
`static` `visible` `container`는 컴파일돼 있지 않다. `contents`·`static`·
`visible`은 반사적으로 손이 가는 유틸리티라 없다는 점을 따로 적어둔다 —
`inline-flex`에 `inline`이라는 글자가 포함돼 있다고 `inline` 단독형까지
있다고 착각하지 않는다.

### flex
`flex` `flex-1` `flex-col` `flex-row` `flex-wrap` `flex-nowrap` `shrink-0`
`self-start` `self-end` `items-start` `items-center` `items-baseline`
`justify-center` `justify-end` `justify-between` `justify-items-center`
`justify-self-end` `place-items-center`

`shrink`(비반응형 없음, `shrink-0`만 존재) `items-stretch`(비반응형 없음,
`md:items-stretch`로만 존재) `justify-start`(반응형 포함 어디에도 없음)는
컴파일돼 있지 않다 — `shrink-0`이 `shrink`라는 글자를 포함한다고 해서
`shrink` 단독형이 있는 건 아니다.

### grid
`grid-cols-3`만 비반응형으로 존재. 컬럼 수는 대부분 반응형 프리픽스와 함께 온다 —
`sm:grid-cols-2` `md:grid-cols-2` `lg:grid-cols-2` `lg:grid-cols-3` `lg:grid-cols-4`
`xl:grid-cols-4` `xl:grid-cols-5`. 그 외 `col-start-2` `sm:col-span-2` `row-span-2`
`row-start-1` `row-start-2` `row-start-3` `auto-rows-min`.
CardGrid(§3)처럼 컬럼 수를 아예 쓰지 않는 `auto-fit`/`minmax` 패턴이 이 repo의
기본 그리드 카드 목록 방식이니, 새 카드 그리드가 필요하면 grid-cols 숫자를 고르기
전에 CardGrid 재사용을 먼저 고려한다.

### gap (spacing 스케일의 일부만 컴파일됨 — 정확히 이 값만)
`gap-0` `gap-0.5` `gap-1` `gap-1.5` `gap-2` `gap-2.5` `gap-3` `gap-4` `gap-5`
`gap-6` `gap-8` / 축 지정: `gap-x-1` `gap-x-2` `gap-x-6` `gap-y-1` `gap-y-2` /
반응형: `sm:gap-1` `sm:gap-2` `sm:gap-x-4` `lg:gap-0.5`

### padding (정확히 이 값만 — 스케일 전체가 아니다)
- `p-0` `p-1` `p-2` `p-3` `p-4` `p-5` `p-6` `p-7`
- `px-1` `px-2` `px-2.5` `px-3` `px-3.5` `px-4` `px-8`
- `py-0.5` `py-1` `py-1.5` `py-2` `py-3` `py-4` `py-6` `py-7` `py-8` `py-12`
  `py-20` `py-24`(`py-22`는 없다 — `py-20`과 `py-24` 사이가 빈 구간이다)
- `pt-1` `pt-2` `pt-4` `pt-5` `pt-6` / `pb-4` / `pl-2` `pl-4` / `pr-8` `pr-20`
- 반응형: `sm:p-6` `sm:p-8` `sm:px-2.5` `sm:px-4` `sm:px-6` `sm:py-0` `md:p-6`
  `lg:p-8` `lg:px-8` `lg:py-24` `lg:py-28`

### margin
`mx-auto` / `mb-1.5` `mb-2` / `ml-2` `ml-4` / `-my-2` /
`mt-0.5` `mt-1` `mt-2` `mt-2.5` `mt-4` `mt-5` `mt-6` `mt-10` `mt-12`

### 폭(width) — 여기가 §0의 사고가 난 축이니 특히 주의
- 정확히 존재: `w-1/3` `w-4/5` `w-8` `w-12` `w-24` `w-32` `w-36` `w-56` `w-fit`
  `w-full` `w-px`
- `min-w-0` `min-w-28` `min-w-32` `min-w-40` `min-w-48` `min-w-64`
- `max-w-28` `max-w-48` `max-w-sm` `max-w-md` `max-w-xl` `max-w-2xl` `max-w-3xl`
  `max-w-4xl` `max-w-5xl` `max-w-6xl` `max-w-7xl` `max-w-full`
- 반응형: `sm:max-w-sm` `lg:min-w-40` `md:w-full`
- **`w-64`(고정폭 256px)는 존재하지 않는다.** 컴파일된 CSS에 `.w-64` 규칙이 없다
  — §0에서 설명한 사고가 바로 이 값을 쓰다 난 것이다. 카드를 나란히 고정폭으로
  놓고 싶으면 `w-64` 대신 실제로 검증된 `min-w-64`(표 헤더/셀에서 실사용,
  `apps/frontend/src/features/audit-log/audit-log-view.tsx`) 또는 §3의
  `grid gap-3 sm:grid-cols-2` 패턴을 쓴다.

### 높이(height) / 정사각 사이즈 — 불연속 스케일, 정확히 이 값만
`h-2` `h-3` `h-4` `h-5` `h-6` `h-7` `h-8` `h-9` `h-10` `h-11` `h-12` `h-16`
`h-20` `h-24` `h-28` `h-36` `h-40` `h-44` `h-48` `h-52` `h-56` `h-64` `h-72`
`h-80` `h-full` `h-dvh` / `min-h-0` `min-h-10` `min-h-11` `min-h-14` `min-h-24`
`min-h-28` `min-h-32` `min-h-48` `min-h-64` `min-h-72` `min-h-80` `min-h-dvh` /
아이콘·아바타류 정사각형은 `size-*`로: `size-1.5` `size-2` `size-2.5` `size-4`
`size-5` `size-6` `size-7` `size-8` `size-9` `size-10` `size-12` / 반응형:
`sm:h-14` `md:h-px`

### 타이포그래피
- 크기: `text-xs` `text-sm` `text-base` `text-lg` `text-xl` `text-2xl` `text-3xl`
  `text-4xl` (반응형 전용으로 `sm:text-3xl` `sm:text-5xl`도 존재 — 비반응형
  `text-5xl` 이상은 없다)
- 굵기: `font-normal` `font-medium` `font-semibold` `font-bold` `font-extrabold`
- 서체: `font-sans`(본문) `font-heading`(제목 — 카드/섹션 헤딩에 씀,
  `CardGrid.tsx` 프리뷰의 `font-heading text-lg font-semibold` 참고) `font-mono`
  (코드/저장소 경로 등)
- 줄간격: `leading-none` `leading-snug` `leading-normal` `leading-relaxed`
  `leading-6` / 자간: `tracking-tight` `tracking-wide`
- 정렬: `text-left` `text-center` `text-right`
- 줄바꿈 제어: `text-balance` `break-all` `break-keep` `break-words`
  `whitespace-normal` `whitespace-nowrap` `whitespace-pre-wrap` `truncate`
  `line-clamp-2` (반응형: `md:text-pretty` `md:text-sm`)
- 기타: `underline` `underline-offset-4` `list-disc` `list-none`
  `tabular-nums`(숫자 정렬용, 표의 정원/신청 인원 등) `sr-only` — `uppercase`는
  컴파일돼 있지 않다(대문자 표기가 필요하면 원문 텍스트 자체를 대문자로 쓴다)

### 색상 유틸리티(semantic 토큰 기반, §1 참고)
`bg-background` `bg-card` `bg-popover` `bg-primary` `bg-secondary` `bg-accent`
`bg-muted` `bg-border` `bg-transparent` `bg-status-{recruiting,closed,pending,approved,rejected}-bg` /
`text-foreground` `text-card-foreground` `text-popover-foreground` `text-primary`
`text-primary-foreground` `text-secondary-foreground` `text-muted-foreground`
`text-accent` `text-destructive` `text-status-{...}-fg` /
`border-border` `border-input` `border-primary` `border-transparent`
`border-status-approved-bg` `border-status-{approved,pending}-fg/40`(맨 클래스가
아니라 항상 `/40`과 함께 쓰인다) — `border-ring`은 컴파일돼 있지 않다
(`focus-visible:border-ring`이라는 포커스 상태 조합만 존재, 단독으로 쓸 수
있는 형태가 아니다) /
불투명도 슬래시 표기(`bg-primary/10`, `text-foreground/80`, `border-primary/30`
등)는 `/8 /10 /30 /40 /50 /55 /80 /85` 값이 관측됨 — 임의 값(`/37`)은 시도하지
않는다. 히어로 전용 토큰(`bg-hero-*`, `text-hero-*`, `border-hero-*`,
`from-hero-from` `via-hero-via` `to-hero-to`)은 §1의 반전 표면 스코프 안에서만
쓴다.

### 테두리 / 라운드
`border` `border-b` `border-t` `border-t-2` `border-l-2` `border-y`
`border-transparent` / **라운드는 불연속 스케일**: `rounded`(기본) `rounded-md`
`rounded-lg` `rounded-xl` `rounded-full` `rounded-t-xl` `rounded-b-xl`만
컴파일돼 있다. `globals.css`의 `@theme inline`은 `--radius-sm`부터
`--radius-4xl`까지 CSS 변수를 전부 정의하지만(§1), 그 변수를 소비하는 유틸리티
클래스(`rounded-sm`, `rounded-2xl`, `rounded-3xl`, `rounded-4xl`)는 실사용처가
없어 **컴파일되지 않았다** — 변수가 정의돼 있다고 유틸리티가 존재한다고
가정하지 않는다.

### 그림자 / 링
`shadow-xs` `shadow-md` `shadow-lg` / `ring-1` `ring-foreground/10`(카드
포커스/선택 강조)

`shadow`(기본값)와 `shadow-sm`은 컴파일돼 있지 않다 — 그림자가 필요하면
`shadow-xs`/`shadow-md`/`shadow-lg` 중 하나를 고른다. 맨 `ring-2`·`ring-primary`
단독형도 컴파일돼 있지 않다. 다만 `peer-checked:ring-2 peer-checked:ring-primary`
조합은 실제로 컴파일되고 정상 동작한다 — `StatusMessagePage`의 역할 선택 카드가
그 실사용 예다: 라디오 `input`에 `peer sr-only`를 주고, 형제로 오는 `Card`에
`peer-checked:ring-2 peer-checked:ring-primary`를 준다. 라디오/체크박스로 카드
선택 상태를 표시하고 싶으면 이 `peer`/`peer-checked:` 조합을 그대로 재사용하고,
`ring-2`·`ring-primary`를 단독으로 쓰지 않는다.

### 트랜지션 / 애니메이션
`transition` `transition-all` `transition-colors` `transition-none`
`transition-shadow` / `animate-pulse` `animate-spin`
`motion-reduce:animate-none`(로딩 스피너에 접근성 대응으로 짝지어 씀) / 그라디언트:
`bg-linear-to-b` `bg-clip-padding`(히어로 전용, §1 참고) — `bg-gradient-to-b`는
컴파일돼 있지 않다(Tailwind v4에서 그라디언트 유틸리티 이름이 `bg-linear-to-*`로
바뀌었다 — 구버전 이름을 새로 쓰지 않는다).

### 포지셔닝 / z-index
`absolute` `relative` `fixed` `sticky` `inset-0` `inset-x-0` `top-0`
`top-2` `top-1/2` `top-full` `right-0` `right-2` `right-4` `right-8` `bottom-4`
`bottom-6` `left-0` `left-1/2` `-translate-x-1/2` `-translate-y-1/2`
`z-10` `z-20` `z-40` `z-50`

`static`과 `transform`은 컴파일돼 있지 않다 — Tailwind v4는 `translate-x-*`
같은 개별 유틸리티가 이미 transform 레이어를 구성해 동작하므로 별도의
`transform` 유틸리티 없이 `-translate-x-1/2 -translate-y-1/2` 조합을 그대로
쓰면 된다.

### 오버플로 / 인터랙션
`overflow-hidden` `overflow-x-auto` `overflow-x-clip`(NavBar가 항목 많을 때 씀)
`overflow-y-auto` / `cursor-default` `cursor-pointer` `select-none` `outline`
`outline-none` `resize-y` `align-middle` `accent-primary`(라디오/체크박스 강조색)

### 반응형 프리픽스
`sm:` `md:` `lg:` `xl:` 만 관측됨(`2xl:`는 없다). 다크 모드는 클래스 프리픽스가
아니라 `.dark` 조상 클래스로 토글되며(`@custom-variant dark (&:is(.dark *))`,
`globals.css` 최상단), 컴포넌트가 개별적으로 `dark:` 유틸리티를 쓰는 대신 semantic
토큰 자체가 `.dark`에서 재정의된다 — 다크 대응이 필요하면 `dark:bg-...`를 새로
쓰지 말고 원래 있던 semantic 클래스를 그대로 두면 된다.

## 3. 컴포넌트 조합 패턴

프리뷰 20개(`.design-sync/previews/*.tsx`)에서 관찰한, 실제 화면을 그대로 옮긴
조합이다. 이 목록에 없는 조합이 필요하면 여기 있는 패턴을 변형하는 쪽을 우선한다.

### 폼: `Field` / `FieldSet` / `FieldLegend` / `FieldGroup`
- 필드 한 줄 = `<Field><FieldLabel/><Input/>(선택: <FieldDescription/> 또는
  <FieldError/>)</Field>`. 검증 실패 상태는 `Field`에 `data-invalid="true"`를
  붙이고 `Input`에 `aria-invalid`를 준다(`FieldError`와 짝).
- 가로 배치(체크박스+라벨 등)는 `Field`에 `orientation="horizontal"`.
- 라디오/체크박스 그룹처럼 여러 `Field`를 묶어야 하면 `FieldSet` +
  `FieldLegend`로 감싸고, 각 옵션은 `FieldLabel`로 `Field(horizontal)`를 감싼다
  (`Field.tsx`의 `RadioSetInFieldSet` 참고 — 라벨 전체가 클릭 영역이 되는 실제
  패턴).
- 섹션 제목이 필요하면 `Field`를 직접 감싸지 말고 `FormSection`(`title` +
  선택적 `description`)으로 감싼 뒤 그 안에 `Field`들을 넣는다.

### 표: `DataTable` vs 원시 `Table`
- **기본은 `DataTable`.** `columns`(헤더/셀 렌더 함수 + 선택적
  `headClassName`/`cellClassName`) + `data` + `rowKey`를 주입하는 방식이고,
  로딩(`isLoading`/`loadingSlot`)과 빈 상태(`emptyState`, 보통 `EmptyState` 컴포넌트를
  그대로 꽂는다)를 자체 처리한다. 역할별로 노출되는 액션이 다르면(승인 대기=승인·반려
  버튼, 승인 완료=회수 버튼만) `cell` 함수 안에서 분기한다 — 컴포넌트가 아니라
  호출부 책임이다.
- **`TableCaption`/`TableFooter`(합계 행 등)가 필요할 때만** 원시 `Table` +
  `TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell`을 직접 조립한다.
  `DataTable`에는 footer 슬롯이 없다.
- 표를 감싸는 컨테이너에 `rounded-lg border border-border`를 주는 것이 이 repo의
  실제 패턴이다(컴포넌트 자체가 테두리를 갖지 않는다).

### 카드 목록: `CardGrid` + `ProgramCard`/`Card` + `StatusBadge`
- `CardGrid`는 컬럼 수를 prop으로 받지 않는다 — `grid-template-columns:
  repeat(auto-fit, minmax(min(18rem,100%), 1fr))`로 뷰포트에 맞춰 자동으로
  줄바꿈된다. 카드 목록에 열 개수를 지정하고 싶다는 요구가 와도 `CardGrid`
  자체에는 그 prop이 없다.
- 프로그램 카드가 목적이면 `Card`를 직접 조립하지 말고 `ProgramCard`
  (`title`/`category`/`period`/`status`/`footer`)를 쓴다. `status`에는
  `StatusBadge`를, `footer`에는 보통 `outline` + `sm` 크기 `Button`을 넣는다.
- `StatusBadge`의 `variant`는 5개뿐이다: `recruiting`(모집중, 기본값) `closed`
  `pending` `approved` `rejected`. 도메인 문구는 자유롭게 바꿔도 되지만
  (역할 요청 화면은 같은 `pending`/`approved`/`rejected`를 "승인 대기"/"승인"/
  "반려"로 쓴다) variant 자체를 늘리지 않는다 — 색은 `--status-*` 토큰에
  고정돼 있다.
- 카드 파트(`CardHeader`/`CardTitle`/`CardAction`/`CardContent`/`CardFooter`)를
  직접 조립할 때, 상태 배지는 `CardAction`에 넣고 제목 옆 여백은
  `CardTitle`에 `pr-20`을 주는 것이 배지와 겹치지 않게 하는 실제 패턴이다
  (`Card.tsx`의 `ProgramStatusCard`).

### 상세/2분할 레이아웃: `DetailPanelLayout`
- `primary`/`secondary` 두 슬롯을 받는다. 기본값은 `md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]`
  — 넓은 화면에서 본문(2) : 보조(1) 비율로 나뉘고, 좁은 화면에서는 세로로
  쌓인다. 두 슬롯 다 `min-w-0`가 이미 걸려 있어 내부에 긴 텍스트/코드가 있어도
  그리드가 밀리지 않는다.
- 좌측이 메뉴처럼 고정폭이어야 하면(`role-panel-shell.tsx` 패턴)
  `className="gap-0 md:grid-cols-[220px_minmax(0,1fr)] md:items-stretch"`처럼
  `className`으로 그리드 정의 자체를 덮어쓰고, `primaryClassName`/
  `secondaryClassName`으로 각 슬롯의 패딩·테두리를 준다
  (`DetailPanelLayout.tsx`의 `RoleMenu`).
- `primary`/`secondary` 안은 보통 `Card` 1~2장을 `grid gap-6`(또는 `gap-4`)로
  쌓은 형태다. 빈 자식으로 렌더하면 그리드 뼈대만 보이는 빈 카드가 되니, 실제
  콘텐츠 없이 레이아웃만 보여주는 용도로 쓰지 않는다.

## 4. 알려진 함정

- **Tailwind 자동 탐지를 되살리면 안 된다 — 그 순간 §2 전체가 무효가 된다.**
  스캔 범위는 `.design-sync/css/ds-entry.css`의 두 줄이 고정한다:
  `@import '../../apps/frontend/node_modules/tailwindcss/index.css' source(none);`
  로 Tailwind v4 자동 탐지 자체를 끄고, 그 아래 `@source '../../apps/frontend/src';`
  로 스캔할 소스를 명시한다. **`@source`만 있고 `source(none)`이 없으면 범위는
  좁혀지지 않는다** — `@source`는 소스를 *추가*할 뿐 자동 탐지를 대체하지
  않는다. 자동 탐지가 켜져 있으면 (꺼지지 않는 한) git repo 루트에서 시작해
  gitignore되지 않은 파일을 전부 훑는다 — 이 문서, 프리뷰 파일, `NOTES.md`까지
  포함해서. 그렇게 되면 이 문서 안에 나열된 클래스 이름 문자열 자체가
  스캐너에 잡혀, 실제로는 앱이 안 쓰는 유틸리티가 §2에 phantom으로 섞여
  들어간다 — 실제로 한 번 일어났던 사고이고(이번 §2 전체를 다시 뽑아야 했던
  이유), 자기 참조적으로 반복되는 함정이라 다음에 또 걸리기 쉽다.
  `source(none)`을 걷어내는 변경은 이유를 불문하고 거부한다.
  경로 표기 함정도 하나 있다: 위 import를 `@import 'tailwindcss' source(none)`
  처럼 패키지명으로 쓰면 `.design-sync/css/`에서 해석되지 않는다 — Tailwind
  패키지가 repo 루트가 아니라 `apps/frontend/node_modules`에 있어서, 지금
  처럼 그 경로까지 상대 경로로 명시해야 한다.
- **`next/*` 클라이언트 모듈은 이 번들에서 실행되지 않는다.** `next/link`의
  `Link`를 새 화면에 주입하려고 하면 모듈 스코프에서 `process.env`를 읽다가
  `ReferenceError: process is not defined`로 죽는다 — 셀 하나가 아니라 그
  컴포넌트의 캡처 전체가 죽는 수준의 실패다. `NavBar`처럼 링크가 필요한
  컴포넌트는 라우터 주입 없이 순수 `<a>`로 렌더되는 게 설계된 정상 동작이니,
  라우팅 연동을 새로 만들려 하지 않는다.
- **아이콘은 인라인 `<svg>`.** `lucide-react`(또는 다른 아이콘 라이브러리)를
  import하지 않는다 — 이 번들 환경에서 검증되지 않은 의존성이다. `Button`,
  `EmptyState`, `StatusMessagePage` 프리뷰가 전부 손으로 쓴 인라인 svg를 쓴다.
  실제 화면이 아이콘 라이브러리를 쓰더라도, 새 화면에서는 비슷한 인라인 svg로
  대체하거나 생략한다.
- **`max-w-*`를 표 셀(`TableCell`/`<td>`)에 직접 걸면 열 폭이 제한되지 않는다.**
  표가 기본 `table-layout: auto`라 브라우저가 셀의 `max-width`를 열 폭 계산에서
  사실상 무시해서, 텍스트가 줄바꿈되지 않고 열만 넓어진다. 셀 안에 `<div>`를
  하나 넣고 그 div에 `max-w-sm whitespace-normal`을 건다(`Table.tsx`의
  `LongText`, `DataTable.tsx`의 `cellClassName: 'whitespace-normal'` 패턴).
- **Radix 팝오버/포털 계열(Select 드롭다운 등)은 정적 캡처 범위 밖이다.** 트리거
  버튼만 찍히고 열린 상태의 팝오버는 담기지 않는다. "열린 상태"를 지어내지
  않는다.
- **라운드 스케일에 구멍이 있다.** §2 참고 — `--radius-sm`~`--radius-4xl` 변수는
  전부 정의돼 있지만 유틸리티 클래스로는 `rounded`/`rounded-md`/`rounded-lg`/
  `rounded-xl`/`rounded-full`/`rounded-t-xl`/`rounded-b-xl`만 존재한다.
- **`w-64`는 존재하지 않는다.** §2의 폭 섹션 참고 — 예전에는 프리뷰 파일의
  주석 문자열이 스캔 범위에 잘못 포함돼 우연히 컴파일된 적이 있었지만, 스캔
  범위가 `apps/frontend/src`로 고정된 지금은 그 경로 자체가 없다. 고정폭
  카드가 필요하면 `min-w-64` 또는 `grid gap-3 sm:grid-cols-2` 패턴을 쓴다.

## 5. 존재하지만 프리뷰가 없는 export

`.d.ts`에는 있지만 `apps/frontend/src` 어디에서도 실사용처가 없어 프리뷰를
만들지 않은 것들이다. **금지된 것이 아니라 미개척 지역**이라는 뜻 — prop 계약은
유효하니 새 화면에 필요하면 조합해도 되지만, 참고할 실사용 예시가 없다는 점을
감안한다.

- `FieldSeparator` `FieldContent` `FieldTitle` — `ui/field.tsx`의 export.
  (같은 파일의 `FieldSet`/`FieldLegend`/`FieldGroup`은 실사용처가 있어 §3에
  들어가 있다.)
- `AlertAction` — `ui/alert.tsx`의 export. `Alert`의 실사용 패턴은
  `AlertDescription`에 직접 `flex justify-between`으로 버튼을 넣는 것이었다
  (§4 `WithRetryAction`류) — `AlertAction`이 그것과 어떻게 다른 슬롯인지는
  실사용 예시로 검증되지 않았다.
