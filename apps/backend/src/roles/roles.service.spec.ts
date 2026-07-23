import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import { AuthErrorCode } from '../auth/auth-error-code.enum';
import { DomainException } from '../common/error-code';
import {
  CONSENT_ERROR_CODES,
  ConsentErrorCode,
} from '../consents/consent-error-code.enum';
import type { ConsentsService } from '../consents/consents.service';
import type { UsersService } from '../users/users.service';
import type { RoleRequestRecord, RoleUser } from './domain/role-onboarding';
import type {
  RolesRepositoryPort,
  RolesTransactionStore,
} from './roles.repository';
import { RolesErrorCode } from './roles-error-code.enum';
import { RolesService } from './roles.service';

const REQUESTED_AT = new Date('2026-01-01T00:00:00.000Z');

class InMemoryRolesStore implements RolesTransactionStore {
  private user: RoleUser | null;
  private readonly requests: RoleRequestRecord[];

  constructor(
    userRole: Role | null,
    requests: RoleRequestRecord[] = [],
    accountStatus: AccountStatus = AccountStatus.ACTIVE,
  ) {
    this.user = { id: 'synthetic-user', role: userRole, accountStatus };
    this.requests = [...requests];
  }

  findUserByGithubId(): Promise<RoleUser | null> {
    return Promise.resolve(this.user);
  }

  updateUserRole(_userId: string, role: Role): Promise<RoleUser> {
    if (!this.user) {
      throw new Error('합성 사용자가 존재해야 합니다.');
    }
    this.user = { ...this.user, role };
    return Promise.resolve(this.user);
  }

  findPendingRequest(): Promise<RoleRequestRecord | null> {
    return Promise.resolve(
      this.requests.find(
        (request) => request.status === RoleRequestStatus.PENDING,
      ) ?? null,
    );
  }

  findLatestRequest(): Promise<RoleRequestRecord | null> {
    return Promise.resolve(this.requests.at(-1) ?? null);
  }

  createPendingRequest(userId: string): Promise<RoleRequestRecord> {
    const request: RoleRequestRecord = {
      id: `synthetic-request-${this.requests.length + 1}`,
      userId,
      status: RoleRequestStatus.PENDING,
      rejectionReason: null,
      decidedAt: null,
      createdAt: REQUESTED_AT,
    };
    this.requests.push(request);
    return Promise.resolve(request);
  }

  requestCount(): number {
    return this.requests.length;
  }

  currentRole(): Role | null {
    return this.user?.role ?? null;
  }
}

class InMemoryRolesRepository implements RolesRepositoryPort {
  constructor(private readonly store: InMemoryRolesStore) {}

  withTransaction<T>(
    operation: (store: RolesTransactionStore) => Promise<T>,
  ): Promise<T> {
    return operation(this.store);
  }

  findUserByGithubId(): Promise<RoleUser | null> {
    return this.store.findUserByGithubId();
  }

  findLatestRequest(): Promise<RoleRequestRecord | null> {
    return this.store.findLatestRequest();
  }
}

function createService(
  role: Role | null,
  requests: RoleRequestRecord[] = [],
  consented = true,
  accountStatus: AccountStatus = AccountStatus.ACTIVE,
): { service: RolesService; store: InMemoryRolesStore } {
  const store = new InMemoryRolesStore(role, requests, accountStatus);
  const consentsService: Pick<ConsentsService, 'requireCurrent'> = {
    requireCurrent: consented
      ? jest.fn().mockResolvedValue(undefined)
      : jest
          .fn()
          .mockRejectedValue(
            new DomainException(
              CONSENT_ERROR_CODES[ConsentErrorCode.REQUIRED_CONSENT_MISSING],
            ),
          ),
  };
  const usersService: Pick<UsersService, 'requireCompleteProfile'> = {
    requireCompleteProfile: jest.fn().mockResolvedValue(undefined),
  };
  return {
    service: new RolesService(
      new InMemoryRolesRepository(store),
      consentsService,
      usersService,
    ),
    store,
  };
}

function roleRequest(
  status: RoleRequestStatus,
  rejectionReason: string | null = null,
): RoleRequestRecord {
  return {
    id: `synthetic-${status.toLowerCase()}`,
    userId: 'synthetic-user',
    status,
    rejectionReason,
    decidedAt: status === RoleRequestStatus.PENDING ? null : REQUESTED_AT,
    createdAt: REQUESTED_AT,
  };
}

