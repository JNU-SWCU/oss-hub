import { Suspense } from 'react';
import { RolePanelShell } from '../../_shell/role-panel-shell';
import { StaffInsightsScreen } from '@/features/staff-insights/staff-insights-screen';

export default function StaffInsightsPage() {
  return (
    <RolePanelShell allow={['staff']}>
      <Suspense fallback={null}>
        <StaffInsightsScreen />
      </Suspense>
    </RolePanelShell>
  );
}
