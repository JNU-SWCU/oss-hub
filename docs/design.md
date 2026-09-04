# Frontend Design

이 문서는 frontend 스킬 게이트가 참조하는 디자인 계약이다.
색상·타이포그래피는 sojoong.kr의 톤(남색 계열 주조색, 녹색 계열 보조색, 짙은 회색 본문색)을 기준으로 삼는다.
토큰은 primitive → semantic → component 3-tier 구조로 관리하며, 실제 정의는 `apps/frontend/src/app/globals.css`에 있다.
프리미티브 컴포넌트는 shadcn CLI(`radix-nova` 스타일, radix-ui 기반)로 생성하고 소유권은 레포 내부(`apps/frontend/src/components/ui/`)에 둔다.

이 문서는 토큰·프리미티브·공용 composition·상태·피드백·다이얼로그·테스트 데이터 계약을 소유한다.
화면 단위 결정은 마지막 「화면별 결정 기록」에 모아 둔다.

## 이 문서를 읽는 방법

엔지니어와 agent는 작업 인덱스와 규칙 id로 먼저 찾고 디자이너는 토큰과 화면 결정 기록을 뒤이어 읽는다.
원칙은 세 개다 — 한 사실은 한 곳에만 쓰고, 상태와 피드백은 kind로 명시하며, 검출 신호가 없는 규칙은 두지 않는다.
검출 결과는 `file:line - finding` 형식으로 보고한다.
근거 표기는 외부 조사 문서를 링크하지 않고 2026-09-03 정적 감사로만 적는다.
그 감사의 수치는 저장소 안에서 재현한다.
로컬 toast state는 `grep -rl 'toastMessage' apps/frontend/src/features --include='*.ts*' | grep -v test`, 로컬 Skeleton은 `grep -rlE 'function [A-Za-z]*Skeleton' apps/frontend/src --include='*.tsx' | grep -v test`, radix dialog 직접 import는 `grep -rlE "from 'radix-ui'" apps/frontend/src/features | xargs grep -lE 'Dialog'`, 120자 초과 className은 `grep -rlE 'className="[^"]{121,}"' apps/frontend/src --include='*.tsx'`, fixture 파일과 LOC는 `find apps/frontend/src -type f -name '*fixture*'`와 같은 목록에 `| xargs cat | wc -l`을 붙여 세어 확인한다.

### 작업 → 절

| 작업 | 절 |
| --- | --- |
| 컴포넌트 고르기 | 계층과 소유권, 컴포넌트 카드 |
| 상태 렌더 | 상태 시스템 |
| 피드백 표시 | 피드백·알림 |
| 폼·다이얼로그 | 폼, 다이얼로그 |
| 접근성 점검 | 접근성 |
| 테스트 데이터 | 테스트 데이터 |
| 화면 근거 찾기 | 화면별 결정 기록 |

### R-id → 소유자·강제 수단

규칙마다 소유자는 한 문서다.
모든 규칙은 리뷰로 강제하며 자동 검사는 아직 없다.
자동 검사는 lint PR이 R-08a·R-08b에 대해 처음 도입하고 그 밖의 열은 현재 부채를 해소할 후속 PR을 가리킨다.

| 규칙 | 소유자 | 현재 부채를 해소할 후속 PR |
| --- | --- | --- |
| R-01, R-02 | `apps/frontend/src/components/AGENTS.md` | 없음 — 리뷰로 유지 |
| R-04 | 이 문서 | composition API PR |
| R-06 | 이 문서 | dialog shell PR |
| R-08a, R-08b | 이 문서 | lint PR |
| R-09, R-10 | 이 문서 | FailureState PR |
| R-17 | 이 문서 | Skeleton PR |
| R-11, R-12 | 이 문서 | Alert kind PR |
| R-13, R-14 | 이 문서 | notification PR |
| R-18, R-19 | 이 문서 | 테스트 인라인화 → builder 승격 → 파일 삭제 PR |
| R-20 | 이 문서 | 하네스 재설계 follow-up |
| R-03, R-05, R-07, R-15, R-16, R-21, R-22, R-24, R-25 | 이 문서 | 없음 — 리뷰로 유지 |

## 구현 스택

`package.json`에 추가된 의존성과 이 문서의 대응 관계다.

- `tailwindcss` / `@tailwindcss/postcss` / `postcss` — Tailwind v4 CSS-first 설정. `@theme inline`을 쓰며 JS 설정 파일이 없다.
- `shadcn` — 프리미티브 생성 CLI. 생성 직후부터 소유권이 레포 코드로 귀속되며 이후 이 패키지 자체에 런타임 의존은 없다.
- `radix-ui` — 프리미티브의 접근성 동작(포커스 트랩, ARIA, 키보드 내비게이션)을 제공하는 헤드리스 라이브러리.
- `class-variance-authority` — 컴포넌트 variant(색상/크기 등) 클래스 조합 관리.
- `clsx` + `tailwind-merge` — `cn()` 헬퍼로 클래스 병합·충돌 해소.
- `lucide-react` — 아이콘 세트.
- `tw-animate-css` — 애니메이션 유틸리티 클래스.

## 계층과 소유권

`apps/frontend/src/components/ui/*` atoms → `apps/frontend/src/components/*` molecules·organisms → `apps/frontend/src/features/**` 도메인 결합 → `apps/frontend/src/app/**` pages 순서로 소유한다.
R-01과 R-02는 이 문서의 색인 항목이고 규범 문장은 소유 문서에 한 번만 있으며 R-05는 이 문서가 소유한다.
**R-01** 공용 승격 기준 — 원본은 `apps/frontend/src/components/AGENTS.md`의 Ownership 절이다.
**R-02** 도메인 전용 컴포넌트의 feature 폴더 유지 — 원본은 같은 문서의 같은 절이다.
**R-05** feature 코드는 `@/components` barrel을 우선 import하고 대응 composition이 없을 때만 `@/components/ui/*`를 직접 import한다.

## 토큰

### 색상

3-tier 구조다.

1. primitive — 의미 없는 원시 색상 램프. `--palette-navy-*`, `--palette-green-*`, `--palette-gray-*` 등.
2. semantic — 역할 토큰. `--primary`, `--background`, `--destructive` 등과 도메인 상태색 그룹 `--status-*`.
3. component — Tailwind 유틸리티 매핑. `@theme inline` 블록이 semantic 토큰을 `--color-*`로 노출해 `bg-primary` 같은 클래스를 만든다.

| 역할 | semantic 토큰 | 참조 palette | 기준 |
| --- | --- | --- | --- |
| 주조색 | `--primary` | `--palette-navy-600` (`#003399`) | sojoong.kr 주조색 |
| 보조색 | `--accent` | `--palette-green-600` (`#007a34`) | sojoong.kr 보조색 anchor는 `green-500`(`#00923f`)이지만 흰 전경과 4.05:1로 AA 미달이라 인접 단계로 한 칸 내렸다(5.48:1). 비텍스트 용도(`--chart-2`)는 anchor를 유지한다 |
| 본문색 | `--foreground` | `--palette-gray-700` (`#444444`) | sojoong.kr 본문색 |
| 위험/오류 | `--destructive` | 라이트 `--palette-red-600` (`#c02626`) · 다크 `--palette-red-300` (`#e98686`) | 상태 표시 보조 램프. 표면별로 다른 단계를 참조한다 — 아래 명도비 항목 참고 |
| 반전 표면(hero) | `--hero-*` | navy 램프(`--palette-navy-950` 포함) | 랜딩 하단 CTA 같은 어두운 표면. `.dark`에서도 반전하지 않는다. 랜딩 첫 화면(우주 여정)은 별도의 `--cosmos-*`를 쓴다 |
| 반전 표면(hero) 오류 | `--hero-danger` | `--palette-red-100` (`#f3c6c6`) | navy-900 대비 명도비 약 10.9:1(AA 통과). `destructive` variant는 밝은 표면 전용이라 어두운 표면에는 쓰지 않는다 — 여정 첫 패널의 로그인 오류 Alert가 이 토큰을 쓴다 |

`--status-*` semantic 그룹(모집중/마감/대기/승인/반려)은 `apps/frontend/src/components/status-badge.tsx`의 `statusBadgeVariants`가 소비한다.
라이트(`:root`)/다크(`.dark`) 두 변형을 모두 정의한다.

#### 상태 배지 명도비 전수 확인

10개 조합(5상태 × 라이트·다크)을 전수 계산했고 **대기(pending)만 양쪽 미달**이었다. amber 램프에 더 어두운 단계가 없어 `--palette-amber-800`(`#805814`)을 신설해 해소했다.

| 상태 | 라이트 | 다크 |
| --- | --- | --- |
| 모집중 | navy-700 / navy-50 — 11.30:1 | navy-100 / navy-800 — 통과 |
| 마감 | gray-600 / gray-100 — 5.76:1 | gray-200 / gray-700 — 7.17:1 |
| 대기 | **amber-800** / amber-50 — 5.74:1 (이전 amber-700 3.99:1) | amber-50 / **amber-800** — 5.74:1 (이전 amber-700 3.99:1) |
| 승인 | green-700 / green-50 — 6.87:1 | green-100 / green-800 — 8.23:1 |
| 반려 | red-700 / red-50 — 6.10:1 | red-50 / red-700 — 6.10:1 |

대기 전경(`--status-pending-fg`)은 배지 안뿐 아니라 **배지 밖 독립 텍스트로도 쓰인다**(`text-status-pending-fg`). 그 경우 배경이 흰색·카드이므로 배지 짝만 확인하면 놓친다 — amber-700은 흰 배경에서도 4.39:1로 미달이었고 amber-800은 6.32:1이다.

#### 명도비 규칙 (#282)

의미가 같은 semantic 토큰이라도 **밝은 표면과 어두운 표면에서 같은 palette 단계를 참조하면 한쪽은 반드시 AA를 놓친다.** `--destructive`가 그 사례였다.

| 표면 | 참조 | 배경 | 명도비 | 판정 |
| --- | --- | --- | --- | --- |
| 라이트(`:root`) — 페이지 배경 | `--palette-red-600` | `#ffffff` | 5.92:1 | AA 통과 |
| 라이트 — muted 표면 | `--palette-red-600` | `#f7f7f7` | 5.53:1 | AA 통과 |
| 다크(`.dark`) — 페이지 배경 | `--palette-red-300` | `#1a1a1a` | 6.81:1 | AA 통과 |
| 다크 — 카드 표면 | `--palette-red-300` | `#2b2b2b` | 5.54:1 | AA 통과 |
| (이전) 양쪽 공통 | `--palette-red-500` | 각각 | 4.38:1 / 3.98:1 | **양쪽 모두 미달** |

`--destructive`는 텍스트 색(`text-destructive`)으로 직접 쓰이고, 위 표는 그 용도의 판정값이다.
Button의 `destructive` variant는 이 토큰을 **흰 전경의 불투명 배경으로 쓰지 않는다** — 배경은 같은 토큰의 반투명 tint(`bg-destructive/10`, hover `/20`)이고 전경은 별도 토큰 `--destructive-on-tint`(라이트 `red-700` · 다크 `red-50`)다. tint는 아래 표면과 alpha 합성되므로 위 표로 판정할 수 없고, 실제 소비 조합의 대비는 `button-contrast.test.ts`가 alpha 합성을 재현해 고정한다(최저 4.82:1).

#### 검사 규칙 두 가지

