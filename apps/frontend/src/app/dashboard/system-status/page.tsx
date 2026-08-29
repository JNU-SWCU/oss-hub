import { SystemStatusScreen } from '@/features/system-status/components/system-status-screen';
import { RolePanelShell } from '../../_shell/role-panel-shell';

// #133 "시스템 상태"(URL: /dashboard/system-status) — 접근: ADMIN만.
export default function AdminSystemStatusPage() {
  return (
    <RolePanelShell allow={['admin']}>
      <SystemStatusScreen />
    </RolePanelShell>
  );
}
