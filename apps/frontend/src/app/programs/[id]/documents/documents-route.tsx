'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { PageBody } from '@/components/page-body';
import { SubmissionChecklistPage } from '@/features/submissions/submission-checklist-page';
import { SubmissionMatrixScreen } from '@/features/submissions/components/submission-matrix-screen';
import { programDocumentsHref } from '@/lib/program-route';
import { useSharedSessionRole } from '../../../_shell/session-role-context';

function withMilestoneQuery(
  programId: string,
  searchParams: URLSearchParams,
  milestoneId: string | null,
): string {
  const next = new URLSearchParams(searchParams.toString());
  if (milestoneId === null) {
    next.delete('milestoneId');
  } else {
    next.set('milestoneId', milestoneId);
  }
  const query = next.toString();
  return `${programDocumentsHref(programId)}${query ? `?${query}` : ''}`;
}

export function DocumentsRoute({ programId }: { readonly programId: string }) {
  const session = useSharedSessionRole();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedMilestoneId = searchParams.get('milestoneId');

  if (session.hasStaffAccess) {
    return (
      <SubmissionMatrixScreen
        programId={programId}
        selectedMilestoneId={selectedMilestoneId}
        onSelectMilestone={(milestoneId) => {
          router.replace(
            withMilestoneQuery(
              programId,
              new URLSearchParams(searchParams.toString()),
              milestoneId,
            ),
            { scroll: false },
          );
        }}
      />
    );
  }

  return (
    <PageBody>
      <SubmissionChecklistPage
        programId={programId}
        milestoneId={selectedMilestoneId}
        onCloseSelected={() => {
          router.replace(
            withMilestoneQuery(
              programId,
              new URLSearchParams(searchParams.toString()),
              null,
            ),
            { scroll: false },
          );
        }}
        onSelectMilestone={(milestoneId) => {
          router.push(
            withMilestoneQuery(
              programId,
              new URLSearchParams(searchParams.toString()),
              milestoneId,
            ),
            { scroll: false },
          );
        }}
      />
    </PageBody>
  );
}
