import { RolePanelShell } from '../_shell/role-panel-shell';
import { MyRepositoriesScreen } from '@/features/repositories';

export default function MyReposPage() {
  return Promise.resolve(
    <RolePanelShell allow={['student', 'staff']}>
      <MyRepositoriesScreen />
    </RolePanelShell>,
  );
}
