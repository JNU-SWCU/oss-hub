import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from './prisma.service';
import { AuditLogRepository } from './audit-log.repository';
import { AuditLogService } from './audit-log.service';
import { AuditLogMetadataService } from './audit-log-metadata.service';
import { AuditLogReadService } from './audit-log-read.service';
import {
  HISTORY_FEED_DAY,
  HISTORY_FEED_PREFIX,
  seedHistoryFeed,
} from './audit-log-history.fixture';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

describe('Combined owned audit feed', () => {
  const prisma = new PrismaService();
  const service = new AuditLogService(
    new AuditLogRepository(prisma),
    new AuditLogReadService(new AuditLogMetadataService()),
  );
  const query = {
    from: HISTORY_FEED_DAY,
    to: HISTORY_FEED_DAY,
    page: 1,
    limit: 20,
  };

  beforeAll(async () => {
    await prisma.$connect();
    await seedHistoryFeed(prisma);
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('deduplicates before totals and paging and orders timestamp ties by canonical id', async () => {
    const pages = await Promise.all(
      [1, 2, 3].map((page) => service.list({ ...query, page, limit: 4 })),
    );

    expect(pages.map((page) => page.total)).toEqual([9, 9, 9]);
    expect(pages.flatMap((page) => page.items.map((item) => item.id))).toEqual([
      `admin:${HISTORY_FEED_PREFIX}9`,
      `user:${HISTORY_FEED_PREFIX}8`,
      `user:${HISTORY_FEED_PREFIX}7`,
      `user:${HISTORY_FEED_PREFIX}6`,
      `admin:${HISTORY_FEED_PREFIX}5`,
      `${HISTORY_FEED_PREFIX}audit:4`,
      `${HISTORY_FEED_PREFIX}audit:3`,
      `${HISTORY_FEED_PREFIX}audit:2`,
      `${HISTORY_FEED_PREFIX}audit:1`,
    ]);
  });

  it('keeps the total on an out-of-range page', async () => {
    const result = await service.list({ ...query, page: 4, limit: 4 });

    expect(result).toEqual({ items: [], total: 9, page: 4, limit: 4 });
  });

  it('applies actor action and dates to the canonical feed rather than individual projections', async () => {
    const result = await service.list({
      ...query,
      actor: 'HISTORY-ACTOR',
      action: 'USER_ROLE_CHANGED',
      limit: 1,
    });

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: `${HISTORY_FEED_PREFIX}audit:3`,
      actor: 'Original actor',
      actorHandle: 'original-actor',
      target: 'Original target',
      targetHandle: 'original-target',
    });
  });

  it('retains unresolved profile originals beside new history events under the same action filter', async () => {
    const result = await service.list({
      ...query,
      action: 'USER_PROFILE_UPDATED',
    });

    expect(result.total).toBe(2);
    expect(result.items.map((item) => [item.id, item.legacy])).toEqual([
      [`user:${HISTORY_FEED_PREFIX}6`, false],
      [`${HISTORY_FEED_PREFIX}audit:2`, true],
    ]);
    expect(result.items[1]).toMatchObject({
      targetId: 'unresolved-user',
      target: 'USER / unresolved-user',
      metadata: null,
    });
  });

  it('keeps malformed imported originals visible without exposing their raw payload', async () => {
    const result = await service.list({
      ...query,
      action: 'USER_PHONE_UPDATED',
    });

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: `${HISTORY_FEED_PREFIX}audit:4`,
      legacy: true,
      metadata: null,
    });
  });

  it('shows real typed transitions and excludes migration snapshots', async () => {
    const result = await service.list({
      ...query,
      action: 'REQUEST_SUPERSEDED',
    });

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      targetType: 'ROLE_REQUEST',
      targetId: `${HISTORY_FEED_PREFIX}request`,
      legacy: false,
      metadata: {
        recordKind: 'REQUEST_TRANSITION',
        requestId: `${HISTORY_FEED_PREFIX}request`,
        status: 'REVOKED',
        cause: 'SUPERSEDED',
        replacementRequestId: 'request-new',
      },
    });
    expect(result.items[0]?.metadata).not.toHaveProperty('request');
  });

  it('projects onboarding type selection with its real identity change, actor and time', async () => {
    const id = `user:${HISTORY_FEED_PREFIX}type-selection`;
    const userId = `${HISTORY_FEED_PREFIX}user`;
    const actorId = `${HISTORY_FEED_PREFIX}actor`;
    const occurredAt = new Date('2026-11-02T00:00:00.000Z');
    const data = {
      schemaVersion: 1,
      recordKind: 'TYPE_SELECTION',
      before: 'UNSELECTED',
      after: 'STUDENT',
    };
    await prisma.$executeRaw`
      INSERT INTO "UserHistory" ("id", "userId", "actorId", "event",
        "occurredAt", "recordedAt", "source", "data")
      VALUES (${id}, ${userId}, ${actorId}, 'TYPE_CHANGED',
        ${occurredAt}, ${occurredAt}, 'APPLICATION', ${JSON.stringify(data)}::jsonb)`;

    const result = await service.list({
      actor: 'audit-history-actor',
      action: 'USER_ROLE_CHANGED',
      from: '2026-11-02',
      to: '2026-11-02',
      page: 1,
      limit: 20,
    });

    expect(result.total).toBe(1);
    expect(result.items).toEqual([
      {
        id,
        actor: 'audit-history-actor',
        actorHandle: 'audit-history-actor',
        action: 'USER_ROLE_CHANGED',
        targetType: 'USER',
        targetId: userId,
        target: `USER / ${userId}`,
        targetHandle: null,
        occurredAt,
        legacy: false,
        metadata: data,
      },
    ]);
  });
});
