import { SystemStatusScreen } from '@/features/system-status/components/system-status-screen';
import { RolePanelShell } from '../../_shell/role-panel-shell';

export default function AdminSystemStatusPage() {
  return (
    <RolePanelShell allow={['admin']}>
      <SystemStatusScreen />
    </RolePanelShell>
  );
}
