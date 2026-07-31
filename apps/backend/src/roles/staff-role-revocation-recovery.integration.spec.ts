import {
  AccountStatus,
  LoginHistoryEvent,
  ProgramCategory,
  RepositoryVisibility,
  Role,
  RoleRequestStatus,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { AuditLogRepository } from '../audit-log/audit-log.repository';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { StaffRoleRequestsRepository } from './staff-role-requests.repository';
import { StaffRoleRequestsService } from './staff-role-requests.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const TEST_PREFIX = 'test:188:account-lifecycle:';
const ADMIN_GITHUB_ID_BASE = 9_188_000_000n;
const STAFF_GITHUB_ID_BASE = 9_188_200_000n;

type StaffLifecycleTestContext = {
  readonly prefix: string;
  readonly adminId: string;
  readonly adminGithubId: bigint;
  readonly adminLogin: string;
  readonly staffId: string;
  readonly staffGithubId: bigint;
  readonly staffStudentId: string;
};

describe('Staff account lifecycle integration', () => {
  const prisma = new PrismaService();
  const service = new StaffRoleRequestsService(
    new StaffRoleRequestsRepository(prisma),
    new AuditLogService(new AuditLogRepository(prisma)),
  );
  let testSequence = 0;
  let context: StaffLifecycleTestContext;

  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  beforeEach(() => {
    testSequence += 1;
    const prefix = `${TEST_PREFIX}${testSequence}:`;
    context = {
      prefix,
      adminId: `${prefix}admin`,
      adminGithubId: ADMIN_GITHUB_ID_BASE + BigInt(testSequence),
      adminLogin: `synthetic-188-${testSequence}-admin`,
      staffId: `${prefix}staff`,
      staffGithubId: STAFF_GITHUB_ID_BASE + BigInt(testSequence),
      staffStudentId: String(9_600_000 + testSequence),
    };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('회수는 STAFF 역할과 연결 자산을 보존하고 계정만 비활성화한다', async () => {
    const { adminId, staffId, requestId } = await createApprovedStaff();
    await createPreservedAssets(staffId);

    const revoked = await service.decide(context.adminGithubId, requestId, {
      action: 'REVOKE',
    });

    const [staff, request, preservedCounts, auditLogs] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: staffId } }),
      prisma.roleRequest.findUniqueOrThrow({ where: { id: requestId } }),
      countPreservedAssets(staffId),
      prisma.auditLog.findMany({ where: { actorId: adminId } }),
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
    expect(auditLogs).toEqual([
      expect.objectContaining({
        action: 'STAFF_ROLE_REQUEST_REVOKED',
        targetType: 'ROLE_REQUEST',
        targetId: requestId,
      }),
    ]);
  });

  it('관리자 재활성화는 REVOKED 이력을 보존하고 별도 APPROVED 이력을 남긴다', async () => {
    const { adminId, staffId, requestId } = await createApprovedStaff();
    await service.decide(context.adminGithubId, requestId, {
      action: 'REVOKE',
    });

    const reactivated = await service.decide(context.adminGithubId, requestId, {
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
      decidedBy: context.adminLogin,
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

  it('불완전한 기존 프로필의 STAFF 승인을 거부하고 보완 후에만 승인한다', async () => {
    const { staffId, requestId } = await createPendingStaffApplicant();

    await expect(
      service.decide(context.adminGithubId, requestId, { action: 'APPROVE' }),
    ).rejects.toMatchObject({
      errorCode: { code: 'USR_002', status: 409 },
    });
    await expect(
      Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: staffId } }),
        prisma.roleRequest.findUniqueOrThrow({ where: { id: requestId } }),
        prisma.auditLog.count({
          where: { actor: { githubId: context.adminGithubId } },
        }),
      ]),
    ).resolves.toEqual([
      expect.objectContaining({ role: null }),
      expect.objectContaining({ status: RoleRequestStatus.PENDING }),
      0,
    ]);

    await prisma.user.update({
      where: { id: staffId },
      data: {
        name: 'Synthetic Pending Staff',
        studentId: context.staffStudentId,
        department: 'Synthetic Department',
      },
    });

    await expect(
      service.decide(context.adminGithubId, requestId, { action: 'APPROVE' }),
    ).resolves.toMatchObject({
      status: RoleRequestStatus.APPROVED,
      userRole: Role.STAFF,
    });
    await expect(
      prisma.auditLog.count({
        where: { actor: { githubId: context.adminGithubId } },
      }),
    ).resolves.toBe(1);
  });

  it('감사 기록 실패 시 승인 상태와 역할 변경을 함께 롤백한다', async () => {
    const { staffId, requestId } = await createPendingStaffApplicant();
    await prisma.user.update({
      where: { id: staffId },
      data: {
        name: 'Synthetic Pending Staff',
        studentId: context.staffStudentId,
        department: 'Synthetic Department',
      },
    });
    const failingAuditLog = new AuditLogService(new AuditLogRepository(prisma));
    jest
      .spyOn(failingAuditLog, 'record')
      .mockRejectedValueOnce(new Error('synthetic audit write failure'));
    const failingService = new StaffRoleRequestsService(
      new StaffRoleRequestsRepository(prisma),
      failingAuditLog,
    );

    await expect(
      failingService.decide(context.adminGithubId, requestId, {
        action: 'APPROVE',
      }),
    ).rejects.toThrow('synthetic audit write failure');
    await expect(
      Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: staffId } }),
        prisma.roleRequest.findUniqueOrThrow({ where: { id: requestId } }),
        prisma.auditLog.count({
          where: { actor: { githubId: context.adminGithubId } },
        }),
      ]),
    ).resolves.toEqual([
      expect.objectContaining({ role: null }),
      expect.objectContaining({ status: RoleRequestStatus.PENDING }),
      0,
    ]);
  });

  async function createApprovedStaff(): Promise<{
    readonly adminId: string;
    readonly staffId: string;
    readonly requestId: string;
  }> {
    const [admin, staff] = await Promise.all([
      prisma.user.create({
        data: {
          id: context.adminId,
          githubId: context.adminGithubId,
          nickname: context.adminLogin,
          role: Role.ADMIN,
        },
      }),
      prisma.user.create({
        data: {
          id: context.staffId,
          githubId: context.staffGithubId,
          nickname: `synthetic-188-${testSequence}-staff`,
          role: Role.STAFF,
        },
      }),
    ]);
    expect(admin.accountStatus).toBe(AccountStatus.ACTIVE);
    expect(staff.accountStatus).toBe(AccountStatus.ACTIVE);
    const request = await prisma.roleRequest.create({
      data: {
        id: `${context.prefix}request`,
        userId: staff.id,
        status: RoleRequestStatus.APPROVED,
        decidedAt: new Date('2026-07-21T09:00:00.000Z'),
        decidedById: admin.id,
      },
    });
    return { adminId: admin.id, staffId: staff.id, requestId: request.id };
  }

  async function createPendingStaffApplicant(): Promise<{
    readonly staffId: string;
    readonly requestId: string;
  }> {
    await prisma.user.create({
      data: {
        id: context.adminId,
        githubId: context.adminGithubId,
        nickname: context.adminLogin,
        role: Role.ADMIN,
      },
    });
    const staff = await prisma.user.create({
      data: {
        id: context.staffId,
        githubId: context.staffGithubId,
        nickname: `synthetic-188-${testSequence}-pending-staff`,
      },
    });
    const request = await prisma.roleRequest.create({
      data: {
        id: `${context.prefix}request`,
        userId: staff.id,
        status: RoleRequestStatus.PENDING,
      },
    });
    return { staffId: staff.id, requestId: request.id };
  }

  async function createPreservedAssets(staffId: string): Promise<void> {
    await Promise.all([
      prisma.consent.create({
        data: {
          id: `${context.prefix}consent`,
          userId: staffId,
          policyVersion: 'synthetic-188-policy',
        },
      }),
      prisma.loginHistory.create({
        data: {
          id: `${context.prefix}login-history`,
          userId: staffId,
          event: LoginHistoryEvent.LOGIN,
          success: true,
        },
      }),
    ]);
    const program = await prisma.program.create({
      data: {
        id: `${context.prefix}program`,
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
        id: `${context.prefix}application`,
        programId: program.id,
        applicantId: staffId,
        answers: { synthetic: true },
        applicationTemplateVersion: 1,
      },
    });
    const repository = await prisma.repository.create({
      data: {
        id: `${context.prefix}repository`,
        applicationId: application.id,
        programId: program.id,
        githubRepositoryId: 9_188_100_001n,
        name: 'synthetic-188-repository',
        url: 'https://example.invalid/synthetic-188-repository',
      },
    });
    const inventory = await prisma.orgRepositoryInventory.create({
      data: {
        id: `${context.prefix}inventory`,
        githubRepositoryId: repository.githubRepositoryId,
        fullName: 'synthetic-org/synthetic-188-repository',
        visibility: RepositoryVisibility.PRIVATE,
        archived: false,
        repositoryId: repository.id,
      },
    });
    await prisma.orgRepositoryActivityEvent.create({
      data: {
        id: `${context.prefix}activity-event`,
        inventoryId: inventory.id,
        deliveryId: 'synthetic-188-delivery',
        eventType: 'push',
        occurredAt: new Date('2026-07-21T10:00:00.000Z'),
        dedupeKey: `${context.prefix}asset`,
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
      prisma.program.count({ where: { id: `${context.prefix}program` } }),
      prisma.application.count({ where: { applicantId: staffId } }),
      prisma.repository.count({
        where: { id: `${context.prefix}repository` },
      }),
      prisma.orgRepositoryInventory.count({
        where: { id: `${context.prefix}inventory` },
      }),
      prisma.orgRepositoryActivityEvent.count({
        where: { id: `${context.prefix}activity-event` },
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
});