1. **라이트·다크 양쪽 배경 기준으로 각각** 4.5:1을 확인한다. 한쪽만 확인하고 같은 palette 단계를 양쪽에 쓰면 이 결함이 재발한다.
2. **페이지 배경만 보지 말고 그 위에 놓이는 표면까지 확인한다.** 같은 텍스트가 `--background`·`--muted`·`--card` 위에 모두 놓이며, 그중 대비가 가장 낮은 조합이 판정 기준이다. 다크 모드는 카드(`gray-800`)가 페이지 배경(`gray-900`)보다 밝아 카드 쪽이 더 불리하다 — 중간값 `#e26a6a`가 페이지 배경에서 5.39:1로 통과하면서 카드에서 4.38:1로 미달했던 것이 이 규칙이 필요한 이유다.

### 타이포그래피

폰트는 `next/font/google`의 `Geist`(Latin subset, self-hosted, shadcn init이 자동 구성)를 그대로 쓴다.
한글은 별도 웹폰트를 추가하지 않고 시스템 sans-serif로 글리프 단위 폴백한다.
새 타이포그래피 토큰을 만들지 않고 Tailwind 유틸리티 조합으로 역할을 정의한다.

| 역할 | 클래스 조합 |
| --- | --- |
| Display | `text-3xl font-bold tracking-tight` |
| Heading | `text-xl font-semibold` |
| Body | `text-sm leading-normal` |
| Caption | `text-sm text-muted-foreground` |

### 간격과 크기

Tailwind v4 기본 spacing 스케일을 그대로 쓴다.
이번 단계에서 새 간격 토큰은 추가하지 않는다.

### 그림자와 모서리

모서리는 semantic `--radius`(0.625rem)를 component 계층에서 `--radius-sm` ~ `--radius-4xl`로 확장해 쓴다.
그림자는 Tailwind 기본 `shadow-sm`/`shadow`/`shadow-md` 유틸리티를 그대로 쓰고, 이번 단계에서 별도 elevation 토큰은 추가하지 않는다.

## 프리미티브

Button부터 Table까지 6종은 `npx shadcn@latest add`로 생성했다(`radix-nova` 스타일).
Collapsible을 포함한 파일은 `apps/frontend/src/components/ui/`에 있고, 생성·추가 직후부터 소유권은 레포 코드로 귀속된다.

### Button

`button.tsx`. 모든 액션 트리거(제출, 이동, 보조 액션)의 기반이며 variant(default/outline/secondary/ghost/destructive/link)와 size 변형을 cva로 관리한다.

### Input

`input.tsx`. 텍스트 입력의 기반 프리미티브이며 `aria-invalid` 상태 스타일을 기본 제공해 폼 검증 패턴과 바로 연결된다.

### Form Field

`field.tsx`(및 의존 `label.tsx`, `separator.tsx`). 스펙상 FormField에 대응하는 프리미티브다.
현재 shadcn 레지스트리에는 레거시 `form.tsx`(react-hook-form 결합형) 대신, 폼 라이브러리에 종속되지 않는 `Field` 계열이 최신 항목으로 제공된다.
`FieldLabel`/`FieldDescription`/`FieldError`로 라벨·설명·에러를 구조화하며, 이 프로젝트가 특정 폼 라이브러리를 아직 강제하지 않으므로 `Field`가 FormField 요건을 그대로 충족한다.

### Card

`card.tsx`. 콘텐츠를 묶는 표면(surface) 프리미티브다. 아래 CardGrid 패턴의 셀 단위로 쓰인다.

### Alert

`alert.tsx`. 오류/안내 메시지의 표면 프리미티브다. 아래 로딩·빈 상태·오류 상태 패턴의 기반이 된다.

### Table

`table.tsx`. 표 형태 데이터를 위한 프리미티브(필수 지정 항목)다. DetailPanelLayout의 목록 영역이나 관리 화면에서 쓰일 예정이다.

### Collapsible

`collapsible.tsx`. `radix-ui`의 Root/Trigger/Content 접근성 동작을 레포 소유의 `Collapsible`/`CollapsibleTrigger`/`CollapsibleContent`로 노출한다.
래퍼 자체는 시각 스타일을 강제하지 않으며, 소비자가 기존 semantic 토큰과 이를 노출한 Tailwind component 유틸리티만 조합한다. 열린 상태 스타일은 각 `data-slot`과 Radix의 `data-state`를 기준으로 적용한다.

**R-24** `apps/frontend/src/components/ui/*`는 shadcn 생성물이고 소유권은 저장소에 있으며 semantic 토큰 적용·`data-slot` 추가·접근성 보강은 허용하고 공개 slot·role을 바꾸는 DOM 변경과 도메인 분기 삽입은 금지한다.
**R-25** 새 시각 변형은 `cva` variant를 소유 프리미티브에 추가해 만들고 variant 이름은 의미(kind·size)로 지으며 소비자 쪽 `className` 오버라이드로 변형을 만들지 않는다.

## Composition 계약

**R-03** 시각·상태 차이는 소유 컴포넌트의 `cva` variant로 표현하고 DOM 의미나 필수 slot이 다를 때만 새 컴포넌트를 만들며 한 컴포넌트에 시각 분기용 boolean prop이 세 개를 넘으면 variant로 바꾼다.
**R-04** 모든 공용 composition은 named `*Props`를 export하고 `className`을 받으며 root에 안정된 `data-slot`을 가진다.
**R-06** feature 코드는 `radix-ui` Dialog/AlertDialog를 직접 import하지 않고 공용 dialog shell을 쓴다.
**R-07** feature page shell은 `PageBody`, 최상위 섹션 제목은 `SectionHeading`, 표는 `DataTable`을 쓰고 필요한 slot이 없으면 컴포넌트를 확장하며 우회하지 않는다.
**R-08a — 길이**: `apps/frontend/src/{components,features,app}/**`의 JSX/TSX class literal에서 120자를 넘는 단일 라인 `className` 문자열을 금지한다.
**R-08b — 색**: `apps/frontend/src/{components,features,app}/**`의 모든 TS/TSX에서 색 상수 배열·데이터 객체·inline `style` 값을 포함한 hex 색상 리터럴과 `--palette-*` 직접 참조를 금지하고 semantic 토큰을 쓴다.
예외는 토큰 소유자 `apps/frontend/src/app/globals.css`, 격리 문서 `apps/frontend/public/policies/policy-document.css`, canvas 전용 테마 상수 `apps/frontend/src/features/landing/cosmos/cosmos-theme.ts`뿐이다.
CSS 파일 일반과 컴포넌트 CSS는 이 규칙 대상이 아니다.

### 레이아웃 뼈대 어휘

아래 이름은 레이아웃 뼈대(구조)를 가리키는 어휘이며 대응 컴포넌트는 `apps/frontend/src/components/`에 이미 있다.
새 뼈대가 필요하면 기존 composition을 확장하고 우회 구현을 만들지 않는다.

- **AppShell** → viewport-shell. 헤더/네비게이션이 고정되고 본문이 뷰포트를 채우는 전체 뼈대.
- **CardGrid** → grid-repetition(card-grid). 동일한 카드가 그리드로 반복되는 목록 뼈대.
- **DetailPanelLayout** → split-sidebar. 좌측 목록/우측 상세(또는 그 반대)로 나뉜 2분할 뼈대.
- **StatusMessagePage** → viewport-shell/cover. 로그인 오류, 빈 상태 등 뷰포트 전체를 덮는 단일 메시지 뼈대.

## 상태 시스템

공용 Skeleton과 failure surface는 아직 없으므로 「수용된 부채」에 기록하고 로컬 정의를 새로 늘리지 않는다.
**R-09** 컬렉션 뷰는 loading · empty · error · ready 네 상태를 상호배타로 렌더하고 네 분기를 테스트로 고정한다.
**R-10** 재시도 가능한 fetch 실패는 공용 failure surface 하나만 쓰고 retry 액션을 노출하며 `EmptyState`와 bare destructive 텍스트는 error 상태에 금지한다.
**R-17** loading 표면은 `aria-busy`, 접근 가능한 label, `motion-reduce` 처리를 갖는 공용 Skeleton을 쓰고 feature 로컬 Skeleton을 새로 정의하지 않는다.

상태 설명만으로 끝내지 않는다.
화면에 들어온 사용자가 원래 하려던 일을 이어갈 수 있도록 `다시 시도`, `목록으로 이동`, `일정으로 이동`, `제출 항목 추가`처럼 목적에 맞는 다음 행동을 하나 이상 제공한다.
권한이 없으면 필요한 권한과 대신 갈 수 있는 화면을 함께 말한다.

## 피드백·알림

| type | 트리거·범위 | 허용 kind | 소유 프리미티브 | 배치 | role / aria-live | 포커스 동작 | 소멸·지속 | 필수 액션 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| field | 필드 단위 검증 실패 | error | FieldError | 컨트롤 바로 아래 | `role="alert"` | 첫 오류로 포커스 이동 | 사용자가 고칠 때까지 지속 | 상단 요약과 쌍(R-16) |
| inline | 작업 중인 영역의 결과 | success·info·warning·error | Alert | 그 영역 안 | 동적 error=`role="alert"`, 그 외 동적 갱신=`role="status"`+`aria-live="polite"`, 정적 초기 렌더=live region 없음 | 포커스 이동 없음 | 화면을 떠날 때까지 | error면 다음 행동 링크(R-15) |
| page | 화면 전체를 막는 실패·권한 | error·warning | 공용 failure surface(미구현 → §수용된 부채 R-10 행) | 본문 최상단 | 상호작용 중 발생한 동적 error만 `role="alert"`, 초기·정적 warning·접근 권한·안내는 live region 없음, 동적 non-error=`role="status"`/`aria-live="polite"` | 첫 액션으로 포커스 | 지속 | 재시도 또는 대체 경로 |
| toast | 화면을 넘어가는 일회성 결과 | success·info | 전역 notification primitive(미구현 → §수용된 부채 R-13 행) | 뷰포트 고정 | `role="status"`+`aria-live="polite"` | 포커스 이동 없음 | 자동 소멸 허용, critical 금지(R-14) | 없음 |
| dialog | 되돌릴 수 없는 결정 요청 | warning·error | 공용 dialog shell(미구현 → §수용된 부채 R-06 행) | 모달 | `role="alertdialog"` | focus trap + 복귀 | 사용자가 결정할 때까지 | 확인·취소 쌍 |

| kind | role | aria-live | 자동 소멸 | 소유 컴포넌트 |
| --- | --- | --- | --- | --- |
| dynamic error | `role="alert"` | assertive | 금지 | FieldError 또는 failure surface |
| dynamic non-error | `role="status"` | polite | toast만 허용 | Alert 또는 notification primitive |
| static initial content | 없음 | 없음 | 해당 없음 | heading + 본문 |

**R-11** 피드백은 `success`·`info`·`warning`·`error` 중 하나의 kind를 명시한다.
**R-12** `role="alert"`는 상호작용 중 발생한 동적 error에만 쓰고 동적 non-error 갱신은 `role="status"` 또는 `aria-live="polite"`를 쓰며 정적 heading과 초기 렌더 콘텐츠에는 live region을 두지 않는다.
**R-13** 화면을 넘어가는 일회성 메시지는 전역 notification primitive 하나로 보낸다.
로컬 `toastMessage` 배너를 금지한다.
현재 미구현 — §수용된 부채 R-13 행.
**R-14** critical 메시지는 타이머로 사라지지 않는다.
**R-15** 오류 문구는 다음 행동을 포함한다.
필드 검증 실패는 field와 상단 요약을 함께 쓴다.
작업 지역 결과는 inline 또는 page를 쓴다.
화면을 넘어가는 비critical 일회성 결과는 toast를 쓴다.
차단 결정은 dialog를 쓴다.
error는 toast 단독으로 절대 쓰지 않는다.

