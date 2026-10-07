import { Suspense } from 'react';

import { RolePanelShell } from '../../_shell/role-panel-shell';
import { AdminAccessScreen } from '@/features/roles/components/admin-access-screen';

export default function ApplicantQueuePage() {
  return (
    <RolePanelShell allow={['staff']}>
      <Suspense fallback={null}>
        <AdminAccessScreen workspace="queue" />
      </Suspense>
    </RolePanelShell>
  );
}
