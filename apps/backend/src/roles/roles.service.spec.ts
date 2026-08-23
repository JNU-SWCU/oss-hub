import {
  AccountStatus,
  MemberKind,
  StaffAccessRequestStatus,
} from '@prisma/client';
import { AuthErrorCode } from '../auth/auth-error-code.enum';
import { DomainException } from '../common/error-code';
import {
  CONSENT_ERROR_CODES,
  ConsentErrorCode,
} from '../consents/consent-error-code.enum';
import type { ConsentsService } from '../consents/consents.service';
import type { UserProfileView } from '../profiles/user-profile-read';
import type {
  StaffAccessRequestRecord,
  MemberUser,
} from './domain/member-onboarding';
import { requestStaffAccess } from './staff-access-request';
import type {
  StaffAccessRequestOutcome,
  StaffAccessRequestTarget,
} from './staff-access-request';
import type {
  RolesRepositoryPort,
  RolesTransactionStore,
} from './roles.repository';
import { RolesErrorCode } from './roles-error-code.enum';
import { RolesService } from './roles.service';

const REQUESTED_AT = new Date('2026-01-01T00:00:00.000Z');

/** 아직 아무것도 채우지 않은 프로필 — 가입을 막 시작한 사람의 상태다. */
const EMPTY_PROFILE: UserProfileView = {
  name: null,
  studentId: null,
  department: null,
};

/** 학생 기준으로도 완성된 프로필 — 이미 가입을 마친 사람의 상태다. */
const COMPLETE_PROFILE: UserProfileView = {
  name: '합성 사용자',
  studentId: '260001',
  department: '인공지능학부',
};

/**
 * 교직원 기준으로만 완성된 프로필 — 학번이 없다.
 *
 * 회수된 교직원의 실제 모습이다. 교직원은 학번을 요구받지 않으므로
 * (`users/user-profile-policy.ts`) 대부분 이 상태로 남아 있다.
 */
const STAFF_ONLY_PROFILE: UserProfileView = {
  name: '합성 교직원',
  studentId: null,
  department: '인공지능학부',
};

class InMemoryRolesStore implements RolesTransactionStore {
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
      // 확정된 회원 유형은 프로필 행이 담는다. ADMIN은 유형을 남기지 않는다 —
      // 관리자 권한은 정체성과 독립이다.
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

  /**
   * 요청 규칙은 실물(`staff-access-request.ts`)을 그대로 태운다 — 여기서 규칙을 다시
   * 적으면 검사는 통과하는데 제품만 틀린 상태가 만들어진다.
   */
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

class InMemoryRolesRepository implements RolesRepositoryPort {
  constructor(private readonly store: InMemoryRolesStore) {}

  withTransaction<T>(
    operation: (store: RolesTransactionStore) => Promise<T>,
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
    // Given
    const { service, store } = createService(null, [], false);

    // When
    const promise = service.selectMemberKind(424242n, 'STUDENT');

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
    const result = await service.selectMemberKind(424242n, 'STUDENT');

    // Then
    expect(result).toEqual({
      selectedMemberKind: 'STUDENT',
      redirectTo: '/onboarding/profile',
    });
    expect(store.currentRole()).toBeNull();
    expect(store.currentSelectedRole()).toBe('STUDENT');
  });

  /**
   * #569 회귀 검사 ① — 교직원 쪽. 승인 요청이 여기서 만들어지면 이름·학과가 빈
   * 미완성 신청이 관리자 대기줄에 올라간다.
   */
  it('교직원을 선택해도 승인 요청을 만들지 않고 기록만 남긴다', async () => {
    // Given
    const { service, store } = createService(null);

    // When
    const result = await service.selectMemberKind(424242n, 'STAFF');

    // Then
    expect(result).toEqual({
      selectedMemberKind: 'STAFF',
      redirectTo: '/onboarding/profile',
    });
    expect(store.requestCount()).toBe(0);
    expect(store.currentSelectedRole()).toBe('STAFF');
  });