## 폼

`Field` + `FieldLabel` + `FieldDescription` + `FieldError` 조합을 표준 패턴으로 쓴다.
에러는 `FieldError`가 `role="alert"`로 렌더링해 스크린 리더에 즉시 통지한다.

**R-16** 폼 검증 실패는 필드 옆 `FieldError`와 상단 요약을 함께 보이고 첫 오류로 포커스를 옮긴다.
제출 중에는 중복 제출을 막고 버튼의 busy 상태를 노출한다.
버튼 정렬은 `docs/rules/frontend.md`를 따른다.

## 다이얼로그

공용 controlled shell은 `open`과 `onOpenChange`를 받고 busy 중에는 닫기를 금지하며 크기 variant를 제공한다.
**R-06**을 따르며 `apps/frontend/src/features/**`의 radix 직접 import 11건은 §수용된 부채 R-06 행에서 해소한다.

## 접근성

프리미티브는 radix-ui 기반이라 포커스 트랩·키보드 내비게이션·ARIA role이 기본 제공된다.
`Field`/`FieldLabel`은 `htmlFor`/`id` 연결을 자동 생성하지 않으므로 소비자가 라벨과 컨트롤의 id를 직접 연결하고 테스트로 고정한다.
주조색(`--primary`)과 위험색(`--destructive`)은 흰 배경 대비 충분한 명도 대비를 확보하도록, sojoong.kr 원색보다 어둡거나 채도를 높인 값을 palette anchor로 선택했다.

접근성 점검은 포커스 가시성, 키보드 도달성, 피드백·알림 표의 live region 원칙, 명도비 기준 절, 테스트로 고정할 항목을 포함한다.

## 테스트 데이터

이것은 fixture를 어떻게 관리하느냐가 아니라 테스트를 어떻게 쓰느냐의 문제다.
**R-18** 기본값은 fixture 파일 없음이며 각 테스트는 자기 단언에 필요한 최소 데이터를 테스트 본문에서 typed builder 호출로 만들고 `apps/frontend/src/**`의 비테스트 파일에 fixture·mock·sample·seed 이름을 쓰지 않는다.
**R-19** builder는 두 개 이상의 테스트 파일이 같은 엔티티를 만들 때만 `apps/frontend/test-support/`로 올리고 완성된 응답 리터럴을 저장하는 fixture 저장소는 두지 않으며 Playwright 확장만 `*.fixture.ts`를 쓴다.
**R-20** runtime 모듈은 테스트 데이터를 import하지 않으며 local-review 하네스의 현 상태는 부채로 기록하고 예외를 두지 않는다.
**R-21** wire-contract drift는 fixture로 막지 않고 DTO 타입 `satisfies`와 계약 테스트로 막는다.
**R-22** 테스트 본문의 인라인 객체·배열은 30줄 상한이며 넘으면 builder로 쪼개거나 단언을 줄인다.

## 안티패턴 (flag these)

출처: 2026-09-03 정적 감사.

| AP | 안티패턴 | 검출 신호 | 대체 규칙 |
| --- | --- | --- | --- |
| AP-01 | 실패를 빈 상태로 위장 | `state.kind === 'failed'`·`status === 'error'` 분기 안의 `<EmptyState` | R-10 (보조 R-09) |
| AP-02 | bare 오류 텍스트 | `components/` 밖의 `<p role="alert"`·단독 `text-destructive` 문단 | R-10 (보조 R-15) |
| AP-03 | 로컬 toast 흉내 | `toastMessage`·`setToast` state, `role="status"` 녹색 박스 | R-13 |
| AP-04 | 긴급도 없는 `role="alert"` | 정적 heading·초기 렌더 콘텐츠의 `role="alert"`, 성공 Alert의 assertive 공지 | R-12 |
| AP-05 | 의미 없는 두 톤 | warning에 `variant="destructive"`, 성공에 `default` | R-11 |
| AP-06 | 로컬 Skeleton 복제 | feature 파일 내 `function *Skeleton`·`animate-pulse` 블록 | R-17 |
| AP-07 | page shell 재구현 | `features/**`의 `<main`·`text-xl`/`text-2xl` 제목 | R-07 |
| AP-08 | raw table | `features/**`의 `<table`·`@/components/ui/table` 직접 import | R-07 (보조 R-05) |
| AP-09 | Radix dialog 직접 조립 | `features/**`의 `radix-ui` Dialog/AlertDialog import, `div role="dialog"` | R-06 |
| AP-10 | 도메인 컴포넌트의 공용 승격 | `components/`에 있으나 소비 feature가 하나 | R-02 (보조 R-01) |
| AP-11 | API 계약 누락 | composition에 named `*Props`·`className`·root `data-slot` 중 하나라도 없음 | R-04 |
| AP-12 | 긴 class literal·hex | 120자 초과 단일 라인 `className`, `#` hex, `--palette-*` | R-08a·R-08b |
| AP-13 | feature-local fixture 파일 | `apps/frontend/src/features/**`의 `*fixture*`·`*mock*`·`*seed*` 파일명 | R-18·R-19 |
| AP-14 | 응답 리터럴 저장소·손 복사 DTO | 테스트 밖 모듈이 완성 응답 객체를 상수로 export, `satisfies` 없는 DTO 복사 | R-19·R-21 |
| AP-15 | runtime 코드의 테스트 데이터 import | `apps/frontend/src/**` 런타임 모듈이 `apps/frontend/test-support/`를 import | R-20 |

## 수용된 부채 (2026-09-03)

이 표는 2026-09-03 정적 감사에서 확인된 위반만 담는다.
여기 없는 위반이 허용된다는 뜻이 아니다.
새로 발견되면 이 표에 행을 추가하고 후속 PR을 연다.

| 기록일 | 위반 | 규칙 | 해소 경로 |
| --- | --- | --- | --- |
| 2026-09-03 | 공용 failure surface 부재 — fetch 실패 표현이 파일마다 다르고 일부는 `EmptyState`로 렌더(예: `apps/frontend/src/features/programs/components/activity-graph-panel.tsx` 31-49) | R-10 | FailureState PR |
| 2026-09-03 | 전역 notification primitive 부재, 로컬 `toastMessage` state 6파일 | R-13 | notification PR |
| 2026-09-03 | 공용 Skeleton 부재, 로컬 정의 15곳 | R-17 | Skeleton PR |
| 2026-09-03 | `apps/frontend/src/components/ui/alert.tsx`가 두 variant뿐이고 항상 `role="alert"` | R-11 | Alert kind PR |
| 2026-09-03 | 정적 heading에 `role="alert"` — `apps/frontend/src/app/_shell/access-denied.tsx` 18-24, `apps/frontend/src/app/_shell/login-required-notice.tsx` 19-25 | R-12 | Alert kind PR |
| 2026-09-03 | 공용 dialog shell 부재, `apps/frontend/src/features/**`에 radix-ui Dialog/AlertDialog 직접 import 11건과 plain `div role="dialog"` 구현 잔존 | R-06 | dialog shell PR |
| 2026-09-03 | CardGrid·PageBody·ListPanel/ListRow·StatusBadge named `*Props` 미export, PaginationNav·RepositoryPublishCard·ProgramCountdown root `className` 미수용 | R-04 | composition API PR |
| 2026-09-03 | signup typography helpers에 `className`·`data-slot` 없음 | R-04 | composition API PR |
| 2026-09-03 | `apps/frontend/src/components/form-section.tsx` root가 프리미티브 `data-slot="field-set"`뿐이고 자체 slot 없음 | R-04 | composition API PR |
| 2026-09-03 | `apps/frontend/src/components/program-card.tsx` 소비자 하나인데 공용 상주 | R-02 | feature 하향 PR |
| 2026-09-03 | 120자 초과 className 43파일과 hex 상수·inline style — `apps/frontend/src/features/activity-timeline/components/activity-chart.tsx` 26-29, `apps/frontend/src/features/landing/components/landing-journey.tsx` 401-414 | R-08a·R-08b | lint PR |
| 2026-09-03 | `apps/frontend/src/features/**`에 fixture 9파일 1,022 LOC | R-18·R-19 | 테스트 인라인화 → 공용 builder 승격 → 파일 삭제 PR |
| 2026-09-03 | local-review 하네스가 `apps/frontend/test-support/local-review/fixture-response.ts`에서 feature fixture를 소비 | R-20 | 하네스 재설계 follow-up |

## 컴포넌트 카드

### AppShell
Use when: header·footer와 앱 프레임을 함께 배치할 때 쓴다.
Don't use when: 독립 콘텐츠 카드면 대신 Card를 쓴다.
Slots·Props: AppShellProps의 `header`, `footer`, div props를 쓴다.
States: header·footer는 선택이다.
Do·Don't: root className으로 여백만 조정하고 page shell을 다시 만들지 않는다.

### NavBar
Use when: 전역 또는 업무 화면 탐색을 제공할 때 쓴다.
Don't use when: 한 화면의 보조 탭이면 대신 해당 feature navigation을 쓴다.
Slots·Props: NavBarProps의 `items`, `brand`, `actions`, `menuResetKey`, `sidebarDrawerOpen`·`onToggleSidebarDrawer`·`sidebarDrawerId`를 쓴다.
States: 접힌 메뉴는 `<details>`가 들고 현재 항목 표시는 호출자가 링크 쪽에서 담당한다.
Accessibility: 드로어 토글에 `aria-expanded`·`aria-controls`를 붙이고 접힌 메뉴는 Escape로 닫힌다.
Do·Don't: NavItem으로 목적지를 선언하고 임의 링크 묶음을 만들지 않는다.

### PageHeader
Use when: 페이지 제목과 보조 설명·액션을 표시할 때 쓴다.
Don't use when: 섹션 내부 제목이면 대신 SectionHeading을 쓴다.
Slots·Props: PageHeaderProps의 title·description·actions를 쓴다.
States: 설명과 actions는 선택이다.
Accessibility: `titleAs`로 h1·h2를 고른다.
Do·Don't: page 제목을 feature마다 재구현하지 않는다.

### PageBody
Use when: feature page의 표준 본문 폭과 간격이 필요할 때 쓴다.
Don't use when: 독립 modal 내용이면 대신 dialog body를 쓴다.
Slots·Props: 미export — §수용된 부채(R-04).
Do·Don't: R-07을 따른다.

### SectionHeading
Use when: 최상위 섹션 제목과 설명·액션을 표시할 때 쓴다.
Don't use when: page 제목이면 대신 PageHeader를 쓴다.
Slots·Props: SectionHeadingProps의 title·meta·action을 쓴다.
States: meta와 action은 선택이다.
Do·Don't: text-xl 제목을 직접 조립하지 않는다.

### StatusMessagePage
Use when: 전체 페이지 상태 메시지를 보여 줄 때 쓴다.
Don't use when: R-10이 적용되는 상황이면 쓰지 않는다.
Slots·Props: StatusMessagePageProps의 icon·title·description·action·header·footer를 쓴다.
States: icon·description·action·header·footer는 선택이다.
Accessibility: 제목과 액션을 명시한다.
Do·Don't: R-10을 따른다.

