import {
  AccountStatus,
  LoginHistoryEvent,
  ProgramCategory,
  RepositoryVisibility,
  Role,
  RoleRequestStatus,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { StaffRoleRequestsRepository } from './staff-role-requests.repository';
import { StaffRoleRequestsService } from './staff-role-requests.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const TEST_PREFIX = 'test:188:account-lifecycle:';
const ADMIN_GITHUB_ID = 9_188_000_001n;
const STAFF_GITHUB_ID = 9_188_000_002n;

describe('Staff account lifecycle integration', () => {
  const prisma = new PrismaService();
  const service = new StaffRoleRequestsService(
    new StaffRoleRequestsRepository(prisma),
  );

  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  beforeEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('회수는 STAFF 역할과 연결 자산을 보존하고 계정만 비활성화한다', async () => {
    const { adminId, staffId, requestId } = await createApprovedStaff();
    await createPreservedAssets(staffId);

    const revoked = await service.decide(ADMIN_GITHUB_ID, requestId, {
      action: 'REVOKE',
    });

    const [staff, request, preservedCounts] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: staffId } }),
      prisma.roleRequest.findUniqueOrThrow({ where: { id: requestId } }),
      countPreservedAssets(staffId),
    ]);
    expect(revoked).toMatchObject({
      status: RoleRequestStatus.REVOKED,
      userRole: Role.STAFF,
      userAccountStatus: AccountStatus.DEACTIVATED,
    });
    expect(staff).toMatchObject({
      role: Role.STAFF,
      accountStatus: AccountStatus.DEACTIVATED,
    });
    expect(request).toMatchObject({
      status: RoleRequestStatus.REVOKED,
      decidedById: adminId,
    });
    expect(preservedCounts).toEqual({
      consents: 1,
      loginHistories: 1,
      programs: 1,
      applications: 1,
      repositories: 1,
      inventories: 1,
      activityEvents: 1,
    });
  });

  it('관리자 재활성화는 REVOKED 이력을 보존하고 별도 APPROVED 이력을 남긴다', async () => {
    const { adminId, staffId, requestId } = await createApprovedStaff();
    await service.decide(ADMIN_GITHUB_ID, requestId, { action: 'REVOKE' });

    const reactivated = await service.decide(ADMIN_GITHUB_ID, requestId, {
      action: 'REACTIVATE',
    });

    const [staff, requests] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: staffId } }),
      prisma.roleRequest.findMany({
        where: { userId: staffId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    expect(staff).toMatchObject({
      role: Role.STAFF,
      accountStatus: AccountStatus.ACTIVE,
    });
    expect(reactivated).toMatchObject({
      status: RoleRequestStatus.APPROVED,
      userRole: Role.STAFF,
      userAccountStatus: AccountStatus.ACTIVE,
      decidedBy: 'synthetic-188-admin',
    });
    expect(reactivated.id).not.toBe(requestId);
    expect(requests).toHaveLength(2);
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: requestId,
          status: RoleRequestStatus.REVOKED,
          decidedById: adminId,
        }),
        expect.objectContaining({
          id: reactivated.id,
          status: RoleRequestStatus.APPROVED,
          decidedById: adminId,
        }),
      ]),
    );
  });

  async function createApprovedStaff(): Promise<{
    readonly adminId: string;
    readonly staffId: string;
    readonly requestId: string;
  }> {
    const [admin, staff] = await Promise.all([
      prisma.user.create({
        data: {
          id: `${TEST_PREFIX}admin`,
          githubId: ADMIN_GITHUB_ID,
          login: 'synthetic-188-admin',
          role: Role.ADMIN,
        },
      }),
      prisma.user.create({
        data: {
          id: `${TEST_PREFIX}staff`,
          githubId: STAFF_GITHUB_ID,
          login: 'synthetic-188-staff',
          role: Role.STAFF,
        },
      }),
    ]);
    expect(admin.accountStatus).toBe(AccountStatus.ACTIVE);
    expect(staff.accountStatus).toBe(AccountStatus.ACTIVE);
    const request = await prisma.roleRequest.create({
      data: {
        id: `${TEST_PREFIX}request`,
        userId: staff.id,
        status: RoleRequestStatus.APPROVED,
        decidedAt: new Date('2026-07-21T09:00:00.000Z'),
        decidedById: admin.id,
      },
    });
    return { adminId: admin.id, staffId: staff.id, requestId: request.id };
  }

  async function createPreservedAssets(staffId: string): Promise<void> {
    await Promise.all([
      prisma.consent.create({
        data: {
          id: `${TEST_PREFIX}consent`,
          userId: staffId,
          policyVersion: 'synthetic-188-policy',
        },
      }),
      prisma.loginHistory.create({
        data: {
          id: `${TEST_PREFIX}login-history`,
          userId: staffId,
          event: LoginHistoryEvent.LOGIN,
          success: true,
        },
      }),
    ]);
    const program = await prisma.program.create({
      data: {
        id: `${TEST_PREFIX}program`,
        name: 'Synthetic 188 Program',
        organizer: 'Synthetic Organizer',
        category: ProgramCategory.BASIC,
        applicationTemplateKey: 'synthetic-188-template',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-07-01T00:00:00.000Z'),
        applicationEndAt: new Date('2026-07-31T00:00:00.000Z'),
        description: 'Synthetic account lifecycle fixture',
      },
    });
    const application = await prisma.application.create({
      data: {
        id: `${TEST_PREFIX}application`,
        programId: program.id,
        applicantId: staffId,
        answers: { synthetic: true },
        applicationTemplateVersion: 1,
      },
    });
    const repository = await prisma.repository.create({
      data: {
        id: `${TEST_PREFIX}repository`,
        applicationId: application.id,
        programId: program.id,
        githubRepositoryId: 9_188_100_001n,
        name: 'synthetic-188-repository',
        url: 'https://example.invalid/synthetic-188-repository',
      },
    });
    const inventory = await prisma.orgRepositoryInventory.create({
      data: {
        id: `${TEST_PREFIX}inventory`,
        githubRepositoryId: repository.githubRepositoryId,
        fullName: 'synthetic-org/synthetic-188-repository',
        visibility: RepositoryVisibility.PRIVATE,
        archived: false,
        repositoryId: repository.id,
      },
    });
    await prisma.orgRepositoryActivityEvent.create({
      data: {
        id: `${TEST_PREFIX}activity-event`,
        inventoryId: inventory.id,
        deliveryId: 'synthetic-188-delivery',
        eventType: 'push',
        occurredAt: new Date('2026-07-21T10:00:00.000Z'),
        dedupeKey: `${TEST_PREFIX}asset`,
        commitDelta: 1,
      },
    });
  }

  async function countPreservedAssets(staffId: string): Promise<{
    readonly consents: number;
    readonly loginHistories: number;
    readonly programs: number;
    readonly applications: number;
    readonly repositories: number;
    readonly inventories: number;
    readonly activityEvents: number;
  }> {
    const [
      consents,
      loginHistories,
      programs,
      applications,
      repositories,
      inventories,
      activityEvents,
    ] = await Promise.all([
      prisma.consent.count({ where: { userId: staffId } }),
      prisma.loginHistory.count({ where: { userId: staffId } }),
      prisma.program.count({ where: { id: `${TEST_PREFIX}program` } }),
      prisma.application.count({ where: { applicantId: staffId } }),
      prisma.repository.count({ where: { id: `${TEST_PREFIX}repository` } }),
      prisma.orgRepositoryInventory.count({
        where: { id: `${TEST_PREFIX}inventory` },
      }),
      prisma.orgRepositoryActivityEvent.count({
        where: { id: `${TEST_PREFIX}activity-event` },
      }),
    ]);
    return {
      consents,
      loginHistories,
      programs,
      applications,
      repositories,
      inventories,
      activityEvents,
    };
  }

  async function cleanup(): Promise<void> {
    await prisma.orgRepositoryActivityEvent.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.orgRepositoryInventory.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.repository.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.application.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.program.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.loginHistory.deleteMany({
      where: { userId: { startsWith: TEST_PREFIX } },
    });
    await prisma.consent.deleteMany({
      where: { userId: { startsWith: TEST_PREFIX } },
    });
    await prisma.roleRequest.deleteMany({
      where: { userId: { startsWith: TEST_PREFIX } },
    });
    await prisma.user.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
  }
});
