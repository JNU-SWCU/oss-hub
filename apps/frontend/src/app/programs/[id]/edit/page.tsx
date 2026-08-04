import { RolePanelShell } from '../../../_shell/role-panel-shell';
import { ProgramEditPage } from '@/features/programs/program-edit-page';
import { decodeRouteProgramId } from '@/features/programs/program-paths';

// 프로그램 편집(URL: /programs/[id]/edit) — 접근: STAFF, ADMIN.
export default async function ProgramEditPageRoute({
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