### DetailPanelLayout
Use when: 상세 본문과 보조 패널을 나란히 배치할 때 쓴다.
Don't use when: 단일 열 목록이면 대신 PageBody를 쓴다.
Slots·Props: DetailPanelLayoutProps의 primary·secondary와 `stacked`를 쓴다.
States: `stacked`로 세로 쌓임을 고른다.
Do·Don't: grid 구조를 feature마다 복제하지 않는다.

### CardGrid
Use when: 동질 카드 목록을 반응형 grid로 표시할 때 쓴다.
Don't use when: 행 단위 데이터면 대신 DataTable을 쓴다.
Slots·Props: 미export — §수용된 부채(R-04).
States: 자식 수는 소비자가 제어한다.
Accessibility: 카드 제목과 링크를 구분한다.
Do·Don't: 임의 grid className으로 대체하지 않는다.

### EmptyState
Use when: 정상 empty 상태의 원인과 다음 행동을 안내할 때 쓴다.
Don't use when: R-10이 적용되는 상황이면 쓰지 않는다.
Slots·Props: EmptyStateProps의 icon·title·description·action을 쓴다.
States: icon·description·action은 선택이다.
Accessibility: action에 구체적 이름을 준다.
Do·Don't: R-10을 따른다.

### FormSection
Use when: 관련 입력을 fieldset으로 묶을 때 쓴다.
Don't use when: 단일 control이면 대신 Field를 쓴다.
Slots·Props: FormSectionProps의 title·description과 fieldset props를 쓴다.
States: description은 선택이다.
Accessibility: title이 legend로 그룹 이름을 제공한다.
Do·Don't: form group 의미를 div로 흉내 내지 않는다.

### PaginationNav
Use when: 페이지 번호 이동을 제공할 때 쓴다.
Don't use when: 무한 스크롤이면 대신 해당 feature의 load-more를 쓴다.
Slots·Props: PaginationNavProps의 page·totalPages·onPageChange와 필수 `ariaLabel`을 쓴다.
States: `totalPages <= 1`이면 아무것도 렌더하지 않고 처음·끝 페이지에서 이전·다음을 비활성화한다.
Accessibility: `ariaLabel`이 이 페이지네이션의 접근 가능한 이름이 된다.
Do·Don't: page state를 별도 복제하지 않는다.

### ProgramCard
Use when: 프로그램 요약과 상태·일정을 카드로 표시할 때 쓴다.
Don't use when: 상세 편집 화면이면 대신 DetailPanelLayout을 쓴다.
Slots·Props: ProgramCardProps의 title·status·badgeText와 선택 `category`·`period`·`note`·`noteIcon`·`href`, div props를 쓴다.
States: `href`가 있으면 status와 무관하게 열린다.
Accessibility: href의 목적지를 명확히 한다.
Do·Don't: 공용 승격 부채를 해소할 때 feature로 내린다.

### RepositoryPublishCard
Use when: 저장소 발행 상태와 발행 액션을 표시할 때 쓴다.
Don't use when: 일반 프로그램 요약이면 대신 ProgramCard를 쓴다.
Slots·Props: RepositoryPublishCardProps의 repository·isPublishing·errorMessage·onPublish를 쓴다.
States: 미연결(`repository` null)·공개·발행 가능·차단(`blockedReasons`)·발행 중·오류 여섯 가지다.
Accessibility: busy와 차단·오류 원인을 텍스트로 알린다.
Do·Don't: 발행 중 중복 액션을 허용하지 않는다.

### DataTable + RowActions — 그룹
Use when: 행 데이터와 행별 액션을 함께 표시할 때 쓴다.
Don't use when: 카드형 요약이면 대신 CardGrid를 쓴다.
Slots·Props: DataTableProps의 columns·data·rowKey와 RowActionsProps의 children을 쓴다.
States: 이 컴포넌트는 loading·empty·ready를 소유하고 error는 호출자가 failure surface로 렌더한다.
Accessibility: `caption`과 `scrollRegionLabel`을 제공한다.
Do·Don't: R-07을 따른다.

### ListPanel + ListRow — 그룹
Use when: 선택 가능한 목록과 행을 구성할 때 쓴다.
Don't use when: 열 정렬 데이터면 대신 DataTable을 쓴다.
Slots·Props: 미export — §수용된 부채(R-04).
States: 선택·비선택은 소비자가 제공한다.
Accessibility: 행의 이름과 선택 상태를 명시한다.
Do·Don't: 목록 grid를 feature마다 복제하지 않는다.

### StatusBadge (+ statusBadgeVariants) — 그룹
Use when: 짧은 상태 kind를 시각적으로 표시할 때 쓴다.
Don't use when: 다음 행동이 필요한 피드백이면 대신 Alert를 쓴다.
Slots·Props: 미export — §수용된 부채(R-04).
States: variant는 `recruiting`·`closed`·`pending`·`approved`·`rejected` 다섯 개다.
Accessibility: 색만으로 상태를 전달하지 않고 라벨 텍스트가 상태를 말한다.
Do·Don't: 도메인 상태는 다섯 variant에 매핑하고 새 색 조합을 호출자가 만들지 않는다.

### ProgramCountdown (+ remainingUntil · formatClock · formatCountdownDate) — 그룹
Use when: 다음 마감까지 남은 시간과 날짜를 표시할 때 쓴다.
Don't use when: 과거 이벤트 기록이면 대신 정적 날짜를 쓴다.
Slots·Props: ProgramCountdownProps의 nextMilestoneLabel·dueAt와 선택 `now`·`untilLabel`을 쓴다.
States: 마운트 전 placeholder, 진행 중, 지난 마감(zero 고정) 세 가지다.
Do·Don't: 남은 시간을 음수로 렌더하지 않는다.

### Signup typography helpers — SignupEyebrow · SignupLede · SignupTitle · signupPrimaryClassName — 그룹
Use when: signup 화면의 정해진 제목·소개·주 action typography가 필요할 때 쓴다.
Don't use when: 일반 page typography면 대신 PageHeader와 SectionHeading을 쓴다.
Slots·Props: 미export — §수용된 부채(R-04).
Accessibility: SignupTitle을 page의 단일 제목으로 쓴다.
Do·Don't: helper class를 복사해 새 typography를 만들지 않는다.

## 화면별 결정 기록

### 사람 중심 일정·제출 폼

- 프로그램 만들기의 신청·운영 일정은 한 달력을 먼저 보여 주고, 그 아래에 신청 기간과 운영 기간을 각각 한 줄로 둔다.
  각 줄을 고른 뒤 달력에서 시작일과 종료일을 차례로 누르며, 날짜·시간을 함께 입력할 때는 같은 줄의 일정 입력 모달 하나만 사용한다.
  각 줄은 초기화 동작을 제공하고 날짜 입력과 시간 입력을 별도 모드로 나누지 않는다.
  신청은 파랑, 운영은 초록, 마일스톤은 주황으로 표시하며 연속 기간은 날짜마다 끊긴 칩이 아니라 주 경계에서 이어지는 막대로 그린다.
- 마일스톤 달력은 운영 기간 밖 날짜를 비활성화한다.
  시작일과 종료일을 차례로 누르면 운영 기간 경계 시각을 보존한 범위가 달력에 즉시 그려지고 마일스톤 추가 모달이 열린다.
  모달은 기간·이름·공지사항·첨부파일을 한 번에 다루며, 달력 아래의 추가 버튼도 같은 모달을 재사용한다.
  고른 날짜와 시각은 `YYYY년 M월 D일 (요일) HH:mm` 형식의 한국어 문장으로 다시 적는다.
- 날짜 오류는 자동으로 값을 바꾸지 않는다.
  충돌한 두 시점, 왜 저장할 수 없는지, 어느 입력을 고쳐야 하는지를 필드 근처에서 말한다.
- 마일스톤은 이름·일정·안내를 가진 단계다.
  새 마일스톤에는 제출 항목을 기본 생성하지 않고, 교직원이 첨부한 공지·양식·참고 파일마다 학생 제출 대상을 하나 만든다.
  대상 이름은 파일명에서 시작해 교직원이 수정할 수 있고, 파일마다 필수·선택을 정하며 `FILE/TEXT` 선택은 노출하지 않는다.
- 마일스톤 첨부파일 순서는 각 항목 앞의 드래그 손잡이로 바꾼다.
  마우스·터치뿐 아니라 키보드로도 손잡이를 집고, 방향키로 옮기고, 놓거나 취소할 수 있어야 한다.
  이동 중 현재 위치와 놓인 위치는 화면 읽기 도구에 한국어로 알리고, 동작 감소 설정에서는 위치 전환 애니메이션을 끈다.
  드롭이 끝났을 때만 전체 순서를 한 번 저장하며, 실패하면 서버가 마지막으로 확인한 순서를 유지하고 해당 항목에서 다시 시도할 행동을 안내한다.
- 학생은 한 제출 화면에서 내용만, 파일만, 내용과 파일을 함께 낼 수 있다.
  두 값이 모두 비었을 때만 제출을 막고, `내용이나 파일을 하나 이상 추가해 주세요.`와 `둘 다 추가해도 됩니다.`를 서로 다른 문장으로 안내한다.
- 파일을 받는 자리는 고르기 **전에** 허용 형식과 상한을 `PDF, HWP, JPG, PNG, ZIP · 최대 5 MB` 한 줄로 말하고 같은 목록을 `accept`에 건다.
  학생 제출과 교직원 양식 올리기(프로그램 상세·마일스톤 편집)가 같은 문장을 쓴다.
  숫자와 형식 목록은 화면이 적어 두지 않고 서류 목록 응답의 `fileUpload`를 그대로 읽는다 — 화면이 사본을 들면 서버가 거절하는 상한과 화면이 약속하는 상한이 갈라진다.
  상한을 넘거나 허용 형식 밖인 파일은 고른 즉시 사유를 말하고 **받아 두지 않는다**. 받아 두면 제출 버튼이 눌리고 그 요청은 반드시 실패한다.
  단위 표기는 `MB` 하나만 쓴다(실제 상한은 5 MiB다). 서버가 내는 거절 문구도 같은 문장이다.
- 생성과 편집은 같은 용어와 정보 순서를 쓴다.
  프로그램 만들기의 단계 이동은 서버에 저장하지 않는 `계속`이고, 최종 검토의 `프로그램 만들기`와 확인 모달을 통과할 때만 전체 내용을 생성한다.
  임시 저장·자동 저장처럼 생성 전 서버나 브라우저에 작성 내용이 남는다고 오해할 표현은 쓰지 않는다.
  기존 프로그램 편집처럼 즉시 서버에 반영하는 화면은 결과가 명확한 `저장`을 쓴다.

### 프로그램 편집 — 마일스톤 수정 레이어

- 제목은 대상 이름을 넣은 `{마일스톤명} 수정`이고, 필드는 마일스톤명·시작 일시·마감 일시·제출 안내로 고정한다.
  레이어가 열린 동안 배경의 프로그램 편집 화면은 상호작용과 스크롤에서 제외하고, 본문만 스크롤하며 `취소`·`저장` 액션 푸터는 하단에 고정한다.
- `sm` 이상에서는 뷰포트 가운데 카드로, `sm` 미만에서는 너비 전체·`100dvh` 전체 화면으로 표시한다.
  어느 너비에서도 가로 오버플로를 만들지 않는다.
- 현재 값이 최초 값과 다를 때만 닫기 요청에 변경 취소 확인을 올리고, 모든 값을 최초 값과 정확히 같게 되돌리면 깨끗한 상태로 보아 바로 닫는다.
  확인이 열린 동안에는 최상위 확인 레이어가 포커스 트랩과 `Escape`를 우선 소유하며, 한 번의 `Escape`는 확인만 닫고 아래 수정 레이어까지 연쇄해 닫지 않는다.
