import { RolePanelShell } from '../../_shell/role-panel-shell';
import { StaffDashboardPage } from '@/features/programs/staff-dashboard-page';

/**
 * 운영 대시보드 딥링크(URL: `/staff/dashboard`).
 *
 * 회원 공통 입구는 `/dashboard`다. STAFF는 그 입구에서도 같은 본문을 본다.
 * 이 경로는 북마크·옛 링크·ADMIN 운영 조회용으로 유지한다(ADMIN 홈 본문은
 * 관리 콘솔이지만, 운영 요약이 필요할 때 여기로 올 수 있다).
 */
export default function StaffDashboardRoute() {
  return (
    <RolePanelShell allow={['STAFF', 'ADMIN']}>
      <StaffDashboardPage />
    </RolePanelShell>
  );
}
