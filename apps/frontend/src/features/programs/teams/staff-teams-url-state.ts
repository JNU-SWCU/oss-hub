import { useSearchParams } from 'next/navigation';
import {
  parseListPage,
  parseListEnum,
  setListPage,
  useListUrlNavigation,
  useParsedListUrlState,
} from '@/lib/list-url-state';
import type { ApplicationListStatus } from '../applications/dto';
interface StaffTeamsUrlState {
  readonly search: string;
  readonly filter: ApplicationListStatus;
  readonly page: number;
}
export function parseStaffTeamsSearchParams(
  params: URLSearchParams,
): StaffTeamsUrlState {
  return {
    search: params.get('search')?.trim() ?? '',
    filter: parseListEnum(
      params.get('filter'),
      ['all', 'SUBMITTED', 'APPROVED', 'REJECTED'],
      'all',
    ),
    page: parseListPage(params.get('page')),
  };
}
export function buildStaffTeamsSearchParams(state: StaffTeamsUrlState) {
  const params = new URLSearchParams();
  if (state.search.trim()) params.set('search', state.search.trim());
  if (state.filter !== 'all') params.set('filter', state.filter);
  setListPage(params, state.page);
  return params;
}

const OWNED_PARAMS = ['search', 'filter', 'page'] as const;

export function useStaffTeamsUrlState() {
  const serialized = useSearchParams().toString();
  const state = useParsedListUrlState(serialized, parseStaffTeamsSearchParams);
  const navigate = useListUrlNavigation(
    state,
    buildStaffTeamsSearchParams,
    OWNED_PARAMS,
    serialized,
  );
  return { state, navigate };
}
