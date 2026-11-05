import { PrismaService } from '../src/platform/prisma.service';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import {
  applyTeamMergeFixture,
  dropTeamMergeFixture,
  resetTeamMergeFixture,
  withinTeamMergeFixture,
} from './team-application-merge.fixture';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();

afterAll(async () => {
  await dropTeamMergeFixture(prisma);
  await prisma.$disconnect();
});

it('stores application state on Team after a fresh migration', async () => {
  const columns = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'Team'
      AND column_name IN (
        'answers', 'applicationTemplateVersion', 'applicantId', 'status',
        'submittedAt', 'processedById', 'processedAt', 'rejectionReason',
        'revision', 'repositoryConnectionMode', 'repositoryUrl',
        'isRepositoryPublicationPlanned'
      )
    ORDER BY column_name
  `;
  expect(columns.map((column) => column.column_name)).toEqual([
    'answers',
    'applicantId',
    'applicationTemplateVersion',
    'isRepositoryPublicationPlanned',
    'processedAt',
    'processedById',
    'rejectionReason',
    'repositoryConnectionMode',
    'repositoryUrl',
    'revision',
    'status',
    'submittedAt',
  ]);
});

describe('application data cutover', () => {
  beforeEach(() => resetTeamMergeFixture(prisma));

  it('preserves every event once with review timestamps and rewrites references to the surviving team', async () => {
    await applyTeamMergeFixture(prisma);
    await expect(withinTeamMergeFixture(prisma, (tx) => tx.$queryRaw`
      SELECT (SELECT count(*)::int FROM "Team") AS teams,
        (SELECT count(*)::int FROM "TeamMember") AS members,
        (SELECT count(*)::int FROM "TeamHistory") AS histories,
        (SELECT count(*)::int FROM "TeamHistory" WHERE "sourceTable" = 'ApplicationReviewHistory') AS reviews,
        (SELECT count(*)::int FROM "TeamHistory" WHERE "sourceTable" = 'AuditLog') AS audits,
        (SELECT count(*)::int FROM "TeamHistory" WHERE event = 'DELETED') AS deleted
    `)).resolves.toEqual([{ teams: 33, members: 65, histories: 105, reviews: 9, audits: 64, deleted: 7 }]);
    await expect(withinTeamMergeFixture(prisma, (tx) => tx.$queryRaw`
      SELECT "teamId", "occurredAt", data->>'pairedAuditId' AS paired
      FROM "TeamHistory" WHERE "sourceId" = 'review-approved-1'
    `)).resolves.toEqual([{
      teamId: 'team-1',
      occurredAt: new Date('2026-08-02T00:00:01.000Z'),
      paired: 'audit-approved-1',
    }]);
    await expect(withinTeamMergeFixture(prisma, (tx) => tx.$queryRaw`
      SELECT "teamId" FROM "RepositoryProvisionJob" WHERE id = 'job-1'
    `)).resolves.toEqual([{ teamId: 'team-1' }]);
    await expect(withinTeamMergeFixture(prisma, (tx) => tx.$queryRaw`
      SELECT "aggregateType", "aggregateId", payload, "idempotencyKey" FROM "OutboxEvent" WHERE id = 'event-1'
    `)).resolves.toEqual([{
      aggregateType: 'Team',
      aggregateId: 'team-1',
      payload: { teamId: 'team-1' },
      idempotencyKey: 'repository-provision:team-1',
    }]);
    await expect(withinTeamMergeFixture(prisma, (tx) => tx.$queryRaw`
      SELECT answers, "applicantId", status::text, "applicationTemplateVersion" FROM "Team" WHERE id = 'team-1'
    `)).resolves.toEqual([{
      answers: { title: 'Synthetic answer 1' },
      applicantId: 'user-1',
      status: 'APPROVED',
      applicationTemplateVersion: 2,
    }]);
  });

  it('rejects nine candidate pairs that are not one-to-one and rolls back the migration', async () => {
    await withinTeamMergeFixture(prisma, async (tx) => {
      await tx.$executeRaw`DELETE FROM "AuditLog" WHERE id = 'audit-approved-2'`;
      await tx.$executeRaw`
        INSERT INTO "AuditLog" SELECT 'ambiguous', "targetType", "targetId", action, "actorId", "occurredAt", metadata
        FROM "AuditLog" WHERE id = 'audit-approved-1'
      `;
    });
    await expect(applyTeamMergeFixture(prisma)).rejects.toThrow('exactly 9 one-to-one pairs');
    await expect(withinTeamMergeFixture(prisma, (tx) => tx.$queryRaw`
      SELECT (SELECT count(*)::int FROM "Team") AS teams,
        (SELECT count(*)::int FROM "TeamHistory") AS histories
    `)).resolves.toEqual([{ teams: 40, histories: 25 }]);
  });

  it('rejects a timestamp difference outside the owner-approved one second window', async () => {
    await withinTeamMergeFixture(prisma, (tx) => tx.$executeRaw`
      UPDATE "AuditLog" SET "occurredAt" = "occurredAt" + INTERVAL '2 seconds' WHERE id = 'audit-approved-1'
    `);
    await expect(applyTeamMergeFixture(prisma)).rejects.toThrow('exactly 9 one-to-one pairs');
  });

  it('rejects repository ownership on an applicationless team instead of silently repointing it', async () => {
    await withinTeamMergeFixture(prisma, (tx) => tx.$executeRaw`
      UPDATE "GithubRepository" SET "teamId" = 'team-34' WHERE id = 'repository-7'
    `);
    await expect(applyTeamMergeFixture(prisma)).rejects.toThrow('Existing repository ownership differs');
  });

  it('rejects changed deletion counts before copying or deleting rows', async () => {
    await withinTeamMergeFixture(prisma, (tx) => tx.$executeRaw`
      INSERT INTO "Team" (id,"programId",name,"leaderId") VALUES ('extra','program','Synthetic extra','user-1')
    `);
    await expect(applyTeamMergeFixture(prisma)).rejects.toThrow('baseline count mismatch');
  });
});