  it('고른 역할을 다시 고르면 기록만 바뀐다 — 회수·해제가 필요 없다', async () => {
    // Given: 교직원을 골라 둔 사람이 프로필 화면에서 되돌아왔다.
    const { service, store } = createService(
      null,
      [],
      true,
      AccountStatus.ACTIVE,
      EMPTY_PROFILE,
      'STAFF',
    );

    // When
    await service.selectMemberKind(424242n, 'STUDENT');

    // Then: 취소할 요청도 되돌릴 역할도 없다.
    expect(store.currentSelectedRole()).toBe('STUDENT');
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
      'STAFF',
    );

    // When
    const result = await service.getMySelection(424242n);

    // Then
    expect(result).toEqual({ selectedMemberKind: 'STAFF' });
  });

  /**
   * 프로필을 **이미** 마친 사람에게는 남은 단계가 없다. 기록만 하고 끝내면 프로필
   * 화면이 "이미 완료"라며 그를 곧바로 내보내 확정이 영원히 오지 않는다. 회수된 뒤
   * 역할을 다시 고르는 사용자가 실제로 그 상태다.
   */
  it('프로필을 이미 마친 교직원은 고르는 그 자리에서 요청이 열린다', async () => {
    // Given: 회수된 뒤 프로필은 그대로 남아 있는 사용자
    const revoked = staffAccessRequest(StaffAccessRequestStatus.REVOKED);
    const { service, store } = createService(
      null,
      [revoked],
      true,
      AccountStatus.ACTIVE,
      COMPLETE_PROFILE,
    );

    // When
    await service.selectMemberKind(424242n, 'STAFF');

    // Then — 학생에게는 열 요청이 없으므로 이 검사는 교직원 갈래를 고정한다.
    expect(store.requestCount()).toBe(2);
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
  it.each<MemberKind>(['STUDENT', 'STAFF'])(
    '%s 선택은 남은 단계인 프로필로 보낸다',
    async (selectedRole) => {
      // Given
      const { service } = createService(null);

      // When
      const result = await service.selectMemberKind(424242n, selectedRole);

      // Then
      expect(result.redirectTo).toBe('/onboarding/profile');
    },
  );

  it('활성 교직원 요청이 있으면 학생 전환을 거부한다', async () => {
    // Given
    const pending = staffAccessRequest(StaffAccessRequestStatus.PENDING);
    const { service, store } = createService(null, [pending]);

    // When
    const promise = service.selectMemberKind(424242n, 'STUDENT');

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
    const pending = staffAccessRequest(StaffAccessRequestStatus.PENDING);
    const { service, store } = createService(
      null,
      [pending],
      true,
      AccountStatus.ACTIVE,
      COMPLETE_PROFILE,
    );

    // When
    const result = await service.selectMemberKind(424242n, 'STAFF');

    // Then
    expect(result.selectedMemberKind).toBe('STAFF');
    expect(store.requestCount()).toBe(1);
  });

  /**
   * **뒤집힌 검사** (#184). 원래 제목은 "권한이 회수된 사용자는 교직원을 다시 고를 수
   * 없다"였고 `ROL_008`을 기대했다. 그 규칙이 화면과 어긋나 있었다 — 회수 화면이
   * "학생 또는 교직원 역할을 다시 선택할 수 있습니다"라며 이 화면으로 보내 놓고, 여기서
   * 교직원을 누르면 409를 줬다. 뒤집는 근거는 `roles.service.ts`의 `requireSelectable`에
   * 적었다: 고르는 것으로는 아무것도 확정되지 않고 승인은 관리자 손에 남는다.
   *
   * 고르는 것만으로 요청이 생기지도 않는다는 사실은 `requestCount`가 그대로인 것으로
   * 못박는다 — 여기서 요청이 만들어지면 회수 화면이 미완성 신청을 대기줄에 올린다.
   */
  it('권한이 회수된 사용자도 교직원을 다시 고를 수 있다', async () => {
    // Given: 회수된 뒤의 상태 — 확정 역할이 비었고 마지막 요청이 REVOKED다.
    const revoked = staffAccessRequest(StaffAccessRequestStatus.REVOKED);
    const { service, store } = createService(null, [revoked]);

    // When
    const result = await service.selectMemberKind(424242n, 'STAFF');

    // Then
    expect(result.selectedMemberKind).toBe('STAFF');
    expect(store.currentSelectedRole()).toBe('STAFF');
    expect(store.currentRole()).toBeNull();
    expect(store.requestCount()).toBe(1);
  });

  /**
   * 회수된 교직원의 **실제** 모습으로 같은 길을 한 번 더 간다 — 프로필이 이미 교직원
   * 기준으로 채워져 있다. 그에게는 남은 단계가 없어서 `selectRole`이 그 자리에서
   * 확정하고(#569), 교직원의 확정은 곧 승인 대기 요청이다.
   *
   * 그래서 #184의 "STAFF 재요청 가능"이 성립하는 자리는 **역할 선택 화면**이다.
   * 위 검사(빈 프로필)만 두면 이 사실이 어디에도 적히지 않는다.
   *
   * 만들어지는 것이 신청뿐이고 `role`은 여전히 비어 있다는 것이 이 PR의 전제다 —
   * 사용자가 자기 손으로 STAFF를 되찾는 것이 아니다.
   */
  it('프로필을 마친 회수 사용자가 교직원을 고르면 승인 대기 요청이 만들어진다', async () => {
    // Given
    const revoked = staffAccessRequest(StaffAccessRequestStatus.REVOKED);
    const { service, store } = createService(
      null,
      [revoked],
      true,
      AccountStatus.ACTIVE,
      STAFF_ONLY_PROFILE,
      'STAFF',
    );

    // When
    await service.selectMemberKind(424242n, 'STAFF');

    // Then
    expect(store.requestCount()).toBe(2);
    expect(store.currentRole()).toBeNull();
  });

  /**
   * 회수된 사용자의 다른 갈래 — 학생으로 내려가는 길도 함께 열려 있어야 인수 조건
   * ("STUDENT 선택 또는 STAFF 재요청 가능", #184)이 성립한다.
   *
   * 프로필은 교직원 기준으로만 채워져 있다(학번 없음). 그래서 학생을 골라도 그 자리에서
   * 확정되지 않고 프로필로 넘어간다 — 학번을 받아야 학생이 완성되기 때문이다.
   */
  it('권한이 회수된 사용자는 학생도 고를 수 있다', async () => {
    // Given
    const revoked = staffAccessRequest(StaffAccessRequestStatus.REVOKED);
    const { service, store } = createService(
      null,
      [revoked],
      true,
      AccountStatus.ACTIVE,
      STAFF_ONLY_PROFILE,
      'STAFF',
    );

    // When
    const result = await service.selectMemberKind(424242n, 'STUDENT');

    // Then
    expect(result.redirectTo).toBe('/onboarding/profile');
    expect(store.currentSelectedRole()).toBe('STUDENT');
    expect(store.currentRole()).toBeNull();
  });

  /**
   * #184로 회수 이력의 문을 연 것이 **확정된 사람의 문까지 열지는 않았다**는 못.
   *
   * 회수 이력이 있다는 사실만으로 통과시키면 확정된 회원 유형까지 바꿀 수 있게 된다.
   * 열리면 안 된다 — 확정된 유형을 바꾸는 일은 가입 절차가 아니라 회수·해제(`users/`)의
   * 몫이다. 실제 방어선은 프로필 행의 `memberKind` 하나뿐이라는 것을 이 검사가 고정한다.
   */
  it('회수 이력이 있어도 확정된 회원 유형은 바꿀 수 없다', async () => {
    // Given: 학생으로 확정된 사용자
    const revoked = staffAccessRequest(StaffAccessRequestStatus.REVOKED);
    const { service, store } = createService('STUDENT', [revoked]);

    // When
    const promise = service.selectMemberKind(424242n, 'STAFF');

    // Then
    await expect(promise).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ROLE_ALREADY_CONFIRMED },
    });
    expect(store.currentSelectedRole()).toBeNull();
  });

  // 같은 유형을 다시 고르는 것은 아무것도 바꾸지 않는 조작이라 409로 막지 않는다.
  it('확정된 유형과 같은 값을 다시 골라도 거부하지 않는다', async () => {
    // Given
    const { service } = createService('STAFF');

    // When / Then
    await expect(
      service.selectMemberKind(424242n, 'STAFF'),
    ).resolves.toMatchObject({ selectedMemberKind: 'STAFF' });
  });

  /**
   * 관리자는 회원 유형을 갖지 않는다(`auth/initial-roles.ts`) — 시드가 학생인지
   * 교직원인지 정하지 않기 때문이다. 그래서 관리자는 로그인 뒤 **직접 고를 수 있어야**
   * 한다. 여기서 막으면 그가 프로필을 영영 만들지 못한다.
   */
  it('회원 유형이 없는 관리자는 직접 고를 수 있다', async () => {
    // Given
    const { service } = createService('ADMIN');

    // When / Then
    await expect(
      service.selectMemberKind(424242n, 'STUDENT'),
    ).resolves.toMatchObject({ selectedMemberKind: 'STUDENT' });
  });

  it('확정된 교직원은 학생으로 바꿀 수 없다', async () => {
    // Given
    const { service } = createService('STAFF');

    // When / Then
    await expect(
      service.selectMemberKind(424242n, 'STUDENT'),
    ).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ROLE_ALREADY_CONFIRMED },
    });
  });

  it('가장 최근 역할 요청을 반환한다', async () => {
    // Given
    const rejected = staffAccessRequest(
      StaffAccessRequestStatus.REJECTED,
      '합성 사유',
    );
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
    const rejected = staffAccessRequest(
      StaffAccessRequestStatus.REJECTED,
      '합성 사유',
    );
    const { service, store } = createService(null, [rejected]);

    // When
    const result = await service.retryStaffRequest(424242n);

    // Then
    expect(result.status).toBe(StaffAccessRequestStatus.PENDING);
    expect(store.requestCount()).toBe(2);
    expect(store.currentSelectedRole()).toBe('STAFF');
  });

  /**
   * **뒤집힌 검사** (#184). 원래 제목은 "권한 회수 이력은 일반 재요청으로 우회할 수
   * 없다"였고 `ROL_008`을 기대했다. '우회'라는 말이 전제한 것 — 재요청으로 권한이
   * 돌아온다 — 이 성립하지 않는다: 이 문이 만드는 것은 `PENDING` 한 건뿐이고 STAFF를
   * 붙이는 것은 관리자의 승인이다. 근거는 `roles.service.ts`에 적었다.
   *
   * 위 거절 검사와 기대가 같은 것이 핵심이다 — 두 상태를 한 갈래로 합쳤으므로 결과도
   * 같아야 한다. 이력을 덮어쓰지 않는 것(요청이 2건으로 늘어난다)도 함께 못박는다:
   * "누가 언제 승인했는가"는 장학금 근거라 지우지 않는다.
   */
  it('권한이 회수된 사용자도 새 PENDING 요청을 만들고 이력을 보존한다', async () => {
    // Given
    const revoked = staffAccessRequest(StaffAccessRequestStatus.REVOKED);
    const { service, store } = createService(null, [revoked]);

    // When
    const result = await service.retryStaffRequest(424242n);

    // Then
    expect(result.status).toBe(StaffAccessRequestStatus.PENDING);
    expect(store.requestCount()).toBe(2);
    expect(store.currentSelectedRole()).toBe('STAFF');
  });

  /**
   * 재요청 쪽에서도 확정된 사람의 문은 닫혀 있다는 못 — 회수 이력을 열어 준 것이
   * `role`이 붙은 사람까지 열지 않았음을 `selectRole`과 짝으로 고정한다.
   */
  it('회수 이력이 있어도 역할이 확정된 사용자는 재요청할 수 없다', async () => {
    // Given: 회수된 뒤 다시 승인받아 STAFF가 된 사람. 이력에는 REVOKED가 남아 있다.
    const revoked = staffAccessRequest(StaffAccessRequestStatus.REVOKED);
    const { service, store } = createService('STAFF', [revoked]);

    // When
    const promise = service.retryStaffRequest(424242n);

    // Then
    await expect(promise).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ROLE_ALREADY_CONFIRMED },
    });
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
    // Given: 과거 요청 이력은 있지만 현행 정책에는 동의하지 않았다.
    const rejected = staffAccessRequest(
      StaffAccessRequestStatus.REJECTED,
      '합성 사유',
    );
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
    const pending = staffAccessRequest(StaffAccessRequestStatus.PENDING);
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
