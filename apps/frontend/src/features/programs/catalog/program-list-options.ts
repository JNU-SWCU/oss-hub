export const PROGRAM_LIST_STATUSES = [
  'all',
  'recruiting',
  'in_progress',
  'upcoming',
  'ended',
] as const;

export type ProgramListStatus = (typeof PROGRAM_LIST_STATUSES)[number];

export const PROGRAM_LIST_SORTS = [
  'name',
  'applicationPeriod',
  'status',
] as const;

export type ProgramListSort = (typeof PROGRAM_LIST_SORTS)[number];

export const PROGRAM_LIST_DIRECTIONS = ['asc', 'desc'] as const;

export type ProgramListDirection = (typeof PROGRAM_LIST_DIRECTIONS)[number];
