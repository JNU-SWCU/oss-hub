import { SubmissionReviewScreen } from '@/features/reviews';

import { RoleGate } from '../../../../../../_shell/role-gate';

// #125 "제출물 검토"
// (URL: /staff/programs/[id]/submissions/[submissionId]/review) —
// 접근: APPROVED STAFF, ADMIN. 문맥적 경로라 좌측 패널 메뉴에는 넣지 않는다.
export default async function SubmissionReviewPage({
  params,
}: {
  readonly params: Promise<{ readonly submissionId: string }>;
}) {
  const { submissionId } = await params;
  return (
    <RoleGate allow={['STAFF', 'ADMIN']}>
      <SubmissionReviewScreen submissionId={submissionId} />
    </RoleGate>
  );
}
