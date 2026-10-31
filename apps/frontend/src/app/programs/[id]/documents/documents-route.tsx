'use client';

import { useContext } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateProgram } from '@/features/programs/catalog/queries';
import { useRouter, useSearchParams } from 'next/navigation';
import { ProgramViewContext } from '../../../_shell/program-shell-policy';
import { PageBody } from '@/components/page-body';
import { SubmissionChecklistPage } from '@/features/submissions/submission-checklist-page';
import { SubmissionMatrixScreen } from '@/features/submissions/components/submission-matrix-screen';
import { programDocumentsHref } from '@/lib/program-route';
import { useSharedSessionRole } from '../../../_shell/session-role-context';
import { ProgramDocumentArchivePanel } from '@/features/programs/documents/program-document-archive-panel';
import { ProgramDocumentChangeRequestPanel } from '@/features/programs/documents/program-document-change-request-panel';

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
  const programView = useContext(ProgramViewContext);
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedMilestoneId = searchParams.get('milestoneId');
  const queryClient = useQueryClient();

  const operationsView =
    programView === null
      ? session.hasStaffAccess
      : programView === 'STAFF' || programView === 'ADMIN';
  if (operationsView) {
    return (
      <SubmissionMatrixScreen
        programId={programId}
        selectedMilestoneId={selectedMilestoneId}
        headerActions={
          <div className="flex flex-wrap items-center gap-3 sm:max-w-xl">
            <ProgramDocumentChangeRequestPanel
              key={`change-requests-${programId}`}
              programId={programId}
              onSent={() => void invalidateProgram(queryClient, programId)}
            />
            <ProgramDocumentArchivePanel
              key={programId}
              programId={programId}
              embedded
            />
          </div>
        }
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
