import { RolePanelShell } from '../../../_shell/role-panel-shell';
import { decodeRouteProgramId } from '@/features/programs/program-paths';
import { DocumentsRoute } from './documents-route';

export default async function ProgramDocumentsPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  return (
    <RolePanelShell allow={['student', 'staff']}>
      <DocumentsRoute programId={decodeRouteProgramId(id)} />
    </RolePanelShell>
  );
}
