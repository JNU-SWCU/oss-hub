import { RolePanelShell } from '../../_shell/role-panel-shell';
import { ADMIN_MENU } from '../../_shell/role-menus';
import { StaffRequestsScreen } from '@/features/roles/components/staff-requests-screen';

// #108 "교직원 승인 관리"(URL: /admin/staff-requests) — 접근: ADMIN만.
export default function StaffRequestsPage() {
  return (
    <RolePanelShell menu={ADMIN_MENU} allow={['ADMIN']}>
      <StaffRequestsScreen />
    </RolePanelShell>
  );
}
