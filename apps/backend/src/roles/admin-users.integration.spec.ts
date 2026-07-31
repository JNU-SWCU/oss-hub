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
const ADMIN_GITHUB_ID_BASE = 9_131_100_000n;
const STAFF_GITHUB_ID_BASE = 9_131_200_000n;
const STUDENT_GITHUB_ID_BASE = 9_131_300_000n;

type AdminUsersTestContext = {
  readonly prefix: string;
  readonly loginFragment: string;
  readonly adminId: string;
  readonly adminGithubId: bigint;
  readonly staffId: string;
  readonly staffGithubId: bigint;
  readonly staffLogin: string;
  readonly studentId: string;
  readonly studentGithubId: bigint;
  readonly studentLogin: string;
  readonly studentName: string;
};

describe('Admin users integration', () => {
  const prisma = new PrismaService();
  const repository = new AdminUsersRepository(prisma);
  const auditLog = new AuditLogService(new AuditLogRepository(prisma));
  const service = new AdminUsersService(repository, auditLog);
  const staffRoleRequestsService = new StaffRoleRequestsService(
    new StaffRoleRequestsRepository(prisma),
    auditLog,
  );
  let testSequence = 0;
  let context: AdminUsersTestContext;

  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  beforeEach(async () => {
    testSequence += 1;
    const prefix = `${TEST_PREFIX}${testSequence}:`;
    const loginFragment = `synthetic-131-${testSequence}`;
    context = {
      prefix,
      loginFragment,
      adminId: `${prefix}admin`,
      adminGithubId: ADMIN_GITHUB_ID_BASE + BigInt(testSequence),
      staffId: `${prefix}staff`,
      staffGithubId: STAFF_GITHUB_ID_BASE + BigInt(testSequence),
      staffLogin: `${loginFragment}-staff`,
      studentId: `${prefix}student`,
      studentGithubId: STUDENT_GITHUB_ID_BASE + BigInt(testSequence),
      studentLogin: `${loginFragment}-student`,
      studentName: `한글 검색 사용자 ${testSequence}`,
    };
    await prisma.user.createMany({
      data: [
        {
          id: context.adminId,
          githubId: context.adminGithubId,
          nickname: `${loginFragment}-admin`,
          name: `합성 관리자 ${testSequence}`,
          role: Role.ADMIN,
        },
        {
          id: context.staffId,
          githubId: context.staffGithubId,
          nickname: context.staffLogin,
          name: `합성 교직원 ${testSequence}`,
          role: Role.STAFF,
        },
        {
          id: context.studentId,
          githubId: context.studentGithubId,
          nickname: context.studentLogin,
          name: context.studentName,
          role: Role.STUDENT,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('ADMIN 목록은 한글 이름·GitHub login 검색과 역할 필터를 적용한다', async () => {
    await expect(
      service.list(context.adminGithubId, {
        query: context.studentName,
        role: undefined,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        githubLogin: context.studentLogin,
        role: Role.STUDENT,
      }),
    ]);
    await expect(
      service.list(context.adminGithubId, {
        query: context.loginFragment,
        role: Role.STAFF,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        githubLogin: context.staffLogin,
        role: Role.STAFF,
      }),
    ]);
  });

  it('역할 변경은 즉시 권한에 반영되고 변경마다 감사 로그를 하나만 남긴다', async () => {
    const targetId = context.staffId;

    await service.updateRole(context.adminGithubId, targetId, Role.ADMIN);
    await expect(
      service.list(context.staffGithubId, {
        query: context.loginFragment,
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

    await service.updateRole(context.adminGithubId, targetId, Role.STUDENT);
    await expect(
      service.list(context.staffGithubId, { query: '', role: undefined }),
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
    const targetId = context.studentId;
    const failingAudit = {
      record: jest.fn().mockRejectedValue(new Error('synthetic audit failure')),
    } as unknown as AuditLogService;
    const failingService = new AdminUsersService(repository, failingAudit);

    await expect(
      failingService.updateRole(context.adminGithubId, targetId, Role.ADMIN),
    ).rejects.toThrow('synthetic audit failure');

    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: targetId } }),
    ).resolves.toMatchObject({ role: Role.STUDENT });
    await expect(prisma.auditLog.count({ where: { targetId } })).resolves.toBe(
      0,
    );
  });
  it('PENDING 신청자에게 STAFF를 부여하면 관리자 결정으로 승인되어 중복 승인과 충돌하지 않는다', async () => {
    const targetId = context.studentId;
    const requestId = `${context.prefix}pending-request`;
    await prisma.roleRequest.create({
      data: { id: requestId, userId: targetId },
    });

    await service.updateRole(context.adminGithubId, targetId, Role.STAFF);

    const decided = await prisma.roleRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    expect(decided.status).toBe(RoleRequestStatus.APPROVED);
    expect(decided.decidedById).toBe(context.adminId);
    expect(decided.decidedAt).not.toBeNull();
    await expect(
      staffRoleRequestsService.decide(context.adminGithubId, requestId, {
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
    const targetId = context.staffId;
    const requestId = `${context.prefix}approved-request`;
    await prisma.roleRequest.create({
      data: {
        id: requestId,
        userId: targetId,
        status: RoleRequestStatus.APPROVED,
        decidedById: context.adminId,
        decidedAt: new Date(),
      },
    });
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: targetId },
    });

    await service.updateRole(context.adminGithubId, targetId, Role.STUDENT);

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
    const closedRequestId = `${context.prefix}closed-request`;
    await prisma.roleRequest.create({
      data: {
        id: closedRequestId,
        userId: context.staffId,
        status: RoleRequestStatus.REJECTED,
        decidedById: context.adminId,
        decidedAt: new Date(),
      },
    });

    await service.updateRole(
      context.adminGithubId,
      context.studentId,
      Role.ADMIN,
    );
    await service.updateRole(
      context.adminGithubId,
      context.staffId,
      Role.STUDENT,
    );

    await expect(
      prisma.roleRequest.count({
        where: { userId: context.studentId },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.roleRequest.findUniqueOrThrow({ where: { id: closedRequestId } }),
    ).resolves.toMatchObject({ status: RoleRequestStatus.REJECTED });
  });
});
