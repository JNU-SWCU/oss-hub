import { StudentDashboardScreen } from '@/features/dashboard';
import { RolePanelShell } from '../../_shell/role-panel-shell';

export default function PersonalDashboardPage() {
  return (
    <RolePanelShell allow={['student']}>
      <StudentDashboardScreen />
    </RolePanelShell>
  );
}
