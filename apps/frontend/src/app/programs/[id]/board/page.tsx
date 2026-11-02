import { RoleGate } from '../../../_shell/role-gate';
import { decodeRouteProgramId } from '@/features/programs/program-paths';
import { BoardListRoute } from './board-list-route';

export default async function ProgramBoardRoutePage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;

  return (
    <RoleGate allow={['student', 'staff']}>
      <BoardListRoute programId={decodeRouteProgramId(id)} />
    </RoleGate>
  );
}
