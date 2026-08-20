import type {
  AdminAccessAccountStatus,
  AdminAccessListParams,
  AdminAccessPendingFilter,
  AdminAccessRoleFilter,
  AdminAccessSortDirection,
  AdminAccessSortField,
} from './admin-access-api';

/**
 * Pure list-query state → `fetchAdminAccessList` params mapping for the
 * `/admin/access` read-only screen (PR04C). Extracted so filter/sort/page
 * transitions are testable without a DOM (this repo's Vitest environment is
 * `node`; see `admin-access-list.test.tsx`). PR04D promotes this same state
 * shape into URL query params — this module intentionally stays free of
 * routing concerns so that reuse is a straight import.
 */

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

export function accessListPath(workspace: AccessWorkspace): string {
  return workspace === 'queue' ? '/dashboard/applicants' : '/admin/access';
}

export function accessDetailPath(
  workspace: AccessWorkspace,
  userId: string,
): string {
  return `${accessListPath(workspace)}/users/${encodeURIComponent(userId)}`;
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
