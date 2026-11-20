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
import {
  STAFF_DASHBOARD_SORTS,
  STAFF_DASHBOARD_SORT_DIRECTIONS,
  type StaffDashboardSort,
  type StaffDashboardSortDirection,
} from './dto';
interface StaffDashboardUrlState {
  readonly search: string;
  readonly status: ProgramListStatus;
  readonly page: number;
  readonly sort?: StaffDashboardSort;
  readonly direction?: StaffDashboardSortDirection;
}
export function parseStaffDashboardSearchParams(
  params: URLSearchParams,
): StaffDashboardUrlState {
  const sort = STAFF_DASHBOARD_SORTS.find(
    (value) => value === params.get('sort'),
  );
  const direction = STAFF_DASHBOARD_SORT_DIRECTIONS.find(
    (value) => value === params.get('direction'),
  );
  return {
    ...(sort && direction ? { sort, direction } : {}),
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
  if (state.sort && state.direction) {
    params.set('sort', state.sort);
    params.set('direction', state.direction);
  }
  return params;
}

const OWNED_PARAMS = ['search', 'status', 'page', 'sort', 'direction'] as const;

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
