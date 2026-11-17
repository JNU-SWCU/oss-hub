import { MyProfileScreen } from '@/features/profile/components/my-profile-screen';
import { RolePanelShell } from '../../_shell/role-panel-shell';
import { DASHBOARD_ALLOWED_SURFACES } from '../dashboard-access';

export default function MyProfilePage() {
  return (
    <RolePanelShell allow={DASHBOARD_ALLOWED_SURFACES}>
      <MyProfileScreen />
    </RolePanelShell>
  );
}
