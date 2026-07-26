import { SystemStatusScreen } from '@/features/system-status/components/system-status-screen';
import { RolePanelShell } from '../../_shell/role-panel-shell';
import { ADMIN_MENU } from '../../_shell/role-menus';

// #133 "시스템 상태"(URL: /admin/system-status) — 접근: ADMIN만.
export default function AdminSystemStatusPage() {
  return (
    <RolePanelShell menu={ADMIN_MENU} allow={['ADMIN']}>
      <SystemStatusScreen />
    </RolePanelShell>
  );
}
