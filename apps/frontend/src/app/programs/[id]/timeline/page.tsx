import { RolePanelShell } from '../../../_shell/role-panel-shell';
import { STUDENT_MENU } from '../../../_shell/role-menus';
import { MilestoneTimelineScreen } from '@/features/milestone-timeline';

export default async function ProgramTimelinePage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  return (
    <RolePanelShell menu={STUDENT_MENU} allow={['STUDENT']}>
      <MilestoneTimelineScreen programId={decodeURIComponent(id)} />
    </RolePanelShell>
  );
}
