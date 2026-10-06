import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const TEST_PREFIX = 'test:audit-log:append-only:';

describe('AuditLog append-only database enforcement', () => {
  const prisma = new PrismaService();

  beforeAll(async () => {
    await prisma.$connect();
    const actor = await prisma.user.create({
      data: {
        id: `${TEST_PREFIX}actor`,
        githubId: 9_402_000_001n,
        nickname: 'synthetic-audit-actor',
        hasAdminAccess: true,
      },
    });
    await prisma.auditLog.createMany({
      data: ['update', 'delete', 'truncate'].map((operation) => ({
        id: `${TEST_PREFIX}${operation}`,
        actorId: actor.id,
        action: 'SYNTHETIC_APPEND_ONLY_PROBE',
        targetType: 'SYNTHETIC',
        targetId: operation,
        metadata: {},
      })),
    });
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('raw SQL UPDATE를 거부한다', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "AuditLog" SET "action" = 'MUTATED' WHERE "id" = '${TEST_PREFIX}update'`,
      ),
    ).rejects.toThrow(/AuditLog is append-only/);
  });

  it('raw SQL DELETE를 거부한다', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `DELETE FROM "AuditLog" WHERE "id" = '${TEST_PREFIX}delete'`,
      ),
    ).rejects.toThrow(/AuditLog is append-only/);
  });

  it('raw SQL TRUNCATE를 거부한다', async () => {
    await expect(
      prisma.$executeRawUnsafe('TRUNCATE TABLE "AuditLog"'),
    ).rejects.toThrow(/AuditLog is append-only/);
  });
});
