import { RolePanelShell } from '../../../../_shell/role-panel-shell';
import { STAFF_MENU } from '../../../../_shell/role-menus';
import { ProgramEditPage } from '@/features/programs/program-edit-page';

export default async function StaffProgramEditPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  return (
    <RolePanelShell menu={STAFF_MENU} allow={['STAFF', 'ADMIN']}>
      <ProgramEditPage programId={id} />
    </RolePanelShell>
  );
}
