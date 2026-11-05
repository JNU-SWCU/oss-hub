import { TeamHistoryEvent } from '@prisma/client';
import type { PrismaService } from '../src/platform/prisma.service';
import {
  inProgramAuthoringFixtureSchema,
  migrationStatements,
} from './program-authoring-migration-test-support';

export const AUDIT_FIXTURE_SCHEMA = 'audit_log_removal_fixture';
export const AUDIT_FIXTURE_BACKUP_SCHEMA = 'audit_log_removal_fixture_backup';

type FixtureOperation<T> = Parameters<
  typeof inProgramAuthoringFixtureSchema<T>
>[2];

export const inAuditFixture = <T>(
  prisma: PrismaService,
  operation: FixtureOperation<T>,
) => inProgramAuthoringFixtureSchema(prisma, AUDIT_FIXTURE_SCHEMA, operation);

export const bindAuditFixtureSql = (sql: string) =>
  sql.replaceAll('program_team_backup', AUDIT_FIXTURE_BACKUP_SCHEMA);

export async function applyAuditFixtureSql(
  prisma: PrismaService,
  sql: string,
): Promise<void> {
  await inAuditFixture(prisma, async (transaction) => {
    for (const statement of migrationStatements(bindAuditFixtureSql(sql)))
      await transaction.$executeRawUnsafe(statement);
  });
}

export async function dropAuditFixture(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    `DROP SCHEMA IF EXISTS "${AUDIT_FIXTURE_SCHEMA}" CASCADE`,
  );
  await prisma.$executeRawUnsafe(
    `DROP SCHEMA IF EXISTS "${AUDIT_FIXTURE_BACKUP_SCHEMA}" CASCADE`,
  );
}

const EVENTS_ADDED_BY_PREPARE: readonly TeamHistoryEvent[] = [
  TeamHistoryEvent.CREATED,
  TeamHistoryEvent.JOINED,
  TeamHistoryEvent.REPOSITORY_PUBLISHED,
];

const SOURCE_STRUCTURE = `
  CREATE TYPE "HistorySource" AS ENUM ('APPLICATION','MIGRATION','BOOTSTRAP');
  CREATE TYPE "TeamHistoryEvent" AS ENUM (${Object.values(TeamHistoryEvent)
    .filter((event) => !EVENTS_ADDED_BY_PREPARE.includes(event))
    .map((event) => `'${event}'`)
    .join(',')});
  CREATE TABLE "User" (id TEXT PRIMARY KEY, login TEXT NOT NULL);
  CREATE TABLE "Program" (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE "Team" (id TEXT PRIMARY KEY, "programId" TEXT NOT NULL, name TEXT NOT NULL);
  CREATE TABLE "GithubRepository" (id TEXT PRIMARY KEY, "teamId" TEXT);
  CREATE TABLE "AuditLog" (
    id TEXT PRIMARY KEY, "actorId" TEXT NOT NULL, action TEXT NOT NULL, "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL, metadata JSONB NOT NULL, "occurredAt" TIMESTAMP(3) NOT NULL
  );
  CREATE FUNCTION reject_audit_log_mutation() RETURNS TRIGGER AS $$
  BEGIN
    RAISE EXCEPTION 'AuditLog is append-only: % is not allowed', TG_OP;
  END;
  $$ LANGUAGE plpgsql;
  CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON "AuditLog"
    FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_log_mutation();
  CREATE TABLE "UserHistory" (id TEXT PRIMARY KEY, "sourceTable" TEXT, "sourceId" TEXT);
  CREATE TABLE "AdminHistory" (id TEXT PRIMARY KEY, "sourceTable" TEXT, "sourceId" TEXT);
  CREATE TABLE "TeamHistory" (
    id TEXT PRIMARY KEY, "teamId" TEXT NOT NULL, "programId" TEXT NOT NULL, "actorId" TEXT,
    event "TeamHistoryEvent" NOT NULL, "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT now(), source "HistorySource" NOT NULL,
    "sourceTable" TEXT, "sourceId" TEXT, data JSONB NOT NULL,
    UNIQUE ("sourceTable", "sourceId"),
    CONSTRAINT "TeamHistory_event_data_check" CHECK (data->>'schemaVersion' = '1')
  );
  CREATE SCHEMA "${AUDIT_FIXTURE_BACKUP_SCHEMA}";
  CREATE TABLE "${AUDIT_FIXTURE_BACKUP_SCHEMA}".application_team_map (
    "applicationId" TEXT PRIMARY KEY, "teamId" TEXT NOT NULL, "programId" TEXT NOT NULL
  );
`;

