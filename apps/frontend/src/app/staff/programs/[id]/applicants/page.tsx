import { RolePanelShell } from '../../../../_shell/role-panel-shell';
import { STAFF_MENU } from '../../../../_shell/role-menus';
import { ProgramApplicantsPage } from '@/features/programs/program-applicants-page';
import { decodeRouteProgramId } from '@/features/programs/program-paths';

export default async function StaffProgramApplicantsRoute({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  return (
    <RolePanelShell menu={STAFF_MENU} allow={['STAFF', 'ADMIN']}>
      <ProgramApplicantsPage programId={decodeRouteProgramId(id)} />
    </RolePanelShell>
  );
}
