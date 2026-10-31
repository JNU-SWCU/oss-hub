import { skipToken, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { milestoneDocumentsKey, programFeatureKey } from '@/lib/query-keys';
import {
  getMilestoneDocumentCollection,
  getMilestoneDocumentHistory,
} from './milestone-document-collection-api';
import type { MilestoneDocumentCollectionQueryInput } from './milestone-document-collection-dto';
import {
  getMilestoneDocumentParticipantHistory,
  listMilestoneDocuments,
} from './milestone-document-api';
import { getProgramDetail } from '../catalog/api';
import { listStaffProgramTeams } from '../teams/api';
import { getProgramDocumentChangeRequestTargets } from './program-document-change-request-api';
import type { ProgramDocumentChangeRequestScope } from './program-document-change-request-dto';
import type { MilestoneDocument } from './milestone-document-dto';
import type { MilestoneDocumentReviewTarget } from './milestone-document-review';

export function useMilestoneDocumentsQuery(
  programId: string,
  milestoneId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: milestoneDocumentsKey(programId, milestoneId),
    queryFn: () => listMilestoneDocuments(milestoneId),
    enabled,
  });
}

export function useMilestoneDocumentParticipantHistoryQuery(
  programId: string,
  document: MilestoneDocument,
) {
  return useInfiniteQuery({
    queryKey: [
      ...milestoneDocumentsKey(programId, document.milestoneId),
      'participant-history',
      document.id,
      document.viewerSubmission?.revision,
    ],
    queryFn: ({ pageParam }: { readonly pageParam: string | null }) =>
      getMilestoneDocumentParticipantHistory(
        document.milestoneId,
        document.id,
        pageParam,
      ),
    initialPageParam: null,
    getNextPageParam: (page): string | null => page.nextCursor,
    enabled:
      document.viewerSubmission?.submitted === true &&
      document.viewerSubmission.history?.hasHistory === true,
  });
}

export function useMilestoneDocumentReviewHistoryQuery(
  programId: string,
  milestoneId: string,
  target: MilestoneDocumentReviewTarget | null,
) {
  return useInfiniteQuery({
    queryKey: [
      ...milestoneDocumentsKey(programId, milestoneId),
      'review-history',
      target?.documentId,
      target?.applicationId,
    ],
    queryFn:
      target === null
        ? skipToken
        : ({ pageParam }: { readonly pageParam: string | null }) =>
            getMilestoneDocumentHistory(
              milestoneId,
              target.documentId,
              target.applicationId,
              pageParam,
            ),
    initialPageParam: null,
    getNextPageParam: (page): string | null => page.nextCursor,
  });
}

export function useProgramDocumentTeamsQuery(
  programId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: programFeatureKey(programId, 'teams', 'document-options'),
    queryFn: () => listStaffProgramTeams(programId),
    enabled,
  });
}

export function useProgramDocumentArchiveQuery(
  programId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: programFeatureKey(programId, 'detail', false),
    queryFn: () => getProgramDetail(programId),
    enabled,
  });
}

export function useProgramDocumentChangeRequestTargetsQuery(
  programId: string,
  scope: ProgramDocumentChangeRequestScope | null,
) {
  return useQuery({
    queryKey: programFeatureKey(
      programId,
      'documents',
      'change-request-targets',
      scope,
    ),
    queryFn:
      scope === null
        ? skipToken
        : () => getProgramDocumentChangeRequestTargets(programId, scope),
  });
}

export function useMilestoneDocumentCollectionQuery(
  programId: string,
  milestoneId: string,
  input: MilestoneDocumentCollectionQueryInput,
) {
  return useQuery({
    queryKey: programFeatureKey(
      programId,
      'documents',
      'collection',
      milestoneId,
      input,
    ),
    queryFn: () => getMilestoneDocumentCollection(milestoneId, input),
  });
}
