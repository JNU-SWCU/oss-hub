import { RolePanelShell } from '../../_shell/role-panel-shell';
import { ActivityTimelineScreen } from '@/features/activity-timeline';

export default function ActivityTimelinePage() {
  return (
    <RolePanelShell allow={['STUDENT']}>
      <ActivityTimelineScreen />
    </RolePanelShell>
  );
}
