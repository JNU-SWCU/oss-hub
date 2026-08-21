import { RolePanelShell } from '../../../_shell/role-panel-shell';
import { MilestoneTimelineScreen } from '@/features/milestone-timeline';

export default async function ProgramTimelinePage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  return (
    <RolePanelShell allow={['student']}>
      <MilestoneTimelineScreen programId={decodeURIComponent(id)} />
    </RolePanelShell>
  );
}
