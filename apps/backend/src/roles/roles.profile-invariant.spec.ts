/**
 * 역할 배정과 프로필 완료 사이의 불변식 — 방향이 뒤집혔다.
 *
 * 예전 규칙: "역할을 배정하려면 프로필이 먼저 완료돼야 한다"(`USR_002`). 이 파일은
 * 그 규칙을 지키는 스펙이었다. 규칙 자체가 틀려서 지운 게 아니라, 그 규칙과 온보딩
 * 순서가 함께 만들던 결과가 틀렸다 — 프로필을 입력하는 시점에 역할이 없으니 학생
 * 기준(가장 엄격)으로 되돌아갔고, 학번이 필요 없는 교직원·관리자가 가짜 학번을
 * 지어내야 가입을 마칠 수 있었다.
 *
 * 그래서 순서를 약관 → **역할** → 프로필로 바꾸고 불변식도 반대로 세웠다:
 * **역할 배정은 프로필을 요구하지 않고, 프로필 완료 판정이 역할을 안다.** 이 파일은
 * 이제 그 새 방향을 고정한다 — 프로필이 비어 있어도 역할을 고를 수 있어야 하고,
 * 동의는 여전히 그보다 먼저여야 한다.
 */
import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import { DomainException } from '../common/error-code';
import {
  CONSENT_ERROR_CODES,
  ConsentErrorCode,
} from '../consents/consent-error-code.enum';
import type { ConsentsService } from '../consents/consents.service';
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
  const consentsService: Pick<ConsentsService, 'requireCurrent'> = {
    requireCurrent,
  };

  return {
    service: new RolesService(repository, consentsService),
    store,
    repository,
    requireCurrent,
    updateUserRole,
    createPendingRequest,
  };
}

it.each([Role.STUDENT, Role.STAFF])(
  '프로필이 비어 있어도 %s 선택은 통과한다',
  async (role) => {
    // Given — 프로필은 아직 한 글자도 채워지지 않았다. 역할이 먼저다.
    const { service, repository } = buildService();

    // When
    const result = await service.selectRole(GITHUB_ID, role);

    // Then — 이 호출이 막히면 교직원은 학번을 요구받는 프로필 화면으로 되돌아가고,
    // 애초에 순서를 뒤집은 이유가 사라진다.
    expect(result.selectedRole).toBe(role);
    expect(repository.transactionCount).toBe(1);
  },
);

it.each([
  [Role.STUDENT, Role.STUDENT, null, '/programs'],
  [Role.STAFF, null, RoleRequestStatus.PENDING, '/onboarding/pending'],
] as const)(
  '%s 선택의 기존 결과는 그대로 보존한다',
  async (selectedRole, role, requestStatus, redirectTo) => {
    // Given
    const { service } = buildService();

    // When
    const result = await service.selectRole(GITHUB_ID, selectedRole);

    // Then — 프로필이 미완료면 화면 게이트가 여기서 다시 `/onboarding/profile`로
    // 보낸다. 목적지 계산을 두 곳에 두지 않으려고 이 응답은 건드리지 않았다.
    expect(result).toEqual({
      selectedRole,
      role,
      requestStatus,
      redirectTo,
    });
  },
);

it('동의는 여전히 역할 선택보다 먼저다', async () => {
  // Given — 개인정보 경계라 이 순서는 바꾸지 않았다
  const consentError = new DomainException(
    CONSENT_ERROR_CODES[ConsentErrorCode.REQUIRED_CONSENT_MISSING],
  );
  const { service, repository } = buildService({ consentError });

  // When
  const promise = service.selectRole(GITHUB_ID, Role.STUDENT);

  // Then
  await expect(promise).rejects.toBe(consentError);
  expect(repository.transactionCount).toBe(0);
});

it('재신청도 프로필을 요구하지 않고 동의만 확인한다', async () => {
  // Given
  const consentError = new DomainException(
    CONSENT_ERROR_CODES[ConsentErrorCode.REQUIRED_CONSENT_MISSING],
  );
  const { service, repository } = buildService({ consentError });

  // When
  const promise = service.retryStaffRequest(GITHUB_ID);

  // Then
  await expect(promise).rejects.toBe(consentError);
  expect(repository.transactionCount).toBe(0);
});