const ROW =
  (
    id: string,
    targetType: string,
    targetId: string,
    action: string,
    metadata: Record<string, unknown> = {},
  ) =>
  (second: number) =>
    `('${id}', 'user-actor', '${action}', '${targetType}', '${targetId}', '${JSON.stringify(metadata)}', TIMESTAMP '2026-09-01 00:00:00' + INTERVAL '${second} second')`;

const AUDIT_ROWS: readonly ((second: number) => string)[] = [
  ROW(
    'copied-application',
    'APPLICATION',
    'application-mapped',
    'APPLICATION_SUBMITTED',
  ),
  ROW(
    'paired-application',
    'APPLICATION',
    'application-mapped',
    'APPLICATION_APPROVED',
  ),
  ROW(
    'orphan-application',
    'APPLICATION',
    'application-unknown',
    'APPLICATION_SUBMITTED',
  ),
  ROW('team-created', 'TEAM', 'team-live', 'TEAM_CREATED', {
    schemaVersion: 1,
    programName: 'Live Program',
    teamName: 'Live Team',
  }),
  ROW('team-joined', 'TEAM', 'team-live', 'TEAM_JOINED', {
    schemaVersion: 1,
    programName: 'Live Program',
    teamName: 'Live Team',
  }),
  ROW('team-renamed', 'TEAM', 'team-live', 'TEAM_RENAMED', {
    schemaVersion: 1,
    programName: 'Live Program',
    teamName: 'Live Team',
    previousName: 'Old Team',
  }),
  ROW('team-left', 'TEAM', 'team-live', 'TEAM_MEMBERSHIP_CHANGED', {
    operation: 'LEAVE',
  }),
  ROW('team-removed', 'TEAM', 'team-live', 'TEAM_MEMBERSHIP_CHANGED', {
    operation: 'REMOVE',
  }),
  ROW('team-transferred', 'TEAM', 'team-live', 'TEAM_MEMBERSHIP_CHANGED', {
    operation: 'TRANSFER_LEADER',
  }),
  ROW('team-empty-metadata', 'TEAM', 'team-live', 'TEAM_JOINED'),
  ROW('team-gone', 'TEAM', 'team-gone', 'TEAM_JOINED'),
  ROW('team-deleted', 'TEAM', 'team-gone', 'TEAM_DELETED', {
    programName: 'Live Program',
    teamName: 'Gone Team',
  }),
  ROW('team-deleted-no-program', 'TEAM', 'team-gone', 'TEAM_DELETED', {
    programName: 'Nobody',
  }),
  ROW('team-deleted-twin-program', 'TEAM', 'team-gone', 'TEAM_DELETED', {
    programName: 'Twin Program',
  }),
  ROW('program-created', 'PROGRAM', 'program-live', 'PROGRAM_CREATED', {
    schemaVersion: 1,
    programName: 'Live Program',
  }),
  ROW('program-created-gone', 'PROGRAM', 'program-gone', 'PROGRAM_CREATED'),
  ROW('program-archived-gone', 'PROGRAM', 'program-gone', 'PROGRAM_ARCHIVED'),
  ROW('program-deleted', 'PROGRAM', 'program-gone', 'PROGRAM_DELETED', {
    schemaVersion: 1,
    programName: 'Gone Program',
  }),
  ROW(
    'repository-published',
    'REPOSITORY',
    'repository-with-team',
    'REPOSITORY_PUBLISHED',
    { schemaVersion: 2, repositoryFullName: 'org/live' },
  ),
  ROW(
    'repository-no-team',
    'REPOSITORY',
    'repository-no-team',
    'REPOSITORY_PUBLISHED',
  ),
  ROW(
    'repository-gone',
    'REPOSITORY',
    'repository-gone',
    'REPOSITORY_PUBLISHED',
  ),
  ROW('user-imported', 'USER', 'user-target', 'USER_PROFILE_UPDATED'),
  ROW('role-imported', 'ROLE_REQUEST', 'request-1', 'ROLE_REQUEST_APPROVED'),
  ROW('user-gone', 'USER', 'user-gone', 'USER_PROFILE_UPDATED'),
  ROW(
    'collection-sync',
    'COLLECTION_SYNC',
    'sync-1',
    'COLLECTION_SYNC_TRIGGERED',
  ),
  ROW(
    'submission-file',
    'SUBMISSION_FILE',
    'file-1',
    'SUBMISSION_FILE_RETRY_RESET',
  ),
];

