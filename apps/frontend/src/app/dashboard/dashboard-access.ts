import type { AppRole } from '../_shell/role';

/**
 * `/dashboard` 접근 허용 역할 — 역할이 확정된 회원 전원.
 *
 * 대시보드는 **회원 공통 입구**다. 상단 Nav의 「대시보드」는 역할과 무관하게 이 경로
 * 하나를 가리키고(`app-frame.tsx`), 갈리는 것은 URL이 아니라 본문
 * (`dashboard-home.tsx`)과 좌측 역할 메뉴(`role-menus.ts`)다.
 *
 * 목록을 상수로 빼 둔 이유는 이 목록이 좁아지는 것이 곧 이 화면의 결함이었기
 * 때문이다 — `allow={['STUDENT']}`이던 시절 STAFF·ADMIN은 **자기에게 보이는** 상단
 * 메뉴를 눌러 "접근 권한이 없는 페이지"로 떨어졌다. 본문 분기 테스트
 * (`dashboard-home.test.tsx`)는 그 회귀를 잡지 못한다. 본문은 게이트를 통과한
 * 뒤에야 그려지므로, 게이트가 닫히면 그 테스트는 초록인 채로 화면만 죽는다.
 * 계약을 여기 두고 `dashboard-access.test.ts`에서 못 박는다.
 *
 * 역할이 아직 없는 사용자는 여기서 가리지 않는다 — 가입 미완료는 권한 문제가 아니라
 * 남은 단계라, `RoleGate`가 온보딩으로 되돌린다.
 */
export const DASHBOARD_ALLOWED_ROLES: readonly AppRole[] = [
  'STUDENT',
  'STAFF',
  'ADMIN',
];
