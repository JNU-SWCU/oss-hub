import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Prisma, TeamHistoryEvent } from '@prisma/client';
import type { PrismaService } from '../src/platform/prisma.service';
import { migrationStatements } from './program-authoring-migration-test-support';

const schema = 'team_application_merge_fixture';
const backup = 'team_application_merge_fixture_backup';
const migration = readFileSync(
  resolve(__dirname, 'migrations/20261105100100_merge_applications_into_teams/migration.sql'),
  'utf8',
).replaceAll('program_team_backup', backup);

export async function withinTeamMergeFixture<T>(
  prisma: PrismaService,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
    return operation(transaction);
  }, { timeout: 30_000 });
}

export async function dropTeamMergeFixture(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${backup}" CASCADE`);
}

export async function applyTeamMergeFixture(prisma: PrismaService): Promise<void> {
  await withinTeamMergeFixture(prisma, async (transaction) => {
    for (const statement of migrationStatements(migration))
      await transaction.$executeRawUnsafe(statement);
  });
}

export async function resetTeamMergeFixture(prisma: PrismaService): Promise<void> {
  await dropTeamMergeFixture(prisma);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await withinTeamMergeFixture(prisma, async (tx) => {
    const ddl = `
      CREATE TYPE "ApplicationStatus" AS ENUM ('SUBMITTED','APPROVED','REJECTED');
      CREATE TYPE "RepositoryConnectionMode" AS ENUM ('NEW','OWN');
      CREATE TYPE "HistorySource" AS ENUM ('APPLICATION','MIGRATION','BOOTSTRAP');
      CREATE TYPE "TeamHistoryEvent" AS ENUM (${Object.values(TeamHistoryEvent).map((event) => `'${event}'`).join(',')});
      CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT, login TEXT NOT NULL);
      CREATE TABLE "Team" (
        id TEXT PRIMARY KEY, "programId" TEXT NOT NULL, name TEXT NOT NULL,
        "leaderId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now()
      );
      CREATE TABLE "TeamMember" ("teamId" TEXT NOT NULL REFERENCES "Team"(id), "userId" TEXT NOT NULL);
      CREATE TABLE "TeamInvitation" (id TEXT PRIMARY KEY, "teamId" TEXT NOT NULL);
      CREATE TABLE "Application" (
        id TEXT PRIMARY KEY, "programId" TEXT NOT NULL, "teamId" TEXT NOT NULL,
        "applicantId" TEXT NOT NULL, answers JSONB NOT NULL, "applicationTemplateVersion" INTEGER NOT NULL,
        status "ApplicationStatus" NOT NULL, "isRepositoryPublicationPlanned" BOOLEAN NOT NULL,
        "repositoryConnectionMode" "RepositoryConnectionMode" NOT NULL, "repositoryUrl" TEXT,
        "rejectionReason" TEXT, revision INTEGER NOT NULL, "submittedAt" TIMESTAMP(3) NOT NULL,
        "processedById" TEXT, "processedAt" TIMESTAMP(3),
        CONSTRAINT "Application_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"(id)
      );
      CREATE TABLE "ApplicationReviewHistory" (
        id TEXT PRIMARY KEY, "applicationId" TEXT NOT NULL, "eventKind" TEXT NOT NULL,
        revision INTEGER NOT NULL, "actorId" TEXT NOT NULL, "occurredAt" TIMESTAMP(3) NOT NULL,
        "rejectionReason" TEXT
      );
      CREATE TABLE "AuditLog" (
        id TEXT PRIMARY KEY, "targetType" TEXT NOT NULL, "targetId" TEXT NOT NULL,
        action TEXT NOT NULL, "actorId" TEXT NOT NULL, "occurredAt" TIMESTAMP(3) NOT NULL, metadata JSONB NOT NULL
      );
      CREATE TABLE "TeamHistory" (
        id TEXT PRIMARY KEY, "teamId" TEXT NOT NULL, "programId" TEXT NOT NULL, "actorId" TEXT,
        event "TeamHistoryEvent" NOT NULL, "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
        "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT now(), source "HistorySource" NOT NULL,
        "sourceTable" TEXT, "sourceId" TEXT, data JSONB NOT NULL,
        UNIQUE ("sourceTable", "sourceId"),
        CONSTRAINT "TeamHistory_invitation_data_check" CHECK (
          (data->>'schemaVersion' = '1' AND jsonb_typeof(data->'invitation') = 'object'
            AND jsonb_typeof(data->'invitation'->'id') = 'string'
            AND jsonb_typeof(data->'invitation'->'inviteeId') = 'string'
            AND jsonb_typeof(data->'invitation'->'invitedById') = 'string'
            AND jsonb_typeof(data->'invitation'->'createdAt') = 'string') IS TRUE
        )
      );
      CREATE TABLE "GithubRepository" (id TEXT PRIMARY KEY, "applicationId" TEXT, "teamId" TEXT, "programId" TEXT);
      CREATE TABLE "RepositoryProvisionJob" (id TEXT PRIMARY KEY, "applicationId" TEXT NOT NULL);
      CREATE TABLE "RepositoryIssuanceHistory" (id TEXT PRIMARY KEY, "applicationId" TEXT NOT NULL);
      CREATE TABLE "GithubRepositoryOutsiderContribution" ("repositoryId" TEXT PRIMARY KEY, "applicationId" TEXT NOT NULL);
      CREATE TABLE "MilestoneDocumentSubmission" (id TEXT PRIMARY KEY, "milestoneDocumentId" TEXT NOT NULL, "applicationId" TEXT NOT NULL);
      CREATE TABLE "SubmissionFile" (
        id TEXT PRIMARY KEY, "applicationId" TEXT, "milestoneId" TEXT, lifecycle TEXT NOT NULL,
        "milestoneDocumentSubmissionId" TEXT, "milestoneDocumentSubmissionHistoryId" TEXT,
        "pendingExpiresAt" TIMESTAMP(3), "expiresAt" TIMESTAMP(3),
        CONSTRAINT "SubmissionFile_lifecycle_attachment_check" CHECK (
          lifecycle IN ('DELETE_PENDING', 'DELETED') OR "applicationId" IS NOT NULL
        )
      );
      CREATE TABLE "Notification" (id TEXT PRIMARY KEY, payload JSONB NOT NULL, "idempotencyKey" TEXT NOT NULL);
      CREATE TABLE "OutboxEvent" (
        id TEXT PRIMARY KEY, payload JSONB NOT NULL, "aggregateType" TEXT NOT NULL,
        "aggregateId" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL
      );
    `;
    for (const statement of migrationStatements(ddl)) await tx.$executeRawUnsafe(statement);
    const seed = `
      INSERT INTO "User" SELECT 'user-' || n, 'Synthetic ' || n, 'synthetic-' || n FROM generate_series(1,72) n;
      INSERT INTO "Team" (id,"programId",name,"leaderId")
        SELECT 'team-' || n, 'program', 'Synthetic team ' || n, 'user-' || n FROM generate_series(1,40) n;
      INSERT INTO "TeamMember"
        SELECT 'team-' || CASE WHEN n <= 40 THEN n ELSE n-40 END, 'user-' || n FROM generate_series(1,72) n;
      INSERT INTO "TeamInvitation" SELECT 'invitation-' || n, 'team-1' FROM generate_series(1,3) n;
      INSERT INTO "Application"
        SELECT 'application-' || n, 'program', 'team-' || n, 'user-' || n,
          jsonb_build_object('title','Synthetic answer ' || n), 2,
          (CASE WHEN n <= 30 THEN 'APPROVED' ELSE 'REJECTED' END)::"ApplicationStatus",
          TRUE, 'NEW', NULL, CASE WHEN n > 30 THEN 'Preserved reason' ELSE NULL END,
          1, TIMESTAMP '2026-08-01' + n * INTERVAL '1 second', 'user-72', TIMESTAMP '2026-08-02'
        FROM generate_series(1,33) n;
      INSERT INTO "ApplicationReviewHistory"
        SELECT 'review-approved-' || n, 'application-' || n, 'APPROVED', 1, 'user-72',
          TIMESTAMP '2026-08-02' + n * INTERVAL '1 second', NULL FROM generate_series(1,5) n;
      INSERT INTO "ApplicationReviewHistory"
        SELECT 'review-submitted-' || n, 'application-' || n, 'SUBMITTED', 1, 'user-72',
          TIMESTAMP '2026-08-01' + n * INTERVAL '1 second', NULL FROM generate_series(1,4) n;
      INSERT INTO "AuditLog"
        SELECT 'audit-approved-' || n, 'APPLICATION', 'application-' || n, 'APPLICATION_APPROVED', 'user-72',
          TIMESTAMP '2026-08-02' + n * INTERVAL '1 second' + INTERVAL '4 milliseconds', '{}'::JSONB
        FROM generate_series(1,33) n;
      INSERT INTO "AuditLog"
        SELECT 'audit-submitted-' || n, 'APPLICATION', 'application-' || n, 'APPLICATION_SUBMITTED', 'user-72',
          TIMESTAMP '2026-08-01' + n * INTERVAL '1 second' + INTERVAL '4 milliseconds', '{}'::JSONB
        FROM generate_series(1,30) n;
      INSERT INTO "AuditLog"
        SELECT 'audit-' || action || '-' || n, 'APPLICATION', 'application-' || n,
          'APPLICATION_' || action, 'user-72', TIMESTAMP '2026-08-03', '{}'::JSONB
        FROM generate_series(10,13) n CROSS JOIN (VALUES ('REJECTED'),('REVERTED')) actions(action);
      INSERT INTO "AuditLog"
        SELECT 'audit-url-' || n, 'APPLICATION', 'application-' || n, 'APPLICATION_REPOSITORY_URL_CHANGED',
          'user-72', TIMESTAMP '2026-08-04', '{"before":{"repositoryUrl":null},"after":{"repositoryUrl":"https://github.com/synthetic/repository"}}'::JSONB
        FROM generate_series(1,2) n;
      INSERT INTO "TeamHistory" (id,"teamId","programId",event,source,"sourceTable","sourceId",data)
        SELECT 'prior-history-' || n, 'team-1', 'program', 'INVITATION_ARCHIVED', 'MIGRATION', 'TeamInvitation',
          'prior-invitation-' || n, jsonb_build_object('schemaVersion',1,'invitation',jsonb_build_object(
            'id','prior-invitation-' || n,'inviteeId','user-1','invitedById','user-2','createdAt','2026-08-01T00:00:00.000Z'))
        FROM generate_series(1,25) n;
      INSERT INTO "GithubRepository" SELECT 'repository-' || n,'application-' || n,'team-' || n,'program' FROM generate_series(1,7) n;
      INSERT INTO "RepositoryProvisionJob" SELECT 'job-' || n,'application-' || n FROM generate_series(1,7) n;
      INSERT INTO "GithubRepositoryOutsiderContribution" SELECT 'repository-' || n,'application-' || n FROM generate_series(1,3) n;
      INSERT INTO "MilestoneDocumentSubmission"
        SELECT 'submission-' || n,'document-' || n,'application-' || (1 + (n % 33)) FROM generate_series(1,55) n;
      INSERT INTO "SubmissionFile" (id,"applicationId",lifecycle)
        SELECT 'file-' || n,CASE WHEN n <= 76 THEN 'application-' || (1 + (n % 33)) ELSE NULL END,
          'DELETE_PENDING' FROM generate_series(1,81) n;
      INSERT INTO "Notification"
        SELECT 'notification-' || n,jsonb_build_object('applicationId','application-' || (1 + (n % 33))),
          'application-decision:application-' || (1 + (n % 33)) || ':' || n FROM generate_series(1,56) n;
      INSERT INTO "OutboxEvent"
        SELECT 'event-' || n,jsonb_build_object('applicationId','application-' || n,'teamId','team-' || n),
          'Application','application-' || n,'repository-provision:application-' || n FROM generate_series(1,5) n;
    `;
    for (const statement of migrationStatements(seed)) await tx.$executeRawUnsafe(statement);
  });
}
