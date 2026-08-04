import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import { AuthErrorCode } from '../auth/auth-error-code.enum';
import { DomainException } from '../common/error-code';
import {
  CONSENT_ERROR_CODES,
  ConsentErrorCode,
} from '../consents/consent-error-code.enum';
import type { ConsentsService } from '../consents/consents.service';
import type { CompatibleProfile } from '../profiles/profile-compatibility';
import type { RoleRequestRecord, RoleUser } from './domain/role-onboarding';
import { confirmSelectedRole } from './role-confirmation';
import type {
  RoleConfirmation,
  RoleConfirmationTarget,
} from './role-confirmation';
import type { RolesRepositoryPort, RolesTransactionStore } from './roles.store';
import { RolesErrorCode } from './roles-error-code.enum';
import { RolesService } from './roles.service';

const REQUESTED_AT = new Date('2026-01-01T00:00:00.000Z');

/** 아직 아무것도 채우지 않은 프로필 — 가입을 막 시작한 사람의 상태다. */
const EMPTY_PROFILE: CompatibleProfile = {
  name: null,
  studentId: null,
  department: null,
};

/** 학생 기준으로도 완성된 프로필 — 이미 가입을 마친 사람의 상태다. */
const COMPLETE_PROFILE: CompatibleProfile = {
  name: '합성 사용자',
  studentId: '260001',
  department: '인공지능학부',
};

class InMemoryRolesStore implements RolesTransactionStore {
  private user: RoleUser | null;
  private readonly requests: RoleRequestRecord[];

  constructor(
    userRole: Role | null,
    requests: RoleRequestRecord[] = [],
    accountStatus: AccountStatus = AccountStatus.ACTIVE,
    profile: CompatibleProfile = EMPTY_PROFILE,
    selectedRole: Role | null = null,
  ) {
    this.user = {
      id: 'synthetic-user',
      role: userRole,
      selectedRole,
      accountStatus,
      profile,
    };
    this.requests = [...requests];
  }

  findUserByGithubId(): Promise<RoleUser | null> {
    return Promise.resolve(this.user);
  }

  updateSelectedRole(_userId: string, role: Role): Promise<RoleUser> {
    if (!this.user) {
      throw new Error('합성 사용자가 존재해야 합니다.');
    }
    this.user = { ...this.user, selectedRole: role };
    return Promise.resolve(this.user);
  }

