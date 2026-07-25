const APPLICATION_LIST_STATUSES = [
  'all',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
] as const;

const APPLICATION_LIST_MODES = ['all', 'personal', 'team'] as const;

type ApplicationListStatus = (typeof APPLICATION_LIST_STATUSES)[number];
type ApplicationListMode = (typeof APPLICATION_LIST_MODES)[number];

interface ApplicationListQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly search: string;
  readonly status: ApplicationListStatus;
  readonly mode: ApplicationListMode;
}

export {
  APPLICATION_LIST_MODES,
  APPLICATION_LIST_STATUSES,
  type ApplicationListMode,
  type ApplicationListQuery,
  type ApplicationListStatus,
};
