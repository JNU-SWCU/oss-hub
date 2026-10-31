import { SubmissionReviewScreen } from '@/features/reviews';

import { RoleGate } from '../../../../../_shell/role-gate';

export default async function ProgramSubmissionReviewPage({
  params,
}: {
  readonly params: Promise<{
    readonly id: string;
    readonly submissionId: string;
  }>;
}) {
  const { id, submissionId } = await params;
  return (
    <RoleGate allow={['staff', 'admin']}>
      <SubmissionReviewScreen programId={id} submissionId={submissionId} />
    </RoleGate>
  );
}
