import { RoleGate } from '../../../_shell/role-gate';
import { decodeRouteProgramId } from '@/features/programs/program-paths';
import { ProgramTeamsRouteView } from './program-teams-route-view';

export default async function ProgramTeamsRoutePage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;

  return (
    <RoleGate allow={['student', 'staff']}>
      <ProgramTeamsRouteView programId={decodeRouteProgramId(id)} />
    </RoleGate>
  );
}
