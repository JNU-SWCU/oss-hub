import { RolePanelShell } from '../../../../_shell/role-panel-shell';
import { ProgramApplicantsPage } from '@/features/programs/program-applicants-page';
import { decodeRouteProgramId } from '@/features/programs/program-paths';

export default async function StaffProgramApplicantsRoute({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  return (
    <RolePanelShell allow={['STAFF', 'ADMIN']}>
      <ProgramApplicantsPage programId={decodeRouteProgramId(id)} />
    </RolePanelShell>
  );
}
