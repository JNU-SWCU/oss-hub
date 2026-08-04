<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-20 · Updated: 2026-08-01 (공개 무인증 라우트 archive/ranking/profile 추가) -->

# apps/frontend/src/app — 라우트 골격

## Purpose

Next.js App Router 라우트. 역할 기반(STUDENT/STAFF/ADMIN) 화면 접근 제어와 공통 상단 NavBar(+ 회원 왼쪽 내 상황 사이드바)를 `_shell/` 공용 컴포넌트로 통일해 각 라우트의 `page.tsx`는 대부분 조합만 담당하는 얇은 파일이다.

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
| `signup/` | `/signup` | 게이트 없음 — 가입·로그인 진입. 로그인한 사용자는 화면 안에서 멈춘 자리(`/consent` 또는 역할 홈)로 되돌린다 |
| `consent/` | `/consent` | `AuthGate`(로그인만 요구, 역할 무관) |
| `settings/` | `/settings` | `AuthGate`(로그인만 요구, 역할 무관) — #156 프로필·알림 설정 |
| `onboarding/role/`, `onboarding/pending/` | `/onboarding/role`, `/onboarding/pending` | `AuthGate` |
| `dashboard/` | `/dashboard` | `STUDENT` |
| `my-repos/` | `/my-repos` | 로그인한 모든 역할(학생 메뉴 아래 있지만 role 무관 접근 허용) |
| `programs/`, `programs/[id]/apply/`, `programs/[id]/milestones/[milestoneId]/submit/` | `/programs`, 신청, 마일스톤 제출 | 화면별 상이 — 각 `page.tsx` 주석 확인 |
| `staff/dashboard/`, `staff/programs/new/`, `staff/programs/[id]/submissions/[submissionId]/review/` | 운영 화면 | `STAFF` |
| `admin/access/`, `admin/audit-log/`, `admin/system-status/` | 관리 콘솔 | `ADMIN` |
| `archive/`, `archive/[repositoryId]/` | `/archive`, `/archive/:repositoryId` | 공개 — 게이트 없음(비로그인 접근 가능), `public-projects/` 목록·상세 API 소비 |
| `ranking/` | `/ranking` | 공개 — 게이트 없음(비로그인 접근 가능) |
| `profile/[userId]/` | `/profile/:userId` | 공개 — 게이트 없음(비로그인 접근 가능), `public-projects/`의 공개 프로필 API 소비 |

## For AI Agents

