import type {
  AdminAccessAccountStatus,
  AdminAccessListParams,
  AdminAccessPendingFilter,
  AdminAccessRoleFilter,
  AdminAccessSortDirection,
  AdminAccessSortField,
} from './admin-access-api';

export const ADMIN_ACCESS_LIST_LIMIT = 20;
export const ADMIN_ACCESS_DEFAULT_SORT: AdminAccessSortField = 'name';
export const ADMIN_ACCESS_DEFAULT_DIRECTION: AdminAccessSortDirection = 'asc';

export interface AdminAccessListFilterState {
  readonly query: string;
  readonly role: AdminAccessRoleFilter | '';
  readonly accountStatus: AdminAccessAccountStatus | '';
  readonly pendingRequest: AdminAccessPendingFilter | '';
  readonly sort: AdminAccessSortField;
  readonly direction: AdminAccessSortDirection;
  readonly page: number;
}

export const ADMIN_ACCESS_DEFAULT_FILTER_STATE: AdminAccessListFilterState = {
  query: '',
  role: '',
  accountStatus: '',
  pendingRequest: '',
  sort: ADMIN_ACCESS_DEFAULT_SORT,
  direction: ADMIN_ACCESS_DEFAULT_DIRECTION,
  page: 1,
};

export const APPLICANT_QUEUE_DEFAULT_FILTER_STATE: AdminAccessListFilterState =
  {
    query: '',
    role: '',
    accountStatus: '',
    pendingRequest: '',
    sort: 'createdAt',
    direction: 'desc',
    page: 1,
  };

export type AccessWorkspace = 'directory' | 'queue';

const ACCESS_DETAIL_BASE_PATHS = {
  directory: '/dashboard/users',
  queue: '/dashboard/applicants/users',
} as const satisfies Record<AccessWorkspace, string>;

export function accessListPath(workspace: AccessWorkspace): string {
  return workspace === 'queue' ? '/dashboard/applicants' : '/dashboard/users';
}

export function accessDetailPath(
  workspace: AccessWorkspace,
  userId: string,
  listSearch = '',
): string {
  const base = `${ACCESS_DETAIL_BASE_PATHS[workspace]}/${encodeURIComponent(userId)}`;
  return listSearch ? `${base}?${listSearch}` : base;
}

export function buildAdminAccessListParams(
  state: AdminAccessListFilterState,
): AdminAccessListParams {
  const trimmedQuery = state.query.trim();
  return {
    ...(trimmedQuery ? { query: trimmedQuery } : {}),
    ...(state.role ? { role: state.role } : {}),
    ...(state.accountStatus ? { accountStatus: state.accountStatus } : {}),
    ...(state.pendingRequest ? { pendingRequest: state.pendingRequest } : {}),
    sort: state.sort,
    direction: state.direction,
    page: state.page,
    limit: ADMIN_ACCESS_LIST_LIMIT,
  };
}
