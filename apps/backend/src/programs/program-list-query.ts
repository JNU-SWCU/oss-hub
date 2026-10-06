const PROGRAM_LIST_QUERY_STATUSES = [
  'all',
  'recruiting',
  'in_progress',
  'upcoming',
  'ended',
] as const;

type ProgramListQueryStatus = (typeof PROGRAM_LIST_QUERY_STATUSES)[number];

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

  readonly sort?: ProgramListQuerySort;

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
