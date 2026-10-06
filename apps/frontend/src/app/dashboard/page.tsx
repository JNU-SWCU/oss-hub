import { RolePanelShell } from '../_shell/role-panel-shell';
import { DASHBOARD_ALLOWED_SURFACES } from './dashboard-access';
import { DashboardHome } from './dashboard-home';

export default function DashboardPage() {
  return (
    <RolePanelShell allow={DASHBOARD_ALLOWED_SURFACES}>
      <DashboardHome />
    </RolePanelShell>
  );
}
