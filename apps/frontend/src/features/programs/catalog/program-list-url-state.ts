import { useSearchParams } from 'next/navigation';
import {
  parseListPage,
  parseListEnum,
  setListPage,
  useListUrlNavigation,
  useParsedListUrlState,
} from '@/lib/list-url-state';
import {
  PROGRAM_LIST_DIRECTIONS,
  PROGRAM_LIST_SORTS,
  PROGRAM_LIST_STATUSES,
  type ProgramListDirection,
  type ProgramListSort,
  type ProgramListStatus,
} from './program-list-options';

export function parseProgramListStatus(
  value: string | null,
): ProgramListStatus {
  if (
    value !== null &&
    (PROGRAM_LIST_STATUSES as readonly string[]).includes(value)
  ) {
    return value as ProgramListStatus;
  }
  return 'all';
}

export function parseProgramListSort(
  value: string | null,
): ProgramListSort | undefined {
  if (
    value !== null &&
    (PROGRAM_LIST_SORTS as readonly string[]).includes(value)
  ) {
    return value as ProgramListSort;
  }
  return undefined;
}

export function parseProgramListDirection(
  value: string | null,
): ProgramListDirection | undefined {
  if (
    value !== null &&
    (PROGRAM_LIST_DIRECTIONS as readonly string[]).includes(value)
  ) {
    return value as ProgramListDirection;
  }
  return undefined;
}

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

export function parseProgramListSearchParams(params: URLSearchParams) {
  const status = parseListEnum(
    params.get('status'),
    PROGRAM_LIST_STATUSES,
    'all',
  );
  const sort = parseProgramListSort(params.get('sort'));
  return {
    status,
    year:
      status === 'ended' ? parseProgramListYear(params.get('year')) : undefined,
    sort,
    direction: sort
      ? parseProgramListDirection(params.get('direction'))
      : undefined,
    search: params.get('search')?.trim() ?? '',
    page: parseListPage(params.get('page')),
  };
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

export function parseProgramListYear(value: string | null): number | undefined {
  if (!value) return undefined;
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 2100
    ? year
    : undefined;
}
