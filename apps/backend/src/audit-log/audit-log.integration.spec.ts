import { AccountStatus, Role } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogErrorCode } from './audit-log-error-code.enum';
import {
  ACCESS_AUDIT_EVENT_KINDS,
  createAccessAuditMetadata,
} from './audit-log-metadata';
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
    await prisma.user.createMany({
      data: [
        {
          id: `${TEST_PREFIX}admin`,
          githubId: ADMIN_GITHUB_ID,
          nickname: 'synthetic-132-admin',
          role: Role.ADMIN,
        },
        {
          id: `${TEST_PREFIX}staff`,
          githubId: STAFF_GITHUB_ID,
          nickname: 'synthetic-132-staff',
          role: Role.STAFF,
        },
      ],
    });
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('record 헬퍼가 감사 레코드를 하나 생성한다', async () => {
    await service.record({
      actorGithubId: ADMIN_GITHUB_ID,
      action: 'STAFF_ROLE_REQUEST_APPROVED',
      targetType: 'ROLE_REQUEST',
      targetId: `${TEST_PREFIX}request`,
      metadata: createAccessAuditMetadata({
        eventKind: ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_APPROVED,
        actor: {
          displayName: null,
          githubLogin: 'synthetic-132-admin',
        },
        before: {
          role: null,
          accountStatus: AccountStatus.ACTIVE,
          requestStatus: null,
        },
        after: {
          role: Role.STAFF,
          accountStatus: AccountStatus.ACTIVE,
          requestStatus: null,
        },
      }),
    });

    await expect(
      prisma.auditLog.count({
        where: { targetId: `${TEST_PREFIX}request` },
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
      page: 1,
      limit: 20,
    });

    expect(result.items.map((record) => record.id)).toEqual([
      `${TEST_PREFIX}newer`,
      `${TEST_PREFIX}older`,
    ]);
    expect(result.items).toEqual([
      expect.objectContaining({ legacy: true, metadata: null }),
      expect.objectContaining({ legacy: true, metadata: null }),
    ]);
    expect(result.total).toBe(2);
  });

  it('동일한 발생 시각의 감사 행을 두 페이지에서 누락·중복 없이 id 역순으로 조회한다', async () => {
    const occurredAt = new Date('2026-07-25T03:00:00.000Z');
    const insertedIds = [
      `${TEST_PREFIX}tie-1`,
      `${TEST_PREFIX}tie-2`,
      `${TEST_PREFIX}tie-3`,
      `${TEST_PREFIX}tie-4`,
    ];
    const expectedIds = [
      `${TEST_PREFIX}tie-4`,
      `${TEST_PREFIX}tie-3`,
      `${TEST_PREFIX}tie-2`,
      `${TEST_PREFIX}tie-1`,
    ];
    await prisma.auditLog.createMany({
      data: insertedIds.map((id) => ({
        id,
        actorId: `${TEST_PREFIX}admin`,
        action: 'TIED_TIMESTAMP_PAGINATION',
        targetType: 'ROLE_REQUEST',
        targetId: id,
        metadata: {},
        occurredAt,
      })),
    });

    const firstPage = await service.list(ADMIN_GITHUB_ID, {
      action: 'TIED_TIMESTAMP_PAGINATION',
      page: 1,
      limit: 2,
    });
    const secondPage = await service.list(ADMIN_GITHUB_ID, {
      action: 'TIED_TIMESTAMP_PAGINATION',
      page: 2,
      limit: 2,
    });
    const firstPageIds = firstPage.items.map((record) => record.id);
    const secondPageIds = secondPage.items.map((record) => record.id);
    const pagedIds = [...firstPageIds, ...secondPageIds];

    expect(firstPageIds.filter((id) => secondPageIds.includes(id))).toEqual([]);
    expect([...new Set(pagedIds)].sort()).toEqual([...insertedIds].sort());
    expect(pagedIds).toEqual(expectedIds);
    expect([firstPage.total, secondPage.total]).toEqual([4, 4]);
  });

  it('STAFF 조회를 차단한다', async () => {
    await expect(
      service.list(STAFF_GITHUB_ID, { page: 1, limit: 20 }),
    ).rejects.toMatchObject({
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
      page: 1,
      limit: 20,
    });

    expect(result.items.map((record) => record.targetId)).toEqual([
      'end',
      'start',
    ]);
  });
});
