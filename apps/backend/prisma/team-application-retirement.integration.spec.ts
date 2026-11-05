import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../src/platform/prisma.service';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import { migrationStatements } from './program-authoring-migration-test-support';
import { applyTeamMergeFixture, dropTeamMergeFixture, resetTeamMergeFixture, withinTeamMergeFixture } from './team-application-merge.fixture';

assertIsolatedIntegrationDatabase({ databaseUrl: process.env.DATABASE_URL, runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER });
const prisma = new PrismaService();
const retirement = readFileSync(resolve(__dirname, 'migrations/20261105110000_retire_application_storage/migration.sql'), 'utf8').replaceAll('program_team_backup', 'team_application_merge_fixture_backup');

async function retire(): Promise<void> {
  await withinTeamMergeFixture(prisma, async tx => { for (const statement of migrationStatements(retirement)) await tx.$executeRawUnsafe(statement); });
}
async function keptCounts(tx: Prisma.TransactionClient): Promise<readonly { teams: number; members: number; histories: number; files: number }[]> {
  return tx.$queryRaw`SELECT (SELECT count(*)::int FROM "Team") AS teams, (SELECT count(*)::int FROM "TeamMember") AS members, (SELECT count(*)::int FROM "TeamHistory") AS histories, (SELECT count(*)::int FROM "SubmissionFile") AS files`;
}
beforeAll(async () => { await prisma.$connect(); });
beforeEach(async () => { await resetTeamMergeFixture(prisma); });
afterAll(async () => { await dropTeamMergeFixture(prisma); await prisma.$disconnect(); });

it('retires a fresh empty fixture after A without dropping the Team model', async () => {
  await withinTeamMergeFixture(prisma, tx => tx.$executeRawUnsafe('TRUNCATE TABLE "ApplicationReviewHistory", "AuditLog", "Application", "TeamHistory", "TeamMember", "TeamInvitation", "GithubRepository", "RepositoryProvisionJob", "RepositoryIssuanceHistory", "GithubRepositoryOutsiderContribution", "MilestoneDocumentSubmission", "SubmissionFile", "Notification", "OutboxEvent", "Team", "User" CASCADE'));
  await applyTeamMergeFixture(prisma);
  await retire();
  await expect(withinTeamMergeFixture(prisma, tx => tx.$queryRaw`SELECT to_regclass('"Application"') IS NULL AS application_absent, to_regclass('"ApplicationReviewHistory"') IS NULL AS review_absent, to_regclass('"Team"') IS NOT NULL AS team_present`)).resolves.toEqual([{ application_absent: true, review_absent: true, team_present: true }]);
});

it('drops the migrated source tables and legacy columns while preserving current rows', async () => {
  await applyTeamMergeFixture(prisma);
  const before = await withinTeamMergeFixture(prisma, keptCounts);
  await retire();
  await expect(withinTeamMergeFixture(prisma, keptCounts)).resolves.toEqual(before);
  await expect(withinTeamMergeFixture(prisma, tx => tx.$queryRaw`SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema = current_schema() AND (column_name = 'applicationId' OR (table_name='GithubRepository' AND column_name='programId'))`)).resolves.toEqual([{ count: 0 }]);
  await expect(withinTeamMergeFixture(prisma, tx => tx.$queryRaw`SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='Team' AND column_name IN ('answers','applicationTemplateVersion','applicantId','status','isRepositoryPublicationPlanned','repositoryConnectionMode','revision','submittedAt') AND is_nullable='NO'`)).resolves.toEqual([{ count: 8 }]);
});

const corruptions = [
  ['lost review actor', `UPDATE "TeamHistory" SET "actorId"=NULL WHERE id=(SELECT id FROM "TeamHistory" WHERE "sourceTable"='ApplicationReviewHistory' ORDER BY id LIMIT 1)`, 'review history mismatch'],
  ['same-count wrong paired ID', `UPDATE "TeamHistory" SET data=jsonb_set(data,'{pairedAuditId}','"missing-audit"'::jsonb) WHERE id=(SELECT id FROM "TeamHistory" WHERE "sourceTable"='ApplicationReviewHistory' ORDER BY id LIMIT 1)`, 'paired audit mismatch'],
  ['changed paired timestamp', `UPDATE "TeamHistory" SET data=jsonb_set(data,'{pairedAuditOccurredAt}','"2099-01-01T00:00:00"'::jsonb) WHERE id=(SELECT id FROM "TeamHistory" WHERE "sourceTable"='ApplicationReviewHistory' ORDER BY id LIMIT 1)`, 'paired audit mismatch'],
  ['changed paired metadata', `UPDATE "TeamHistory" SET data=jsonb_set(data,'{pairedAuditMetadata}','{"changed":true}'::jsonb) WHERE id=(SELECT id FROM "TeamHistory" WHERE "sourceTable"='ApplicationReviewHistory' ORDER BY id LIMIT 1)`, 'paired audit mismatch'],
  ['changed paired source event', `UPDATE "AuditLog" SET action='APPLICATION_REJECTED' WHERE id=(SELECT data->>'pairedAuditId' FROM "TeamHistory" WHERE "sourceTable"='ApplicationReviewHistory' AND event='APPROVED' ORDER BY id LIMIT 1)`, 'paired audit cardinality mismatch'],
  ['lost unpaired audit actor', `UPDATE "TeamHistory" SET "actorId"=NULL WHERE id=(SELECT id FROM "TeamHistory" WHERE "sourceTable"='AuditLog' ORDER BY id LIMIT 1)`, 'copied audit mismatch'],
  ['changed unpaired audit metadata', `UPDATE "TeamHistory" SET data=jsonb_set(data,'{metadata}','{"changed":true}'::jsonb) WHERE id=(SELECT id FROM "TeamHistory" WHERE "sourceTable"='AuditLog' ORDER BY id LIMIT 1)`, 'copied audit mismatch'],
] as const;

it.each(corruptions)('aborts retirement for %s and preserves both source tables', async (_name, sql, expected) => {
  await applyTeamMergeFixture(prisma);
  await withinTeamMergeFixture(prisma, tx => tx.$executeRawUnsafe(sql));
  const before = await withinTeamMergeFixture(prisma, keptCounts);
  await expect(retire()).rejects.toThrow(expected);
  await expect(withinTeamMergeFixture(prisma, keptCounts)).resolves.toEqual(before);
  await expect(withinTeamMergeFixture(prisma, tx => tx.$queryRaw`SELECT (SELECT count(*)::int FROM "Application") AS applications, (SELECT count(*)::int FROM "ApplicationReviewHistory") AS reviews`)).resolves.toEqual([{ applications: 33, reviews: 9 }]);
});
