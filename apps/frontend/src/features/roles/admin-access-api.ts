import { ApiError, apiClient } from '@/lib/api-client';

/**
 * Typed client for the unified `/users/access` admin resource.
 * Mirrors `apps/backend/src/users/admin-access.controller.ts`,
 * `dto/admin-access-query.dto.ts`, `dto/patch-admin-access.dto.ts`, and
 * `domain/admin-access.ts` (PR04A). Feature-local; does not replace the
 * legacy `./api.ts` client, which stays in place until PR04H's cutover.
 */

export type AdminAccessRole = 'STUDENT' | 'STAFF' | 'ADMIN';
export type AdminAccessRoleFilter = 'UNASSIGNED' | AdminAccessRole;
export type AdminAccessAccountStatus = 'ACTIVE' | 'DEACTIVATED';
export type AdminAccessPendingFilter = 'NONE' | 'PENDING';
export type AdminAccessSortField = 'name' | 'createdAt' | 'lastLoginAt';
export type AdminAccessSortDirection = 'asc' | 'desc';
export type AdminAccessRoleRequestStatus =
  'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';
export type AdminAccessLoginEvent = 'LOGIN' | 'LOGOUT';

export interface AdminAccessPendingRequest {
  readonly id: string;
  readonly status: 'PENDING';
  readonly createdAt: string;
}

export interface AdminAccessListItem {
  readonly id: string;
  readonly githubLogin: string;
  readonly name: string | null;
  readonly role: AdminAccessRole | null;
  readonly accountStatus: AdminAccessAccountStatus;
  readonly isSelf: boolean;
  readonly isProfileComplete: boolean;
  readonly pendingRequest: AdminAccessPendingRequest | null;
  readonly lastLoginAt: string | null;
}

export interface AdminAccessFacetCounts {
  readonly roles: {
    readonly unassigned: number;
    readonly student: number;
    readonly staff: number;
    readonly admin: number;
  };
  readonly accountStatuses: {
    readonly active: number;
    readonly deactivated: number;
  };
  readonly pendingRequests: {
    readonly none: number;
    readonly pending: number;
  };
}

