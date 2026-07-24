import { RolePanelShell } from '../_shell/role-panel-shell';
import { STUDENT_MENU } from '../_shell/role-menus';
import { MyRepositoriesScreen } from '@/features/repositories';

export default async function MyReposPage() {
  return (
    <RolePanelShell menu={STUDENT_MENU} allow={['STUDENT', 'STAFF', 'ADMIN']}>
      <MyRepositoriesScreen />
    </RolePanelShell>
  );
}
