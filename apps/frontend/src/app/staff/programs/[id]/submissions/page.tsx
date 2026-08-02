import { RolePanelShell } from '../../../../_shell/role-panel-shell';
import { SubmissionMatrixScreen } from '@/features/submissions/components/submission-matrix-screen';
import { decodeRouteProgramId } from '@/features/programs/program-paths';

// #124 "제출 현황 매트릭스"(URL: /staff/programs/[id]/submissions) —
// 접근: APPROVED STAFF, ADMIN. 문맥적 경로라 좌측 패널 메뉴에는 넣지 않는다.
export default async function StaffProgramSubmissionsPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  return (
    <RolePanelShell allow={['STAFF', 'ADMIN']}>
      <SubmissionMatrixScreen programId={decodeRouteProgramId(id)} />
    </RolePanelShell>
  );
}