- 저장 성공은 변경을 반영하고 레이어를 닫으며, 변경사항 취소는 저장하지 않은 값을 버리고 레이어를 닫는다.
  최종 닫힘 뒤에는 저장·변경사항 취소 경로 모두 해당 레이어를 연 `수정` 버튼으로 포커스를 돌려준다.

레이어 구조·닫기·최종 포커스 복귀는 `ProgramEditMilestoneDialog`, 필드와 고정 액션 푸터는 `ProgramEditMilestoneForm`, 최초 값 대비 변경 판정과 화면 이탈 상태는 `isMilestoneFormDirty`·`hasUnsavedMilestoneEdit`가 소유한다.

### 로딩·빈 상태·오류 상태

오류/빈 상태 메시지는 `Alert` + `AlertTitle` + `AlertDescription` 조합을 표준으로 쓴다.
로딩 상태 전용 컴포넌트(스켈레톤 등)는 이번 단계 범위 밖이며 필요 시 B-6에서 추가한다.

상태 설명만으로 끝내지 않는다.
화면에 들어온 사용자가 원래 하려던 일을 이어갈 수 있도록 `다시 시도`, `목록으로 이동`, `일정으로 이동`, `제출 항목 추가`처럼 목적에 맞는 다음 행동을 하나 이상 제공한다.
권한이 없으면 필요한 권한과 대신 갈 수 있는 화면을 함께 말한다.

### 랜딩 우주 스크롤 여정

랜딩(`/`)의 첫 화면은 canvas 하나로 그린 우주를 스크롤로 통과하는 여정이다.
방문 횟수나 로그인 여부로 다른 랜딩을 보여 주는 분기는 없다 — 모든 방문자가 같은 여정을 보고, 세션에 따라 달라지는 것은 주 CTA 버튼 하나뿐이다.

| 파일 | 역할 |
| --- | --- |
| `features/landing/components/landing-journey.tsx` | 무대와 다섯 패널 DOM, 스크롤 진행도 계산, 렌더 루프 |
| `features/landing/components/landing-journey.module.css` | 무대 높이·패널 배치·스크림·범례·진행 표시·모션 축소 |
| `features/landing/cosmos/cosmos-graph.ts` | 연출용 그래프 생성과 3D 힘 기반 배치 |
| `features/landing/cosmos/cosmos-camera.ts` | 다섯 구간 카메라 안무와 패널 구간 상수 |
| `features/landing/cosmos/cosmos-renderer.ts` | canvas 2D 렌더 — 하늘·별·오로라·성운·관계선·천체·블룸·라벨·속도선 |
| `features/landing/cosmos/cosmos-theme.ts` | canvas 전용 색 상수(`DAWN_THEME`)와 보간 헬퍼 |
| `features/landing/cosmos/cosmos-quality.ts` | 프레임 예산을 넘기면 해상도를 낮추는 품질 거버너 |

#### 무대 구조

- 여정 컨테이너(`.journey`)는 높이 `560vh`, 배경은 `--cosmos-void`다. 그 안의 무대(`.stage`)가 `position: sticky; top: 0`으로 `100svh`를 채운다. 스크롤한 만큼이 그대로 장면 진행도가 된다.
- 진행도는 `-journey.getBoundingClientRect().top / (journey.offsetHeight - window.innerHeight)`를 0~1로 자른 값이다. 스크롤을 가로채거나 관성을 바꾸지 않고 네이티브 스크롤을 읽기만 한다.
- 화면에 반영되는 값은 목표 진행도를 프레임마다 `+= (목표 - 현재) * 0.09`로 따라가고, 차이가 `0.0002` 미만이면 목표에 붙인다. 스크롤을 멈추면 카메라도 곧 멈춘다.
- 무대 안 층 순서는 canvas → 비네트(z 2) → 스크림(3) → 패널(4) → 범례·진행 표시·SCROLL 힌트(5) → 건너뛰기 링크(8)다.
- 상단 헤더는 전 화면에서 기본 흰 바다(`app/_shell/shell-nav.tsx`). 랜딩에서만 `fixed inset-x-0 top-0 z-40`으로 떠 있어 560vh 여정 동안 메뉴가 남는다. 가입 본문의 우주 반전(`data-surface="inverted"`)은 `SignupStage` 등 본문 스코프에만 둔다. 헤더를 숨기거나 스크롤에 따라 표면을 바꾸는 스크립트는 없다.

#### 다섯 장면

패널 순서·구간은 카메라 구간과 1:1로 대응한다(`PANEL_RANGES`, `cosmos-camera.ts`).

| 순서 | 진행 구간 | eyebrow | 제목 | 패널이 갖는 것 |
| --- | --- | --- | --- | --- |
| 1 | 0.00–0.16 | 전남대학교 SW중심대학사업단 | 흩어진 정보를 한 곳으로 (`h1`) | 서비스 한 문단, 로그인 오류·로그아웃 안내 슬롯, 주 CTA + `프로그램 둘러보기` |
| 2 | 0.20–0.38 | 프로그램 | 모든 활동은 / 프로그램 단위로 묶입니다 | 공개 프로그램·공개 저장소·공개 기여자 수치 3개와 출처 배지 |
| 3 | 0.44–0.60 | 흐름 | 신청부터 공개까지, / 하나의 흐름 | `STEP 1 신청·팀 구성` → `STEP 2 저장소 연결` → `STEP 3 제출·검토` → `STEP 4 공개 아카이브` |
| 4 | 0.66–0.82 | 나의 활동 | 참여 기록이 / 한 곳에 남습니다 | 대시보드에서 보는 것과 공개 범위(팀·교직원만 열람, 공개는 검토 후 승인) 고지 |
| 5 | 0.88–1.01 | 없음 | 지금 OSS Hub에서 / 시작하세요 | 주 CTA + 외곽선 `프로그램 둘러보기` 버튼 |

- 패널은 구간 앞뒤로 `0.05`만큼 페이드한다. 불투명도가 `0.6`을 넘을 때만 `pointer-events: auto`가 되고 `inert`·`aria-hidden`이 풀린다. `0.5`를 넘으면 진행 눈금이 활성 표시로 바뀐다.
- 패널이 바꾸는 속성은 `opacity`와 `translateY`(22px → 0)뿐이다. 레이아웃 속성은 애니메이션하지 않는다.

#### 캔버스가 그리는 것

| 층 | 내용 |
| --- | --- |
| 하늘 | 위에서 아래로 `#000000 → #03040a → #070a15` 3-stop 세로 그라디언트 |
| 배경 별 | 3층(깊이 0.18 / 0.42 / 0.75, 460 / 230 / 95개). 층마다 시차가 다르고 별 밝기는 고정이라 화면이 깜빡이지 않는다 |
| 오로라 | 커튼 4장을 각각 26개의 굵고 흐린 빗살로 그려 `screen`으로 합성. 성운에 진입할수록 옅어진다 |
| 성운 | 프로그램 항성마다 방사 그라디언트 한 겹. 진입 중인 프로그램만 밝고 나머지는 존재만 암시한다 |
| 관계선 | 학생↔프로그램, 저장소↔학생, 학생↔학생 세 종류. 포커스 프로그램의 선은 진행도에 따라 순서대로 드러나고 일부에는 빛 알갱이가 흐른다 |
| 항성 = 프로그램 | 코로나 + 십자 회절 스파이크 + 흰 코어 |
| 별 = 학생 | 얇은 후광 + 코어. 반짝임 없이 고정 크기이고, 주인공만 상시 조금 크다 |
| 행성 = 저장소 | 자기 프로그램 항성 쪽으로 치우친 방사 그라디언트로 구 음영을 만들고, 반사 하이라이트와 얕은 대기 림을 얹는다 |
| 블룸 | 밝은 코어만 1/3 해상도 버퍼에 따로 그린 뒤 `blur(7px)`로 덧씌운다. 전체 화면 후처리보다 싸고 글자는 번지지 않는다 |
| 속도선 | 스크롤이 빠를 때만 화면 가장자리로 뻗는 80개 광선. 속도가 임계값 아래면 0이다 |

그래프 자체는 마운트할 때 한 번만 만든다. 프로그램 6개, 학생 108개, 저장소 152개에 학생 간 링크 26개이며, 고정 시드 난수라 매 로드 같은 배치가 나온다.
배치는 3D 힘 기반 레이아웃(링크 인력 · 노드 반발 · 차수 비례 중력)을 240회 돌린 뒤 그대로 굳히고, y축을 눌러 원반형으로 만든다. 상시 시뮬레이션이 아니라 프레임마다 다시 푸는 비용이 없고 떨림도 없다.

한 프레임의 그리기 순서는 `하늘 → 배경 별 → 오로라 → 성운 → 관계선 → 천체 → 블룸 합성 → 라벨 → 속도선`이다.

폭 900px을 넘으면 그래프 중심을 화면 가로 64%(마지막 장면에서는 54%) 지점에 두고, 왼쪽 40% 안쪽에는 라벨을 놓지 않는다. 좌측 패널 카피와 겹치지 않게 하기 위한 규칙이다. 900px 이하에서는 중심이 화면 한가운데다.

#### 카메라 다섯 구간

| 진행도 | 카메라 | 대응 패널 |
| --- | --- | --- |
| 0.00–0.14 | 전체 그래프를 멀리서, zoom 1.0 | 1 |
| 0.14–0.42 | 포커스 프로그램의 성운으로 접근, zoom 2.9 | 2 |
| 0.42–0.62 | 성운 내부, zoom 4.4 | 3 |
| 0.62–0.80 | 주인공 학생과 그 저장소로 포커스, zoom 6.8. 그 밖의 노드·관계선은 어두워진다 | 4 |
| 0.86–1.00 | 다시 전체로 후퇴, zoom 1.18 | 5 |

시야각은 진행도와 시간에 함께 비례해 아주 느리게 돈다(`time * 0.000075 + progress * 1.15`). 스크롤을 멈춰도 화면이 완전히 정지하지 않게 하는 최소한의 움직임이다.

#### 캔버스 라벨은 예시 데이터다

화면에 뜨는 `@example-user`, `@example-134`, `team-nova/api-server` 같은 이름은 **실제 사용자·팀·저장소가 아니다.** 연출을 위해 생성한 문자열이며, 범례 오른쪽 끝의 `예시 구성` 표기가 그 사실을 알린다.

- 학생 노드는 `@example-100`부터의 연번, 주인공은 `@example-user`, 저장소는 `team-{단어}/{단어}` 조합이다(`cosmos-graph.ts`).
- 프로그램 항성의 이름만 예외다. 공개 응답이 도착하면 프로그램명을 앞에서부터 갈아 끼운다(배치는 다시 잡지 않는다). 도착 전이거나 개수가 모자라면 사업단 프로그램 유형 이름(`오픈소스 해커톤`, `OSS 기여 챌린지` 등)으로 채운다.
- 두 번째 패널의 수치는 공개 그래프에서 센 값이다. 0이면 숫자 대신 `—`를 쓰고, 출처 배지로 `공개 아카이브 기준` · `예시 데이터 기준` · `공개 집계 준비 중` · `일부 집계`를 구분한다. 없는 값을 0으로 채우지 않는다.
- 랜딩 전용 새 공개 API를 만들지 않는다. 읽는 곳은 기존 공개 응답 셋(`programs`, `repositories/public`, `repositories/:id/public`)뿐이고(`features/landing/api.ts`), 개인 활동은 권한이 확인된 대시보드 뒤에 둔다.

