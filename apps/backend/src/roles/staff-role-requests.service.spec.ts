import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import type { RoleUser } from './domain/role-onboarding';
import type { UserProfileRecord } from '../users/user-profile-policy';
import {
  STAFF_ROLE_REQUEST_ACTIONS,
  type StaffRoleRequestAction,
  type StaffRoleRequestListQuery,
  type StaffRoleReactivationApproval,
  type StaffRoleRequestRecord,
  type StaffRoleRequestTransition,
  type StaffUserAccountStatusTransition,
  type StaffUserRoleTransition,
} from './domain/staff-role-request';
import { RolesErrorCode } from './roles-error-code.enum';
import type {
  StaffRoleRequestsRepositoryPort,
  StaffRoleRequestsTransactionStore,
} from './staff-role-requests.repository';
import { StaffRoleRequestsService } from './staff-role-requests.service';

const ADMIN_GITHUB_ID = 1001n;
const STAFF_GITHUB_ID = 1002n;
const REQUESTED_AT = new Date('2026-01-01T00:00:00.000Z');

function pendingRequest(): StaffRoleRequestRecord {
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

class InMemoryStaffRoleRequestsRepository
  implements StaffRoleRequestsRepositoryPort, StaffRoleRequestsTransactionStore
{
  private readonly users = new Map<bigint, RoleUser>([
    [
      ADMIN_GITHUB_ID,
      {
        id: 'synthetic-admin',
        role: Role.ADMIN,
        accountStatus: AccountStatus.ACTIVE,
      },
    ],
    [
      STAFF_GITHUB_ID,
      {
        id: 'synthetic-staff-actor',
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

  findUserByGithubId(githubId: bigint): Promise<RoleUser | null> {
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

function createService(
  request: StaffRoleRequestRecord = pendingRequest(),
): StaffRoleRequestsService {
  return new StaffRoleRequestsService(
    new InMemoryStaffRoleRequestsRepository(request),
  );
}

describe('StaffRoleRequestsService', () => {
  it('ADMIN은 오래된 PENDING 요청 목록을 조회한다', async () => {
    // Given
    const service = createService();
    const query: StaffRoleRequestListQuery = {
      status: RoleRequestStatus.PENDING,
      query: '',
      page: 1,
      limit: 20,
    };

    // When
    const result = await service.list(ADMIN_GITHUB_ID, query);

    // Then
    expect(result).toMatchObject({ page: 1, limit: 20, total: 1 });
    expect(result.items[0]?.githubLogin).toBe('synthetic-staff');
  });

  it('ADMIN이 PENDING 요청을 승인하면 같은 트랜잭션에서 STAFF 역할을 부여한다', async () => {
    // Given
    const service = createService();
    const action: StaffRoleRequestAction = {
      action: STAFF_ROLE_REQUEST_ACTIONS.APPROVE,
    };

    // When
    const result = await service.decide(
      ADMIN_GITHUB_ID,
      'synthetic-request',
      action,
    );

    // Then
    expect(result.status).toBe(RoleRequestStatus.APPROVED);
    expect(result.userRole).toBe(Role.STAFF);
    expect(result.decidedBy).toBe('synthetic-admin');
  });

  it('프로필이 미완료인 기존 PENDING 요청은 승인해도 STAFF 역할을 부여하지 않는다', async () => {
    // Given
    const repository = new InMemoryStaffRoleRequestsRepository();
    jest.spyOn(repository, 'findUserProfileById').mockResolvedValue({
      id: 'synthetic-requester',
      name: '합성 사용자',
      studentId: null,
      department: null,
    });
    const service = new StaffRoleRequestsService(repository);

    // When
    const approval = service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.APPROVE,
    });

    // Then
    await expect(approval).rejects.toMatchObject({
      errorCode: { code: 'USR_002', status: 409 },
    });
    expect(repository.allRequests()[0]).toMatchObject({
      status: RoleRequestStatus.PENDING,
      userRole: null,
    });
  });

  it('ADMIN이 PENDING 요청을 반려하면 사유를 남기고 역할은 부여하지 않는다', async () => {
    // Given
    const service = createService();
    const action: StaffRoleRequestAction = {
      action: STAFF_ROLE_REQUEST_ACTIONS.REJECT,
      reason: '합성 소속 확인 필요',
    };

    // When
    const result = await service.decide(
      ADMIN_GITHUB_ID,
      'synthetic-request',
      action,
    );

    // Then
    expect(result.status).toBe(RoleRequestStatus.REJECTED);
    expect(result.rejectionReason).toBe('합성 소속 확인 필요');
    expect(result.userRole).toBeNull();
  });

  it('ADMIN이 APPROVED 요청을 회수하면 STAFF 역할을 보존하고 계정만 비활성화한다', async () => {
    // Given
    const service = createService();
    await service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.APPROVE,
    });

    // When
    const result = await service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.REVOKE,
    });

    // Then
    expect(result.status).toBe(RoleRequestStatus.REVOKED);
    expect(result).toMatchObject({
      userRole: Role.STAFF,
      userAccountStatus: AccountStatus.DEACTIVATED,
    });
    expect(result.decidedBy).toBe('synthetic-admin');
    expect(result.decidedAt).toBeInstanceOf(Date);
  });

  it('이미 회수된 요청은 경쟁 처리에서 다시 회수하지 않는다', async () => {
    // Given
    const service = createService();
    await service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.APPROVE,
    });
    await service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.REVOKE,
    });

    // When
    const secondRevocation = service.decide(
      ADMIN_GITHUB_ID,
      'synthetic-request',
      { action: STAFF_ROLE_REQUEST_ACTIONS.REVOKE },
    );

    // Then
    await expect(secondRevocation).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ROLE_REQUEST_ALREADY_DECIDED },
    });
  });

  it('ADMIN 재활성화는 REVOKED 이력을 보존하고 별도 APPROVED 이력을 만든다', async () => {
    const repository = new InMemoryStaffRoleRequestsRepository();
    const service = new StaffRoleRequestsService(repository);
    await service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.APPROVE,
    });
    await service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.REVOKE,
    });

    const result = await service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.REACTIVATE,
    });

    expect(result).toMatchObject({
      status: RoleRequestStatus.APPROVED,
      userRole: Role.STAFF,
      userAccountStatus: AccountStatus.ACTIVE,
      decidedBy: 'synthetic-admin',
    });
    expect(repository.allRequests()).toHaveLength(2);
    expect(repository.allRequests()[0]?.status).toBe(RoleRequestStatus.REVOKED);
  });

  it('이미 재활성화된 계정은 같은 REVOKED 이력으로 다시 활성화하지 않는다', async () => {
    const repository = new InMemoryStaffRoleRequestsRepository();
    const service = new StaffRoleRequestsService(repository);
    await service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.APPROVE,
    });
    await service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.REVOKE,
    });
    await service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.REACTIVATE,
    });

    await expect(
      service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
        action: STAFF_ROLE_REQUEST_ACTIONS.REACTIVATE,
      }),
    ).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ROLE_STATE_CONFLICT },
    });
    expect(repository.allRequests()).toHaveLength(2);
  });

  it('비활성 ADMIN은 목록 조회와 처리를 모두 AUT_003으로 거부한다', async () => {
    const repository = new InMemoryStaffRoleRequestsRepository();
    repository.deactivateAdmin();
    const service = new StaffRoleRequestsService(repository);
    const query: StaffRoleRequestListQuery = {
      status: RoleRequestStatus.PENDING,
      query: '',
      page: 1,
      limit: 20,
    };

    await expect(service.list(ADMIN_GITHUB_ID, query)).rejects.toMatchObject({
      errorCode: { code: 'AUT_003' },
    });
    await expect(
      service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
        action: STAFF_ROLE_REQUEST_ACTIONS.APPROVE,
      }),
    ).rejects.toMatchObject({ errorCode: { code: 'AUT_003' } });
  });

  it('ADMIN이 아닌 사용자의 조회와 처리를 거부한다', async () => {
    // Given
    const service = createService();
    const query: StaffRoleRequestListQuery = {
      status: RoleRequestStatus.PENDING,
      query: '',
      page: 1,
      limit: 20,
    };

    // When
    const listPromise = service.list(STAFF_GITHUB_ID, query);
    const decisionPromise = service.decide(
      STAFF_GITHUB_ID,
      'synthetic-request',
      { action: STAFF_ROLE_REQUEST_ACTIONS.APPROVE },
    );

    // Then
    await expect(listPromise).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ADMIN_ONLY },
    });
    await expect(decisionPromise).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ADMIN_ONLY },
    });
  });

  it('이미 처리된 요청은 다시 처리하지 않는다', async () => {
    // Given
    const service = createService();
    await service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.APPROVE,
    });

    // When
    const secondDecision = service.decide(
      ADMIN_GITHUB_ID,
      'synthetic-request',
      { action: STAFF_ROLE_REQUEST_ACTIONS.REJECT, reason: '합성 사유' },
    );

    // Then
    await expect(secondDecision).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ROLE_REQUEST_ALREADY_DECIDED },
    });
  });
});
