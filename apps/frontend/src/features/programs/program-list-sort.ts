import {
  PROGRAM_LIST_DIRECTIONS,
  PROGRAM_LIST_SORTS,
  type ProgramListDirection,
  type ProgramListSort,
  type ProgramListStatus,
} from './types';

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
  readonly sort?: ProgramListSort;
  readonly direction?: ProgramListDirection;
}

export function buildProgramListHref(state: ProgramListUrlState): string {
  const params = new URLSearchParams();
  if (state.status !== 'all') params.set('status', state.status);
  if (state.sort) {
    params.set('sort', state.sort);
    if (state.direction && state.direction !== 'asc') {
      params.set('direction', state.direction);
    }
  }
  const query = params.toString();
  return query ? `/programs?${query}` : '/programs';
}
