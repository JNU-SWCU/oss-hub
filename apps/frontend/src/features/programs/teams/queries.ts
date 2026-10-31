'use client';

import { skipToken, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { featureKey, programFeatureKey } from '@/lib/query-keys';
import { useWindowFocusRefetch } from '@/lib/use-window-focus-refetch';
import { getMyTeam, getStaffProgramTeamDetail } from './api';
import { getProgramDetail } from '../catalog/api';
import { getMyApplication } from '../applications/student-application-api';
import {
  getApplicationDetailWithHistory,
  listTeamManagementApplications,
} from '../applications/api';
import { TEAM_MANAGEMENT_PAGE_SIZE } from '../applications/application-wire';
import type { ApplicationListStatus } from '../applications/dto';
import { getProgramTeamDirectory } from './program-team-directory-api';
import { getRepositoryHistory, getTeamActivity } from './team-activity-api';
import {
  listReceivedInvitations,
  listSentInvitations,
  searchInvitationCandidates,
} from './team-invitation-api';

export class TeamApplicationOutOfSyncError extends Error {
  constructor() {
    super(
      '팀 신청서를 찾지 못했습니다. 방금 상태가 바뀌었을 수 있으니 다시 시도해 주세요.',
    );
  }
}

export function useMyTeamQuery(programId: string, sessionKey: string | null) {
  const query = useQuery({
    queryKey: programFeatureKey(programId, 'teams', 'me', sessionKey),
    queryFn:
      sessionKey === null
        ? skipToken
        : async () => {
            const [program, team] = await Promise.all([
              getProgramDetail(programId),
              getMyTeam(programId),
            ]);
            const application = team?.hasApplication
              ? await getMyApplication(programId)
              : null;
            if (team?.hasApplication && application === null)
              throw new TeamApplicationOutOfSyncError();
            return { program, team, application };
          },
    refetchOnWindowFocus: true,
  });
  useWindowFocusRefetch(query.refetch, sessionKey !== null);
  return query;
}

export function useTeamsDirectoryQuery(programId: string) {
  return useQuery({
    queryKey: programFeatureKey(programId, 'teams', 'directory'),
    queryFn: async () => {
      const [program, teams] = await Promise.all([
        getProgramDetail(programId),
        getProgramTeamDirectory(programId),
      ]);
      const myTeamId =
        program.viewer.role === 'STUDENT'
          ? ((await getMyTeam(programId))?.id ?? null)
          : null;
      return { program, teams, myTeamId };
    },
  });
}

export function useStaffTeamsQuery(
  programId: string,
  input: {
    readonly search: string;
    readonly filter: ApplicationListStatus;
    readonly page: number;
  },
) {
  return useQuery({
    queryKey: programFeatureKey(programId, 'teams', 'staff', input),
    queryFn: () =>
      listTeamManagementApplications(programId, {
        search: input.search,
        status: input.filter,
        page: input.page,
        pageSize: TEAM_MANAGEMENT_PAGE_SIZE,
      }),
  });
}

export function useStaffTeamDetailQuery(
  programId: string,
  teamId: string,
  sessionKey: string | null,
) {
  return useQuery({
    queryKey: programFeatureKey(
      programId,
      'teams',
      'staff-detail',
      teamId,
      sessionKey,
    ),
    queryFn: () => getStaffProgramTeamDetail(programId, teamId),
  });
}

export function useTeamApplicationQuery(
  programId: string,
  applicationId: string | null,
  sessionKey: string | null,
) {
  return useQuery({
    queryKey: programFeatureKey(
      programId,
      'teams',
      'application',
      applicationId,
      sessionKey,
    ),
    queryFn:
      applicationId === null
        ? skipToken
        : () => getApplicationDetailWithHistory(applicationId),
  });
}

export function useTeamActivityQuery(programId: string, teamId: string) {
  const query = useQuery({
    queryKey: programFeatureKey(programId, 'teams', 'activity', teamId),
    queryFn: () => getTeamActivity(programId, teamId),
    refetchOnWindowFocus: true,
  });
  useWindowFocusRefetch(query.refetch);
  return query;
}

export function receivedInvitationsKey(identityKey: string | null) {
  return featureKey('team-invitations', 'received', identityKey);
}

export function useReceivedInvitationsQuery(identityKey: string | null) {
  const query = useQuery({
    queryKey: receivedInvitationsKey(identityKey),
    queryFn: listReceivedInvitations,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });
  useWindowFocusRefetch(query.refetch);
  return query;
}

export function useSentInvitationsQuery(
  programId: string,
  teamId: string | null,
  identityKey: string | null,
  preparation: boolean,
  refetchInterval: number | false = false,
) {
  const query = useQuery({
    queryKey: programFeatureKey(
      programId,
      'teams',
      'sent',
      teamId,
      identityKey,
      preparation,
    ),
    queryFn:
      teamId !== null && identityKey !== null
        ? () => listSentInvitations(teamId, preparation)
        : skipToken,
    refetchOnWindowFocus: refetchInterval !== false,
    refetchInterval,
  });
  useWindowFocusRefetch(
    query.refetch,
    teamId !== null && identityKey !== null && refetchInterval !== false,
  );
  return query;
}

export function useInvitationCandidatesQuery(
  programId: string,
  teamId: string | null,
  identityKey: string | null,
  preparation: boolean,
  query: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: programFeatureKey(
      programId,
      'teams',
      'search',
      teamId,
      identityKey,
      preparation,
      query,
    ),
    queryFn:
      teamId !== null && identityKey !== null && enabled
        ? () => searchInvitationCandidates(teamId, query, preparation)
        : skipToken,
  });
}

export function useRepositoryHistoryQuery(programId: string, teamId: string) {
  return useInfiniteQuery({
    queryKey: programFeatureKey(
      programId,
      'teams',
      'repository-history',
      teamId,
    ),
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      pageParam.length === 0
        ? getRepositoryHistory(programId, teamId)
        : getRepositoryHistory(programId, teamId, pageParam),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}
