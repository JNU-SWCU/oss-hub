import { RolePanelShell } from '../../../_shell/role-panel-shell';
import { ProgramApplicantsPage } from '@/features/programs/program-applicants-page';
import { decodeRouteProgramId } from '@/features/programs/program-paths';

// 신청자 목록(URL: /programs/[id]/applicants) — 접근: STAFF, ADMIN.
export default async function ProgramApplicantsPageRoute({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  return (
    <RolePanelShell allow={['staff']}>
      <ProgramApplicantsPage programId={decodeRouteProgramId(id)} />
    </RolePanelShell>
  );
}
