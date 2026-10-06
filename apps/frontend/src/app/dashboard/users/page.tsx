import { Suspense } from 'react';

import { RolePanelShell } from '../../_shell/role-panel-shell';
import { AdminAccessScreen } from '@/features/roles/components/admin-access-screen';

export default function AdminAccessPage() {
  return (
    <RolePanelShell allow={['admin']}>
      <Suspense fallback={null}>
        <AdminAccessScreen workspace="directory" />
      </Suspense>
    </RolePanelShell>
  );
}
