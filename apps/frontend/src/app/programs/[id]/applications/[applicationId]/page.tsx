import Link from 'next/link';
import { RolePanelShell } from '../../../../_shell/role-panel-shell';
import { EmptyState, PageHeader } from '@/components';
import { Button } from '@/components/ui/button';
import { decodeRouteProgramId } from '@/features/programs/program-paths';
import { programApplicantsHref } from '@/lib/program-route';

/**
 * 신청 상세·판정 UI 자리 — 목록 링크 대상 경로만 고정한다.
 * decide 액션은 구현하지 않는다.
 */
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
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
        <PageHeader
          title="신청 상세"
          description={`신청 ID: ${decodedApplicationId}`}
        />
        <EmptyState
          title="신청 상세·판정은 준비 중입니다"
          description="목록에서 선택한 신청의 상세 화면이 곧 연결됩니다. 승인·반려 조작은 이 화면에서 제공하지 않습니다."
          action={
            <Button asChild variant="outline">
              <Link href={programApplicantsHref(programId)}>
                신청자 목록으로
              </Link>
            </Button>
          }
        />
      </main>
    </RolePanelShell>
  );
}