#### 공개 그래프는 두 단계로 도착한다

공개 목록(`GET /projects`)에는 기여자가 없다. 기여자는 상세(`GET /projects/:id`)에만 있고, 여러 프로젝트의 기여자를 한 번에 주는 공개 엔드포인트는 백엔드에 없다(`PublicProjectsController`는 목록과 단건 상세 둘뿐). 그래서 요청 수는 줄이지 못한다. 줄인 것은 기다리는 시간이다.

| 단계 | 무엇으로 세우나 | 화면 |
| --- | --- | --- |
| 1단계 `base` | 목록 응답 하나 | 프로그램·저장소 노드가 곧바로 선다. 기여자는 아직 0이라 `—` |
| 2단계 `complete` | 상세 응답들(동시 요청) | 기여자 노드를 얹는다 |

예전에는 상세가 전부 도착할 때까지 예시 그래프를 붙들고 있었다. 이제 진짜 공개 그래프가 보이기까지의 왕복이 2회에서 1회로 줄었다(`features/landing/api.ts`의 `streamLandingGraph`).

#### 일부만 도착한 집계는 정확한 수로 내보이지 않는다

상세 요청에서 일어나는 실패는 두 가지이고, 둘을 같이 다루지 않는다.

| 실패 | 무엇이 일어났나 | 어떻게 다루나 |
| --- | --- | --- |
| 전송 실패 | 요청 자체가 실패했다 | 그 프로젝트의 기여자만 빠진다. 그래프에는 `partial` 표가 남는다 |
| 계약 위반 | 응답은 왔는데 형식이 계약과 다르다 | 2단계를 통째로 실패시키고 1단계 그래프에 머문다 |

두 실패를 한 `catch`로 삼키면 안 된다. 계약을 어긴 응답을 조용히 건너뛰면, 줄어든 기여자 수가 `공개 아카이브 기준`이라는 정확한 수치로 화면에 걸린다. 틀린 수를 맞는 수처럼 보여 주느니 화면에 내보내지 않는다.

전송 실패는 사정이 다르다. 목록까지 버리면 진짜 공개 데이터를 다 들고도 예시 그래프로 되돌아가므로, 실패는 그 프로젝트의 기여자 선에서 끊는다. 대신 줄어든 집계라는 사실을 화면까지 전달한다(`LandingGraphCompleteness`). `partial`이면 두 번째 패널은 기여자 자리를 `—`로 비우고 배지를 `일부 집계`로 바꾼다. 프로그램·저장소 수는 목록 하나에서 나오므로 그대로 정확하고, 그대로 둔다.

목록 자체가 실패하면 세울 그래프가 없다. 종전대로 던져 호출부가 예시 그래프로 되돌아가게 둔다.

#### 보조 요소

| 요소 | 위치와 동작 |
| --- | --- |
| 건너뛰기 링크 | 무대 왼쪽 위. 평소에는 위로 밀어 두고 키보드 포커스에서만 내려온다. `로그인·프로그램 정보로 건너뛰기` → 여정 아래 `#landing-entry` |
| 진행 표시 | 왼쪽 아래 세로 눈금 5개. 활성 눈금은 길어지고 밝아지며 `aria-current="step"`이 붙는다 |
| 범례 | 오른쪽 아래 알약 형태. 학생·저장소·프로그램 점과 이름, 끝에 `예시 구성` |
| SCROLL 힌트 | 화면 하단 중앙. 진행도 0.08에서 완전히 사라진다. 깜빡이지 않는 정적인 선 하나만 딸린다 |
| 알림 슬롯 | 첫 패널 안. 로그인 실패는 `--hero-danger` 색 Alert, 로그아웃 안내는 `role="status"` 상자 |

#### 여정의 접근성

- canvas는 `aria-hidden="true"`인 장식 계층이다. 관계도를 조작하는 DOM 노드는 두지 않고, 내용 전달은 다섯 패널의 실제 텍스트가 전담한다.
- 각 패널은 `aria-labelledby`를 가진 `section`이고, `h1`은 문서 전체에서 첫 패널의 것 하나뿐이다.
- 보이지 않는 패널은 `inert` + `aria-hidden="true"` + `pointer-events: none`이라 키보드 탭이 들어가지 않는다.
- 여정 전용 건너뛰기 링크와 별개로, 전역 `본문으로 건너뛰기`(`#main-content`)가 layout에 따로 있다.
- 진행 눈금은 각각 `1단계`…`5단계` 스크린 리더 텍스트를 갖고, 목록에는 `소개 진행 상태` 라벨이 붙는다.
- 범례는 `aria-hidden`이지만 학생·저장소·프로그램이라는 같은 구분이 패널 본문 문장에 텍스트로 남는다. 색만으로 구분되는 정보는 없다.

#### 모션 축소

`prefers-reduced-motion: reduce`이면 컨테이너에 `data-motion="reduce"`가 붙고 다음이 적용된다.

- `560vh`와 sticky를 해제한다. 무대 높이가 auto가 되고 다섯 패널이 문서 흐름에 차례로 쌓인다(모두 불투명, transform 없음).
- 렌더 루프를 아예 시작하지 않는다. canvas는 진행도 0으로 한 번만 그리고 크기가 바뀔 때만 다시 그린다. 카메라 이동·속도선·시간 기반 회전이 전부 없다.
- 진행 표시와 SCROLL 힌트는 감춘다. 범례는 문서 흐름 안으로 내려온다. 건너뛰기 링크와 모든 CTA는 그대로 둔다.
- 첫 패널은 고정 헤더에 가리지 않도록 위 여백을 더 준다.

#### 반응형

| 조건 | 조정 |
| --- | --- |
| 폭 900px 이하 | 사선 스크림을 위→아래 세로 스크림으로 바꾼다. 그래프 중심이 화면 한가운데로 오고 라벨 좌측 금지 구역이 없어진다. 프레임 예산도 33ms로 본다(그 위는 16.7ms) |
| 폭 820px 이하 | 범례와 진행 표시를 감춘다 |
| 높이 520px 이하(가로모드 폰) | 패널 세로 중앙을 28px 내려 eyebrow가 고정 헤더 뒤로 들어가지 않게 하고, 제목·여백·통계 크기를 줄이며 SCROLL 힌트를 감춘다. 패널 구성과 순서는 그대로다 |

패널 좌우 인셋은 `clamp(16px, 6vw, 96px)`, 최대 너비 720px이다.
제목은 `clamp(24px, 5.4vw, 62px)`(h1)과 `clamp(22px, 3.6vw, 42px)`(h2), 본문은 `clamp(15px, 1.3vw, 18px)` / line-height 1.75 / 최대 40em이며 한국어 줄바꿈은 `word-break: keep-all`이다.
버튼은 기존 Button 프리미티브를 쓰고 터치 타깃은 최소 44px를 유지한다.

#### 성능

- canvas 배율은 `min(devicePixelRatio × 품질계수, 2)`다. 품질계수는 1 → 0.75 → 0.5 세 단계이고, 12프레임 표본의 p95가 예산을 넘으면 한 창 만에 한 단계 내린다. 올릴 때는 기준을 비대칭으로 둬서, p95가 예산의 70% 이하로 들어온 창이 세 번(36프레임) 연속돼야 한 단계 올린다. 경계값은 복귀 쪽에 포함된다 — 정확히 70%인 창도 여유로운 창으로 센다. 그 사이 70%를 넘긴 창이 하나라도 끼면 연속 기록은 0으로 돌아간다. 여유선과 연속 조건만으로는 출렁임이 잡히지 않는다 — 프레임 비용이 품질계수를 따라 달라지는 기기에서는 낮은 단계의 여유가 진짜여도 올라간 뒤에는 남아 있지 않아, 올렸다 내렸다를 반복한다. 그래서 올린 직후 **첫 창**이 예산을 넘기면 그 단계를 한 번 더 시험하고, **연속 두 번** 그렇게 무너질 때만 이 기기의 한계로 적어 세션 내내 다시 넘보지 않는다. 첫 창 한 번의 실패를 증거로 쓰지 않는 이유는, 올리는 순간 canvas와 블룸 버퍼를 더 큰 크기로 다시 잡아 전환 비용이 그 창에 섞이고 GC 멈춤도 하필 그때 들어올 수 있어서다 — p95는 12표본의 최댓값이라 느린 프레임 하나면 창 전체가 떨어진다. 첫 창이 예산 안으로 들어오면 그 단계는 검증된 것으로 보고, 이후의 멈춤은 몇 번이든 한계로 쌓지 않는다. 실패 기록은 **다음 시도 대상이 바뀌는 순간 지운다** — 승격과 무관하게 더 내려갔을 때(다음 시도는 아래 단계)와 승격이 첫 창을 통과했을 때(다음 시도는 위 단계) 모두다. 그러지 않으면 서로 다른 두 단계에서 한 번씩 미끄러진 것이 합산돼, 한 번밖에 실패하지 않은 단계가 금지된다. 오르내림은 항상 한 단계씩이다.
- 무대가 뷰포트를 벗어나거나 탭이 비활성이면 `requestAnimationFrame` 루프를 멈춘다(IntersectionObserver + `visibilitychange`).
- 스크롤·리사이즈 리스너는 진행도만 갱신하고 그리기는 루프 한 곳에서만 한다. 스크롤은 passive 리스너다.
- 언마운트에서 루프·리스너·옵저버를 모두 해제하고 블룸 버퍼와 투영 배열을 비운다.
- 힘 기반 레이아웃은 마운트 시 한 번만 돌고 결과가 굳는다. 프레임마다 노드 쌍을 다시 비교하지 않는다.
- 가입 동선 네 화면(`app/_shell/signup-starfield.tsx`)의 별밭은 이 canvas를 재사용하지 않는다. 움직일 카메라가 없어 정적 SVG 한 장(고정 seed로 뽑은 3층, `preserveAspectRatio="xMidYMid slice"`)으로 굳혔다 — 렌더 루프가 없으므로 위 화질 거버너의 대상이 아니다.

#### 색 토큰

`globals.css`의 `--cosmos-*` semantic 토큰은 DOM 계층(패널·범례·진행 표시·버튼)만 칠한다.
canvas 안의 색은 `cosmos-theme.ts`의 RGB 상수 세트(`DAWN_THEME`)에서 나온다.
약관 전문 문서(`public/policies/policy-document.css`)도 세 번째 사본이다 — 그 문서는 `sandbox=""` iframe 안의 별도 문서라 이 변수들을 물려받지 못해 같은 palette 값을 리터럴로 다시 선언한다. **세 곳이 분리돼 있으므로 우주 색을 바꿀 때는 셋을 함께 본다.**

