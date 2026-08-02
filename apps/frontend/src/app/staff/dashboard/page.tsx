import { RolePanelShell } from '../../_shell/role-panel-shell';
import { StaffDashboardPage } from '@/features/programs/staff-dashboard-page';

// #117 "운영 대시보드"(URL: /staff/dashboard) — 접근: APPROVED STAFF, ADMIN.
export default function StaffDashboardRoute() {
  return (
    <RolePanelShell allow={['STAFF', 'ADMIN']}>
      <StaffDashboardPage />
    </RolePanelShell>
  );
}
