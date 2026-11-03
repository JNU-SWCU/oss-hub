import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from './prisma.service';
import { AuditLogRepository } from './audit-log.repository';
import { AuditLogService } from './audit-log.service';
import { AuditLogMetadataService } from './audit-log-metadata.service';
import { AuditLogReadService } from './audit-log-read.service';
import { InvalidAuditLogMetadataError } from './audit-log-error-code.error';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const HISTORY_FEED_PREFIX = 'test:audit-bootstrap:';
describe('Bootstrap audit feed', () => {
  const prisma = new PrismaService();
  const service = new AuditLogService(
    new AuditLogRepository(prisma),
    new AuditLogReadService(new AuditLogMetadataService()),
  );
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: {
        id: HISTORY_FEED_PREFIX + 'user',
        githubId: 9_501_102_001n,
        nickname: 'bootstrap-subject',
      },
    });
  }, 60_000);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('projects the seed bootstrap envelope as grant then revoke from stored events', async () => {
    const userId = `${HISTORY_FEED_PREFIX}user`;
    const data = {
      schemaVersion: 1,
      recordKind: 'BOOTSTRAP',
      operatorReceipt: 'explicit seed initialization',
    };
    await prisma.adminHistory.createMany({
      data: [
        {
          id: `${HISTORY_FEED_PREFIX}bootstrap-grant`,
          userId,
          event: 'GRANTED',
          source: 'BOOTSTRAP',
          occurredAt: new Date('2092-01-01T00:00:00Z'),
          data,
        },
        {
          id: `${HISTORY_FEED_PREFIX}bootstrap-revoke`,
          userId,
          event: 'REVOKED',
          source: 'BOOTSTRAP',
          occurredAt: new Date('2092-01-01T00:01:00Z'),
          data,
        },
      ],
    });

    const pages = await Promise.all(
      ['GRANT_ADMIN_ACCESS', 'REVOKE_ADMIN_ACCESS'].map((action) =>
        service.list({
          action,
          from: '2092-01-01',
          to: '2092-01-01',
          page: 1,
          limit: 20,
        }),
      ),
    );

    expect(pages.map((page) => page.total)).toEqual([1, 1]);
    expect(pages.flatMap((page) => page.items)).toEqual([
      {
        id: `${HISTORY_FEED_PREFIX}bootstrap-grant`,
        actor: 'SYSTEM',
        actorHandle: null,
        action: 'GRANT_ADMIN_ACCESS',
        targetType: 'USER',
        targetId: userId,
        target: `USER / ${userId}`,
        targetHandle: null,
        occurredAt: new Date('2092-01-01T00:00:00Z'),
        legacy: false,
        metadata: { schemaVersion: 1, recordKind: 'BOOTSTRAP' },
      },
      {
        id: `${HISTORY_FEED_PREFIX}bootstrap-revoke`,
        actor: 'SYSTEM',
        actorHandle: null,
        action: 'REVOKE_ADMIN_ACCESS',
        targetType: 'USER',
        targetId: userId,
        target: `USER / ${userId}`,
        targetHandle: null,
        occurredAt: new Date('2092-01-01T00:01:00Z'),
        legacy: false,
        metadata: { schemaVersion: 1, recordKind: 'BOOTSTRAP' },
      },
    ]);
  });

  it('fails closed for a bootstrap envelope on an unsupported history event', async () => {
    await prisma.userHistory.create({
      data: {
        id: `user:${HISTORY_FEED_PREFIX}invalid-bootstrap`,
        userId: `${HISTORY_FEED_PREFIX}user`,
        event: 'TYPE_CHANGED',
        source: 'BOOTSTRAP',
        occurredAt: new Date('2093-01-01T00:00:00Z'),
        data: {
          schemaVersion: 1,
          recordKind: 'BOOTSTRAP',
          operatorReceipt: 'private',
        },
      },
    });

    await expect(
      service.list({
        from: '2093-01-01',
        to: '2093-01-01',
        page: 1,
        limit: 20,
      }),
    ).rejects.toBeInstanceOf(InvalidAuditLogMetadataError);
  });
});
