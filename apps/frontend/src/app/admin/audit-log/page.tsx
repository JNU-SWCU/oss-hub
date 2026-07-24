import { RolePanelShell } from '../../_shell/role-panel-shell';
import { ADMIN_MENU } from '../../_shell/role-menus';
import { AuditLogScreen } from '@/features/audit-log/audit-log-screen';

// #132 "감사 로그"(URL: /admin/audit-log) — 접근: ADMIN만.
export default function AdminAuditLogPage() {
  return (
    <RolePanelShell menu={ADMIN_MENU} allow={['ADMIN']}>
      <AuditLogScreen />
    </RolePanelShell>
  );
}
