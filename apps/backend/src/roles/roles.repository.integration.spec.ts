import { Role, StaffAccessRequestStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import type { ConsentsService } from '../consents/consents.service';
import { PrismaService } from '../prisma/prisma.service';
import { RolesRepository } from './roles.repository';
import { RolesErrorCode } from './roles-error-code.enum';
import { RolesService } from './roles.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const TEST_PREFIX = 'test:169:';
const STAFF_GITHUB_ID = 9_169_000_001n;
const MIXED_GITHUB_ID = 9_169_000_002n;
const INCOMPLETE_GITHUB_ID = 9_169_000_003n;
const COMPLETE_PROFILE = {
  name: '합성 사용자',
  studentId: '123456',
  department: '인공지능학부',
} as const;

describe('RolesRepository integration', () => {
  const prisma = new PrismaService();
  const repository = new RolesRepository(prisma);
  const consentsService: Pick<ConsentsService, 'requireCurrent'> = {
    requireCurrent: jest.fn().mockResolvedValue(undefined),
  };
  const service = new RolesService(repository, consentsService);

  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  beforeEach(async () => {
    await prisma.staffAccessRequest.deleteMany({
      where: { user: { id: { startsWith: TEST_PREFIX } } },
    });
    await prisma.user.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
  });

  afterAll(async () => {
    await prisma.staffAccessRequest.deleteMany({
      where: { user: { id: { startsWith: TEST_PREFIX } } },
    });
    await prisma.user.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.$disconnect();
  });

  it('동시 교직원 선택은 한 PENDING 요청으로 수렴한다', async () => {
    // Given
    const user = await prisma.user.create({
      data: {
        id: `${TEST_PREFIX}staff`,
        githubId: STAFF_GITHUB_ID,
        nickname: 'synthetic-169-staff',
        ...COMPLETE_PROFILE,
      },
    });

    // When
    const results = await Promise.all([
      service.selectRole(STAFF_GITHUB_ID, Role.STAFF),
      service.selectRole(STAFF_GITHUB_ID, Role.STAFF),
    ]);

    // Then
    const pendingCount = await prisma.staffAccessRequest.count({
      where: { userId: user.id, status: StaffAccessRequestStatus.PENDING },
    });
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.selectedRole === Role.STAFF)).toBe(
      true,
    );
    expect(pendingCount).toBe(1);
  });

  it('동시 학생·교직원 선택은 확정 역할과 PENDING을 함께 남기지 않는다', async () => {
    // Given
    const user = await prisma.user.create({
      data: {
        id: `${TEST_PREFIX}mixed`,
        githubId: MIXED_GITHUB_ID,
        nickname: 'synthetic-169-mixed',
        ...COMPLETE_PROFILE,
      },
    });

    // When
    const results = await Promise.allSettled([
      service.selectRole(MIXED_GITHUB_ID, Role.STUDENT),
      service.selectRole(MIXED_GITHUB_ID, Role.STAFF),
    ]);

    // Then
    const [storedUser, pendingCount] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      prisma.staffAccessRequest.count({
        where: { userId: user.id, status: StaffAccessRequestStatus.PENDING },
      }),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(Number(storedUser.role === Role.STUDENT) + pendingCount).toBe(1);
  });

  /**
   * #569 회귀 검사 ① — 저장된 행으로 확인한다.
   *
   * 온보딩 순서가 약관 → 역할 → 프로필로 바뀌어, 역할을 고르는 시점에 프로필은 아직
   * 비어 있는 것이 정상이다. 그 상태에서 확정까지 해 버리면 이름·학과가 빈 미완성
   * 신청이 관리자 대기줄에 올라가고, 학생은 이름 없이 학생 권한을 갖는다. 고른 사실만
   * `selectedRole`에 남고 `role`·`StaffAccessRequest`는 그대로여야 한다.
   */
  it.each([Role.STUDENT, Role.STAFF])(
    '프로필이 비어 있으면 %s 선택은 기록만 남기고 아무것도 확정하지 않는다',
    async (selectedRole) => {
      // Given
      const user = await prisma.user.create({
        data: {
          id: `${TEST_PREFIX}incomplete-${selectedRole.toLowerCase()}`,
          githubId:
            INCOMPLETE_GITHUB_ID + (selectedRole === Role.STUDENT ? 0n : 1n),
          nickname: `synthetic-169-incomplete-${selectedRole.toLowerCase()}`,
        },
      });

      // When
      const result = await service.selectRole(user.githubId, selectedRole);

      // Then
      expect(result).toEqual({
        selectedRole,
        redirectTo: '/onboarding/profile',
      });
      const [storedUser, requestCount] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
        prisma.staffAccessRequest.count({ where: { userId: user.id } }),
      ]);
      expect(storedUser.selectedRole).toBe(selectedRole);
      expect(storedUser.role).toBeNull();
      expect(requestCount).toBe(0);
    },
  );

  /**
   * 회수된 사용자가 역할을 다시 고르고 교직원을 재신청할 수 있는가 (#184).
   *
   * ## 상태를 fixture로 직접 만드는 이유
   *
   * 회수를 **호출해서** 이 상태를 만들지 않는다. `main`의 회수는 아직 `role`을 비우지
   * 않고 STAFF→STUDENT로 한 단계 내릴 뿐이라, 회수 API를 태우면 여기서 검증하려는 상태가
   * 아예 만들어지지 않는다. 그 전이를 고치는 것은 별도 변경(`users/admin-access-*`)이고
   * 이 파일은 그 파일을 건드리지 않는다.
   *
   * 그래서 `role: null` + 최신 `REVOKED` 행을 행 수준에서 직접 세운다. 이 계약이
   * 회수 구현과 독립적으로 성립한다는 뜻이기도 하다 — 회수가 어느 코드에서 오든,
   * **역할이 비어 있고 마지막 요청이 회수인 사용자**는 다시 고를 수 있어야 한다.
   *
   * `APPROVED` 행을 함께 남기는 이유는 실제 이력의 모양이 그렇기 때문이다: 회수는 기존
   * 승인 행을 덮어쓰지 않고 새 `REVOKED` 행을 넣는다. 덮어쓰면 "누가 언제 승인했는가"가
   * 사라지고, 그 숫자는 장학금 근거로 쓰인다.
   */
  describe('회수된 사용자의 재선택·재요청 (#184)', () => {
    const REVOKED_AT = new Date('2026-02-02T00:00:00.000Z');
    const APPROVED_AT = new Date('2026-02-01T00:00:00.000Z');

    /**
     * 회수된 교직원의 프로필 — 학번이 없다.
     *
     * 교직원은 학번을 요구받지 않으므로(`users/user-profile-policy.ts`) 실제로 이 모양으로
     * 남아 있다. `COMPLETE_PROFILE`을 쓰면 학생 선택이 그 자리에서 확정돼 재선택 이후의
     * 흐름이 가려진다.
     */
    const STAFF_ONLY_PROFILE = {
      name: '합성 교직원',
      studentId: null,
      department: '인공지능학부',
    } as const;

    async function createRevokedStaff(
      key: string,
      githubId: bigint,
      role: Role | null = null,
    ) {
      const user = await prisma.user.create({
        data: {
          id: `${TEST_PREFIX}${key}`,
          githubId,
          nickname: `synthetic-184-${key}`,
          role,
          selectedRole: Role.STAFF,
          ...STAFF_ONLY_PROFILE,
        },
      });
      await prisma.staffAccessRequest.create({
        data: {
          userId: user.id,
          status: StaffAccessRequestStatus.APPROVED,
          createdAt: APPROVED_AT,
          decidedAt: APPROVED_AT,
        },
      });
      await prisma.staffAccessRequest.create({
        data: {
          userId: user.id,
          status: StaffAccessRequestStatus.REVOKED,
          createdAt: REVOKED_AT,
          decidedAt: REVOKED_AT,
        },
      });
      return user;
    }

    it('학생을 다시 고를 수 있고 기록만 바뀐다', async () => {
      // Given
      const user = await createRevokedStaff('revoked-student', 9_184_000_001n);

      // When
      const result = await service.selectRole(user.githubId, Role.STUDENT);

      // Then: 고른 사실만 남고 권한은 돌아오지 않는다.
      const [stored, requestCount] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
        prisma.staffAccessRequest.count({ where: { userId: user.id } }),
      ]);
      expect(result.selectedRole).toBe(Role.STUDENT);
      expect(result.redirectTo).toBe('/onboarding/profile');
      expect(stored.selectedRole).toBe(Role.STUDENT);
      expect(stored.role).toBeNull();
      expect(requestCount).toBe(2);
    });

    /**
     * 회수된 교직원의 정식 재신청 경로는 **역할 선택 화면 하나**다.
     *
     * 보통은 역할을 고르는 것만으로 아무것도 확정되지 않지만(#569), 회수된 교직원은
     * 프로필을 이미 마친 상태라 남은 단계가 없다 — 기록만 하고 끝내면 프로필 화면이
     * "이미 완료"라며 그를 곧바로 내보내 확정이 영원히 오지 않는다. `selectRole`이 그
     * 경우를 알고 그 자리에서 확정하며(`roles.service.ts`), 교직원의 확정은 곧
     * `PENDING` 요청이다. 이 검사가 없으면 #184의 "STAFF 재요청 가능"이 어느 화면에서
     * 성립하는지 아무도 답할 수 없다.
     *
     * **여기서 만들어지는 것은 신청 한 건뿐이고 `role`은 비어 있다** — 승인은 여전히
     * 관리자 손에 있다는 이 PR의 전제를 행으로 확인한다.
     */
    it('교직원을 다시 고르면 그 자리에서 신청 한 건이 만들어진다', async () => {
      // Given
      const user = await createRevokedStaff('revoked-staff', 9_184_000_002n);

      // When
      const result = await service.selectRole(user.githubId, Role.STAFF);

      // Then
      const [stored, pendingCount, requestCount] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
        prisma.staffAccessRequest.count({
          where: { userId: user.id, status: StaffAccessRequestStatus.PENDING },
        }),
        prisma.staffAccessRequest.count({ where: { userId: user.id } }),
      ]);
      expect(result.selectedRole).toBe(Role.STAFF);
      expect(stored.role).toBeNull();
      expect(pendingCount).toBe(1);
      expect(requestCount).toBe(3);
    });

    it('교직원을 두 번 골라도 신청은 한 건이다', async () => {
      // Given: '선택 완료'를 두 번 누른 상황. 두 번째가 대기줄에 같은 신청을 또
      // 올리면 관리자는 같은 사람을 두 번 처리해야 한다.
      const user = await createRevokedStaff('revoked-twice', 9_184_000_006n);

      // When
      await service.selectRole(user.githubId, Role.STAFF);
      await service.selectRole(user.githubId, Role.STAFF);

      // Then
      const pendingCount = await prisma.staffAccessRequest.count({
        where: { userId: user.id, status: StaffAccessRequestStatus.PENDING },
      });
      expect(pendingCount).toBe(1);
    });

    it('교직원을 재요청하면 새 PENDING 행이 생기고 승인 이력은 남는다', async () => {
      // Given
      const user = await createRevokedStaff('revoked-retry', 9_184_000_003n);

      // When
      const result = await service.retryStaffRequest(user.githubId);

      // Then
      const [stored, requests] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
        prisma.staffAccessRequest.findMany({
          where: { userId: user.id },
          orderBy: [{ createdAt: 'asc' }],
        }),
      ]);
      expect(result.status).toBe(StaffAccessRequestStatus.PENDING);
      // 새 행이지 덮어쓴 행이 아니다 — 옛 상태가 이 행에 실려 오면 이력이 지워진 것이다.
      expect(result.status).not.toMatch(/APPROVED|REVOKED/);
      expect(requests).toHaveLength(3);
      expect(requests[0]?.status).toBe(StaffAccessRequestStatus.APPROVED);
      expect(requests[1]?.status).toBe(StaffAccessRequestStatus.REVOKED);
      expect(requests[2]?.status).toBe(StaffAccessRequestStatus.PENDING);
      // 승인은 여전히 관리자 손에 있다 — 재요청이 권한을 되돌리지 않는다.
      expect(stored.role).toBeNull();
      expect(stored.selectedRole).toBe(Role.STAFF);
    });

    it('동시 재요청 2건은 한 PENDING으로 수렴한다', async () => {
      // Given
      const user = await createRevokedStaff('revoked-race', 9_184_000_004n);

      // When
      const results = await Promise.allSettled([
        service.retryStaffRequest(user.githubId),
        service.retryStaffRequest(user.githubId),
      ]);

      // Then: 행 잠금이 먼저 걸러도, 빠져나가면 partial unique
      // (`StaffAccessRequest_userId_pending_key`)가 남은 1건을 막는다.
      const pendingCount = await prisma.staffAccessRequest.count({
        where: { userId: user.id, status: StaffAccessRequestStatus.PENDING },
      });
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(pendingCount).toBe(1);
    });

    it('회수 이력이 있어도 역할이 확정된 사용자는 다시 고를 수 없다', async () => {
      // Given: 회수된 뒤 재승인돼 STAFF가 된 사람. 이력에는 REVOKED가 그대로 남는다.
      const user = await createRevokedStaff(
        'reapproved-staff',
        9_184_000_005n,
        Role.STAFF,
      );

      // When
      const promise = service.selectRole(user.githubId, Role.STUDENT);

      // Then: 확정된 사람은 못 바꾼다는 불변식은 #184 이후에도 그대로다.
      await expect(promise).rejects.toMatchObject({
        errorCode: { code: RolesErrorCode.ROLE_ALREADY_CONFIRMED },
      });
      const stored = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(stored.role).toBe(Role.STAFF);
      expect(stored.selectedRole).toBe(Role.STAFF);
    });
  });
});
