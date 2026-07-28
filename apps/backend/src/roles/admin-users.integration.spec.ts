import { Role, RoleRequestStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { AuditLogRepository } from '../audit-log/audit-log.repository';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminUsersRepository } from './admin-users.repository';
import { AdminUsersService } from './admin-users.service';
import { RolesErrorCode } from './roles-error-code.enum';
import { STAFF_ROLE_REQUEST_ACTIONS } from './domain/staff-role-request';
import { StaffRoleRequestsService } from './staff-role-requests.service';
import { StaffRoleRequestsRepository } from './staff-role-requests.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const TEST_PREFIX = 'test:131:admin-users:';
const ADMIN_GITHUB_ID = 9_131_100_001n;
const STAFF_GITHUB_ID = 9_131_100_002n;
const STUDENT_GITHUB_ID = 9_131_100_003n;

describe('Admin users integration', () => {
  const prisma = new PrismaService();
  const repository = new AdminUsersRepository(prisma);
  const auditLog = new AuditLogService(new AuditLogRepository(prisma));
  const service = new AdminUsersService(repository, auditLog);
  const staffRoleRequestsService = new StaffRoleRequestsService(
    new StaffRoleRequestsRepository(prisma),
    auditLog,
  );

  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  beforeEach(async () => {
    await cleanup();
    await prisma.user.createMany({
      data: [
        {
          id: `${TEST_PREFIX}admin`,
          githubId: ADMIN_GITHUB_ID,
          nickname: 'synthetic-131-admin',
          name: '합성 관리자',
          role: Role.ADMIN,
        },
        {
          id: `${TEST_PREFIX}staff`,
          githubId: STAFF_GITHUB_ID,
          nickname: 'synthetic-131-staff',
          name: '합성 교직원',
          role: Role.STAFF,
        },
        {
          id: `${TEST_PREFIX}student`,
          githubId: STUDENT_GITHUB_ID,
          nickname: 'synthetic-131-student',
          name: '한글 검색 사용자',
          role: Role.STUDENT,
        },
      ],
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('ADMIN 목록은 한글 이름·GitHub login 검색과 역할 필터를 적용한다', async () => {
    await expect(
      service.list(ADMIN_GITHUB_ID, { query: '한글 검색', role: undefined }),
    ).resolves.toEqual([
      expect.objectContaining({
        githubLogin: 'synthetic-131-student',
        role: Role.STUDENT,
      }),
    ]);
    await expect(
      service.list(ADMIN_GITHUB_ID, {
        query: 'synthetic-131',
        role: Role.STAFF,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        githubLogin: 'synthetic-131-staff',
        role: Role.STAFF,
      }),
    ]);
  });

  it('역할 변경은 즉시 권한에 반영되고 변경마다 감사 로그를 하나만 남긴다', async () => {
    const targetId = `${TEST_PREFIX}staff`;

    await service.updateRole(ADMIN_GITHUB_ID, targetId, Role.ADMIN);
    await expect(
      service.list(STAFF_GITHUB_ID, {
        query: 'synthetic-131',
        role: undefined,
      }),
    ).resolves.toHaveLength(3);
    await expect(
      prisma.auditLog.count({
        where: {
          action: 'USER_ROLE_CHANGED',
          targetType: 'USER',
          targetId,
        },
      }),
    ).resolves.toBe(1);

    await service.updateRole(ADMIN_GITHUB_ID, targetId, Role.STUDENT);
    await expect(
      service.list(STAFF_GITHUB_ID, { query: '', role: undefined }),
    ).rejects.toMatchObject({ errorCode: { code: 'ROL_004', status: 403 } });
    await expect(
      prisma.auditLog.count({
        where: {
          action: 'USER_ROLE_CHANGED',
          targetType: 'USER',
          targetId,
        },
      }),
    ).resolves.toBe(2);
  });

  it('감사 기록 실패는 역할 변경도 같은 Prisma 트랜잭션에서 롤백한다', async () => {
    const targetId = `${TEST_PREFIX}student`;
    const failingAudit = {
      record: jest.fn().mockRejectedValue(new Error('synthetic audit failure')),
    } as unknown as AuditLogService;
    const failingService = new AdminUsersService(repository, failingAudit);

    await expect(
      failingService.updateRole(ADMIN_GITHUB_ID, targetId, Role.ADMIN),
    ).rejects.toThrow('synthetic audit failure');

    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: targetId } }),
    ).resolves.toMatchObject({ role: Role.STUDENT });
    await expect(prisma.auditLog.count({ where: { targetId } })).resolves.toBe(
      0,
    );
  });
  it('PENDING 신청자에게 STAFF를 부여하면 관리자 결정으로 승인되어 중복 승인과 충돌하지 않는다', async () => {
    const targetId = `${TEST_PREFIX}student`;
    const requestId = `${TEST_PREFIX}pending-request`;
    await prisma.roleRequest.create({
      data: { id: requestId, userId: targetId },
    });

    await service.updateRole(ADMIN_GITHUB_ID, targetId, Role.STAFF);

    const decided = await prisma.roleRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    expect(decided.status).toBe(RoleRequestStatus.APPROVED);
    expect(decided.decidedById).toBe(`${TEST_PREFIX}admin`);
    expect(decided.decidedAt).not.toBeNull();
    await expect(
      staffRoleRequestsService.decide(ADMIN_GITHUB_ID, requestId, {
        action: STAFF_ROLE_REQUEST_ACTIONS.APPROVE,
      }),
    ).rejects.toMatchObject({
      errorCode: {
        code: RolesErrorCode.ROLE_REQUEST_ALREADY_DECIDED,
        status: 409,
      },
    });
  });

  it('APPROVED 교직원을 STUDENT로 변경하면 신청만 회수하고 계정 상태는 유지한다', async () => {
    const targetId = `${TEST_PREFIX}staff`;
    const requestId = `${TEST_PREFIX}approved-request`;
    await prisma.roleRequest.create({
      data: {
        id: requestId,
        userId: targetId,
        status: RoleRequestStatus.APPROVED,
        decidedById: `${TEST_PREFIX}admin`,
        decidedAt: new Date(),
      },
    });
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: targetId },
    });

    await service.updateRole(ADMIN_GITHUB_ID, targetId, Role.STUDENT);

    await expect(
      prisma.roleRequest.findUniqueOrThrow({ where: { id: requestId } }),
    ).resolves.toMatchObject({ status: RoleRequestStatus.REVOKED });
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: targetId } }),
    ).resolves.toMatchObject({
      role: Role.STUDENT,
      accountStatus: before.accountStatus,
    });
  });

  it('신청 기록이 없거나 이미 종결되면 신청 행을 만들거나 변경하지 않는다', async () => {
    const closedRequestId = `${TEST_PREFIX}closed-request`;
    await prisma.roleRequest.create({
      data: {
        id: closedRequestId,
        userId: `${TEST_PREFIX}staff`,
        status: RoleRequestStatus.REJECTED,
        decidedById: `${TEST_PREFIX}admin`,
        decidedAt: new Date(),
      },
    });

    await service.updateRole(
      ADMIN_GITHUB_ID,
      `${TEST_PREFIX}student`,
      Role.ADMIN,
    );
    await service.updateRole(
      ADMIN_GITHUB_ID,
      `${TEST_PREFIX}staff`,
      Role.STUDENT,
    );

    await expect(
      prisma.roleRequest.count({
        where: { userId: `${TEST_PREFIX}student` },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.roleRequest.findUniqueOrThrow({ where: { id: closedRequestId } }),
    ).resolves.toMatchObject({ status: RoleRequestStatus.REJECTED });
  });

  async function cleanup(): Promise<void> {
    await prisma.auditLog.deleteMany({
      where: { targetId: { startsWith: TEST_PREFIX } },
    });
    await prisma.roleRequest.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.user.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
  }
});
