import type {
  AdminAccessAccountStatus,
  AdminAccessPendingFilter,
  AdminAccessRoleFilter,
  AdminAccessSortDirection,
  AdminAccessSortField,
} from './admin-access-api';
import {
  ADMIN_ACCESS_DEFAULT_DIRECTION,
  ADMIN_ACCESS_DEFAULT_FILTER_STATE,
  ADMIN_ACCESS_DEFAULT_SORT,
  APPLICANT_QUEUE_DEFAULT_FILTER_STATE,
  type AdminAccessListFilterState,
} from './admin-access-list-query';

const ROLE_FILTER_VALUES: readonly AdminAccessRoleFilter[] = [
  'UNASSIGNED',
  'STUDENT',
  'STAFF',
  'ADMIN',
];
const ACCOUNT_STATUS_VALUES: readonly AdminAccessAccountStatus[] = [
  'ACTIVE',
  'DEACTIVATED',
];
const PENDING_FILTER_VALUES: readonly AdminAccessPendingFilter[] = [
  'NONE',
  'PENDING',
];
const SORT_FIELD_VALUES: readonly AdminAccessSortField[] = [
  'name',
  'createdAt',
  'lastLoginAt',
  'role',
  'accountStatus',
];
const DIRECTION_VALUES: readonly AdminAccessSortDirection[] = ['asc', 'desc'];

const PAGE_PATTERN = /^[1-9][0-9]*$/;

function parseOptionalEnumParam<T extends string>(
  raw: string | null,
  allowed: readonly T[],
): T | '' {
  return raw !== null && (allowed as readonly string[]).includes(raw)
    ? (raw as T)
    : '';
}

function parseRequiredEnumParam<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  fallback: T,
): T {
  return raw !== null && (allowed as readonly string[]).includes(raw)
    ? (raw as T)
    : fallback;
}

function parsePageParam(raw: string | null): number {
  if (raw === null || !PAGE_PATTERN.test(raw)) {
    return ADMIN_ACCESS_DEFAULT_FILTER_STATE.page;
  }
  const page = Number(raw);
  return Number.isSafeInteger(page)
    ? page
    : ADMIN_ACCESS_DEFAULT_FILTER_STATE.page;
}

export function parseAdminAccessSearchParams(
  searchParams: URLSearchParams,
): AdminAccessListFilterState {
  const rawQuery = searchParams.get('query');
  return {
    query:
      rawQuery !== null
        ? rawQuery.trim()
        : ADMIN_ACCESS_DEFAULT_FILTER_STATE.query,
    role: parseOptionalEnumParam(searchParams.get('role'), ROLE_FILTER_VALUES),
    accountStatus: parseOptionalEnumParam(
      searchParams.get('accountStatus'),
      ACCOUNT_STATUS_VALUES,
    ),
    pendingRequest: parseOptionalEnumParam(
      searchParams.get('pendingRequest'),
      PENDING_FILTER_VALUES,
    ),
    sort: parseRequiredEnumParam(
      searchParams.get('sort'),
      SORT_FIELD_VALUES,
      ADMIN_ACCESS_DEFAULT_SORT,
    ),
    direction: parseRequiredEnumParam(
      searchParams.get('direction'),
      DIRECTION_VALUES,
      ADMIN_ACCESS_DEFAULT_DIRECTION,
    ),
    page: parsePageParam(searchParams.get('page')),
  };
}

export function buildAdminAccessSearchParams(
  state: AdminAccessListFilterState,
): URLSearchParams {
  const search = new URLSearchParams();
  const trimmedQuery = state.query.trim();
  if (trimmedQuery) search.set('query', trimmedQuery);
  if (state.role) search.set('role', state.role);
  if (state.accountStatus) search.set('accountStatus', state.accountStatus);
  if (state.pendingRequest) search.set('pendingRequest', state.pendingRequest);
  if (state.sort !== ADMIN_ACCESS_DEFAULT_SORT) search.set('sort', state.sort);
  if (state.direction !== ADMIN_ACCESS_DEFAULT_DIRECTION) {
    search.set('direction', state.direction);
  }
  if (state.page !== ADMIN_ACCESS_DEFAULT_FILTER_STATE.page) {
    search.set('page', String(state.page));
  }
  return search;
}

export function parseApplicantQueueSearchParams(
  searchParams: URLSearchParams,
): AdminAccessListFilterState {
  const parsed = parseAdminAccessSearchParams(searchParams);
  const sortRaw = searchParams.get('sort');
  const directionRaw = searchParams.get('direction');
  return {
    ...parsed,
    pendingRequest: '',
    sort:
      sortRaw !== null &&
      (SORT_FIELD_VALUES as readonly string[]).includes(sortRaw)
        ? parsed.sort
        : APPLICANT_QUEUE_DEFAULT_FILTER_STATE.sort,
    direction:
      directionRaw !== null &&
      (DIRECTION_VALUES as readonly string[]).includes(directionRaw)
        ? parsed.direction
        : APPLICANT_QUEUE_DEFAULT_FILTER_STATE.direction,
  };
}

export function buildApplicantQueueSearchParams(
  state: AdminAccessListFilterState,
): URLSearchParams {
  const search = new URLSearchParams();
  const trimmedQuery = state.query.trim();
  if (trimmedQuery) search.set('query', trimmedQuery);
  if (state.sort !== APPLICANT_QUEUE_DEFAULT_FILTER_STATE.sort) {
    search.set('sort', state.sort);
  }
  if (state.direction !== APPLICANT_QUEUE_DEFAULT_FILTER_STATE.direction) {
    search.set('direction', state.direction);
  }
  if (state.page !== APPLICANT_QUEUE_DEFAULT_FILTER_STATE.page) {
    search.set('page', String(state.page));
  }
  return search;
}
