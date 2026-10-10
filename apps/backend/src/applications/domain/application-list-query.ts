const APPLICATION_LIST_STATUSES = [
  'all',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
] as const;

type ApplicationListStatus = (typeof APPLICATION_LIST_STATUSES)[number];

const APPLICATION_LIST_VIEWS = ['default', 'team-management'] as const;

type ApplicationListView = (typeof APPLICATION_LIST_VIEWS)[number];

interface ApplicationListQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly search: string;
  readonly status: ApplicationListStatus;
  readonly view: ApplicationListView;
}

export {
  APPLICATION_LIST_STATUSES,
  APPLICATION_LIST_VIEWS,
  type ApplicationListQuery,
  type ApplicationListStatus,
  type ApplicationListView,
};
