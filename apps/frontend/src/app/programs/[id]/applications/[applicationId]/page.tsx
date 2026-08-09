import { RolePanelShell } from '../../../../_shell/role-panel-shell';
import { decodeRouteProgramId } from '@/features/programs/program-paths';
import { ProgramApplicationDetailPage } from '@/features/programs/program-application-detail-page';

/** #722 신청 상세·판정 — 신청자 목록의 「보기」가 도착하는 화면. */
export default async function ProgramApplicationDetailRoute({
  params,
}: {
  readonly params: Promise<{
    readonly id: string;
    readonly applicationId: string;
  }>;
}) {
  const { id, applicationId } = await params;
  const programId = decodeRouteProgramId(id);
  let decodedApplicationId = applicationId;
  try {
    decodedApplicationId = decodeURIComponent(applicationId);
  } catch {
    decodedApplicationId = applicationId;
  }

  return (
    <RolePanelShell allow={['STAFF', 'ADMIN']}>
      <ProgramApplicationDetailPage
        programId={programId}
        applicationId={decodedApplicationId}
      />
    </RolePanelShell>
  );
}