  /**
   * 확정 규칙은 실물(`role-confirmation.ts`)을 그대로 태운다 — 여기서 규칙을 다시
   * 적으면 검사는 통과하는데 제품만 틀린 상태가 만들어진다.
   */
  confirmSelectedRole(
    target: RoleConfirmationTarget,
  ): Promise<RoleConfirmation> {
    return confirmSelectedRole(
      {
        user: {
          updateMany: (({ data }: { data: { role: Role } }) => {
            if (this.user) {
              this.user = { ...this.user, role: data.role };
            }
            return Promise.resolve({ count: 1 });
          }) as never,
        },
        roleRequest: {
          findFirst: (() => this.findPendingRequest()) as never,
          create: (({ data }: { data: { userId: string } }) =>
            this.createPendingRequest(data.userId)) as never,
        },
      },
      target,
    );
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

  currentSelectedRole(): Role | null {
    return this.user?.selectedRole ?? null;
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
  profile: CompatibleProfile = EMPTY_PROFILE,
  selectedRole: Role | null = null,
): { service: RolesService; store: InMemoryRolesStore } {
  const store = new InMemoryRolesStore(
    role,
    requests,
    accountStatus,
    profile,
    selectedRole,
  );
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
  return {
    service: new RolesService(
      new InMemoryRolesRepository(store),
      consentsService,
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

  /**
   * #569 회귀 검사 ① — **역할 선택은 확정하지 않는다.**
   *
   * 예전에는 이 자리에서 `User.role`에 STUDENT가 붙었다. 프로필을 한 글자도 입력하기
   * 전이라, 그 사람은 이름 없이 학생 권한을 들고 제품 안으로 들어갈 수 있었다.
   */
  it('학생을 선택해도 역할을 확정하지 않고 기록만 남긴다', async () => {
    // Given
    const { service, store } = createService(null);

    // When
    const result = await service.selectRole(424242n, Role.STUDENT);

    // Then
    expect(result).toEqual({
      selectedRole: Role.STUDENT,
      redirectTo: '/onboarding/profile',
    });
    expect(store.currentRole()).toBeNull();
    expect(store.currentSelectedRole()).toBe(Role.STUDENT);
  });

  /**
   * #569 회귀 검사 ① — 교직원 쪽. 승인 요청이 여기서 만들어지면 이름·학과가 빈
   * 미완성 신청이 관리자 대기줄에 올라간다.
   */
  it('교직원을 선택해도 승인 요청을 만들지 않고 기록만 남긴다', async () => {
    // Given
    const { service, store } = createService(null);

    // When
    const result = await service.selectRole(424242n, Role.STAFF);

    // Then
    expect(result).toEqual({
      selectedRole: Role.STAFF,
      redirectTo: '/onboarding/profile',
    });
    expect(store.requestCount()).toBe(0);
    expect(store.currentSelectedRole()).toBe(Role.STAFF);
  });

  it('고른 역할을 다시 고르면 기록만 바뀐다 — 회수·해제가 필요 없다', async () => {
    // Given: 교직원을 골라 둔 사람이 프로필 화면에서 되돌아왔다.
    const { service, store } = createService(
      null,
      [],
      true,
      AccountStatus.ACTIVE,
      EMPTY_PROFILE,
      Role.STAFF,
    );

    // When
    await service.selectRole(424242n, Role.STUDENT);

    // Then: 취소할 요청도 되돌릴 역할도 없다.
    expect(store.currentSelectedRole()).toBe(Role.STUDENT);
    expect(store.currentRole()).toBeNull();
    expect(store.requestCount()).toBe(0);
  });

  it('지금 고른 역할을 돌려준다', async () => {
    // Given
    const { service } = createService(
      null,
      [],
      true,
      AccountStatus.ACTIVE,
      EMPTY_PROFILE,
      Role.STAFF,
    );

    // When
    const result = await service.getMySelection(424242n);

    // Then
    expect(result).toEqual({ selectedRole: Role.STAFF });
  });

  /**
   * 프로필을 **이미** 마친 사람에게는 남은 단계가 없다. 기록만 하고 끝내면 프로필
   * 화면이 "이미 완료"라며 그를 곧바로 내보내 확정이 영원히 오지 않는다. 회수된 뒤
   * 역할을 다시 고르는 사용자가 실제로 그 상태다.
   */
  it('프로필을 이미 마친 사용자는 고르는 그 자리에서 확정된다', async () => {
    // Given
    const revoked = roleRequest(RoleRequestStatus.REVOKED);
    const { service, store } = createService(
      null,
      [revoked],
      true,
      AccountStatus.ACTIVE,
      COMPLETE_PROFILE,
    );

    // When
    await service.selectRole(424242n, Role.STUDENT);

    // Then
    expect(store.currentRole()).toBe(Role.STUDENT);
  });

  /**
   * `redirectTo`가 `/onboarding/profile`인 것이 이 검사의 핵심이다 — 승인 대기 화면이
   * 깜빡이던 자리다.
   *
   * 교직원에게 `/onboarding/pending`을 주면 그 화면의 `OnboardingGate`가 비어 있는
   * 프로필을 보고 곧바로 `/onboarding/profile`로 되돌린다. 사용자는 "관리자 승인을
   * 기다려 주세요"를 반 초쯤 봤다가 빼앗긴다. 교직원도 학과가 필수라
   * (`users/user-profile-policy.ts`) 프로필이 남은 단계인 것이 사실이므로, 처음부터
   * 그리로 보낸다.
   */
  it.each([Role.STUDENT, Role.STAFF])(
    '%s 선택은 남은 단계인 프로필로 보낸다',
    async (selectedRole) => {
      // Given
      const { service } = createService(null);

      // When
      const result = await service.selectRole(424242n, selectedRole);

      // Then
      expect(result.redirectTo).toBe('/onboarding/profile');
    },
  );

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

  it('활성 요청이 있으면 교직원 선택을 멱등 처리한다', async () => {
    // Given: '선택 완료'를 두 번 누른 상황이다. 여기서 409를 주면 아무것도 바뀌지
    // 않는 조작에 오류 화면이 뜬다.
    const pending = roleRequest(RoleRequestStatus.PENDING);
    const { service, store } = createService(
      null,
      [pending],
      true,
      AccountStatus.ACTIVE,
      COMPLETE_PROFILE,
    );

    // When
    const result = await service.selectRole(424242n, Role.STAFF);

    // Then
    expect(result.selectedRole).toBe(Role.STAFF);
    expect(store.requestCount()).toBe(1);
  });

  it('권한이 회수된 사용자는 교직원을 다시 고를 수 없다', async () => {
    // Given
    const revoked = roleRequest(RoleRequestStatus.REVOKED);
    const { service, store } = createService(null, [revoked]);

    // When
    const promise = service.selectRole(424242n, Role.STAFF);

    // Then
    await expect(promise).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ROLE_STATE_CONFLICT },
    });
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
