import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import type { AuditLogTransactionWriter } from '../audit-log/audit-log.repository';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { UserProfileRecord } from '../users/user-profile-policy';
import type { RoleUser } from './domain/role-onboarding';
import type {
  StaffRoleReactivationApproval,
  StaffRoleRequestListQuery,
  StaffRoleRequestRecord,
  StaffRoleRequestTransition,
  StaffUserAccountStatusTransition,
  StaffUserRoleTransition,
} from './domain/staff-role-request';
import type {
  StaffRoleRequestsRepositoryPort,
  StaffRoleRequestsTransactionStore,
} from './staff-role-requests.repository';
import { StaffRoleRequestsService } from './staff-role-requests.service';

export const ADMIN_GITHUB_ID = 1001n;
export const STAFF_GITHUB_ID = 1002n;
const REQUESTED_AT = new Date('2026-01-01T00:00:00.000Z');

type StaffRoleTestActor = RoleUser & {
  readonly name: string | null;
  readonly githubLogin: string;
};

export function pendingRequest(): StaffRoleRequestRecord {
  return {
    id: 'synthetic-request',
    userId: 'synthetic-requester',
    githubLogin: 'synthetic-staff',
    userRole: null,
    userAccountStatus: AccountStatus.ACTIVE,
    status: RoleRequestStatus.PENDING,
    rejectionReason: null,
    decidedAt: null,
    decidedBy: null,
    createdAt: REQUESTED_AT,
  };
}

export class InMemoryStaffRoleRequestsRepository
  implements StaffRoleRequestsRepositoryPort, StaffRoleRequestsTransactionStore
{
  readonly auditLogWriter = {} as AuditLogTransactionWriter;
  private readonly users = new Map<bigint, StaffRoleTestActor>([
    [
      ADMIN_GITHUB_ID,
      {
        id: 'synthetic-admin',
        name: '합성 관리자',
        githubLogin: 'synthetic-admin',
        role: Role.ADMIN,
        accountStatus: AccountStatus.ACTIVE,
      },
    ],
    [
      STAFF_GITHUB_ID,
      {
        id: 'synthetic-staff-actor',
        name: '합성 교직원',
        githubLogin: 'synthetic-staff-actor',
        role: Role.STAFF,
        accountStatus: AccountStatus.ACTIVE,
      },
    ],
  ]);
  private readonly requests: StaffRoleRequestRecord[];

  constructor(request: StaffRoleRequestRecord = pendingRequest()) {
    this.requests = [request];
  }

  findUserProfileById(userId: string): Promise<UserProfileRecord | null> {
    return Promise.resolve({
      id: userId,
      name: '합성 사용자',
      studentId: '123456',
      department: '인공지능학부',
    });
  }

  withTransaction<T>(
    operation: (store: StaffRoleRequestsTransactionStore) => Promise<T>,
  ): Promise<T> {
    return operation(this);
  }

  findUserByGithubId(githubId: bigint): Promise<StaffRoleTestActor | null> {
    return Promise.resolve(this.users.get(githubId) ?? null);
  }

  list(): Promise<{
    readonly items: readonly StaffRoleRequestRecord[];
    readonly total: number;
  }> {
    return Promise.resolve({
      items: this.requests,
      total: this.requests.length,
    });
  }

  findRequestById(id: string): Promise<StaffRoleRequestRecord | null> {
    return Promise.resolve(
      this.requests.find((request) => request.id === id) ?? null,
    );
  }

  transitionRequest(input: StaffRoleRequestTransition): Promise<boolean> {
    const index = this.requests.findIndex(
      (request) =>
        request.id === input.requestId &&
        request.status === input.expectedStatus,
    );
    const request = this.requests[index];
    if (index < 0 || !request) {
      return Promise.resolve(false);
    }
    this.requests[index] = {
      ...request,
      status: input.nextStatus,
      rejectionReason: input.rejectionReason,
      decidedAt: input.decidedAt,
      decidedBy: 'synthetic-admin',
    };
    return Promise.resolve(true);
  }

  transitionUserRole(input: StaffUserRoleTransition): Promise<boolean> {
    const request = this.requests.find(
      (candidate) => candidate.userId === input.userId,
    );
    if (
      !request ||
      request.userRole !== input.expectedRole ||
      request.userAccountStatus !== input.expectedAccountStatus
    ) {
      return Promise.resolve(false);
    }
    this.replaceUserState(input.userId, {
      userRole: input.nextRole,
      userAccountStatus: input.expectedAccountStatus,
    });
    return Promise.resolve(true);
  }

  transitionUserAccountStatus(
    input: StaffUserAccountStatusTransition,
  ): Promise<boolean> {
    const request = this.requests.find(
      (candidate) => candidate.userId === input.userId,
    );
    if (
      !request ||
      request.userRole !== input.expectedRole ||
      request.userAccountStatus !== input.expectedAccountStatus
    ) {
      return Promise.resolve(false);
    }
    this.replaceUserState(input.userId, {
      userRole: input.expectedRole,
      userAccountStatus: input.nextAccountStatus,
    });
    return Promise.resolve(true);
  }

  createApprovedReactivation(
    input: StaffRoleReactivationApproval,
  ): Promise<StaffRoleRequestRecord> {
    const userState = this.requests.find(
      (request) => request.userId === input.userId,
    );
    if (!userState) {
      throw new Error('합성 요청 사용자가 존재해야 합니다.');
    }
    const approved: StaffRoleRequestRecord = {
      id: `synthetic-reactivation-${this.requests.length}`,
      userId: input.userId,
      githubLogin: userState.githubLogin,
      userRole: userState.userRole,
      userAccountStatus: userState.userAccountStatus,
      status: RoleRequestStatus.APPROVED,
      rejectionReason: null,
      decidedAt: input.decidedAt,
      decidedBy: 'synthetic-admin',
      createdAt: input.decidedAt,
    };
    this.requests.push(approved);
    return Promise.resolve(approved);
  }

  allRequests(): readonly StaffRoleRequestRecord[] {
    return this.requests;
  }

  deactivateAdmin(): void {
    this.users.set(ADMIN_GITHUB_ID, {
      id: 'synthetic-admin',
      name: '합성 관리자',
      githubLogin: 'synthetic-admin',
      role: Role.ADMIN,
      accountStatus: AccountStatus.DEACTIVATED,
    });
  }

  private replaceUserState(
    userId: string,
    state: Pick<StaffRoleRequestRecord, 'userRole' | 'userAccountStatus'>,
  ): void {
    for (const [index, request] of this.requests.entries()) {
      if (request.userId === userId) {
        this.requests[index] = { ...request, ...state };
      }
    }
  }
}

export function createService(
  request: StaffRoleRequestRecord = pendingRequest(),
): StaffRoleRequestsService {
  return new StaffRoleRequestsService(
    new InMemoryStaffRoleRequestsRepository(request),
    createAuditLogService(),
  );
}

export function createAuditLogService(): jest.Mocked<AuditLogService> {
  return {
    record: jest.fn().mockResolvedValue({}),
  } as unknown as jest.Mocked<AuditLogService>;
}

export function staffRoleListQuery(): StaffRoleRequestListQuery {
  return {
    status: RoleRequestStatus.PENDING,
    query: '',
    page: 1,
    limit: 20,
  };
}
