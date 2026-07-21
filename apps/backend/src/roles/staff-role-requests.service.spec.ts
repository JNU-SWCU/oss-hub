import { Role, RoleRequestStatus } from '@prisma/client';
import type { RoleUser } from './domain/role-onboarding';
import {
  STAFF_ROLE_REQUEST_ACTIONS,
  type StaffRoleRequestAction,
  type StaffRoleRequestListQuery,
  type StaffRoleRequestRecord,
  type StaffRoleRequestTransition,
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
    [ADMIN_GITHUB_ID, { id: 'synthetic-admin', role: Role.ADMIN }],
    [STAFF_GITHUB_ID, { id: 'synthetic-staff-actor', role: Role.STAFF }],
  ]);

  constructor(private request: StaffRoleRequestRecord = pendingRequest()) {}

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
    return Promise.resolve({ items: [this.request], total: 1 });
  }

  findRequestById(id: string): Promise<StaffRoleRequestRecord | null> {
    return Promise.resolve(this.request.id === id ? this.request : null);
  }

  transitionRequest(input: StaffRoleRequestTransition): Promise<boolean> {
    if (
      this.request.id !== input.requestId ||
      this.request.status !== input.expectedStatus
    ) {
      return Promise.resolve(false);
    }

    this.request = {
      ...this.request,
      status: input.nextStatus,
      rejectionReason: input.rejectionReason,
      decidedAt: input.decidedAt,
      decidedBy: 'synthetic-admin',
    };
    return Promise.resolve(true);
  }

  transitionUserRole(input: StaffUserRoleTransition): Promise<boolean> {
    if (
      this.request.userId !== input.userId ||
      this.request.userRole !== input.expectedRole
    ) {
      return Promise.resolve(false);
    }
    this.request = { ...this.request, userRole: input.nextRole };
    return Promise.resolve(true);
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

  it('ADMIN이 APPROVED 요청을 회수하면 같은 트랜잭션에서 STAFF 역할을 제거한다', async () => {
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
    expect(result.userRole).toBeNull();
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
