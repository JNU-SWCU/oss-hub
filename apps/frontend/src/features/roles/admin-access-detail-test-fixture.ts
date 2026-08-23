import { vi } from 'vitest';
import type {
  AdminAccessHistory,
  AdminAccessLoginHistoryItem,
  AdminAccessStaffAccessRequestHistoryItem,
} from './admin-access-api';
import type { CanonicalAdminAccessDetail } from './independent-authority-api';
import type { AdminAccessDetailMutationController } from './components/admin-access-detail-view';

export function adminDetail(
  overrides: Partial<CanonicalAdminAccessDetail> = {},
): CanonicalAdminAccessDetail {
  return {
    id: 'target',
    githubLogin: 'octocat',
    name: '홍길동',
    role: 'STAFF',
    memberKind: 'STAFF',
    hasStaffAccess: true,
    hasAdminAccess: false,
    accountStatus: 'ACTIVE',
    isSelf: false,
    isProfileComplete: true,
    pendingRequest: null,
    lastLoginAt: '2026-07-30T01:00:00.000Z',
    profile: {
      name: '홍길동',
      studentId: '202601',
      department: '인공지능학부',
      isComplete: true,
    },
    ...overrides,
  };
}

export function historyPage<T>(
  overrides: {
    items?: readonly T[];
    page?: number;
    limit?: number;
    total?: number;
  } = {},
) {
  return {
    items: overrides.items ?? [],
    page: overrides.page ?? 1,
    limit: overrides.limit ?? 20,
    total: overrides.total ?? overrides.items?.length ?? 0,
  };
}

export function adminHistory(
  overrides: Partial<AdminAccessHistory> = {},
): AdminAccessHistory {
  return {
    staffAccessRequests:
      historyPage<AdminAccessStaffAccessRequestHistoryItem>(),
    loginHistory: historyPage<AdminAccessLoginHistoryItem>(),
    ...overrides,
  };
}

export function adminMutation(
  overrides: Partial<AdminAccessDetailMutationController> = {},
): AdminAccessDetailMutationController {
  return {
    confirmAction: null,
    processingAction: null,
    rejectReason: '',
    dialogError: null,
    conflictNotice: null,
    successMessage: null,
    onRequestAction: vi.fn(),
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    onReasonChange: vi.fn(),
    ...overrides,
  };
}