export interface AdminAccessListPage {
  readonly items: readonly AdminAccessListItem[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly facets: AdminAccessFacetCounts;
}

export interface AdminAccessProfile {
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
  readonly isComplete: boolean;
}

export interface AdminAccessDetail extends AdminAccessListItem {
  readonly profile: AdminAccessProfile;
}

export interface AdminAccessRoleRequestHistoryItem {
  readonly id: string;
  readonly status: AdminAccessRoleRequestStatus;
  readonly rejectionReason: string | null;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
  readonly createdAt: string;
}

export interface AdminAccessLoginHistoryItem {
  readonly id: string;
  readonly event: AdminAccessLoginEvent;
  readonly provider: 'github';
  readonly success: boolean;
  readonly loginAt: string;
}

export interface AdminAccessHistory {
  readonly roleRequests: {
    readonly items: readonly AdminAccessRoleRequestHistoryItem[];
    readonly page: number;
    readonly limit: number;
    readonly total: number;
  };
  readonly loginHistory: {
    readonly items: readonly AdminAccessLoginHistoryItem[];
    readonly page: number;
    readonly limit: number;
    readonly total: number;
  };
}

export interface AdminAccessListParams {
  readonly query?: string;
  readonly role?: AdminAccessRoleFilter;
  readonly accountStatus?: AdminAccessAccountStatus;
  readonly pendingRequest?: AdminAccessPendingFilter;
  readonly sort?: AdminAccessSortField;
  readonly direction?: AdminAccessSortDirection;
  readonly page?: number;
  readonly limit?: number;
}

export interface AdminAccessHistoryParams {
  readonly roleRequestPage?: number;
  readonly roleRequestLimit?: number;
  readonly loginPage?: number;
  readonly loginLimit?: number;
}

export interface AdminAccessExpectedPendingRequest {
  readonly id: string;
  readonly status: 'PENDING';
}

export type AdminAccessRequestDecisionInput =
  | { readonly decision: 'APPROVE' }
  | { readonly decision: 'REJECT'; readonly reason: string };

/** CAS mutation body: `expected*` fields are the caller's last-known projection. */
export interface AdminAccessPatchRequest {
  readonly expectedRole: AdminAccessRole | null;
  readonly desiredRole: AdminAccessRole | null;
  readonly expectedAccountStatus: AdminAccessAccountStatus;
  readonly desiredAccountStatus: AdminAccessAccountStatus;
  readonly expectedPendingRequest: AdminAccessExpectedPendingRequest | null;
  readonly requestDecision?: AdminAccessRequestDecisionInput;
}

export interface AdminAccessDecidedRequest {
  readonly id: string;
  readonly status: 'APPROVED' | 'REJECTED';
}

export interface AdminAccessMutationResponse {
  readonly id: string;
  readonly role: AdminAccessRole | null;
  readonly accountStatus: AdminAccessAccountStatus;
  readonly pendingRequest: AdminAccessPendingRequest | null;
  readonly decidedRequest: AdminAccessDecidedRequest | null;
}

/** The backend's authoritative current-state projection returned on a 409 CAS conflict. */
export interface AdminAccessConflictProjection {
  readonly id: string;
  readonly role: AdminAccessRole | null;
  readonly accountStatus: AdminAccessAccountStatus;
  readonly pendingRequest: AdminAccessPendingRequest | null;
}

/** `RolesErrorCode.ACCESS_STATE_MISMATCH` in `apps/backend/src/roles/roles-error-code.enum.ts`. */
const ACCESS_STATE_MISMATCH_CODE = 'ROL_013';

export class AdminAccessResponseError extends Error {
  constructor() {
    super('관리자 접근 API 응답 형식이 올바르지 않습니다.');
    this.name = 'AdminAccessResponseError';
  }
}

export function serializeAdminAccessListQuery(
  params: AdminAccessListParams,
): string {
  const search = new URLSearchParams();
  if (params.query) search.set('query', params.query);
  if (params.role) search.set('role', params.role);
  if (params.accountStatus) search.set('accountStatus', params.accountStatus);
  if (params.pendingRequest) {
    search.set('pendingRequest', params.pendingRequest);
  }
  if (params.sort) search.set('sort', params.sort);
  if (params.direction) search.set('direction', params.direction);
  if (params.page !== undefined) search.set('page', String(params.page));
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  return search.toString();
}

export function serializeAdminAccessHistoryQuery(
  params: AdminAccessHistoryParams,
): string {
  const search = new URLSearchParams();
  if (params.roleRequestPage !== undefined) {
    search.set('roleRequestPage', String(params.roleRequestPage));
  }
  if (params.roleRequestLimit !== undefined) {
    search.set('roleRequestLimit', String(params.roleRequestLimit));
  }
  if (params.loginPage !== undefined) {
    search.set('loginPage', String(params.loginPage));
  }
  if (params.loginLimit !== undefined) {
    search.set('loginLimit', String(params.loginLimit));
  }
  return search.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isAdminAccessRole(value: unknown): value is AdminAccessRole {
  return value === 'STUDENT' || value === 'STAFF' || value === 'ADMIN';
}

function isAdminAccessAccountStatus(
  value: unknown,
): value is AdminAccessAccountStatus {
  return value === 'ACTIVE' || value === 'DEACTIVATED';
}

function isAdminAccessPendingRequest(
  value: unknown,
): value is AdminAccessPendingRequest {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    value.status === 'PENDING' &&
    isNonEmptyString(value.createdAt)
  );
}

function isNullableAdminAccessPendingRequest(
  value: unknown,
): value is AdminAccessPendingRequest | null {
  return value === null || isAdminAccessPendingRequest(value);
}

function isAdminAccessListItem(value: unknown): value is AdminAccessListItem {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.githubLogin) &&
    (value.name === null || typeof value.name === 'string') &&
    (value.role === null || isAdminAccessRole(value.role)) &&
    isAdminAccessAccountStatus(value.accountStatus) &&
    typeof value.isSelf === 'boolean' &&
    typeof value.isProfileComplete === 'boolean' &&
    isNullableAdminAccessPendingRequest(value.pendingRequest) &&
    (value.lastLoginAt === null || typeof value.lastLoginAt === 'string')
  );
}

