import { SubmissionReviewScreen } from '@/features/reviews';

import { RoleGate } from '../../../../../_shell/role-gate';

export default async function ProgramSubmissionReviewPage({
  params,
}: {
  readonly params: Promise<{ readonly submissionId: string }>;
}) {
  const { submissionId } = await params;
  return (
    <RoleGate allow={['staff', 'admin']}>
      <SubmissionReviewScreen submissionId={submissionId} />
    </RoleGate>
  );
}
