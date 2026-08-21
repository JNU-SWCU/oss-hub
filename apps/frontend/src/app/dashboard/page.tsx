import { RolePanelShell } from '../_shell/role-panel-shell';
import { DASHBOARD_ALLOWED_SURFACES } from './dashboard-access';
import { DashboardHome } from './dashboard-home';

/**
 * 회원 공통 대시보드 입구(URL: `/dashboard`).
 *
 * 접근: 가입 완료 회원 전원(STUDENT · STAFF · ADMIN). 비로그인·역할 미확정·
 * 프로필 미완료는 `RoleGate`가 랜딩·온보딩으로 보낸다 — 이 화면에서
 * "접근 권한이 없는 페이지"를 띄우지 않는다. 본문은 세션 역할로만 갈린다
 * (`dashboard-home.tsx`).
 *
 * 관리 도구는 `/admin/*`만 담당한다. 운영 대시보드 입구는 이 경로 하나다.
 */
export default function DashboardPage() {
  return (
    <RolePanelShell allow={DASHBOARD_ALLOWED_SURFACES}>
      <DashboardHome />
    </RolePanelShell>
  );
}
