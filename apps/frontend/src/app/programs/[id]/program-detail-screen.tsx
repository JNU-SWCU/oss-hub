'use client';

import { useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ProgramDetailPage } from '@/features/programs/program-detail-page';
import { programHref } from '@/features/programs/program-paths';
import { SubmissionChecklistPage } from '@/features/submissions/submission-checklist-page';
import { studentProgramSubmissionHref } from '@/lib/program-route';

export function ProgramDetailScreen({
  programId,
}: {
  readonly programId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedMilestoneId = searchParams.get('submission');
  const openedInPage = useRef(false);

  return (
    <ProgramDetailPage
      programId={programId}
      approvedStudentMilestones={
        <SubmissionChecklistPage
          milestoneId={selectedMilestoneId}
          onCloseSelected={() => {
            if (openedInPage.current) {
              openedInPage.current = false;
              router.back();
              return;
            }
            const next = new URLSearchParams(searchParams.toString());
            next.delete('submission');
            const query = next.toString();
            router.replace(
              `${programHref(programId)}${query ? `?${query}` : ''}`,
              { scroll: false },
            );
          }}
          onSelectMilestone={(milestoneId) => {
            openedInPage.current = true;
            router.push(studentProgramSubmissionHref(programId, milestoneId), {
              scroll: false,
            });
          }}
          programId={programId}
        />
      }
    />
  );
}