- **`_shell/`는 Next.js 라우트가 아니다** — 파일명이 밑줄로 시작해 라우팅에서 제외되는 private 폴더로, 여러 라우트가 공유하는 역할 게이트·패널 컴포넌트만 담는다(괄호 route group이 아님에 주의). 새 화면을 추가할 때는 이 폴더의 컴포넌트를 가져다 쓰고, 화면별로 게이트 로직을 새로 만들지 않는다.
  - `role.ts` — `AppRole = 'STUDENT' | 'STAFF' | 'ADMIN'`과 `roleHomePath(role)`(role 불일치 시 되돌아갈 "자기 역할 홈" — STUDENT→`/dashboard`, STAFF→`/staff/dashboard`, ADMIN→`/admin/access`).
  - `use-session-role.ts` — `/auth/me`를 호출해 `{status: 'loading'|'anonymous'|'unassigned'|'assigned', role}`를 반환하는 훅. `features/auth`(owner 전속)가 아직 응답에 `role`을 노출하지 않아 이 훅 안에서만 로컬로 타입을 넓혀 쓴다 — owner 경로는 건드리지 않는다.
  - `role-gate.tsx`(`RoleGate`) — 비로그인은 `/`, 역할 미확정은 `/onboarding/role`, `allow`에 없는 역할은 `roleHomePath()`로 리다이렉트. `auth-gate.tsx`(`AuthGate`)는 로그인 여부만 확인(역할 무관 공용 화면용).
  - `role-menus.ts` — `STUDENT_MENU`/`STAFF_MENU`/`ADMIN_MENU`(`NavItem[]`). **왼쪽 “내 상황” 사이드바** 원본. id 문맥 경로(신청·제출·검토)는 상세 흐름이라 고정 메뉴에 넣지 않는다.
  - `public-menus.ts` — `PUBLIC_MENU`. **상단 Nav 전담** 공개 항목 원본(#513). 프로그램(신청 입구)·공개 아카이브·랭킹. `/`는 브랜드, `/settings`는 계정 드롭다운.
  - `app-frame.tsx`(`AppFrame`) — 항상 상단 `ShellNav`(`PUBLIC_MENU`). 가입 전 경로만 본문 직결, 그 외는 `ProductShell`(회원만 왼쪽 사이드바). 랜딩과 업무가 같은 Nav 컴포넌트를 재사용한다.
  - `shell-nav.tsx`(`ShellNav`) — `NavBar` 래퍼. 랜딩 fixed+표면 전환, 가입 cosmos inverted, 그 외 흰 바.
  - `product-shell.tsx`·`app-sidebar.tsx`·`sidebar-menu.ts` — 상단 Nav **아래** 내 상황 레일. 역할 메뉴만, 공개 없음. 접힘 `localStorage['oss-hub-sidebar']`.
  - `signup-completion.ts`(`isSignupComplete`·`shouldShowAccountSlot`) — **"이 사람이 회원인가"의 단일 판정**. 가입은 약관 → 역할 → 프로필을 다 마쳐야 끝나고, GitHub 로그인만으로는 회원이 아니다. 승인 대기 교직원(`unassigned` + 살아 있는 역할 요청)은 역할이 비어 있어도 회원으로 본다 — 세션의 `isProfileComplete`는 **배정된 역할** 기준이라 그 사람에게는 쓸 수 없다(backend `auth/auth.repository.ts`). 새 화면이 "회원인가"를 물어야 하면 여기서 읽고, 화면마다 판정을 다시 만들지 않는다.
  - `account-slot.tsx`(`AccountSlot`) — 헤더 오른쪽 계정 슬롯. 위 판정으로 `LoginButton`을 낼지만 정한다. 가입을 마치지 않은 사람은 가입 절차 화면(`signup-routes.ts`의 `SIGNUP_FLOW_PATHS`) 안에서만 계정 표식을 본다 — 밖에서는 그 표식이 "회원이다"로 읽힌다. 비로그인은 언제나 낸다(그 슬롯이 곧 로그인 버튼이다).
  - `role-home-link.tsx`(`SessionEntryNavLink`) — actions 가입 재개 링크. 가입 완료 역할 홈은 왼쪽 사이드바에 있으므로 actions에서는 숨긴다.
  - `role-panel-shell.tsx`(`RolePanelShell`) — `RoleGate`만 감싼다. 메뉴 prop 없음.
  - `ticket-stub.tsx`(`TicketStub`) — 아직 미구현 화면을 `EmptyState` + 이슈 링크로 채우는 표준 스텁. 화면을 실제로 구현하기 전까지는 이 컴포넌트로 채운다.
- 새 라우트의 전형적 패턴: `RolePanelShell allow={[...]}` 안에 `TicketStub` 또는 실제 화면 컴포넌트를 넣는다(`dashboard/page.tsx` 참조). 메뉴는 넘기지 않는다 — 상단·사이드바가 셸에서 조립한다.
- 서버 사이드 접근 강화(middleware)는 아직 이 라우트 골격 범위 밖이다 — `RoleGate`/`AuthGate`는 클라이언트 사이드 redirect만 수행한다.

## Dependencies

- [apps/frontend/src/AGENTS.md](../AGENTS.md)
- `features/auth`(`fetchMe`) — `use-session-role.ts`가 의존.
- `components/`(`DetailPanelLayout`·`EmptyState`·`NavItem` 등) — `_shell/`이 조합해 쓴다.
