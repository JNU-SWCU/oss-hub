import { RolePanelShell } from '../../_shell/role-panel-shell';
import { STUDENT_MENU } from '../../_shell/role-menus';
import { ActivityTimelineScreen } from '@/features/activity-timeline';

export default function ActivityTimelinePage() {
  return (
    <RolePanelShell menu={STUDENT_MENU} allow={['STUDENT']}>
      <ActivityTimelineScreen />
    </RolePanelShell>
  );
}
