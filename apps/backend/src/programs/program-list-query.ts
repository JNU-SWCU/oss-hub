const PROGRAM_LIST_QUERY_STATUSES = [
  'all',
  'recruiting',
  'in_progress',
  'upcoming',
  'ended',
] as const;

type ProgramListQueryStatus = (typeof PROGRAM_LIST_QUERY_STATUSES)[number];

/** 정렬 기준. 생략하면(undefined) 기존 표시 순서(모집중 우선)를 그대로 유지한다. */
const PROGRAM_LIST_QUERY_SORTS = [
  'name',
  'applicationPeriod',
  'status',
] as const;

type ProgramListQuerySort = (typeof PROGRAM_LIST_QUERY_SORTS)[number];

const PROGRAM_LIST_QUERY_DIRECTIONS = ['asc', 'desc'] as const;

type ProgramListQueryDirection = (typeof PROGRAM_LIST_QUERY_DIRECTIONS)[number];

interface ProgramListQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly search: string;
  readonly status: ProgramListQueryStatus;
  /** 생략 시 레거시 기본 정렬(§program-list-status-filter.ts)을 그대로 쓴다. */
  readonly sort?: ProgramListQuerySort;
  /** 생략 시 'asc'로 간주한다. `sort`가 없으면 무시된다. */
  readonly direction?: ProgramListQueryDirection;
}

export {
  PROGRAM_LIST_QUERY_DIRECTIONS,
  PROGRAM_LIST_QUERY_SORTS,
  PROGRAM_LIST_QUERY_STATUSES,
  type ProgramListQuery,
  type ProgramListQueryDirection,
  type ProgramListQuerySort,
  type ProgramListQueryStatus,
};
