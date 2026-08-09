import { RolePanelShell } from '../../../../../_shell/role-panel-shell';
import { MilestoneDocumentCollectionScreen } from '@/features/programs/milestone-document-collection-screen';
import { decodeRouteProgramId } from '@/features/programs/program-paths';

// 교직원 서류 수합 표(URL: /programs/[id]/milestones/[milestoneId]/documents) —
// 접근: STAFF, ADMIN. 프로그램 상세의 마일스톤 줄에서 들어가는 문맥 경로이며
// 좌측 패널 메뉴에는 넣지 않는다.
export default async function MilestoneDocumentCollectionPage({
  params,
}: {
  readonly params: Promise<{
    readonly id: string;
    readonly milestoneId: string;
  }>;
}) {
  const { id, milestoneId } = await params;
  // seed id에는 `:`가 들어가 링크가 인코딩해 보낸다 — 두 값 모두 되돌려 놓아야
  // 조회 경로가 다시 인코딩할 때 이중 인코딩이 되지 않는다.
  return (
    <RolePanelShell allow={['STAFF', 'ADMIN']}>
      <MilestoneDocumentCollectionScreen
        programId={decodeRouteProgramId(id)}
        milestoneId={decodeRouteProgramId(milestoneId)}
      />
    </RolePanelShell>
  );
}
