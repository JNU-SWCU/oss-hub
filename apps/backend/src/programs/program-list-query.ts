const PROGRAM_LIST_QUERY_STATUSES = [
  'all',
  'recruiting',
  'in_progress',
  'upcoming',
  'ended',
] as const;

type ProgramListQueryStatus = (typeof PROGRAM_LIST_QUERY_STATUSES)[number];

interface ProgramListQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly search: string;
  readonly status: ProgramListQueryStatus;
}

export {
  PROGRAM_LIST_QUERY_STATUSES,
  type ProgramListQuery,
  type ProgramListQueryStatus,
};
