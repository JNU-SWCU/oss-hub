import { RolePanelShell } from '../../../_shell/role-panel-shell';
import { decodeRouteProgramId } from '@/features/programs/program-paths';
import { ProgramEditRoute } from './program-edit-route';

// 프로그램 편집(URL: /programs/[id]/edit) — 접근: STAFF, ADMIN.
export default async function ProgramEditPageRoute({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  return (
    <RolePanelShell allow={['staff']}>
      <ProgramEditRoute programId={decodeRouteProgramId(id)} />
    </RolePanelShell>
  );
}
