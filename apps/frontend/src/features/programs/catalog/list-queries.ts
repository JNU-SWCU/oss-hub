import { useQuery, type QueryClient } from '@tanstack/react-query';
import { featureKey } from '@/lib/query-keys';
import { getProgramEndedYears, listPrograms } from './api';
import type { ProgramListParams } from './dto';

export function useProgramListQuery(input: ProgramListParams) {
  return useQuery({
    queryKey: featureKey('programs', input),
    queryFn: () => listPrograms(input),
  });
}

export function useProgramEndedYearsQuery(enabled: boolean) {
  return useQuery({
    queryKey: featureKey('program-ended-years'),
    queryFn: ({ signal }) => getProgramEndedYears(signal),
    enabled,
  });
}

export function invalidateProgramLists(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: featureKey('programs') }),
    queryClient.invalidateQueries({
      queryKey: featureKey('program-ended-years'),
    }),
    queryClient.invalidateQueries({ queryKey: featureKey('staff-dashboard') }),
  ]);
}
