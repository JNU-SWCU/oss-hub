import { RolePanelShell } from '../../../_shell/role-panel-shell';
import { decodeRouteProgramId } from '@/features/programs/program-paths';
import { DocumentsRoute } from './documents-route';

// 프로그램 서류(URL: /programs/[id]/documents, 선택 마일스톤: ?milestoneId={id}) —
// 학생과 교직원이 같은 주소를 쓰고, 게이트가 확인한 권한에 따라 본문만 갈린다.
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
