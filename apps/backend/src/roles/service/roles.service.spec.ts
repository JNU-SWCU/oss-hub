import {
  AccountStatus,
  MemberKind,
  StaffAccessRequestStatus,
} from '@prisma/client';
import { AuthErrorCode } from '../../auth/auth-error-code.enum';
import { DomainException } from '../../common/error-code';
import {
  CONSENT_ERROR_CODES,
  ConsentErrorCode,
} from '../../consents/consent-error-code.enum';
import type { ConsentsService } from '../../consents/consents.service';
import type { UserProfileView } from '../../profiles/user-profile-read';
import type {
  StaffAccessRequestRecord,
  MemberUser,
} from '../../users/domain/member-onboarding';
import { requestStaffAccess } from '../../users/repository/staff-access-request';
import type {
  StaffAccessRequestOutcome,
  StaffAccessRequestTarget,
} from '../../users/domain/onboarding-store';
import type {
  OnboardingRepositoryPort,
  OnboardingTransactionStore,
} from '../../users/domain/onboarding-store';
import { RolesErrorCode } from '../../users/domain/roles-error-code.enum';
import { RolesService } from './roles.service';

const REQUESTED_AT = new Date('2026-01-01T00:00:00.000Z');

const EMPTY_PROFILE: UserProfileView = {
  name: null,
  studentId: null,
  department: null,
};

const COMPLETE_PROFILE: UserProfileView = {
  name: '합성 사용자',
  studentId: '260001',
  department: '인공지능학부',
};

const STAFF_ONLY_PROFILE: UserProfileView = {
  name: '합성 교직원',
  studentId: null,
  department: '인공지능학부',
};

class InMemoryRolesStore implements OnboardingTransactionStore {
  private user: MemberUser | null;
  private readonly requests: StaffAccessRequestRecord[];

  constructor(
    userRole: 'STUDENT' | 'STAFF' | 'ADMIN' | null,
    requests: StaffAccessRequestRecord[] = [],
    accountStatus: AccountStatus = AccountStatus.ACTIVE,
    profile: UserProfileView = EMPTY_PROFILE,
    selectedRole: 'STUDENT' | 'STAFF' | 'ADMIN' | null = null,
  ) {
    this.user = {
      id: 'synthetic-user',

      memberKind: userRole === 'ADMIN' ? null : userRole,
      selectedMemberKind: selectedRole === 'ADMIN' ? null : selectedRole,
      hasStaffAccess: userRole === 'STAFF',
      hasAdminAccess: userRole === 'ADMIN',
      accountStatus,
      profile,
    };
    this.requests = [...requests];
  }

  findUserByGithubId(): Promise<MemberUser | null> {
    return Promise.resolve(this.user);
  }

  updateSelectedMemberKind(
    _userId: string,
    memberKind: MemberKind,
  ): Promise<MemberUser> {
    if (!this.user) {
      throw new Error('합성 사용자가 존재해야 합니다.');
    }
    this.user = { ...this.user, selectedMemberKind: memberKind };
    return Promise.resolve(this.user);
  }

  requestStaffAccess(
    target: StaffAccessRequestTarget,
  ): Promise<StaffAccessRequestOutcome> {
    return requestStaffAccess(
      {
        staffAccessRequest: {
          findFirst: (() => this.findPendingRequest()) as never,
          create: (({ data }: { data: { userId: string } }) =>
            this.createPendingRequest(data.userId)) as never,
        },
      },
      target,
    );
  }

  findPendingRequest(): Promise<StaffAccessRequestRecord | null> {
    return Promise.resolve(
      this.requests.find(
        (request) => request.status === StaffAccessRequestStatus.PENDING,
      ) ?? null,
    );
  }

  findLatestRequest(): Promise<StaffAccessRequestRecord | null> {
    return Promise.resolve(this.requests.at(-1) ?? null);
  }

