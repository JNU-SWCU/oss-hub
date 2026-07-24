import { RoleGate } from '../../../_shell/role-gate';
import { SubmissionChecklistPage } from '@/features/submissions/submission-checklist-page';

// #116 "제출 체크리스트와 보완 재제출"
// (URL: /programs/[id]/submissions, 선택 마일스톤: ?milestoneId={id}) —
// 접근: 승인된 application의 STUDENT(개인형 본인/팀형 팀원). 문맥적 경로라
// 좌측 패널 메뉴에는 넣지 않는다.
export default async function ProgramSubmissionsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>;
  readonly searchParams?: Promise<
    Record<string, string | string[] | undefined>
  >;
}) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const rawMilestoneId = resolvedSearchParams?.milestoneId;
  return (
    <RoleGate allow={['STUDENT']}>
      <SubmissionChecklistPage
        programId={decodeURIComponent(id)}
        milestoneId={typeof rawMilestoneId === 'string' ? rawMilestoneId : null}
      />
    </RoleGate>
  );
}
