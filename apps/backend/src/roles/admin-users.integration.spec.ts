import { Role } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { AuditLogRepository } from '../audit-log/audit-log.repository';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminUsersRepository } from './admin-users.repository';
import { AdminUsersService } from './admin-users.service';

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
          login: 'synthetic-131-admin',
          name: '합성 관리자',
          role: Role.ADMIN,
        },
        {
          id: `${TEST_PREFIX}staff`,
          githubId: STAFF_GITHUB_ID,
          login: 'synthetic-131-staff',
          name: '합성 교직원',
          role: Role.STAFF,
        },
        {
          id: `${TEST_PREFIX}student`,
          githubId: STUDENT_GITHUB_ID,
          login: 'synthetic-131-student',
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

  async function cleanup(): Promise<void> {
    await prisma.auditLog.deleteMany({
      where: { targetId: { startsWith: TEST_PREFIX } },
    });
    await prisma.user.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
  }
});
