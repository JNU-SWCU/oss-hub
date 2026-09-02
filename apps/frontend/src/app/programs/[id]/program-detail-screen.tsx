'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ProgramDetailPage } from '@/features/programs/program-detail-page';
import { SubmissionChecklistPage } from '@/features/submissions/submission-checklist-page';
import { programDocumentsHref } from '@/lib/program-route';

export function ProgramDetailScreen({
  programId,
}: {
  readonly programId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const legacyMilestoneId = searchParams.get('submission');

  useEffect(() => {
    if (legacyMilestoneId === null) return;
    router.replace(programDocumentsHref(programId, legacyMilestoneId));
  }, [legacyMilestoneId, programId, router]);

  return (
    <ProgramDetailPage
      programId={programId}
      approvedStudentMilestones={
        <SubmissionChecklistPage
          milestoneId={null}
          onSelectMilestone={(milestoneId) => {
            router.push(programDocumentsHref(programId, milestoneId), {
              scroll: false,
            });
          }}
          programId={programId}
        />
      }
    />
  );
}