describe('RolesService', () => {
  it('현행 정책 미동의 사용자의 역할 선택을 거부한다', async () => {
    // Given
    const { service, store } = createService(null, [], false);

    // When
    const promise = service.selectRole(424242n, Role.STUDENT);

    // Then
    await expect(promise).rejects.toMatchObject({
      errorCode: { code: ConsentErrorCode.REQUIRED_CONSENT_MISSING },
    });
    expect(store.currentRole()).toBeNull();
  });

  it('학생을 선택하면 역할을 확정하고 프로그램 목록으로 보낸다', async () => {
    // Given
    const { service } = createService(null);

    // When
    const result = await service.selectRole(424242n, Role.STUDENT);

    // Then
    expect(result).toEqual({
      selectedRole: Role.STUDENT,
      role: Role.STUDENT,
      requestStatus: null,
      redirectTo: '/programs',
    });
  });

  it('교직원을 선택하면 역할을 확정하지 않고 PENDING 요청을 만든다', async () => {
    // Given
    const { service, store } = createService(null);

    // When
    const result = await service.selectRole(424242n, Role.STAFF);

    // Then
    expect(result).toEqual({
      selectedRole: Role.STAFF,
      role: null,
      requestStatus: RoleRequestStatus.PENDING,
      redirectTo: '/onboarding/pending',
    });
    expect(store.requestCount()).toBe(1);
  });

  it('활성 요청이 있으면 교직원 선택을 멱등 처리한다', async () => {
    // Given
    const pending = roleRequest(RoleRequestStatus.PENDING);
    const { service, store } = createService(null, [pending]);

    // When
    const result = await service.selectRole(424242n, Role.STAFF);

    // Then
    expect(result.requestStatus).toBe(RoleRequestStatus.PENDING);
    expect(store.requestCount()).toBe(1);
  });

  it('활성 교직원 요청이 있으면 학생 전환을 거부한다', async () => {
    // Given
    const pending = roleRequest(RoleRequestStatus.PENDING);
    const { service, store } = createService(null, [pending]);

    // When
    const promise = service.selectRole(424242n, Role.STUDENT);

    // Then
    await expect(promise).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ACTIVE_REQUEST_EXISTS },
    });
    expect(store.currentRole()).toBeNull();
    expect(store.requestCount()).toBe(1);
  });

  it.each([Role.STAFF, Role.ADMIN])(
    '%s 역할이 확정된 사용자의 선택 변경을 거부한다',
    async (role) => {
      // Given
      const { service } = createService(role);

      // When
      const promise = service.selectRole(424242n, Role.STUDENT);

      // Then
      await expect(promise).rejects.toMatchObject({
        errorCode: { code: RolesErrorCode.ROLE_ALREADY_CONFIRMED },
      });
    },
  );

  it('가장 최근 역할 요청을 반환한다', async () => {
    // Given
    const rejected = roleRequest(RoleRequestStatus.REJECTED, '합성 사유');
    const { service } = createService(null, [rejected]);

    // When
    const result = await service.getMyRequest(424242n);

    // Then
    expect(result).toEqual(rejected);
  });

  it('역할 요청이 없으면 null을 반환한다', async () => {
    // Given
    const { service } = createService(null);

    // When
    const result = await service.getMyRequest(424242n);

    // Then
    expect(result).toBeNull();
  });

  it('거절 이력이 있으면 새 PENDING 요청을 만들고 이력을 보존한다', async () => {
    // Given
    const rejected = roleRequest(RoleRequestStatus.REJECTED, '합성 사유');
    const { service, store } = createService(null, [rejected]);

    // When
    const result = await service.retryStaffRequest(424242n);

    // Then
    expect(result.status).toBe(RoleRequestStatus.PENDING);
    expect(store.requestCount()).toBe(2);
  });

  it('권한 회수 이력은 일반 재요청으로 우회할 수 없다', async () => {
    // Given
    const revoked = roleRequest(RoleRequestStatus.REVOKED);
    const { service, store } = createService(null, [revoked]);

    // When
    const promise = service.retryStaffRequest(424242n);

    // Then
    await expect(promise).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ROLE_STATE_CONFLICT },
    });
    expect(store.requestCount()).toBe(1);
  });

  it('비활성 교직원은 기존 온보딩·재요청 경로를 사용할 수 없다', async () => {
    const revoked = roleRequest(RoleRequestStatus.REVOKED);
    const { service, store } = createService(
      Role.STAFF,
      [revoked],
      true,
      AccountStatus.DEACTIVATED,
    );

    await expect(service.retryStaffRequest(424242n)).rejects.toMatchObject({
      errorCode: { code: AuthErrorCode.UNAUTHENTICATED },
    });
    expect(store.requestCount()).toBe(1);
  });

  it('현행 정책 미동의 사용자의 교직원 재요청을 거부한다', async () => {
    // Given: 과거 요청 이력은 있지만 현행 정책에는 동의하지 않았다.
    const rejected = roleRequest(RoleRequestStatus.REJECTED, '합성 사유');
    const { service, store } = createService(null, [rejected], false);

    // When
    const promise = service.retryStaffRequest(424242n);

    // Then
    await expect(promise).rejects.toMatchObject({
      errorCode: { code: ConsentErrorCode.REQUIRED_CONSENT_MISSING },
    });
    expect(store.requestCount()).toBe(1);
  });

  it('활성 요청이 있으면 재요청을 거부한다', async () => {
    // Given
    const pending = roleRequest(RoleRequestStatus.PENDING);
    const { service } = createService(null, [pending]);

    // When
    const promise = service.retryStaffRequest(424242n);

    // Then
    await expect(promise).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ACTIVE_REQUEST_EXISTS },
    });
  });

  it('거절 이력 없이 재요청하면 잘못된 역할 선택으로 거부한다', async () => {
    // Given
    const { service } = createService(null);

    // When
    const promise = service.retryStaffRequest(424242n);

    // Then
    await expect(promise).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.INVALID_ROLE_SELECTION },
    });
  });
});