| semantic 토큰 | 참조 | 소비처 |
| --- | --- | --- |
| `--cosmos-void` | `#00133a` (ramp 밖, `sky[0]`과 같아야 함) | 여정 컨테이너 배경, 가입 동선 바탕 |
| `--cosmos-copy` | `--palette-white` | 제목·본문 기본색, 활성 진행 눈금, 링크·외곽선 버튼 |
| `--cosmos-muted` | `--palette-navy-200` | eyebrow, 본문, 범례, 비활성 눈금, SCROLL 힌트 |
| `--cosmos-repository` | `--palette-green-300` | 흐름 패널의 STEP 번호 |
| `--cosmos-edge` | `--palette-navy-300` | 통계 항목명 |
| `--cosmos-border` | white 12% | eyebrow·외곽선 버튼·출처 배지·범례·건너뛰기 링크 테두리 |
| `--cosmos-danger` | `--palette-red-300` | 어두운 바탕 위 경고 글자(동의 화면의 거부 안내). 반전 스코프가 `--destructive`를 `--hero-danger`로 덮으므로 그쪽을 쓸 수 없다 |
| `--cosmos-near` | `--palette-navy-950` | 좁은 화면 약관 전문 팝업의 판 바탕 |
| `--cosmos-student` | `--palette-navy-200` | 정의만 있다 — 범례의 학생 점은 canvas 테마와 맞춘 인라인 색을 쓴다 |
| `--cosmos-scrim-strong` · `--cosmos-scrim-soft` | black 95% · 48% | 정의만 있다 — 스크림은 현재 CSS module에서 같은 값의 리터럴로 쓴다 |

여정 아래 밝은 구간과 하단 CTA는 기존 `--hero-*` 반전 표면 토큰을 그대로 쓴다.

#### 세션별 주 CTA

여정 자체는 세션과 무관하게 같고, 첫 패널과 마지막 패널의 주 버튼만 바뀐다(`app/_shell/landing-entry-action.tsx`). 자동 역할 홈 리다이렉트는 하지 않는다.

| 세션 상태 | 주 버튼 | 목적지 |
| --- | --- | --- |
| 확인 중 | `세션 확인 중` (비활성, `aria-busy="true"`) | — |
| 익명 | `회원가입 / 로그인` — 로그인 실패 뒤에는 `로그인 다시 시도` | `/signup` |
| 로그인·역할 미확정 | `회원가입 / 로그인` — 비로그인과 **같은** 버튼 | `/signup` |
| 학생 | `내 대시보드` | `/dashboard` (본문: 학생 대시보드) |
| 교직원 | `운영 대시보드` | `/dashboard` (본문: 운영 대시보드) |
| 관리자 | `운영 대시보드` | `/dashboard` (본문: 운영 대시보드. 관리 도구도 같은 대시보드 아래) |
| 조회 실패 | `회원가입 / 로그인` — 비로그인과 **같은** 버튼을 그대로 낸다 | `/signup` |

익명과 역할 미확정이 목적지를 공유하는 이유는 **진입점이 둘이어도 목적지는 하나여야 하기** 때문이다 — 사용자 눈에는 둘 다 "들어가기"일 뿐이고, 재개 지점 판단은 `/signup`이 대신하므로 `가입 계속하기`라는 별도 갈래를 두지 않는다(`features/auth/signup-entry-link.ts`).

조회 실패에서 버튼을 지우면 첫 화면에 진입로가 하나도 남지 않는다 — 히어로의 주 버튼이 사라지고 헤더에도 남지 않아(`features/auth/session-view.ts`가 실패를 `null`로 접는다) "프로그램 둘러보기" 하나만 남는다. 유일한 복구 수단인 `SessionError` 배너는 문서 5,400px 지점이다. 역할을 모르니 역할 홈으로는 보낼 수 없지만 진입 수단은 세션과 무관하므로, 진입점이 둘이어도 목적지가 갈라지지 않게 비로그인 버튼을 재사용한다.
버튼만 비로그인과 같게 두면 "로그아웃됐다"로 읽히므로 버튼 아래에 실패 사실과 "로그아웃된 것은 아니다"를 `SessionError`와 같은 어조로 함께 적는다. 이 문단은 어두운 표면에서 `--muted-foreground`가 묻히므로 `inverted` 여부로 색을 나눈다.
nav는 조회 실패에서 종전대로 링크를 숨긴다(`role-home-link.tsx`). 모든 화면 상단에 얹히는 자리라 실패 사실을 함께 적을 공간이 없어, 버튼만 내면 같은 오해를 막을 수 없기 때문이다.

역할별 라벨은 역할 메뉴의 첫 항목에서 파생한다(`role-menus.ts` → `role-home-link.tsx`). 두 값이 갈라질 수 없다.
어두운 표면 위 버튼은 흰 배경·남색 글자로 뒤집고(`inverted`), 여정 아래 밝은 구간에서는 기본 버튼을 쓴다.

#### 여정 다음 구간

여정이 끝나면 같은 페이지 안에서 밝은 업무 레이아웃으로 이어진다(`app/page.tsx`).
순서는 `#landing-entry`(역할 안내 + 주 CTA) → (세션 조회 실패 시 오류·재시도) → 진행 중인 프로그램 → 참여 절차 → 하단 CTA → 푸터다.
이 구간은 나머지 화면과 같은 프리미티브·토큰 계약을 따르며 우주 연출을 이어받지 않는다. 혜택 카드나 역할 소개 카드로 이 순서를 늘리지 않는다.

### 접근 권한 안내

권한이 없는 화면에 들어왔을 때 조용히 되돌리지 않고 안내를 띄운다(`app/_shell/access-denied.tsx`).
조용한 리다이렉트는 사용자 입장에서 "왜 다른 화면이 떠 있지?"로 읽혀 같은 시도를 반복하게 만든다.

| 세션 상태 | 동작 |
| --- | --- |
| 확인 중 | `확인 중…` (`role="status"`) |
| 익명 | 랜딩(`/`)으로 이동 |
| 역할 미확정 | 요청 상태에 맞는 온보딩 경로로 이동 |
| 역할은 있으나 권한 밖 | 이동하지 않고 접근 권한 안내를 띄운다 |
| 조회 실패 | 어디로도 보내지 않고 오류·재시도를 보인다 |

안내 화면은 `role="alert"` 제목 `접근 권한이 없는 페이지 입니다`, 무슨 일이 있었는지 설명하는 한 문단, 돌아갈 곳 버튼 하나(외곽선, `min-h-11`)로 이루어진다. 돌아갈 곳은 호출부가 지정한 경로이고, 없으면 자기 역할 홈이다.

### 역할 선택 화면

`features/roles/components/role-selection-screen.tsx`. 선택에 따라 화면이 흔들리지 않는 것이 이 화면의 핵심 규칙이다.

| 규칙 | 방법 |
| --- | --- |
| 안내 자리를 미리 잡는다 | 역할별 다음 단계 안내가 들어갈 슬롯을 `min-h-20` 그리드로 항상 그린다. 선택 전에는 Alert와 같은 상자 규격(모서리·여백·글자 크기)의 점선 자리표시가 들어간다. 안내가 나타나도 아래 제출 버튼이 움직이지 않는다 |
| 폼 폭을 고정한다 | `w-[min(100vw-2rem,40rem)]`. 부모가 `items-center`라 폭을 내용에 맡기면 안내가 뜰 때 좌우로도 벌어졌다. 고정 폭이라 위 단계 표시와 좌우가 맞는다 |
| 카드 높이를 맞춘다 | 두 카드를 `items-stretch` 그리드에 놓고 `h-full`을 준다. 두 카드 모두 하단 한 줄 요약(`승인 없이 바로 시작합니다` / `관리자 승인이 필요합니다`)을 반드시 갖는다 |
| 선택을 도형으로 알린다 | 선택 표식은 채워진 체크 원과 빈 원이며 크기가 같다. 색(ring)만으로 상태를 알리지 않고, 상태가 바뀌어도 칸이 밀리지 않는다 |
| 한 화면에 담는다 | 위쪽 공통 셸과 온보딩 단계 표시가 쓰는 높이를 뺀 `min-h-[calc(100dvh-9rem)]`을 쓴다. **단 반려 안내가 설 때는 예외다 — 아래 참조** |

#### 「한 화면에 담는다」의 예외 — 반려 안내(#673)

