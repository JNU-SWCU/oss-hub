import { useSearchParams } from 'next/navigation';
import {
  parseListEnum,
  useListUrlNavigation,
  useParsedListUrlState,
} from '@/lib/list-url-state';
export type DashboardFilter =
  'all' | 'active' | 'feedback' | 'done' | 'applying';
interface StudentDashboardUrlState {
  readonly status: DashboardFilter;
}
export function parseStudentDashboardSearchParams(
  params: URLSearchParams,
): StudentDashboardUrlState {
  return {
    status: parseListEnum(
      params.get('status'),
      ['all', 'active', 'feedback', 'done', 'applying'],
      'all',
    ),
  };
}
export function buildStudentDashboardSearchParams(
  state: StudentDashboardUrlState,
) {
  const params = new URLSearchParams();
  if (state.status !== 'all') params.set('status', state.status);
  return params;
}

const OWNED_PARAMS = ['status'] as const;

export function useStudentDashboardUrlState() {
  const serialized = useSearchParams().toString();
  const state = useParsedListUrlState(
    serialized,
    parseStudentDashboardSearchParams,
  );
  const navigate = useListUrlNavigation(
    state,
    buildStudentDashboardSearchParams,
    OWNED_PARAMS,
    serialized,
  );
  return { state, navigate };
}
