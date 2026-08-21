import { RolePanelShell } from '../../../_shell/role-panel-shell';
import { decodeRouteProgramId } from '@/features/programs/program-paths';
import { MyDocsRoute } from './mydocs-route';

// 학생 내 제출물(URL: /programs/[id]/mydocs, 선택 마일스톤: ?milestoneId={id}) —
// 접근: STUDENT. 프로그램 스코프 사이드바 "내 제출물" 그룹 진입점.
export default async function ProgramMyDocsPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  return (
    <RolePanelShell allow={['student']}>
      <MyDocsRoute programId={decodeRouteProgramId(id)} />
    </RolePanelShell>
  );
}