function isAdminAccessFacetCounts(
  value: unknown,
): value is AdminAccessFacetCounts {
  if (!isRecord(value)) return false;
  const { roles, accountStatuses, pendingRequests } = value;
  return (
    isRecord(roles) &&
    typeof roles.unassigned === 'number' &&
    typeof roles.student === 'number' &&
    typeof roles.staff === 'number' &&
    typeof roles.admin === 'number' &&
    isRecord(accountStatuses) &&
    typeof accountStatuses.active === 'number' &&
    typeof accountStatuses.deactivated === 'number' &&
    isRecord(pendingRequests) &&
    typeof pendingRequests.none === 'number' &&
    typeof pendingRequests.pending === 'number'
  );
}

export function parseAdminAccessListPage(value: unknown): AdminAccessListPage {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !value.items.every(isAdminAccessListItem) ||
    typeof value.page !== 'number' ||
    typeof value.limit !== 'number' ||
    typeof value.total !== 'number' ||
    !isAdminAccessFacetCounts(value.facets)
  ) {
    throw new AdminAccessResponseError();
  }
  return {
    items: value.items.map((item) => ({ ...item })),
    page: value.page,
    limit: value.limit,
    total: value.total,
    facets: value.facets,
  };
}

export function parseAdminAccessFacets(value: unknown): AdminAccessFacetCounts {
  if (!isAdminAccessFacetCounts(value)) {
    throw new AdminAccessResponseError();
  }
  return value;
}

export function parseAdminAccessDetail(value: unknown): AdminAccessDetail {
  if (!isAdminAccessListItem(value)) {
    throw new AdminAccessResponseError();
  }
  const profile = (value as unknown as Record<string, unknown>).profile;
  if (
    !isRecord(profile) ||
    !(profile.name === null || typeof profile.name === 'string') ||
    !(profile.studentId === null || typeof profile.studentId === 'string') ||
    !(profile.department === null || typeof profile.department === 'string') ||
    typeof profile.isComplete !== 'boolean'
  ) {
    throw new AdminAccessResponseError();
  }
  return {
    ...value,
    profile: {
      name: profile.name as string | null,
      studentId: profile.studentId as string | null,
      department: profile.department as string | null,
      isComplete: profile.isComplete,
    },
  };
}

function isAdminAccessRoleRequestHistoryItem(
  value: unknown,
): value is AdminAccessRoleRequestHistoryItem {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    (value.status === 'PENDING' ||
      value.status === 'APPROVED' ||
      value.status === 'REJECTED' ||
      value.status === 'REVOKED') &&
    (value.rejectionReason === null ||
      typeof value.rejectionReason === 'string') &&
    (value.decidedAt === null || typeof value.decidedAt === 'string') &&
    (value.decidedBy === null || typeof value.decidedBy === 'string') &&
    isNonEmptyString(value.createdAt)
  );
}

function isAdminAccessLoginHistoryItem(
  value: unknown,
): value is AdminAccessLoginHistoryItem {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    (value.event === 'LOGIN' || value.event === 'LOGOUT') &&
    value.provider === 'github' &&
    typeof value.success === 'boolean' &&
    isNonEmptyString(value.loginAt)
  );
}

export function parseAdminAccessHistory(value: unknown): AdminAccessHistory {
  if (
    !isRecord(value) ||
    !isRecord(value.roleRequests) ||
    !Array.isArray(value.roleRequests.items) ||
    !value.roleRequests.items.every(isAdminAccessRoleRequestHistoryItem) ||
    typeof value.roleRequests.page !== 'number' ||
    typeof value.roleRequests.limit !== 'number' ||
    typeof value.roleRequests.total !== 'number' ||
    !isRecord(value.loginHistory) ||
    !Array.isArray(value.loginHistory.items) ||
    !value.loginHistory.items.every(isAdminAccessLoginHistoryItem) ||
    typeof value.loginHistory.page !== 'number' ||
    typeof value.loginHistory.limit !== 'number' ||
    typeof value.loginHistory.total !== 'number'
  ) {
    throw new AdminAccessResponseError();
  }
  return {
    roleRequests: {
      items: value.roleRequests.items.map((item) => ({ ...item })),
      page: value.roleRequests.page,
      limit: value.roleRequests.limit,
      total: value.roleRequests.total,
    },
    loginHistory: {
      items: value.loginHistory.items.map((item) => ({ ...item })),
      page: value.loginHistory.page,
      limit: value.loginHistory.limit,
      total: value.loginHistory.total,
    },
  };
}

