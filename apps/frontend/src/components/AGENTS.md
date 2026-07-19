<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-20 -->

# apps/frontend/src/components — 공유 UI

## Purpose

여러 feature 또는 라우트가 공유하는 조합 컴포넌트. `ui/`는 shadcn CLI로 생성한 프리미티브(소유권은 이 repo 내부)이고, 최상위 파일들은 그 위에 만든 조합 컴포넌트(AppShell·CardGrid·DataTable 등)다.

## Key Files

| 파일 | 컴포넌트 | 비고 |
| --- | --- | --- |
| `index.ts` | — | 공개 배럴. **append-only** — 자기 몫의 export만 추가하고 기존 줄은 리팩터링하지 않는다 |
| `app-shell.tsx` | `AppShell` | 전역 셸 레이아웃 |
| `nav-bar.tsx` | `NavBar`, `NavItem` 타입 | 상단 네비게이션 — `NavItem`은 `_shell/role-menus.ts`가 재사용 |
| `data-table.tsx` | `DataTable`, `DataTableColumn`/`DataTableProps` 타입 | |
| `detail-panel-layout.tsx` | `DetailPanelLayout` | 좁은 패널 + 넓은 본문 레이아웃 — `_shell/role-panel-shell.tsx`가 재사용 |
| `card-grid.tsx`, `program-card.tsx` | `CardGrid`, `ProgramCard` | |
| `form-section.tsx`, `page-header.tsx`, `row-actions.tsx`, `status-badge.tsx`, `status-message-page.tsx`, `empty-state.tsx` | 각 동명 컴포넌트 | |

## Subdirectories

| 경로 | 내용 |
| --- | --- |
| `ui/` | shadcn CLI 생성 프리미티브(`button`·`card`·`input`·`field`·`label`·`separator`·`table`·`alert`) — `components.json`의 `radix-nova` 스타일, radix-ui 기반 |

## For AI Agents

- 새 공유 컴포넌트를 추가하면 `index.ts`에 export를 **추가만** 한다 — 기존 줄 순서를 바꾸거나 묶어 정리하지 않는다(파일 상단 주석 규약).
- 이 디렉터리는 `docs/design.md`의 토큰 계약(3-tier: primitive → semantic → component) 소비자다. 색상·타이포그래피를 하드코딩하지 않고 `globals.css`에 정의된 토큰(및 `ui/` 프리미티브)을 통해 쓴다.
- `ui/` 밖의 파일들은 `ui/` 프리미티브를 조합한 상위 컴포넌트다 — `ui/` 프리미티브를 직접 복제하지 않고 여기서 조합한다.
- 테스트는 컴포넌트 곁에 `*.test.tsx`(Vitest)로 둔다 — `cards.test.tsx`, `data-table.test.tsx`, `detail-panel-layout.test.tsx`, `form-section.test.tsx`, `layout.test.tsx`, `row-actions.test.tsx`, `ui/primitives.test.tsx`.

## Dependencies

- [apps/frontend/src/AGENTS.md](../AGENTS.md)
- [Frontend Design](../../../../docs/design.md) — 토큰·프리미티브 계약 원본.
- `radix-ui`, `class-variance-authority`, `lucide-react`, `tailwind-merge`(`lib/utils.ts`의 `cn`).
