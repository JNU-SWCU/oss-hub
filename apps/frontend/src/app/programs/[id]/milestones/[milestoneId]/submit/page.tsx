import { RoleGate } from '../../../../../_shell/role-gate';
import { SubmissionPage } from '@/features/submissions/submission-page';

// #115 "마일스톤 제출"(URL: /programs/[id]/milestones/[milestoneId]/submit) —
// 접근: 승인된 application의 STUDENT(개인형 본인/팀형 팀원). 문맥적 경로라
// 좌측 패널 메뉴에는 넣지 않는다.
export default async function MilestoneSubmitPage({
  params,
}: {
  readonly params: Promise<{
    readonly id: string;
    readonly milestoneId: string;
  }>;
}) {
  const { id, milestoneId } = await params;
  return (
    <RoleGate allow={['STUDENT']}>
      <SubmissionPage programId={id} milestoneId={milestoneId} />
    </RoleGate>
  );
}
