import { apiClient } from '@/lib/api-client';
import type {
  AdminAccessDetail,
  AdminAccessFacetCounts,
  AdminAccessHistory,
  AdminAccessHistoryParams,
  AdminAccessListPage,
  AdminAccessListParams,
  AdminAccessMutationResponse,
  AdminAccessPatchRequest,
  AdminProfileUpdateCommand,
  AdminProfileUpdateResponse,
} from './admin-access-api-types';
import {
  parseAdminAccessDetail,
  parseAdminAccessFacets,
  parseAdminAccessHistory,
  parseAdminAccessListPage,
} from './admin-access-read-parsers';
import { AdminAccessResponseError } from './admin-access-response-guards';
import {
  parseAdminAccessConflictProjection,
  parseAdminAccessMutationResponse,
  parseAdminProfileUpdateResponse,
} from './admin-access-write-parsers';

export type {
  AdminAccessAccountStatus,
  AdminAccessConflictProjection,
  AdminAccessDecidedRequest,
  AdminAccessDetail,
  AdminAccessExpectedPendingRequest,
  AdminAccessFacetCounts,
  AdminAccessHistory,
  AdminAccessHistoryParams,
  AdminAccessListItem,
  AdminAccessListPage,
  AdminAccessListParams,
  AdminAccessLoginEvent,
  AdminAccessLoginHistoryItem,
  AdminAccessMutationResponse,
  AdminAccessPatchRequest,
  AdminAccessPendingFilter,
  AdminAccessPendingRequest,
  AdminAccessProfile,
  AdminAccessRequestDecisionInput,
  AdminAccessRole,
  AdminAccessRoleFilter,
  AdminAccessSortDirection,
  AdminAccessSortField,
  AdminAccessStaffAccessRequestHistoryItem,
  AdminAccessStaffAccessRequestStatus,
  AdminProfileUpdateCommand,
  AdminProfileUpdateResponse,
} from './admin-access-api-types';
export {
  AdminAccessResponseError,
  parseAdminAccessConflictProjection,
  parseAdminAccessDetail,
  parseAdminAccessFacets,
  parseAdminAccessHistory,
  parseAdminAccessListPage,
  parseAdminAccessMutationResponse,
  parseAdminProfileUpdateResponse,
};

/**
 * Typed client for the unified `/users/access` admin resource.
 * Mirrors `apps/backend/src/users/admin-access.controller.ts`,
 * `dto/admin-access-query.dto.ts`, `dto/patch-admin-access.dto.ts`, and
 * `domain/admin-access.ts` (PR04A). Feature-local; does not replace the
 * legacy `./api.ts` client, which stays in place until PR04H's cutover.
 */

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
  if (params.staffAccessRequestPage !== undefined) {
    search.set('staffAccessRequestPage', String(params.staffAccessRequestPage));
  }
  if (params.staffAccessRequestLimit !== undefined) {
    search.set(
      'staffAccessRequestLimit',
      String(params.staffAccessRequestLimit),
    );
  }
  if (params.loginPage !== undefined) {
    search.set('loginPage', String(params.loginPage));
  }
  if (params.loginLimit !== undefined) {
    search.set('loginLimit', String(params.loginLimit));
  }
  return search.toString();
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

export async function fetchAdminAccessRequests(
  params: AdminAccessListParams,
  signal?: AbortSignal,
): Promise<AdminAccessListPage> {
  const search = serializeAdminAccessListQuery({
    ...params,
    pendingRequest: undefined,
  });
  const value = await apiClient<unknown>(
    `users/access/requests${search ? `?${search}` : ''}`,
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

/**
 * `PATCH /users/:id/profile` — 관리자가 다른 사용자의 이름·학번·학과를 대신 고친다
 * (admin-profile.service.ts, admin-profile-mutation.service.ts). CAS 접근 변경
 * (`patchAdminAccess`)과 달리 낙관적 잠금이 없는 단순 부분 갱신이라 `expected*` 필드가
 * 없다 — 요청 바디는 `admin-profile-edit-policy.ts`가 만드는 변경분만 담는다.
 */
export async function patchAdminUserProfile(
  id: string,
  command: AdminProfileUpdateCommand,
  signal?: AbortSignal,
): Promise<AdminProfileUpdateResponse> {
  const value = await apiClient<unknown>(
    `users/${encodeURIComponent(id)}/profile`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
      ...(signal ? { signal } : {}),
    },
  );
  return parseAdminProfileUpdateResponse(value);
}
