import type {
  AdminAccessDetail,
  AdminAccessFacetCounts,
  AdminAccessHistory,
  AdminAccessLoginHistoryItem,
  AdminAccessListPage,
  AdminAccessStaffAccessRequestHistoryItem,
} from './admin-access-api-types';
import {
  AdminAccessResponseError,
  isAdminAccessListItem,
  isNonEmptyString,
  isRecord,
  isStrictIsoTimestamp,
} from './admin-access-response-guards';

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
  if (!isRecord(value)) {
    throw new AdminAccessResponseError();
  }
  const profile = value.profile;
  if (
    !isAdminAccessListItem(value) ||
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
      name: profile.name,
      studentId: profile.studentId,
      department: profile.department,
      isComplete: profile.isComplete,
    },
  };
}

function isAdminAccessStaffAccessRequestHistoryItem(
  value: unknown,
): value is AdminAccessStaffAccessRequestHistoryItem {
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
    isStrictIsoTimestamp(value.createdAt)
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
    !isRecord(value.staffAccessRequests) ||
    !Array.isArray(value.staffAccessRequests.items) ||
    !value.staffAccessRequests.items.every(
      isAdminAccessStaffAccessRequestHistoryItem,
    ) ||
    typeof value.staffAccessRequests.page !== 'number' ||
    typeof value.staffAccessRequests.limit !== 'number' ||
    typeof value.staffAccessRequests.total !== 'number' ||
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
    staffAccessRequests: {
      items: value.staffAccessRequests.items.map((item) => ({ ...item })),
      page: value.staffAccessRequests.page,
      limit: value.staffAccessRequests.limit,
      total: value.staffAccessRequests.total,
    },
    loginHistory: {
      items: value.loginHistory.items.map((item) => ({ ...item })),
      page: value.loginHistory.page,
      limit: value.loginHistory.limit,
      total: value.loginHistory.total,
    },
  };
}
