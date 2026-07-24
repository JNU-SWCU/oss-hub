import { RolePanelShell } from '../../_shell/role-panel-shell';
import { ADMIN_MENU } from '../../_shell/role-menus';
import { AdminUsersScreen } from '@/features/roles/components/admin-users-screen';

// #131 "관리 콘솔"(URL: /admin/users) — 접근: ADMIN만.
export default function AdminUsersPage() {
  return (
    <RolePanelShell menu={ADMIN_MENU} allow={['ADMIN']}>
      <AdminUsersScreen />
    </RolePanelShell>
  );
}
