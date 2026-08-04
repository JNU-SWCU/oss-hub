import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import type { AuditLogTransactionWriter } from '../audit-log/audit-log.store';
import type { AuditLogService } from '../audit-log/audit-log.service';
import type {
  AdminAccessActor,
  AdminAccessPendingDecisionUpdate,
  AdminAccessRepositoryPort,
  AdminAccessTransactionStore,
  AdminAccessUserDetailRecord,
  AdminAccessUserPageRecord,
  AdminAccessUserRecord,
  AdminAccessUserUpdate,
} from './admin-access.repository';
import type {
  AdminAccessListQuery,
  AdminAccessLoginHistoryPage,
  AdminAccessRoleRequestHistoryPage,
} from './domain/admin-access';

export const ADMIN_GITHUB_ID = 9_131_300_001n;
export const TARGET_GITHUB_ID = 9_131_300_002n;

export function adminActor(
  overrides: Partial<AdminAccessActor> = {},
): AdminAccessActor {
  return {
    id: 'admin',
    githubId: ADMIN_GITHUB_ID,
    githubLogin: 'synthetic-admin',
    name: '합성 관리자',
    role: Role.ADMIN,
    accountStatus: AccountStatus.ACTIVE,
    ...overrides,
  };
}

export function accessUser(
  overrides: Partial<AdminAccessUserRecord> = {},
): AdminAccessUserRecord {
  return {
    id: 'target',
    githubId: TARGET_GITHUB_ID,
    githubLogin: 'synthetic-target',
    name: '합성 사용자',
    role: Role.STUDENT,
    accountStatus: AccountStatus.ACTIVE,
    isProfileComplete: true,
    pendingRequest: null,
    lastLoginAt: null,
    ...overrides,
  };
}

export function auditLogHarness(): {
  readonly service: AuditLogService;
  readonly record: jest.Mock;
} {
  const record = jest.fn().mockResolvedValue({});
  return {
    service: { record } as unknown as AuditLogService,
    record,
  };
}

export class InMemoryAdminAccessRepository
  implements AdminAccessRepositoryPort, AdminAccessTransactionStore
{
  readonly auditLogWriter = {} as AuditLogTransactionWriter;
  actor: AdminAccessActor | null = adminActor();
  target: AdminAccessUserRecord | null = accessUser();
  authoritativeTarget: AdminAccessUserRecord | null = null;
  activeAdminCount = 2;
  userCasSucceeds = true;
  requestCasSucceeds = true;
  operations: string[] = [];
  userUpdates: AdminAccessUserUpdate[] = [];
  requestUpdates: AdminAccessPendingDecisionUpdate[] = [];

  withTransaction<T>(
    operation: (store: AdminAccessTransactionStore) => Promise<T>,
  ): Promise<T> {
    return operation(this);
  }

  findActorByGithubId(): Promise<AdminAccessActor | null> {
    return Promise.resolve(this.actor);
  }

  list(query: AdminAccessListQuery): Promise<AdminAccessUserPageRecord> {
    const target = this.target;
    return Promise.resolve({
      items: target ? [target] : [],
      page: query.page,
      limit: query.limit,
      total: target ? 1 : 0,
      facets: {
        roles: { unassigned: 0, student: target ? 1 : 0, staff: 0, admin: 0 },
        accountStatuses: {
          active: target ? 1 : 0,
          deactivated: 0,
        },
        pendingRequests: { none: target ? 1 : 0, pending: 0 },
      },
    });
  }

  facets(query: AdminAccessListQuery) {
    return this.list(query).then((page) => page.facets);
  }

  findById(): Promise<AdminAccessUserDetailRecord | null> {
    const target = this.authoritativeTarget ?? this.target;
    return Promise.resolve(
      target
        ? {
            ...target,
            profile: {
              name: target.name,
              studentId: '123456',
              department: '소프트웨어공학과',
              isComplete: target.isProfileComplete,
            },
          }
        : null,
    );
  }

  listRoleRequestHistory(
    _userId: string,
    page: { readonly page: number; readonly limit: number },
  ): Promise<AdminAccessRoleRequestHistoryPage> {
    return Promise.resolve({ items: [], ...page, total: 0 });
  }

  listLoginHistory(
    _userId: string,
    page: { readonly page: number; readonly limit: number },
  ): Promise<AdminAccessLoginHistoryPage> {
    return Promise.resolve({ items: [], ...page, total: 0 });
  }

  lockActiveAdmins(): Promise<number> {
    this.operations.push('lock-active-admins');
    return Promise.resolve(this.activeAdminCount);
  }

  findUserForUpdate(): Promise<AdminAccessUserRecord | null> {
    this.operations.push('find-user-for-update');
    return Promise.resolve(this.target);
  }

  compareAndSwapAccess(input: AdminAccessUserUpdate): Promise<boolean> {
    this.operations.push('compare-and-swap-access');
    this.userUpdates.push(input);
    if (this.userCasSucceeds && this.target) {
      this.target = {
        ...this.target,
        role: input.desiredRole,
        accountStatus: input.desiredAccountStatus,
      };
    }
    return Promise.resolve(this.userCasSucceeds);
  }

  decidePendingRequest(
    input: AdminAccessPendingDecisionUpdate,
  ): Promise<boolean> {
    this.operations.push('decide-pending-request');
    this.requestUpdates.push(input);
    if (this.requestCasSucceeds && this.target) {
      this.target = { ...this.target, pendingRequest: null };
    }
    return Promise.resolve(this.requestCasSucceeds);
  }
}

export const PENDING_REQUEST = {
  id: 'request-pending',
  status: RoleRequestStatus.PENDING,
  createdAt: new Date('2026-07-23T00:00:00.000Z'),
} as const;
