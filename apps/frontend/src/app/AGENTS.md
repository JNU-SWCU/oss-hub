<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-20 -->

# apps/frontend/src/app — 라우트 골격

## Purpose

Next.js App Router 라우트. 역할 기반(STUDENT/STAFF/ADMIN) 화면 접근 제어와 좌측 메뉴 패널을 `_shell/` 공용 컴포넌트로 통일해 각 라우트의 `page.tsx`는 대부분 조합만 담당하는 얇은 파일이다.

## Key Files

| 파일 | 역할 |
| --- | --- |
| `layout.tsx` | 루트 레이아웃 |
| `page.tsx` | 랜딩 페이지(비로그인 진입점) |
| `globals.css` | 디자인 토큰(primitive → semantic → component 3-tier, `docs/design.md` 원본) |

## Subdirectories

| 경로 | 라우트 | 접근(허용 role) |
| --- | --- | --- |
| `_shell/` | (라우트 아님 — 아래 참조) | — |
| `consent/` | `/consent` | `AuthGate`(로그인만 요구, 역할 무관) |
| `onboarding/role/`, `onboarding/pending/` | `/onboarding/role`, `/onboarding/pending` | `AuthGate` |
| `dashboard/` | `/dashboard` | `STUDENT` |
| `my-repos/` | `/my-repos` | 로그인한 모든 역할(학생 메뉴 아래 있지만 role 무관 접근 허용) |
| `programs/`, `programs/[id]/apply/`, `programs/[id]/milestones/[milestoneId]/submit/` | `/programs`, 신청, 마일스톤 제출 | 화면별 상이 — 각 `page.tsx` 주석 확인 |
| `staff/dashboard/`, `staff/programs/new/`, `staff/programs/[id]/submissions/[submissionId]/review/` | 운영 화면 | `STAFF` |
| `admin/staff-requests/`, `admin/users/`, `admin/audit-log/`, `admin/system-status/` | 관리 콘솔 | `ADMIN` |

## For AI Agents

- **`_shell/`는 Next.js 라우트가 아니다** — 파일명이 밑줄로 시작해 라우팅에서 제외되는 private 폴더로, 여러 라우트가 공유하는 역할 게이트·패널 컴포넌트만 담는다(괄호 route group이 아님에 주의). 새 화면을 추가할 때는 이 폴더의 컴포넌트를 가져다 쓰고, 화면별로 게이트 로직을 새로 만들지 않는다.
  - `role.ts` — `AppRole = 'STUDENT' | 'STAFF' | 'ADMIN'`과 `roleHomePath(role)`(role 불일치 시 되돌아갈 "자기 역할 홈" — STUDENT→`/dashboard`, STAFF→`/staff/dashboard`, ADMIN→`/admin/staff-requests`).
  - `use-session-role.ts` — `/auth/me`를 호출해 `{status: 'loading'|'anonymous'|'unassigned'|'assigned', role}`를 반환하는 훅. `features/auth`(owner 전속)가 아직 응답에 `role`을 노출하지 않아 이 훅 안에서만 로컬로 타입을 넓혀 쓴다 — owner 경로는 건드리지 않는다.
  - `role-gate.tsx`(`RoleGate`) — 비로그인은 `/`, 역할 미확정은 `/onboarding/role`, `allow`에 없는 역할은 `roleHomePath()`로 리다이렉트. `auth-gate.tsx`(`AuthGate`)는 로그인 여부만 확인(역할 무관 공용 화면용).
  - `role-menus.ts` — `STUDENT_MENU`/`STAFF_MENU`/`ADMIN_MENU`(`NavItem[]`). id가 필요한 문맥적 경로(신청·마일스톤 제출·제출물 검토)는 상세 화면에서 진입하는 흐름이라 고정 메뉴에 넣지 않는다.
  - `role-panel-shell.tsx`(`RolePanelShell`) — `RoleGate` + `DetailPanelLayout`을 좁은 메뉴(좌측)와 본문(우측)으로 조합. `menu`(표시할 메뉴)와 `allow`(접근 허용 role)를 분리 인자로 받는다 — 화면마다 둘이 항상 같지는 않다.
  - `ticket-stub.tsx`(`TicketStub`) — 아직 미구현 화면을 `EmptyState` + 이슈 링크로 채우는 표준 스텁. 화면을 실제로 구현하기 전까지는 이 컴포넌트로 채운다.
- 새 라우트의 전형적 패턴: `RolePanelShell menu={<ROLE>_MENU} allow={[...]}` 안에 `TicketStub` 또는 실제 화면 컴포넌트를 넣는다(`dashboard/page.tsx` 참조).
- 서버 사이드 접근 강화(middleware)는 아직 이 라우트 골격 범위 밖이다 — `RoleGate`/`AuthGate`는 클라이언트 사이드 redirect만 수행한다.

## Dependencies

- [apps/frontend/src/AGENTS.md](../AGENTS.md)
- `features/auth`(`fetchMe`) — `use-session-role.ts`가 의존.
- `components/`(`DetailPanelLayout`·`EmptyState`·`NavItem` 등) — `_shell/`이 조합해 쓴다.
