export const PROGRAM_LIST_QUERY_STATUSES = [
  'all',
  'current',
  'recruiting',
  'in_progress',
  'upcoming',
  'ended',
] as const;

export const PROGRAM_LIST_QUERY_SORTS = [
  'name',
  'applicationPeriod',
  'status',
] as const;

export const PROGRAM_LIST_QUERY_DIRECTIONS = ['asc', 'desc'] as const;
