import { RoleGate } from '../../../_shell/role-gate';
import { decodeRouteProgramId } from '@/features/programs/program-paths';
import { ProgramApplyRoute } from './program-apply-route';

export default async function ProgramApplyRoutePage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;

  return (
    <RoleGate allow={['student']}>
      <ProgramApplyRoute programId={decodeRouteProgramId(id)} />
    </RoleGate>
  );
}