function isAdminAccessDecidedRequest(
  value: unknown,
): value is AdminAccessDecidedRequest {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    (value.status === 'APPROVED' || value.status === 'REJECTED')
  );
}

export function parseAdminAccessMutationResponse(
  value: unknown,
): AdminAccessMutationResponse {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !(value.role === null || isAdminAccessRole(value.role)) ||
    !isAdminAccessAccountStatus(value.accountStatus) ||
    !isNullableAdminAccessPendingRequest(value.pendingRequest) ||
    !(
      value.decidedRequest === null ||
      isAdminAccessDecidedRequest(value.decidedRequest)
    )
  ) {
    throw new AdminAccessResponseError();
  }
  return {
    id: value.id,
    role: value.role,
    accountStatus: value.accountStatus,
    pendingRequest: value.pendingRequest,
    decidedRequest: value.decidedRequest,
  };
}

function isAdminAccessConflictProjection(
  value: unknown,
): value is AdminAccessConflictProjection {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    (value.role === null || isAdminAccessRole(value.role)) &&
    isAdminAccessAccountStatus(value.accountStatus) &&
    isNullableAdminAccessPendingRequest(value.pendingRequest)
  );
}

/**
 * Extracts the authoritative projection from a 409 CAS conflict. Returns
 * `null` for any other error (including non-conflict `ApiError`s) so
 * callers can rethrow; throws `AdminAccessResponseError` if the response
 * is a conflict but its `currentAccess` extension is malformed.
 */
export function parseAdminAccessConflictProjection(
  error: unknown,
): AdminAccessConflictProjection | null {
  if (
    !(error instanceof ApiError) ||
    error.problem.status !== 409 ||
    error.problem.code !== ACCESS_STATE_MISMATCH_CODE
  ) {
    return null;
  }
  const currentAccess = (error.problem as { currentAccess?: unknown })
    .currentAccess;
  if (!isAdminAccessConflictProjection(currentAccess)) {
    throw new AdminAccessResponseError();
  }
  return currentAccess;
}

export async function fetchAdminAccessList(
  params: AdminAccessListParams,
  signal?: AbortSignal,
): Promise<AdminAccessListPage> {
  const search = serializeAdminAccessListQuery(params);
  const value = await apiClient<unknown>(
    `users/access${search ? `?${search}` : ''}`,
    signal ? { signal } : undefined,
  );
  return parseAdminAccessListPage(value);
}

export async function fetchAdminAccessFacets(
  params: AdminAccessListParams,
  signal?: AbortSignal,
): Promise<AdminAccessFacetCounts> {
  const search = serializeAdminAccessListQuery(params);
  const value = await apiClient<unknown>(
    `users/access/facets${search ? `?${search}` : ''}`,
    signal ? { signal } : undefined,
  );
  return parseAdminAccessFacets(value);
}

export async function fetchAdminAccessDetail(
  id: string,
  signal?: AbortSignal,
): Promise<AdminAccessDetail> {
  const value = await apiClient<unknown>(
    `users/${encodeURIComponent(id)}/access`,
    signal ? { signal } : undefined,
  );
  return parseAdminAccessDetail(value);
}

export async function fetchAdminAccessHistory(
  id: string,
  params: AdminAccessHistoryParams,
  signal?: AbortSignal,
): Promise<AdminAccessHistory> {
  const search = serializeAdminAccessHistoryQuery(params);
  const value = await apiClient<unknown>(
    `users/${encodeURIComponent(id)}/access/history${search ? `?${search}` : ''}`,
    signal ? { signal } : undefined,
  );
  return parseAdminAccessHistory(value);
}

export async function patchAdminAccess(
  id: string,
  request: AdminAccessPatchRequest,
  signal?: AbortSignal,
): Promise<AdminAccessMutationResponse> {
  const value = await apiClient<unknown>(
    `users/${encodeURIComponent(id)}/access`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      ...(signal ? { signal } : {}),
    },
  );
  return parseAdminAccessMutationResponse(value);
}
