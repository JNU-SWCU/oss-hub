import { RolePanelShell } from '../../../../../_shell/role-panel-shell';
import { MilestoneDocumentCollectionScreen } from '@/features/programs/milestone-document-collection-screen';
import { decodeRouteProgramId } from '@/features/programs/program-paths';
import { ProgramDocumentArchivePanel } from '@/features/programs/program-document-archive-panel';

export default async function MilestoneDocumentCollectionPage({
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
      <MilestoneDocumentCollectionScreen
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
