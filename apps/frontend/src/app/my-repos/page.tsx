import { RolePanelShell } from '../_shell/role-panel-shell';
import { MyRepositoriesScreen } from '@/features/repositories';

export default async function MyReposPage() {
  return (
    <RolePanelShell allow={['student', 'staff']}>
      <MyRepositoriesScreen />
    </RolePanelShell>
  );
}
