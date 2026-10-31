import { useSearchParams } from 'next/navigation';
import {
  parseListPage,
  parseListEnum,
  setListPage,
  useListUrlNavigation,
  useParsedListUrlState,
} from '@/lib/list-url-state';
import {
  PROGRAM_LIST_STATUSES,
  type ProgramListStatus,
} from '../catalog/program-list-options';
interface StaffDashboardUrlState {
  readonly search: string;
  readonly status: ProgramListStatus;
  readonly page: number;
}
export function parseStaffDashboardSearchParams(
  params: URLSearchParams,
): StaffDashboardUrlState {
  return {
    search: params.get('search')?.trim() ?? '',
    status: parseListEnum(params.get('status'), PROGRAM_LIST_STATUSES, 'all'),
    page: parseListPage(params.get('page')),
  };
}
export function buildStaffDashboardSearchParams(state: StaffDashboardUrlState) {
  const params = new URLSearchParams();
  if (state.search.trim()) params.set('search', state.search.trim());
  if (state.status !== 'all') params.set('status', state.status);
  setListPage(params, state.page);
  return params;
}

const OWNED_PARAMS = ['search', 'status', 'page'] as const;

export function useStaffDashboardUrlState() {
  const serialized = useSearchParams().toString();
  const state = useParsedListUrlState(
    serialized,
    parseStaffDashboardSearchParams,
  );
  const navigate = useListUrlNavigation(
    state,
    buildStaffDashboardSearchParams,
    OWNED_PARAMS,
    serialized,
  );
  return { state, navigate };
}
