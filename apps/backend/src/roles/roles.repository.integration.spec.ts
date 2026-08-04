import { Role, RoleRequestStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import type { ConsentsService } from '../consents/consents.service';
import { PrismaService } from '../prisma/prisma.service';
import { RolesRepository } from './roles.repository';
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
    await prisma.roleRequest.deleteMany({
      where: { user: { id: { startsWith: TEST_PREFIX } } },
    });
    await prisma.user.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
  });

  afterAll(async () => {
    await prisma.roleRequest.deleteMany({
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
    const pendingCount = await prisma.roleRequest.count({
      where: { userId: user.id, status: RoleRequestStatus.PENDING },
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
      prisma.roleRequest.count({
        where: { userId: user.id, status: RoleRequestStatus.PENDING },
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
   * `selectedRole`에 남고 `role`·`RoleRequest`는 그대로여야 한다.
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
        prisma.roleRequest.count({ where: { userId: user.id } }),
      ]);
      expect(storedUser.selectedRole).toBe(selectedRole);
      expect(storedUser.role).toBeNull();
      expect(requestCount).toBe(0);
    },
  );
});
