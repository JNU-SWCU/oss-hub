const APPLICATION_LIST_STATUSES = [
  'all',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
] as const;

type ApplicationListStatus = (typeof APPLICATION_LIST_STATUSES)[number];

interface ApplicationListQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly search: string;
  readonly status: ApplicationListStatus;
}

export {
  APPLICATION_LIST_STATUSES,
  type ApplicationListQuery,
  type ApplicationListStatus,
};
