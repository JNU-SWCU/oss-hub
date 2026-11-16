import { RolePanelShell } from '../../../_shell/role-panel-shell';
import { decodeRouteProgramId } from '@/features/programs/program-paths';
import { ProgramNotificationsPage } from '@/features/programs/notifications/program-notifications-page';

export default async function ProgramNotificationsPageRoute({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  return (
    <RolePanelShell allow={['staff']}>
      <ProgramNotificationsPage programId={decodeRouteProgramId(id)} />
    </RolePanelShell>
  );
}
