import { Role } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogErrorCode } from './audit-log-error-code.enum';
import { AuditLogRepository } from './audit-log.repository';
import { AuditLogService } from './audit-log.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const TEST_PREFIX = 'test:132:audit-log:';
const ADMIN_GITHUB_ID = 9_132_000_001n;
const STAFF_GITHUB_ID = 9_132_000_002n;

describe('Audit log integration', () => {
  const prisma = new PrismaService();
  const service = new AuditLogService(new AuditLogRepository(prisma));

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
          login: 'synthetic-132-admin',
          role: Role.ADMIN,
        },
        {
          id: `${TEST_PREFIX}staff`,
          githubId: STAFF_GITHUB_ID,
          login: 'synthetic-132-staff',
          role: Role.STAFF,
        },
      ],
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('record 헬퍼가 감사 레코드를 하나 생성한다', async () => {
    await service.record({
      actorGithubId: ADMIN_GITHUB_ID,
      action: 'STAFF_ROLE_REQUEST_APPROVED',
      targetType: 'ROLE_REQUEST',
      targetId: `${TEST_PREFIX}request`,
    });

    await expect(
      prisma.auditLog.count({
        where: { actorId: `${TEST_PREFIX}admin` },
      }),
    ).resolves.toBe(1);
  });

  it('ADMIN 필터 조회는 조건을 모두 적용하고 최신순으로 정렬한다', async () => {
    await prisma.auditLog.createMany({
      data: [
        {
          id: `${TEST_PREFIX}older`,
          actorId: `${TEST_PREFIX}admin`,
          action: 'STAFF_ROLE_REQUEST_APPROVED',
          targetType: 'ROLE_REQUEST',
          targetId: 'request-older',
          metadata: {},
          occurredAt: new Date('2026-07-24T01:00:00.000Z'),
        },
        {
          id: `${TEST_PREFIX}newer`,
          actorId: `${TEST_PREFIX}admin`,
          action: 'STAFF_ROLE_REQUEST_APPROVED',
          targetType: 'ROLE_REQUEST',
          targetId: 'request-newer',
          metadata: {},
          occurredAt: new Date('2026-07-24T02:00:00.000Z'),
        },
        {
          id: `${TEST_PREFIX}excluded`,
          actorId: `${TEST_PREFIX}admin`,
          action: 'STAFF_ROLE_REQUEST_REJECTED',
          targetType: 'ROLE_REQUEST',
          targetId: 'request-excluded',
          metadata: {},
          occurredAt: new Date('2026-07-24T03:00:00.000Z'),
        },
      ],
    });

    const result = await service.list(ADMIN_GITHUB_ID, {
      actor: '132-admin',
      action: 'STAFF_ROLE_REQUEST_APPROVED',
      from: '2026-07-24',
      to: '2026-07-24',
    });

    expect(result.map((record) => record.id)).toEqual([
      `${TEST_PREFIX}newer`,
      `${TEST_PREFIX}older`,
    ]);
  });

  it('STAFF 조회를 차단한다', async () => {
    await expect(service.list(STAFF_GITHUB_ID, {})).rejects.toMatchObject({
      errorCode: { code: AuditLogErrorCode.ADMIN_ONLY, status: 403 },
    });
  });

  it('선택한 한국 날짜의 00:00부터 23:59:59.999까지만 조회한다', async () => {
    await prisma.auditLog.createMany({
      data: [
        {
          id: `${TEST_PREFIX}before-kst-day`,
          actorId: `${TEST_PREFIX}admin`,
          action: 'BOUNDARY',
          targetType: 'ROLE_REQUEST',
          targetId: 'before',
          metadata: {},
          occurredAt: new Date('2026-07-23T14:59:59.999Z'),
        },
        {
          id: `${TEST_PREFIX}kst-day-start`,
          actorId: `${TEST_PREFIX}admin`,
          action: 'BOUNDARY',
          targetType: 'ROLE_REQUEST',
          targetId: 'start',
          metadata: {},
          occurredAt: new Date('2026-07-23T15:00:00.000Z'),
        },
        {
          id: `${TEST_PREFIX}kst-day-end`,
          actorId: `${TEST_PREFIX}admin`,
          action: 'BOUNDARY',
          targetType: 'ROLE_REQUEST',
          targetId: 'end',
          metadata: {},
          occurredAt: new Date('2026-07-24T14:59:59.999Z'),
        },
        {
          id: `${TEST_PREFIX}after-kst-day`,
          actorId: `${TEST_PREFIX}admin`,
          action: 'BOUNDARY',
          targetType: 'ROLE_REQUEST',
          targetId: 'after',
          metadata: {},
          occurredAt: new Date('2026-07-24T15:00:00.000Z'),
        },
      ],
    });

    const result = await service.list(ADMIN_GITHUB_ID, {
      action: 'BOUNDARY',
      from: '2026-07-24',
      to: '2026-07-24',
    });

    expect(result.map((record) => record.targetId)).toEqual(['end', 'start']);
  });

  async function cleanup(): Promise<void> {
    await prisma.auditLog.deleteMany({
      where: { actorId: { startsWith: TEST_PREFIX } },
    });
    await prisma.user.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
  }
});
