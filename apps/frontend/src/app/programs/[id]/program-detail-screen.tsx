'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from '@/features/auth/use-session';
import {
  ProgramDetailPage,
  type ProgramDetailSession,
} from '@/features/programs/program-detail-page';
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
  const { status: sessionStatus } = useSession();

  const session: ProgramDetailSession =
    sessionStatus === 'loading'
      ? 'unknown'
      : sessionStatus === 'anonymous'
        ? 'anonymous'
        : 'present';

  useEffect(() => {
    if (legacyMilestoneId === null) return;
    router.replace(programDocumentsHref(programId, legacyMilestoneId));
  }, [legacyMilestoneId, programId, router]);

  return (
    <ProgramDetailPage
      programId={programId}
      session={session}
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
