'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { ProgramDetailPage } from '@/features/programs/program-detail-page';
import { programHref } from '@/features/programs/program-paths';
import { SubmissionChecklistPage } from '@/features/submissions/submission-checklist-page';

export function ProgramDetailScreen({
  programId,
}: {
  readonly programId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedMilestoneId = searchParams.get('submission');

  return (
    <ProgramDetailPage
      programId={programId}
      approvedStudentMilestones={
        <SubmissionChecklistPage
          embedded
          milestoneId={selectedMilestoneId}
          onCloseSelected={() => {
            const next = new URLSearchParams(searchParams.toString());
            next.delete('submission');
            const query = next.toString();
            router.replace(
              `${programHref(programId)}${query ? `?${query}` : ''}`,
              { scroll: false },
            );
          }}
          programId={programId}
        />
      }
    />
  );
}
