# Frontend Design

이 문서는 frontend 스킬 게이트가 참조하는 디자인 계약이다.
색상·타이포그래피는 sojoong.kr의 톤(남색 계열 주조색, 녹색 계열 보조색, 짙은 회색 본문색)을 기준으로 삼는다.
토큰은 primitive → semantic → component 3-tier 구조로 관리하며, 실제 정의는 `apps/frontend/src/app/globals.css`에 있다.
프리미티브 컴포넌트는 shadcn CLI(`radix-nova` 스타일, radix-ui 기반)로 생성하고 소유권은 레포 내부(`apps/frontend/src/components/ui/`)에 둔다.
이번 문서·PR은 토큰과 프리미티브만 다루며, AppShell/CardGrid/DataTable 같은 조합 컴포넌트(12종)는 다음 단계(B-6)에서 만든다.

## 구현 스택

`package.json`에 추가된 의존성과 이 문서의 대응 관계다.

- `tailwindcss` / `@tailwindcss/postcss` / `postcss` — Tailwind v4 CSS-first 설정. `@theme inline`을 쓰며 JS 설정 파일이 없다.
- `shadcn` — 프리미티브 생성 CLI. 생성 직후부터 소유권이 레포 코드로 귀속되며 이후 이 패키지 자체에 런타임 의존은 없다.
- `radix-ui` — 프리미티브의 접근성 동작(포커스 트랩, ARIA, 키보드 내비게이션)을 제공하는 헤드리스 라이브러리.
- `class-variance-authority` — 컴포넌트 variant(색상/크기 등) 클래스 조합 관리.
- `clsx` + `tailwind-merge` — `cn()` 헬퍼로 클래스 병합·충돌 해소.
- `lucide-react` — 아이콘 세트.
- `tw-animate-css` — 애니메이션 유틸리티 클래스.

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
| 위험/오류 | `--destructive` | `--palette-red-500` | 상태 표시 보조 램프 |
| 반전 표면(hero) | `--hero-*` | navy 램프(`--palette-navy-950` 포함) | 랜딩 히어로의 어두운 표면. `.dark`에서도 반전하지 않는다 |
| 반전 표면(hero) 오류 | `--hero-danger` | `--palette-red-100` (`#f3c6c6`) | navy-900 대비 명도비 약 10.9:1(AA 통과). `destructive` variant는 밝은 표면 전용이라 히어로에는 쓰지 않는다 |

`--status-*` semantic 그룹(모집중/마감/대기/승인/반려)은 이번 단계에서 토큰만 정의하고, 이를 소비하는 StatusBadge 컴포넌트는 만들지 않는다(B-6 범위).
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

6종 모두 `npx shadcn@latest add`로 생성했다(`radix-nova` 스타일).
파일은 `apps/frontend/src/components/ui/`에 있고, 생성 직후부터 소유권은 레포 코드로 귀속된다(외부 패키지 런타임 의존이 아니다).

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

## 패턴

아래 이름은 레이아웃 뼈대(구조)를 가리키는 어휘이고, 실제 조합 컴포넌트(AppShell/CardGrid/DataTable 등)는 이번 단계에서 만들지 않는다(B-6 범위).
이 절은 그 컴포넌트들이 앞으로 따를 뼈대만 미리 못박는다.

### 페이지 레이아웃

- **AppShell** → viewport-shell. 헤더/네비게이션이 고정되고 본문이 뷰포트를 채우는 전체 뼈대.
- **CardGrid** → grid-repetition(card-grid). 동일한 카드가 그리드로 반복되는 목록 뼈대.
- **DetailPanelLayout** → split-sidebar. 좌측 목록/우측 상세(또는 그 반대)로 나뉜 2분할 뼈대.
- **StatusMessagePage** → viewport-shell/cover. 로그인 오류, 빈 상태 등 뷰포트 전체를 덮는 단일 메시지 뼈대.

### 폼과 검증

`Field` + `FieldLabel` + `FieldDescription` + `FieldError` 조합을 표준 패턴으로 쓴다.
에러는 `FieldError`가 `role="alert"`로 렌더링해 스크린 리더에 즉시 통지한다.

### 로딩·빈 상태·오류 상태

오류/빈 상태 메시지는 `Alert` + `AlertTitle` + `AlertDescription` 조합을 표준으로 쓴다.
로딩 상태 전용 컴포넌트(스켈레톤 등)는 이번 단계 범위 밖이며 필요 시 B-6에서 추가한다.

### 접근성

프리미티브는 radix-ui 기반이라 포커스 트랩·키보드 내비게이션·ARIA role이 기본 제공된다.
`Field`/`FieldLabel`은 `htmlFor`/`id` 연결을 구조적으로 강제해 라벨-컨트롤 연결 누락을 막는다.
주조색(`--primary`)과 위험색(`--destructive`)은 흰 배경 대비 충분한 명도 대비를 확보하도록, sojoong.kr 원색보다 어둡거나 채도를 높인 값을 palette anchor로 선택했다.
