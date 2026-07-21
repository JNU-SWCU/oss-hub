import { Role, RoleRequestStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import type { ConsentsService } from '../consents/consents.service';
import { PrismaService } from '../prisma/prisma.service';
import { RolesRepository } from './roles.repository';
import { RolesService } from './roles.service';
import { StaffRoleRequestsRepository } from './staff-role-requests.repository';
import { StaffRoleRequestsService } from './staff-role-requests.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const TEST_PREFIX = 'test:174:recovery:';
const ADMIN_GITHUB_ID = 9_174_000_001n;
const STAFF_GITHUB_ID = 9_174_000_002n;

describe('Staff role revocation recovery integration', () => {
  const prisma = new PrismaService();
  const rolesService = new RolesService(new RolesRepository(prisma), {
    requireCurrent: jest.fn().mockResolvedValue(undefined),
  } satisfies Pick<ConsentsService, 'requireCurrent'>);
  const staffRoleRequestsService = new StaffRoleRequestsService(
    new StaffRoleRequestsRepository(prisma),
  );

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

  it('회수로 역할이 비워진 사용자는 새 교직원 승인을 요청할 수 있다', async () => {
    // Given
    const [admin, staff] = await Promise.all([
      prisma.user.create({
        data: {
          id: `${TEST_PREFIX}admin`,
          githubId: ADMIN_GITHUB_ID,
          login: 'synthetic-174-admin',
          role: Role.ADMIN,
        },
      }),
      prisma.user.create({
        data: {
          id: `${TEST_PREFIX}staff`,
          githubId: STAFF_GITHUB_ID,
          login: 'synthetic-174-staff',
          role: Role.STAFF,
        },
      }),
    ]);
    const approved = await prisma.roleRequest.create({
      data: {
        userId: staff.id,
        status: RoleRequestStatus.APPROVED,
        decidedAt: new Date('2026-07-21T09:00:00.000Z'),
        decidedById: admin.id,
      },
    });

    // When
    await staffRoleRequestsService.decide(ADMIN_GITHUB_ID, approved.id, {
      action: 'REVOKE',
    });
    const retried = await rolesService.retryStaffRequest(STAFF_GITHUB_ID);

    // Then
    const [storedStaff, storedRequests] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: staff.id } }),
      prisma.roleRequest.findMany({
        where: { userId: staff.id },
      }),
    ]);
    expect(storedStaff.role).toBeNull();
    expect(retried.status).toBe(RoleRequestStatus.PENDING);
    expect(storedRequests).toHaveLength(2);
    expect(storedRequests.map((request) => request.status)).toEqual(
      expect.arrayContaining([
        RoleRequestStatus.REVOKED,
        RoleRequestStatus.PENDING,
      ]),
    );
  });
});