export const COPIED_TEAM_ROWS = [
  ['team-created', 'team-live', 'program-live', 'CREATED'],
  ['team-deleted', 'team-gone', 'program-live', 'DELETED'],
  ['team-empty-metadata', 'team-live', 'program-live', 'JOINED'],
  ['team-joined', 'team-live', 'program-live', 'JOINED'],
  ['team-left', 'team-live', 'program-live', 'MEMBER_LEFT'],
  ['team-removed', 'team-live', 'program-live', 'MEMBER_REMOVED'],
  ['team-renamed', 'team-live', 'program-live', 'RENAMED'],
  ['team-transferred', 'team-live', 'program-live', 'LEADER_TRANSFERRED'],
  ['repository-published', 'team-live', 'program-live', 'REPOSITORY_PUBLISHED'],
] as const;

export const COPIED_PROGRAM_ROWS = [
  ['program-created', 'program-live', 'CREATED'],
  ['program-deleted', 'program-gone', 'DELETED'],
] as const;

export const SEED_SQL = `
  INSERT INTO "User" VALUES ('user-actor', 'actor'), ('user-target', 'target');
  INSERT INTO "Program" VALUES
    ('program-live', 'Live Program'), ('twin-1', 'Twin Program'), ('twin-2', 'Twin Program');
  INSERT INTO "Team" VALUES ('team-live', 'program-live', 'Live Team');
  INSERT INTO "GithubRepository" VALUES
    ('repository-with-team', 'team-live'), ('repository-no-team', NULL);
  INSERT INTO "${AUDIT_FIXTURE_BACKUP_SCHEMA}".application_team_map VALUES
    ('application-mapped', 'team-live', 'program-live');
  INSERT INTO "TeamHistory" (id, "teamId", "programId", "actorId", event, source, "sourceTable", "sourceId", data) VALUES
    ('application-audit:copied-application', 'team-live', 'program-live', 'user-actor', 'SUBMITTED',
      'MIGRATION', 'AuditLog', 'copied-application', '{"schemaVersion":1,"applicationId":"application-mapped","metadata":{}}'),
    ('review-1', 'team-live', 'program-live', 'user-actor', 'APPROVED', 'MIGRATION',
      'ApplicationReviewHistory', 'review-1', '{"schemaVersion":1,"revision":1,"rejectionReason":null,"applicationId":"application-mapped","pairedAuditId":"paired-application","pairedAuditMetadata":{}}');
  INSERT INTO "UserHistory" VALUES ('imported-user', 'AuditLog', 'user-imported');
  INSERT INTO "AdminHistory" VALUES ('imported-role', 'AuditLog', 'role-imported');
  INSERT INTO "AuditLog" (id, "actorId", action, "targetType", "targetId", metadata, "occurredAt") VALUES
    ${AUDIT_ROWS.map((row, second) => row(second)).join(',\n    ')};
`;

export async function resetAuditFixture(prisma: PrismaService): Promise<void> {
  await dropAuditFixture(prisma);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${AUDIT_FIXTURE_SCHEMA}"`);
  await inAuditFixture(prisma, async (transaction) => {
    for (const statement of migrationStatements(SOURCE_STRUCTURE))
      await transaction.$executeRawUnsafe(statement);
    for (const statement of migrationStatements(SEED_SQL))
      await transaction.$executeRawUnsafe(statement);
  });
}
