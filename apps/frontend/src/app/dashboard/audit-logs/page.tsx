import { RolePanelShell } from '../../_shell/role-panel-shell';
import { AuditLogScreen } from '@/features/audit-log/audit-log-screen';

export default function AdminAuditLogPage() {
  return (
    <RolePanelShell allow={['admin']}>
      <AuditLogScreen />
    </RolePanelShell>
  );
}
