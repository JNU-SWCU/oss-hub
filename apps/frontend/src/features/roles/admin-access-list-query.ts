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
 * `/dashboard/users` read-only screen (PR04C). Extracted so filter/sort/page
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

const ACCESS_DETAIL_BASE_PATHS = {
  directory: '/dashboard/users',
  queue: '/dashboard/applicants/users',
} as const satisfies Record<AccessWorkspace, string>;

export function accessListPath(workspace: AccessWorkspace): string {
  return workspace === 'queue' ? '/dashboard/applicants' : '/dashboard/users';
}

/**
 * 상세 주소에 **목록이 서 있던 검색·필터·정렬·페이지를 그대로 얹는다.**
 * 이 화면의 목록 상태는 URL 이 원본이라(`admin-access-url-state.ts`), 상세로
 * 갈 때 그 질의를 떨어뜨리면 오버레이 뒤에 깔린 목록이 같은 주소를 다시 읽어
 * 「검색 안 한 첫 화면」으로 되돌아간다. 상세 페이지는 이 질의를 읽지 않으므로
 * 얹어도 상세의 동작은 변하지 않고, 닫을 때(`router.back()`)의 복귀도 그대로다.
 */
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
