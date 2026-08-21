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
    <RolePanelShell allow={['staff']}>
      {/*
       * `key`로 신청이 바뀌면 화면 인스턴스를 새로 만든다. 재사용하면 앞 신청의
       * 느린 응답이 뒤에 도착해 화면을 덮고, 열어 둔 확인창·안내가 그대로 남는다.
       */}
      <ProgramApplicationDetailPage
        key={decodedApplicationId}
        programId={programId}
        applicationId={decodedApplicationId}
      />
    </RolePanelShell>
  );
}
