'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { SubmissionChecklistPage } from '@/features/submissions/submission-checklist-page';
import { programMyDocsHref } from '@/lib/program-route';

export function MyDocsRoute({ programId }: { readonly programId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedMilestoneId = searchParams.get('milestoneId');

  return (
    <SubmissionChecklistPage
      programId={programId}
      milestoneId={selectedMilestoneId}
      onCloseSelected={() => {
        const next = new URLSearchParams(searchParams.toString());
        next.delete('milestoneId');
        const query = next.toString();
        router.replace(
          `${programMyDocsHref(programId)}${query ? `?${query}` : ''}`,
          { scroll: false },
        );
      }}
      onSelectMilestone={(milestoneId) => {
        router.push(programMyDocsHref(programId, milestoneId), {
          scroll: false,
        });
      }}
    />
  );
}
