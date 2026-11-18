'use client';

import { useQueryClient } from '@tanstack/react-query';
import { invalidateProgram } from '@/features/programs/catalog/queries';
import { useRouter, useSearchParams } from 'next/navigation';
import { hasStaffAudience } from '../../../_shell/member-access';
import { PageBody } from '@/components/page-body';
import { RequirementChecklistPage } from '../requirement-checklist';
import { SubmissionMatrixScreen } from '@/features/submissions/components/submission-matrix-screen';
import {
  documentsStageSearch,
  programDocumentsHref,
} from '@/lib/program-route';
import { useSharedSessionRole } from '../../../_shell/session-role-context';
import { ProgramDocumentArchivePanel } from '@/features/programs/documents/program-document-archive-panel';
import { ProgramDocumentChangeRequestPanel } from '@/features/programs/documents/program-document-change-request-panel';
import { RequirementCollectionScreen } from '@/features/programs/documents/requirement-collection-screen';

function withMilestoneQuery(
  programId: string,
  searchParams: URLSearchParams,
  milestoneId: string | null,
): string {
  const query = documentsStageSearch(searchParams.toString(), milestoneId);
  return `${programDocumentsHref(programId)}${query ? `?${query}` : ''}`;
}

export function DocumentsRoute({ programId }: { readonly programId: string }) {
  const session = useSharedSessionRole();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedMilestoneId = searchParams.get('milestoneId');
  const queryClient = useQueryClient();

  if (hasStaffAudience(session)) {
    const headerActions = (
      <div className="flex flex-wrap items-center gap-3 sm:max-w-xl">
        <ProgramDocumentChangeRequestPanel
          key={`change-requests-${programId}`}
          programId={programId}
          onSent={() => void invalidateProgram(queryClient, programId)}
        />
        <ProgramDocumentArchivePanel
          key={`${programId}/${selectedMilestoneId ?? ''}`}
          programId={programId}
          initialMilestoneId={selectedMilestoneId ?? undefined}
          embedded
        />
      </div>
    );

    if (selectedMilestoneId !== null) {
      return (
        <RequirementCollectionScreen
          key={selectedMilestoneId}
          programId={programId}
          milestoneId={selectedMilestoneId}
          headerActions={headerActions}
        />
      );
    }

    return (
      <SubmissionMatrixScreen
        programId={programId}
        headerActions={headerActions}
      />
    );
  }

  return (
    <PageBody>
      <RequirementChecklistPage
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
