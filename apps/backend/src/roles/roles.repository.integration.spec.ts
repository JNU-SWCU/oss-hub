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
        login: 'synthetic-169-staff',
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
    expect(results.every((result) => result.requestStatus === 'PENDING')).toBe(
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
        login: 'synthetic-169-mixed',
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
});
