import { useQuery } from '@tanstack/react-query';
import { programFeatureKey } from '@/lib/query-keys';
import { listTeamManagementApplications } from '../applications/api';
import { TEAM_MANAGEMENT_PAGE_SIZE } from '../applications/application-wire';
import type { ApplicationListStatus } from '../applications/dto';

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
