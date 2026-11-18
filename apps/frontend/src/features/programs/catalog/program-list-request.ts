import { parseListEnum, parseListPage } from '@/lib/list-url-params';
import { featureKey } from '@/lib/query-keys';
import type { ProgramListParams } from './dto';
import {
  PROGRAM_LIST_DIRECTIONS,
  PROGRAM_LIST_SORTS,
  PROGRAM_LIST_STATUSES,
} from './program-list-options';

export type ProgramListAudience = 'public' | 'viewer';

export function parseProgramListStatus(value: string | null) {
  return parseListEnum(value, PROGRAM_LIST_STATUSES, 'all');
}

export function parseProgramListSort(value: string | null) {
  return PROGRAM_LIST_SORTS.find((sort) => sort === value);
}

export function parseProgramListDirection(value: string | null) {
  return PROGRAM_LIST_DIRECTIONS.find((direction) => direction === value);
}

export function parseProgramListYear(value: string | null): number | undefined {
  if (!value) return undefined;
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 2100
    ? year
    : undefined;
}

export function parseProgramListSearchParams(
  params: Pick<URLSearchParams, 'get'>,
) {
  const status = parseProgramListStatus(params.get('status'));
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

export function programListInput({
  status,
  ...filters
}: ReturnType<typeof parseProgramListSearchParams>): ProgramListParams {
  return {
    ...filters,
    pageSize: 20,
    status: status === 'all' ? 'current' : status,
  };
}

export function programListKey(
  input: ProgramListParams,
  audience: ProgramListAudience,
) {
  return audience === 'public'
    ? featureKey('programs', input, 'public')
    : featureKey('programs', input);
}

export function programListPath(input: ProgramListParams): string {
  const params = new URLSearchParams({
    page: String(input.page),
    pageSize: String(input.pageSize),
    ...(input.search.trim() ? { search: input.search } : {}),
    status: input.status,
  });
  if (input.sort) params.set('sort', input.sort);
  if (input.direction) params.set('direction', input.direction);
  if (input.year !== undefined) params.set('year', String(input.year));
  return 'programs?' + params.toString();
}
