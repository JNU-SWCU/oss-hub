import { useSearchParams } from 'next/navigation';
import {
  setListPage,
  useListUrlNavigation,
  useParsedListUrlState,
} from '@/lib/list-url-state';
import type {
  ProgramListDirection,
  ProgramListSort,
  ProgramListStatus,
} from './program-list-options';
import { parseProgramListSearchParams } from './program-list-request';

export {
  parseProgramListDirection,
  parseProgramListSearchParams,
  parseProgramListSort,
  parseProgramListStatus,
  parseProgramListYear,
} from './program-list-request';

export interface ProgramListUrlState {
  readonly status: ProgramListStatus;
  readonly search?: string;
  readonly page?: number;
  readonly year?: number;
  readonly sort?: ProgramListSort;
  readonly direction?: ProgramListDirection;
}

export function buildProgramListSearchParams(
  state: ProgramListUrlState,
): URLSearchParams {
  const params = new URLSearchParams();
  if (state.status !== 'all') params.set('status', state.status);
  if (state.status === 'ended' && state.year !== undefined) {
    params.set('year', String(state.year));
  }
  if (state.sort) {
    params.set('sort', state.sort);
    if (state.direction && state.direction !== 'asc') {
      params.set('direction', state.direction);
    }
  }
  if (state.search?.trim()) params.set('search', state.search.trim());
  setListPage(params, state.page ?? 1);
  return params;
}

export function buildProgramListHref(state: ProgramListUrlState): string {
  const query = buildProgramListSearchParams(state).toString();
  return query ? `/programs?${query}` : '/programs';
}

const OWNED_PARAMS = [
  'status',
  'year',
  'sort',
  'direction',
  'search',
  'page',
] as const;

export function useProgramListUrlState() {
  const serialized = useSearchParams().toString();
  const state = useParsedListUrlState(serialized, parseProgramListSearchParams);
  const navigate = useListUrlNavigation(
    state,
    buildProgramListSearchParams,
    OWNED_PARAMS,
    serialized,
  );
  return { state, navigate };
}
