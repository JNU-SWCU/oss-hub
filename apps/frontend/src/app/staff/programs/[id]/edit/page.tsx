import { RolePanelShell } from '../../../../_shell/role-panel-shell';
import { ProgramEditPage } from '@/features/programs/program-edit-page';
import { decodeRouteProgramId } from '@/features/programs/program-paths';

export default async function StaffProgramEditPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  return (
    <RolePanelShell allow={['STAFF', 'ADMIN']}>
      <ProgramEditPage programId={decodeRouteProgramId(id)} />
    </RolePanelShell>
  );
}
