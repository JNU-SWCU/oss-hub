'use client';

import { skipToken, useQuery, type QueryClient } from '@tanstack/react-query';
import { programFeatureKey, programKey } from '@/lib/query-keys';
import { getMyApplication } from '../applications/student-application-api';
import { getProgramDetail, getPublicProgramDetail } from './api';
import { getProgramNavigationMilestones } from './program-navigation-api';
import { getProgramOverview } from './program-overview-api';

export function useProgramDetailQuery(
  programId: string | null,
  operationsView: boolean | null,
) {
  return useQuery({
    queryKey: programFeatureKey(programId ?? '', 'detail', operationsView),
    queryFn:
      programId !== null && operationsView !== null
        ? () => getProgramDetail(programId, operationsView)
        : skipToken,
  });
}

export function usePublicProgramDetailQuery(programId: string | null) {
  return useQuery({
    queryKey: programFeatureKey(programId ?? '', 'public-detail'),
    queryFn:
      programId !== null ? () => getPublicProgramDetail(programId) : skipToken,
  });
}

export function useProgramOverviewQuery(
  programId: string | null,
  operationsView: boolean | null,
) {
  return useQuery({
    queryKey: programFeatureKey(programId ?? '', 'overview', operationsView),
    queryFn:
      programId !== null && operationsView !== null
        ? () => getProgramOverview(programId, operationsView)
        : skipToken,
  });
}

export function useProgramNavigationMilestonesQuery(programId: string | null) {
  return useQuery({
    queryKey: programFeatureKey(programId ?? '', 'navigation-milestones'),
    queryFn:
      programId !== null
        ? () => getProgramNavigationMilestones(programId)
        : skipToken,
  });
}

export function useProgramParticipationQuery(programId: string | null) {
  return useQuery({
    queryKey: programFeatureKey(programId ?? '', 'application'),
    queryFn: programId !== null ? () => getMyApplication(programId) : skipToken,
    select: (application) => application?.status === 'APPROVED',
  });
}

export async function invalidateProgram(
  queryClient: QueryClient,
  programId: string,
) {
  const queryKey = programKey(programId);
  await queryClient.cancelQueries({ queryKey });
  await queryClient.invalidateQueries({ queryKey });
}
