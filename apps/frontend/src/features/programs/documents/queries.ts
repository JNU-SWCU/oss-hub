import { skipToken, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { requirementsKey, programFeatureKey } from '@/lib/query-keys';
import {
  getRequirementCollection,
  getRequirementHistory,
} from './requirement-collection-api';
import type { RequirementCollectionQueryInput } from './requirement-collection-dto';
import {
  getRequirementParticipantHistory,
  listRequirements,
} from './requirement-api';
import { getProgramDetail } from '../catalog/api';
import { listStaffProgramTeams } from '../teams/api';
import { getProgramDocumentChangeRequestTargets } from './program-document-change-request-api';
import type { ProgramDocumentChangeRequestScope } from './program-document-change-request-dto';
import type { Requirement } from './requirement-dto';
import type { RequirementReviewTarget } from './requirement-review';

export function useRequirementsQuery(
  programId: string,
  milestoneId: string,
  enabled: boolean,
  scope?: 'all',
) {
  return useQuery({
    queryKey: requirementsKey(programId, milestoneId, scope),
    queryFn: () => listRequirements(milestoneId, scope),
    enabled,
  });
}

export function useRequirementParticipantHistoryQuery(
  programId: string,
  document: Requirement,
) {
  return useInfiniteQuery({
    queryKey: [
      ...requirementsKey(programId, document.milestoneId),
      'participant-history',
      document.id,
      document.viewerSubmission?.revision,
    ],
    queryFn: ({ pageParam }: { readonly pageParam: string | null }) =>
      getRequirementParticipantHistory(
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

export function useRequirementReviewHistoryQuery(
  programId: string,
  milestoneId: string,
  target: RequirementReviewTarget | null,
) {
  return useInfiniteQuery({
    queryKey: [
      ...requirementsKey(programId, milestoneId),
      'review-history',
      target?.documentId,
      target?.teamId,
    ],
    queryFn:
      target === null
        ? skipToken
        : ({ pageParam }: { readonly pageParam: string | null }) =>
            getRequirementHistory(
              milestoneId,
              target.documentId,
              target.teamId,
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

export function useRequirementCollectionQuery(
  programId: string,
  milestoneId: string,
  input: RequirementCollectionQueryInput,
) {
  return useQuery({
    queryKey: programFeatureKey(
      programId,
      'documents',
      'collection',
      milestoneId,
      input,
    ),
    queryFn: () => getRequirementCollection(milestoneId, input),
  });
}
