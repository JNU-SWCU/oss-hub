import { RolePanelShell } from '../../../_shell/role-panel-shell';
import { SubmissionMatrixScreen } from '@/features/submissions/components/submission-matrix-screen';
import { decodeRouteProgramId } from '@/features/programs/program-paths';

// 교직원 서류 현황(URL: /programs/[id]/status, 선택 마일스톤: ?milestoneId={id}) —
// 접근: STAFF, ADMIN. 프로그램 스코프 사이드바 "서류 현황" 그룹 진입점.
// SubmissionMatrixScreen은 programId만 받으므로 milestoneId 쿼리는 전달하지 않는다.
export default async function ProgramStatusPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  return (
    <RolePanelShell allow={['staff']}>
      <SubmissionMatrixScreen programId={decodeRouteProgramId(id)} />
    </RolePanelShell>
  );
}
