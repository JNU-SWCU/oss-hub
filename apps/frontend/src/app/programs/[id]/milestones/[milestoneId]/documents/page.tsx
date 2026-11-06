import { RolePanelShell } from '../../../../../_shell/role-panel-shell';
import { RequirementCollectionScreen } from '@/features/programs/documents/requirement-collection-screen';
import { decodeRouteProgramId } from '@/features/programs/program-paths';
import { ProgramDocumentArchivePanel } from '@/features/programs/documents/program-document-archive-panel';

export default async function RequirementCollectionPage({
  params,
}: {
  readonly params: Promise<{
    readonly id: string;
    readonly milestoneId: string;
  }>;
}) {
  const { id, milestoneId } = await params;

  return (
    <RolePanelShell allow={['staff']}>
      <RequirementCollectionScreen
        programId={decodeRouteProgramId(id)}
        milestoneId={decodeRouteProgramId(milestoneId)}
      />
      <ProgramDocumentArchivePanel
        key={`${id}/${milestoneId}`}
        programId={decodeRouteProgramId(id)}
        initialMilestoneId={decodeRouteProgramId(milestoneId)}
      />
    </RolePanelShell>
  );
}
