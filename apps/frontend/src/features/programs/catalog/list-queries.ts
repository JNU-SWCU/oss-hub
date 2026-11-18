import { useQuery, type QueryClient } from '@tanstack/react-query';
import { featureKey } from '@/lib/query-keys';
import { getProgramEndedYears, listPrograms, listPublicPrograms } from './api';
import type { ProgramListParams } from './dto';
import {
  programListKey,
  type ProgramListAudience,
} from './program-list-request';

export function useProgramListQuery(
  input: ProgramListParams,
  audience: ProgramListAudience,
  enabled: boolean,
) {
  return useQuery({
    queryKey: programListKey(input, audience),
    enabled,
    queryFn: (context) =>
      audience === 'public'
        ? listPublicPrograms(input, context.signal)
        : listPrograms(input),
    ...(audience === 'public' ? { staleTime: 30_000 } : {}),
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
