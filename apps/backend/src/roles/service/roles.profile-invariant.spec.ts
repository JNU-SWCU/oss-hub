import {
  AccountStatus,
  MemberKind,
  StaffAccessRequestStatus,
} from '@prisma/client';
import { DomainException } from '../../common/error-code';
import {
  CONSENT_ERROR_CODES,
  ConsentErrorCode,
} from '../../consents/consent-error-code.enum';
import type { ConsentsService } from '../../consents/consents.service';
import type { MemberUser } from '../../users/domain/member-onboarding';
import type {
  OnboardingRepositoryPort,
  OnboardingTransactionStore,
} from '../../users/domain/onboarding-store';
import { RolesService } from './roles.service';

const GITHUB_ID = 424242n;
const USER: MemberUser = {
  id: 'synthetic-user',
  memberKind: null,
  selectedMemberKind: null,
  hasStaffAccess: false,
  hasAdminAccess: false,
  accountStatus: AccountStatus.ACTIVE,

  profile: { name: null, studentId: null, department: null },
};

class InMemoryProfileRolesRepository implements OnboardingRepositoryPort {
  transactionCount = 0;

  constructor(private readonly store: OnboardingTransactionStore) {}

  withTransaction<T>(
    operation: (transaction: OnboardingTransactionStore) => Promise<T>,
  ): Promise<T> {
    this.transactionCount += 1;
    return operation(this.store);
  }

  findUserByGithubId(): Promise<MemberUser | null> {
    return Promise.resolve(USER);
  }

  findLatestRequest(): Promise<null> {
    return Promise.resolve(null);
  }
}

function buildService(
  options: {
    readonly consentError?: DomainException;
  } = {},
) {
  const updateSelectedMemberKind = jest
    .fn()
    .mockImplementation((_userId: string, memberKind: MemberKind) =>
      Promise.resolve({ ...USER, selectedMemberKind: memberKind }),
    );
  const createPendingRequest = jest.fn().mockResolvedValue({
    id: 'synthetic-request',
    userId: USER.id,
    status: StaffAccessRequestStatus.PENDING,
    rejectionReason: null,
    decidedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  const requestStaffAccess = jest
    .fn()
    .mockResolvedValue({ role: null, requestStatus: null });
  const store: OnboardingTransactionStore = {
    findUserByGithubId: jest.fn().mockResolvedValue(USER),
    updateSelectedMemberKind,
    findPendingRequest: jest.fn().mockResolvedValue(null),
    findLatestRequest: jest.fn().mockResolvedValue(null),
    createPendingRequest,
    requestStaffAccess,
  };
  const repository = new InMemoryProfileRolesRepository(store);
  const requireCurrent = options.consentError
    ? jest.fn().mockRejectedValue(options.consentError)
    : jest.fn().mockResolvedValue(undefined);
  const consentsService: Pick<ConsentsService, 'requireCurrent'> = {
    requireCurrent,
  };

  return {
    service: new RolesService(repository, consentsService),
    store,
    repository,
    requireCurrent,
    updateSelectedMemberKind,
    createPendingRequest,
    requestStaffAccess,
  };
}

it.each<MemberKind>(['STUDENT', 'STAFF'])(
  '프로필이 비어 있어도 %s 선택은 통과한다',
  async (role) => {
    const { service, repository } = buildService();

    const result = await service.selectMemberKind(GITHUB_ID, role);

    expect(result.selectedMemberKind).toBe(role);
    expect(repository.transactionCount).toBe(1);
  },
);

it.each<MemberKind>(['STUDENT', 'STAFF'])(
  '%s 선택은 고른 사실만 남기고 남은 단계인 프로필로 보낸다',
  async (selectedRole) => {
    const { service, updateSelectedMemberKind } = buildService();

    const result = await service.selectMemberKind(GITHUB_ID, selectedRole);

    expect(result).toEqual({
      selectedMemberKind: selectedRole,
      redirectTo: '/onboarding/profile',
    });
    expect(updateSelectedMemberKind).toHaveBeenCalledWith(
      USER.id,
      selectedRole,
    );
  },
);

it.each<MemberKind>(['STUDENT', 'STAFF'])(
  '프로필이 비어 있으면 %s 선택은 확정을 부르지 않는다',
  async (selectedRole) => {
    const { service, requestStaffAccess, createPendingRequest } =
      buildService();

    await service.selectMemberKind(GITHUB_ID, selectedRole);

    expect(requestStaffAccess).not.toHaveBeenCalled();
    expect(createPendingRequest).not.toHaveBeenCalled();
  },
);

it('동의는 여전히 역할 선택보다 먼저다', async () => {
  const consentError = new DomainException(
    CONSENT_ERROR_CODES[ConsentErrorCode.REQUIRED_CONSENT_MISSING],
  );
  const { service, repository } = buildService({ consentError });

  const promise = service.selectMemberKind(GITHUB_ID, 'STUDENT');

  await expect(promise).rejects.toBe(consentError);
  expect(repository.transactionCount).toBe(0);
});

it('재신청도 프로필을 요구하지 않고 동의만 확인한다', async () => {
  const consentError = new DomainException(
    CONSENT_ERROR_CODES[ConsentErrorCode.REQUIRED_CONSENT_MISSING],
  );
  const { service, repository } = buildService({ consentError });

  const promise = service.retryStaffRequest(GITHUB_ID);

  await expect(promise).rejects.toBe(consentError);
  expect(repository.transactionCount).toBe(0);
});
