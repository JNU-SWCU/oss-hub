import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import { DomainException } from '../common/error-code';
import {
  CONSENT_ERROR_CODES,
  ConsentErrorCode,
} from '../consents/consent-error-code.enum';
import type { ConsentsService } from '../consents/consents.service';
import type { UsersService } from '../users/users.service';
import type { RoleUser } from './domain/role-onboarding';
import type {
  RolesRepositoryPort,
  RolesTransactionStore,
} from './roles.repository';
import { RolesService } from './roles.service';

const GITHUB_ID = 424242n;
const USER: RoleUser = {
  id: 'synthetic-user',
  role: null,
  accountStatus: AccountStatus.ACTIVE,
};

class InMemoryProfileRolesRepository implements RolesRepositoryPort {
  transactionCount = 0;

  constructor(private readonly store: RolesTransactionStore) {}

  withTransaction<T>(
    operation: (transaction: RolesTransactionStore) => Promise<T>,
  ): Promise<T> {
    this.transactionCount += 1;
    return operation(this.store);
  }

  findUserByGithubId(): Promise<RoleUser | null> {
    return Promise.resolve(USER);
  }

  findLatestRequest(): Promise<null> {
    return Promise.resolve(null);
  }
}

function buildService(
  options: {
    readonly consentError?: DomainException;
    readonly profileError?: DomainException;
  } = {},
) {
  const updateUserRole = jest
    .fn()
    .mockResolvedValue({ ...USER, role: Role.STUDENT });
  const createPendingRequest = jest.fn().mockResolvedValue({
    id: 'synthetic-request',
    userId: USER.id,
    status: RoleRequestStatus.PENDING,
    rejectionReason: null,
    decidedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  const store: RolesTransactionStore = {
    findUserByGithubId: jest.fn().mockResolvedValue(USER),
    updateUserRole,
    findPendingRequest: jest.fn().mockResolvedValue(null),
    findLatestRequest: jest.fn().mockResolvedValue(null),
    createPendingRequest,
  };
  const repository = new InMemoryProfileRolesRepository(store);
  const requireCurrent = options.consentError
    ? jest.fn().mockRejectedValue(options.consentError)
    : jest.fn().mockResolvedValue(undefined);
  const requireCompleteProfile = options.profileError
    ? jest.fn().mockRejectedValue(options.profileError)
    : jest.fn().mockResolvedValue(undefined);
  const consentsService: Pick<ConsentsService, 'requireCurrent'> = {
    requireCurrent,
  };
  const usersService: Pick<UsersService, 'requireCompleteProfile'> = {
    requireCompleteProfile,
  };

  return {
    service: new RolesService(repository, consentsService, usersService),
    store,
    repository,
    requireCompleteProfile,
    updateUserRole,
    createPendingRequest,
  };
}

function profileIncomplete(): DomainException {
  return new DomainException({
    code: 'USR_002',
    status: 409,
    message: '온보딩 프로필을 먼저 완료해 주세요.',
  });
}

it.each([Role.STUDENT, Role.STAFF])(
  '미완료 프로필은 %s 선택을 변경 없이 거부한다',
  async (role) => {
    // Given
    const { service, repository, updateUserRole, createPendingRequest } =
      buildService({
        profileError: profileIncomplete(),
      });

    // When
    const promise = service.selectRole(GITHUB_ID, role);

    // Then
    await expect(promise).rejects.toMatchObject({
      errorCode: { code: 'USR_002' },
    });
    expect(repository.transactionCount).toBe(0);
    expect(updateUserRole).not.toHaveBeenCalled();
    expect(createPendingRequest).not.toHaveBeenCalled();
  },
);

it.each([
  [Role.STUDENT, Role.STUDENT, null, '/programs'],
  [Role.STAFF, null, RoleRequestStatus.PENDING, '/onboarding/pending'],
] as const)(
  '완료 프로필은 %s 선택의 기존 결과를 보존한다',
  async (selectedRole, role, requestStatus, redirectTo) => {
    // Given
    const { service } = buildService();

    // When
    const result = await service.selectRole(GITHUB_ID, selectedRole);

    // Then
    expect(result).toEqual({
      selectedRole,
      role,
      requestStatus,
      redirectTo,
    });
  },
);

it('동의와 프로필이 모두 부족하면 동의 오류를 먼저 반환한다', async () => {
  // Given
  const consentError = new DomainException(
    CONSENT_ERROR_CODES[ConsentErrorCode.REQUIRED_CONSENT_MISSING],
  );
  const { service, repository, requireCompleteProfile } = buildService({
    consentError,
    profileError: profileIncomplete(),
  });

  // When
  const promise = service.selectRole(GITHUB_ID, Role.STUDENT);

  // Then
  await expect(promise).rejects.toBe(consentError);
  expect(requireCompleteProfile).not.toHaveBeenCalled();
  expect(repository.transactionCount).toBe(0);
});