  createPendingRequest(userId: string): Promise<StaffAccessRequestRecord> {
    const request: StaffAccessRequestRecord = {
      id: `synthetic-request-${this.requests.length + 1}`,
      userId,
      status: StaffAccessRequestStatus.PENDING,
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

  currentRole(): 'STUDENT' | 'STAFF' | 'ADMIN' | null {
    if (!this.user) return null;
    if (this.user.hasAdminAccess) return 'ADMIN';
    if (this.user.hasStaffAccess) return 'STAFF';
    return this.user.memberKind;
  }

  currentSelectedRole(): 'STUDENT' | 'STAFF' | 'ADMIN' | null {
    return this.user?.selectedMemberKind ?? null;
  }
}

class InMemoryRolesRepository implements OnboardingRepositoryPort {
  constructor(private readonly store: InMemoryRolesStore) {}

  withTransaction<T>(
    operation: (store: OnboardingTransactionStore) => Promise<T>,
  ): Promise<T> {
    return operation(this.store);
  }

  findUserByGithubId(): Promise<MemberUser | null> {
    return this.store.findUserByGithubId();
  }

  findLatestRequest(): Promise<StaffAccessRequestRecord | null> {
    return this.store.findLatestRequest();
  }
}

function createService(
  role: 'STUDENT' | 'STAFF' | 'ADMIN' | null,
  requests: StaffAccessRequestRecord[] = [],
  consented = true,
  accountStatus: AccountStatus = AccountStatus.ACTIVE,
  profile: UserProfileView = EMPTY_PROFILE,
  selectedRole: 'STUDENT' | 'STAFF' | 'ADMIN' | null = null,
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

function staffAccessRequest(
  status: StaffAccessRequestStatus,
  rejectionReason: string | null = null,
): StaffAccessRequestRecord {
  return {
    id: `synthetic-${status.toLowerCase()}`,
    userId: 'synthetic-user',
    status,
    rejectionReason,
    decidedAt:
      status === StaffAccessRequestStatus.PENDING ? null : REQUESTED_AT,
    createdAt: REQUESTED_AT,
  };
}

describe('RolesService', () => {
  it('현행 정책 미동의 사용자의 역할 선택을 거부한다', async () => {
    const { service, store } = createService(null, [], false);

    const promise = service.selectMemberKind(424242n, 'STUDENT');

    await expect(promise).rejects.toMatchObject({
      errorCode: { code: ConsentErrorCode.REQUIRED_CONSENT_MISSING },
    });
    expect(store.currentRole()).toBeNull();
  });

  it('학생을 선택해도 역할을 확정하지 않고 기록만 남긴다', async () => {
    const { service, store } = createService(null);

    const result = await service.selectMemberKind(424242n, 'STUDENT');

    expect(result).toEqual({
      selectedMemberKind: 'STUDENT',
      redirectTo: '/onboarding/profile',
    });
    expect(store.currentRole()).toBeNull();
    expect(store.currentSelectedRole()).toBe('STUDENT');
  });

  it('교직원을 선택해도 승인 요청을 만들지 않고 기록만 남긴다', async () => {
    const { service, store } = createService(null);

    const result = await service.selectMemberKind(424242n, 'STAFF');

    expect(result).toEqual({
      selectedMemberKind: 'STAFF',
      redirectTo: '/onboarding/profile',
    });
    expect(store.requestCount()).toBe(0);
    expect(store.currentSelectedRole()).toBe('STAFF');
  });

  it('고른 역할을 다시 고르면 기록만 바뀐다 — 회수·해제가 필요 없다', async () => {
    const { service, store } = createService(
      null,
      [],
      true,
      AccountStatus.ACTIVE,
      EMPTY_PROFILE,
      'STAFF',
    );

    await service.selectMemberKind(424242n, 'STUDENT');

    expect(store.currentSelectedRole()).toBe('STUDENT');
    expect(store.currentRole()).toBeNull();
    expect(store.requestCount()).toBe(0);
  });

  it('지금 고른 역할을 돌려준다', async () => {
    const { service } = createService(
      null,
      [],
      true,
      AccountStatus.ACTIVE,
      EMPTY_PROFILE,
      'STAFF',
    );

    const result = await service.getMySelection(424242n);

    expect(result).toEqual({ selectedMemberKind: 'STAFF' });
  });

  it('프로필을 이미 마친 교직원은 고르는 그 자리에서 요청이 열린다', async () => {
    const revoked = staffAccessRequest(StaffAccessRequestStatus.REVOKED);
    const { service, store } = createService(
      null,
      [revoked],
      true,
      AccountStatus.ACTIVE,
      COMPLETE_PROFILE,
    );

    await service.selectMemberKind(424242n, 'STAFF');

    expect(store.requestCount()).toBe(2);
  });

  it.each<MemberKind>(['STUDENT', 'STAFF'])(
    '%s 선택은 남은 단계인 프로필로 보낸다',
    async (selectedRole) => {
      const { service } = createService(null);

      const result = await service.selectMemberKind(424242n, selectedRole);

      expect(result.redirectTo).toBe('/onboarding/profile');
    },
  );

  it('활성 교직원 요청이 있으면 학생 전환을 거부한다', async () => {
    const pending = staffAccessRequest(StaffAccessRequestStatus.PENDING);
    const { service, store } = createService(null, [pending]);

    const promise = service.selectMemberKind(424242n, 'STUDENT');

    await expect(promise).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ACTIVE_REQUEST_EXISTS },
    });
    expect(store.currentRole()).toBeNull();
    expect(store.requestCount()).toBe(1);
  });

  it('활성 요청이 있으면 교직원 선택을 멱등 처리한다', async () => {
    const pending = staffAccessRequest(StaffAccessRequestStatus.PENDING);
    const { service, store } = createService(
      null,
      [pending],
      true,
      AccountStatus.ACTIVE,
      COMPLETE_PROFILE,
    );

    const result = await service.selectMemberKind(424242n, 'STAFF');

    expect(result.selectedMemberKind).toBe('STAFF');
    expect(store.requestCount()).toBe(1);
  });

  it('권한이 회수된 사용자도 교직원을 다시 고를 수 있다', async () => {
    const revoked = staffAccessRequest(StaffAccessRequestStatus.REVOKED);
    const { service, store } = createService(null, [revoked]);

    const result = await service.selectMemberKind(424242n, 'STAFF');

    expect(result.selectedMemberKind).toBe('STAFF');
    expect(store.currentSelectedRole()).toBe('STAFF');
    expect(store.currentRole()).toBeNull();
    expect(store.requestCount()).toBe(1);
  });

  it('프로필을 마친 회수 사용자가 교직원을 고르면 승인 대기 요청이 만들어진다', async () => {
    const revoked = staffAccessRequest(StaffAccessRequestStatus.REVOKED);
    const { service, store } = createService(
      null,
      [revoked],
      true,
      AccountStatus.ACTIVE,
      STAFF_ONLY_PROFILE,
      'STAFF',
    );

    await service.selectMemberKind(424242n, 'STAFF');

    expect(store.requestCount()).toBe(2);
    expect(store.currentRole()).toBeNull();
  });

  it('권한이 회수된 사용자는 학생도 고를 수 있다', async () => {
    const revoked = staffAccessRequest(StaffAccessRequestStatus.REVOKED);
    const { service, store } = createService(
      null,
      [revoked],
      true,
      AccountStatus.ACTIVE,
      STAFF_ONLY_PROFILE,
      'STAFF',
    );

    const result = await service.selectMemberKind(424242n, 'STUDENT');

    expect(result.redirectTo).toBe('/onboarding/profile');
    expect(store.currentSelectedRole()).toBe('STUDENT');
    expect(store.currentRole()).toBeNull();
  });

  it('회수 이력이 있어도 확정된 회원 유형은 바꿀 수 없다', async () => {
    const revoked = staffAccessRequest(StaffAccessRequestStatus.REVOKED);
    const { service, store } = createService('STUDENT', [revoked]);

    const promise = service.selectMemberKind(424242n, 'STAFF');

    await expect(promise).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ROLE_ALREADY_CONFIRMED },
    });
    expect(store.currentSelectedRole()).toBeNull();
  });

  it('확정된 유형과 같은 값을 다시 골라도 거부하지 않는다', async () => {
    const { service } = createService('STAFF');

    await expect(
      service.selectMemberKind(424242n, 'STAFF'),
    ).resolves.toMatchObject({ selectedMemberKind: 'STAFF' });
  });

  it('회원 유형이 없는 관리자는 직접 고를 수 있다', async () => {
    const { service } = createService('ADMIN');

    await expect(
      service.selectMemberKind(424242n, 'STUDENT'),
    ).resolves.toMatchObject({ selectedMemberKind: 'STUDENT' });
  });

  it('확정된 교직원은 학생으로 바꿀 수 없다', async () => {
    const { service } = createService('STAFF');

    await expect(
      service.selectMemberKind(424242n, 'STUDENT'),
    ).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ROLE_ALREADY_CONFIRMED },
    });
  });

  it('가장 최근 역할 요청을 반환한다', async () => {
    const rejected = staffAccessRequest(
      StaffAccessRequestStatus.REJECTED,
      '합성 사유',
    );
    const { service } = createService(null, [rejected]);

    const result = await service.getMyRequest(424242n);

    expect(result).toEqual(rejected);
  });

  it('역할 요청이 없으면 null을 반환한다', async () => {
    const { service } = createService(null);

    const result = await service.getMyRequest(424242n);

    expect(result).toBeNull();
  });

  it('거절 이력이 있으면 새 PENDING 요청을 만들고 이력을 보존한다', async () => {
    const rejected = staffAccessRequest(
      StaffAccessRequestStatus.REJECTED,
      '합성 사유',
    );
    const { service, store } = createService(null, [rejected]);

    const result = await service.retryStaffRequest(424242n);

    expect(result.status).toBe(StaffAccessRequestStatus.PENDING);
    expect(store.requestCount()).toBe(2);
    expect(store.currentSelectedRole()).toBe('STAFF');
  });

  it('권한이 회수된 사용자도 새 PENDING 요청을 만들고 이력을 보존한다', async () => {
    const revoked = staffAccessRequest(StaffAccessRequestStatus.REVOKED);
    const { service, store } = createService(null, [revoked]);

    const result = await service.retryStaffRequest(424242n);

    expect(result.status).toBe(StaffAccessRequestStatus.PENDING);
    expect(store.requestCount()).toBe(2);
    expect(store.currentSelectedRole()).toBe('STAFF');
  });

  it('회수 이력이 있어도 역할이 확정된 사용자는 재요청할 수 없다', async () => {
    const revoked = staffAccessRequest(StaffAccessRequestStatus.REVOKED);
    const { service, store } = createService('STAFF', [revoked]);

    const promise = service.retryStaffRequest(424242n);

    await expect(promise).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ROLE_ALREADY_CONFIRMED },
    });
    expect(store.requestCount()).toBe(1);
  });

  it('학생으로 변경된 회원은 과거 회수 이력으로 교직원 재요청을 열 수 없다', async () => {
    const revoked = staffAccessRequest(StaffAccessRequestStatus.REVOKED);
    const { service, store } = createService(
      'STUDENT',
      [revoked],
      true,
      AccountStatus.ACTIVE,
      COMPLETE_PROFILE,
      'STUDENT',
    );

    await expect(service.retryStaffRequest(424242n)).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ROLE_ALREADY_CONFIRMED },
    });
    expect(store.currentSelectedRole()).toBe('STUDENT');
    expect(store.requestCount()).toBe(1);
  });

  it('비활성 교직원은 기존 온보딩·재요청 경로를 사용할 수 없다', async () => {
    const revoked = staffAccessRequest(StaffAccessRequestStatus.REVOKED);
    const { service, store } = createService(
      'STAFF',
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
    const rejected = staffAccessRequest(
      StaffAccessRequestStatus.REJECTED,
      '합성 사유',
    );
    const { service, store } = createService(null, [rejected], false);

    const promise = service.retryStaffRequest(424242n);

    await expect(promise).rejects.toMatchObject({
      errorCode: { code: ConsentErrorCode.REQUIRED_CONSENT_MISSING },
    });
    expect(store.requestCount()).toBe(1);
  });

  it('활성 요청이 있으면 재요청을 거부한다', async () => {
    const pending = staffAccessRequest(StaffAccessRequestStatus.PENDING);
    const { service } = createService(null, [pending]);

    const promise = service.retryStaffRequest(424242n);

    await expect(promise).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ACTIVE_REQUEST_EXISTS },
    });
  });

  it('거절 이력 없이 재요청하면 잘못된 역할 선택으로 거부한다', async () => {
    const { service } = createService(null);

    const promise = service.retryStaffRequest(424242n);

    await expect(promise).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.INVALID_ROLE_SELECTION },
    });
  });
});
