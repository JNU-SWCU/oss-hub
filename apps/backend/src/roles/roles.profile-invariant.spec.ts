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
import { AccountStatus, StaffAccessRequestStatus } from '@prisma/client';
import { DomainException } from '../common/error-code';
import {
  CONSENT_ERROR_CODES,
  ConsentErrorCode,
} from '../consents/consent-error-code.enum';
import type { ConsentsService } from '../consents/consents.service';
import type { MemberUser } from './domain/member-onboarding';
import type {
  RolesRepositoryPort,
  RolesTransactionStore,
} from './roles.repository';
import { RolesService } from './roles.service';

const GITHUB_ID = 424242n;
const USER: MemberUser = {
  id: 'synthetic-user',
  memberKind: null,
  accountStatus: AccountStatus.ACTIVE,
  // 한 글자도 채워지지 않은 프로필. 이 파일이 고정하려는 상태가 바로 이것이다.
  profile: { name: null, studentId: null, department: null },
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
    .mockImplementation((_userId: string, role: Role) =>
      Promise.resolve({ ...USER, selectedRole: role }),
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
  const store: RolesTransactionStore = {
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

it.each(['STUDENT', 'STAFF'])(
  '프로필이 비어 있어도 %s 선택은 통과한다',
  async (role) => {
    // Given — 프로필은 아직 한 글자도 채워지지 않았다. 역할이 먼저다.
    const { service, repository } = buildService();

    // When
    const result = await service.selectMemberKind(GITHUB_ID, role);

    // Then — 이 호출이 막히면 교직원은 학번을 요구받는 프로필 화면으로 되돌아가고,
    // 애초에 순서를 뒤집은 이유가 사라진다.
    expect(result.selectedRole).toBe(role);
    expect(repository.transactionCount).toBe(1);
  },
);

it.each(['STUDENT', 'STAFF'])(
  '%s 선택은 고른 사실만 남기고 남은 단계인 프로필로 보낸다',
  async (selectedRole) => {
    // Given
    const { service, updateSelectedMemberKind } = buildService();

    // When
    const result = await service.selectMemberKind(GITHUB_ID, selectedRole);

    // Then — 두 역할의 답이 완전히 같다. 확정을 `가입 마치기`로 미룬 뒤로(#569) 이
    // 화면에서 갈리는 것이 없어졌기 때문이다. 프로필을 마친 뒤 학생을 역할 홈으로,
    // 교직원을 승인 대기로 잇는 일은 그대로 화면의 게이트가 한다.
    expect(result).toEqual({
      selectedRole,
      redirectTo: '/onboarding/profile',
    });
    expect(updateSelectedMemberKind).toHaveBeenCalledWith(USER.id, selectedRole);
  },
);

/**
 * #569 회귀 검사 ① — **프로필이 비어 있는 동안에는 아무것도 확정되지 않는다.**
 *
 * 확정이 여기서 일어나면 이름·학과가 빈 미완성 신청이 관리자 대기줄에 올라가고,
 * 학생은 이름 없이 학생 권한을 들고 제품 안으로 들어간다. `requestStaffAccess`이
 * 아예 불리지 않아야 한다 — 불린 뒤 안에서 걸러지는 것으로는 부족하다.
 */
it.each(['STUDENT', 'STAFF'])(
  '프로필이 비어 있으면 %s 선택은 확정을 부르지 않는다',
  async (selectedRole) => {
    // Given
    const { service, requestStaffAccess, createPendingRequest } =
      buildService();

    // When
    await service.selectMemberKind(GITHUB_ID, selectedRole);

    // Then
    expect(requestStaffAccess).not.toHaveBeenCalled();
    expect(createPendingRequest).not.toHaveBeenCalled();
  },
);

it('동의는 여전히 역할 선택보다 먼저다', async () => {
  // Given — 개인정보 경계라 이 순서는 바꾸지 않았다
  const consentError = new DomainException(
    CONSENT_ERROR_CODES[ConsentErrorCode.REQUIRED_CONSENT_MISSING],
  );
  const { service, repository } = buildService({ consentError });

  // When
  const promise = service.selectMemberKind(GITHUB_ID, 'STUDENT');

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