교직원 요청이 반려된 사용자는 이 화면에 도착하고(#535), 카드 위에 반려 사실과 사유가
선다. 그 상자가 `선택 완료` 버튼을 좁은 화면의 접히는 선 아래로 밀어낸다. **알고
허용한 것이므로 이 표를 근거로 되돌리지 마라.**

| 375×812 | 버튼 하단 | 화면 안 | 문서 높이 |
| --- | --- | --- | --- |
| 안내 없음 | 732px | 예 | 812(스크롤 0) |
| 안내 있음 | 929px | **아니오** | 993 |

1440×900에서는 739.3px → 819px로 둘 다 화면 안이다(문서 900, 스크롤 0). 대가는 좁은
화면에만 생긴다.

근거는 세 가지다. ① 「한 화면에 담는다」는 **읽을 것이 없는 첫 가입 동선**을 전제로
쓴 규칙인데, 반려 사용자의 첫 할 일은 고르기가 아니라 **왜인지 읽기**다 — 이유를
모른 채 다시 고르면 같은 이유로 또 반려된다. ② 버튼을 화면 안에 두려면 안내가 85px
이하여야 하는데 제목 + 사유 두 줄 + 여백만으로 92px라, 사유를 인라인으로 보여 주는
한 375에서 성립하는 조합이 없다. ③ 사유를 접어 숨기면 높이는 맞지만 #673이 고치려는
결함("사유가 사용자에게 닿지 않는다")을 절반 되살린다.

대신 대가는 줄였다 — 안내 설명을 두 문장에서 한 문장으로 묶어 상자를 222px에서
202px로 낮췄고, 사유는 길이·줄 수를 제한한다(`clampRejectionReason`). 카드 가로 배치는
이 예외와 **무관하게 그대로**다: 거기서 세로로 쌓으면 안내가 없는 첫 가입자까지 함께
스크롤하게 된다. 실측 내역과 되돌리지 말아야 할 이유는
`role-selection-screen.tsx`의 `ClosedRoleRequestAlert` 주석에 있다.

라디오는 `sr-only` peer이고 라벨 전체가 클릭 영역이다. 포커스 링은 `focus-within`으로 카드에 걸리고, 제출 버튼은 `min-h-11 w-full`로 터치 타깃 44px을 확보한다.

### 업무 화면 내비게이션

**공통 상단 `NavBar`(`ShellNav`) + 섹션 컨텍스트 좌측 패널.**  
상단에서 섹션을 고르면 좌측은 **그 섹션의 피어 필터만** 보여 준다(누적 메뉴 아님).

| 항목 | 결정 |
| --- | --- |
| 바탕 | 순백색을 유지한다 |
| 상단 Nav | 프로그램 · 공개 아카이브 · 랭킹. 가입 완료 시 **대시보드**(`/dashboard`, 라벨 고정). 입구 URL은 역할 무관 하나이고, 본문·좌측 메뉴만 세션 `User.role`(DB, `/auth/me`)로 갈린다. 비회원에게는 항목 자체를 붙이지 않는다 |
| 왼쪽 사이드 패널 | **컨텍스트형** — 프로그램 `?status=` · 아카이브 `?year=` · 랭킹 `?year=` · 대시보드 역할 메뉴(학생: 저장소·활동 / 교직원: 운영 대시보드·학생 활성·가입 신청 / 관리자: 교직원 그룹(운영·학생 활성·가입 신청) + 사용자 목록·감사·시스템). 입구 URL은 `/dashboard` 하나이고 ADMIN 본문도 운영 대시보드다. 필터는 flat 피어(네스트 트리 금지). 카운트 뱃지 0도 표시. 사이드 패널에는 생성 waypoint를 두지 않는다. 프로그램 섹션에서는 프로필을 마친 교직원·관리자에게 목록 `PageHeader` CTA를 제공하며, 운영 대시보드의 화면 고유 CTA는 유지한다 |
| 모바일(&lt;900px) | 좌측 패널 숨김. 본문 칩으로 동일 필터 |
| 레이아웃 | 전체 폭 Nav 아래 `[사이드 \| 본문]`(≥900px). 랜딩·가입은 패널 없음 |
| 표면 톤 | 상단 Nav는 전 화면 기본 흰 바. `data-surface="inverted"`는 가입 본문 무대만 |
| 설정 | 계정 드롭다운. 본문 PageHeader에 사이드와 같은 waypoint CTA를 두지 않는다 |
| 강조색 | 남색을 유지하되, 한 화면에서 주 행동 하나에만 쓴다 |

카드 스타일·표 밀도 등 본문 미감 세부는 화면별로 이어 간다.
#### 프로그램 스코프 좌측 패널

프로그램 상세(`/programs/:id` 및 하위)에서는 섹션 패싯 패널 대신 **프로그램 스코프 좌측 패널**을 쓴다.
치수(폭·접힘 폭·행 높이 등)는 기존 repo 구현을 따르며, 이 문서는 **구조와 상태 표기 규약만** 규정한다.

| 항목 | 결정 |
| --- | --- |
| 3그룹 | ① 프로그램 개요 · 참여 팀 · (**교직원·관리자만**) 신청자 ② 서류(역할별 부모) + 마일스톤 depth-1 자식 ③ 게시판 |
| 신청자 | 교직원·관리자 전용. `/programs/:id/applicants` — 프로그램 신청 승인·반려 창구. 참여 팀은 현황 조회만 하므로 판정 입구를 여기와 개요 CTA에 둔다 |
| g2 부모 라벨 | 교직원·관리자: `서류 현황`. 학생: `내 제출물` |
| 마일스톤 자식 | 서류가 있는 마일스톤만 depth-1로 붙인다. 없으면 부모 항목만 둔다 |
| 항목 표기 | 아이콘 + 라벨 + 카운트 뱃지(분수·자유형식 허용, 0도 표시) |
| current | 정확히 일치하는 depth-0 항목에 마커와 `aria-current="page"`. 마일스톤 depth-1 자식에는 current 마커를 달지 않는다 |
| 브랜드 행 | 목록 패싯의 브랜드 대신 `‹ 프로그램 목록` 백링크 + 프로그램명 eyebrow. 목적지는 역할과 무관하게 `/programs` |
| 접기·마감 | 접기 토글과 마감 영역은 **펼침 상태에서만** 노출한다. 개요 응답이 아직 없거나 실패한 상태(`remainingMilestones === undefined`)에서는 마감 영역을 그리지 않는다. 개요 응답이 도착했고 남은 마감이 없으면 같은 자리에 `마감 일정이 종료되었습니다.` 한 줄을 둔다 |
| 참여자 전용 그룹 | ②·③은 참여자 전용 화면이다. 참여자가 아님이 확정된 학생에게는 그 그룹을 **그리지 않는다** — 눌리지 않는 잠금 항목을 대신 두지 않는다. 참여 여부를 아직 모르는 동안에는 그대로 둔다 |
| 두 그룹의 열쇠는 다르다 | ②(내 제출물)의 열쇠는 승인된 신청 하나뿐이다. ③(게시판)은 **관리자 접근 권한**으로도 열린다(`board-access.guard.ts`). 그래서 회원 유형이 학생이면서 관리자 권한을 가진 계정이 신청하지 않았을 때 ②는 사라지고 ③은 남는다 — 두 그룹을 한 조건으로 묶으면 열려 있는 화면으로 가는 길이 끊긴다 |

렌더는 `ProgramScopeSidebar`, 그룹 조립은 `programScopeSidebarGroups()`가 담당한다.
목록 루트(`/programs`)는 기존 상태 패싯 패널을 유지하고, `/programs/:id/*`만 이 스코프 패널로 갈린다.

마감 영역은 프로그램 스코프 패널 전용 상태 요약이다. 남은 마감 목록이 하나 이상이면 가장 가까운 마감명을 먼저 두고, 그 아래에 일·시간·분·초 4칸 셀과 서울 시간 기준 절대 시각(`YYYY.MM.DD (요일) HH:mm`)을 표시한다. 이어지는 목록은 남은 마감만 `이름 — YYYY.MM.DD HH:mm` 형식으로 나열한다. 긴 이름은 말줄임하고, 구분자와 날짜·시각은 줄바꿈하거나 잘리지 않게 유지한다. 현재 시각은 기존처럼 보조 정보로 남기되, 시각 위계는 마감명·남은 시간·절대 시각이 먼저 읽히도록 둔다.

이 규약은 랭킹 좌측 패널의 `다음 수집까지` 단일 카운트다운과 분리한다. 랭킹은 기존 단일 마감 모드, 표시 문구, 노출 조건을 유지하며 남은 마감 목록이나 종료 안내를 쓰지 않는다. 900px 미만에서는 기존처럼 데스크톱 좌측 패널이 숨겨지고, 모바일 전용 마감 카드를 새로 만들지 않는다. daker.ai 참고 화면은 구조 비교용으로만 쓰며, 공개 저장소와 PR에는 이미지·색·카피를 옮기지 않고 URL만 남긴다.

#### 서류 현황 표

교직원·관리자 서류 현황 매트릭스의 정보 구조다.

**QA49 변경** — 이전에는 셀 상태를 `제출함` / `지각` / `미제출` 3종으로 접어, 승인·보완 요청·반려가 모두
`제출함`으로 뭉개져 실제 판정 상태가 가려졌다. 이 화면이 답해야 하는 질문은 "냈나"뿐 아니라
"최신 판정이 무엇인가"이기도 하므로, 셀은 이제 최신 판정 상태를 그대로 구분해 보여준다.

| 구분 | 규약 |
| --- | --- |
| 셀 상태 6종 | `미제출` / `검토 대기` / `지각 제출` / `승인` / `보완 요청` / `반려` |
| 빈칸 | 칸에 값이 없으면 곧 `미제출`이다 |
| 통계 4종 | 서류 칸 · 빈 칸 · 한 장도 안 낸 팀 · 지각 제출 |
| 빠른 필터 3종 | 전체 · 빈 칸 있는 팀 · 한 장도 안 낸 팀. 이와 별도로 마일스톤 탭을 둔다 |
| 행 진입 | 행에서 해당 제출물 검토 화면으로 들어간다 |

**라벨 매핑** — 코드 원본은 `apps/frontend/src/features/submissions/matrix.ts`의 `MATRIX_CELL_DISPLAY_LABELS`와
`isLateSubmission()`이다. 화면 표기는 저장 상태 enum을 그대로 옮기되, 코드 문자열(`제출 전` 등)을 그대로 쓰지 않는다.

| 코드 (`MatrixCellStatus` / 판정) | 화면 표기 |
| --- | --- |
| `NOT_SUBMITTED` | `미제출` (빈칸과 동일) |
| `SUBMITTED` (마감 전 제출) | `검토 대기` |
| `SUBMITTED` + `isLateSubmission(cell, milestone) === true` | `지각 제출` |
| `APPROVED` | `승인` |
| `CHANGES_REQUESTED` | `보완 요청` |
| `REJECTED` | `반려` |

지각 판정은 검토 전(`SUBMITTED`) 셀에만 적용한다.
`isLateSubmission()`이 `submittedAt > milestone.dueAt`일 때 참이 되며, 이미 검토를 거친 승인·보완 요청·반려
셀은 지각 여부를 다시 덧붙이지 않고 판정 상태만 보여준다 — 제출 시각이 궁금하면 행의 「열어 보기」로 들어가 확인한다.
학생 화면의 `내 제출물`은 같은 제출 데이터를 개인 관점으로 보여 주며, 교직원 매트릭스 표기를 그대로 복제할 필요는 없다.

#### 게시판

프로그램 스코프 게시판의 정보 구조만 규정한다(그리드·카드 치수는 화면 구현에 맡긴다).

| 항목 | 결정 |
| --- | --- |
| 목록 | 공지와 질문을 **한 목록**에 섞어 보여 준다 |
| 본문·댓글 | 글을 열면 댓글이 같은 자리에서 펼쳐진다 |
| 역할 태그 | 댓글에 작성자 역할 태그를 붙인다 |

#### 참여 팀

프로그램 스코프의 참여 팀 공개 범위다.

| 항목 | 결정 |
| --- | --- |
| 공개 | 팀 구성과 인원만 공개한다 |
| 팀장 | 팀장을 표시한다 |
| 저장소 | 팀 저장소는 비공개다(이 화면에서 노출하지 않는다) |

### 없는 주소·렌더 실패 화면

라우트 트리가 화면을 내주지 못하는 두 경우(#1103)를 이 서비스가 직접 받는다.
`app/not-found.tsx`가 라우트 트리에 없는 모든 주소를, `app/error.tsx`가 렌더 중 예외가 난 route를 맡고, 두 파일 모두 `app/_shell/route-notice.tsx`의 `RouteNotice` 한 뼈대를 쓴다.
이 파일들이 없으면 `<html lang="ko">` 껍데기 안에 프레임워크 기본 영어 화면이 들어앉는다.

| 항목 | 결정 |
| --- | --- |
| 뼈대 | 같은 처지의 전면 안내 셋(`access-denied.tsx`·`login-required-notice.tsx`·`session-error.tsx`)의 치수를 그대로 쓴다 — `min-h-[50svh]` 가운데 정렬, `text-lg font-semibold` 제목, `max-w-md break-keep text-sm text-muted-foreground` 한 문단, `min-h-11` 버튼 |
| 삽화 | 두지 않는다. 위 전면 안내 셋이 모두 글자만 쓰고 `EmptyState` 53곳 중 40곳도 아이콘이 없다(2026-09-04 전수 확인) — 여기만 그림이 있으면 결이 어긋난다 |
| 없는 주소의 목적지 | `프로그램 목록으로`(`/programs`, 주 행동)와 `이전 화면`(`router.back()`) 둘. `/dashboard`는 쓰지 않는다 — 역할마다 본문이 갈리는 자리라 주소를 잘못 눌렀을 뿐인 사람을 자기 역할 화면으로 밀어 넣게 된다 |
| 렌더 실패의 목적지 | `다시 시도`(Next가 넘겨주는 `reset`, 주 행동)와 `프로그램 목록으로`. R-10의 「재시도 또는 대체 경로」를 둘 다 준다 |
| 숫자 표기 | `404`와 오류 digest는 제목 자리에 크게 세우지 않고 본문 아래 `text-xs text-muted-foreground` 한 줄로만 남긴다. 개발자·문의 창구에는 단서지만 학생에게는 아니다 |
| 강조색 | 주 행동 하나만 `default`(남색), 나머지는 `outline`. 새 색을 만들지 않는다 |
| live region | 두지 않는다. R-12는 `role="alert"`을 상호작용 중 발생한 동적 error에만 허용하고 이 둘은 그 route의 초기 렌더 콘텐츠다 |
| 예외 메시지 | `error.message`를 화면에 옮기지 않는다. 배포 빌드는 Next가 지워 digest만 남기고, 개발 빌드는 내부 구현이 영어 그대로 드러난다 |

범위는 두 경우까지다 — 로딩 중 화면(`loading.tsx`)과 root layout 자체가 던지는 경우(`global-error.tsx`)는 이 결정에 들어 있지 않다.

`/programs/:id`처럼 **라우트는 있고 데이터만 없는** 주소는 여기로 오지 않는다.
그 자리는 각 화면이 이미 자기 문구로 받는다(`ProgramDetailFailureState`의 `프로그램을 찾을 수 없습니다`).
