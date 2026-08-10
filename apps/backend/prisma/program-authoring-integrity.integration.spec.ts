import { PrismaService } from '../src/prisma/prisma.service';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import {
  columnExists,
  executeProgramAuthoringMigration,
  inProgramAuthoringFixtureSchema,
  resetProgramAuthoringFixture,
} from './program-authoring-migration-test-support';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const SCHEMA = 'program_authoring_integrity_fixture';
const HASH = 'a'.repeat(64);
const prisma = new PrismaService();

beforeEach(async () => {
  await resetProgramAuthoringFixture(prisma, SCHEMA);
  await inProgramAuthoringFixtureSchema(
    prisma,
    SCHEMA,
    executeProgramAuthoringMigration,
  );
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await prisma.$disconnect();
});

function insertUpload(values: string): Promise<number> {
  return inProgramAuthoringFixtureSchema(prisma, SCHEMA, (transaction) =>
    transaction.$executeRawUnsafe(`
      INSERT INTO "ProgramAuthoringUpload" (
        "id", "actorId", "storageKey", "originalFileName", "mimeType", "sizeBytes",
        "sha256", "lifecycle", "expiresAt", "attachedAt", "deleteClaimedAt",
        "deleteClaimExpiresAt", "deleteClaimOwner", "deleteAttemptCount",
        "nextDeleteAttemptAt", "lastDeleteError", "deletedAt", "updatedAt"
      ) VALUES (${values})
    `),
  );
}

it('rejects malformed hashes and empty or oversized idempotency keys', async () => {
  await expect(
    inProgramAuthoringFixtureSchema(prisma, SCHEMA, (transaction) =>
      transaction.$executeRawUnsafe(`
        INSERT INTO "ProgramCreateRequest" (
          "id", "actorId", "idempotencyKey", "payloadHash", "programId"
        ) VALUES ('request-invalid', 'actor-1', '', '${'G'.repeat(64)}', 'program-1')
      `),
    ),
  ).rejects.toBeDefined();

  await expect(
    inProgramAuthoringFixtureSchema(prisma, SCHEMA, (transaction) =>
      transaction.$executeRawUnsafe(`
        INSERT INTO "ProgramCreateRequest" (
          "id", "actorId", "idempotencyKey", "payloadHash", "programId"
        ) VALUES ('request-long', 'actor-1', '${'k'.repeat(129)}', '${HASH}', 'program-1')
      `),
    ),
  ).rejects.toBeDefined();

  await expect(
    insertUpload(
      `'upload-hash', 'actor-1', 'authoring/upload-hash', 'file.pdf',
       'application/pdf', 10, '${'A'.repeat(64)}', 'PENDING',
       NOW() + INTERVAL '1 day', NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, NOW()`,
    ),
  ).rejects.toBeDefined();
});

it('rejects oversized files and noncanonical delete leases', async () => {
  await expect(
    insertUpload(
      `'upload-large', 'actor-1', 'authoring/upload-large', 'file.pdf',
       'application/pdf', 5242881, '${HASH}', 'PENDING',
       NOW() + INTERVAL '1 day', NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, NOW()`,
    ),
  ).rejects.toBeDefined();

  await expect(
    insertUpload(
      `'upload-short-lease', 'actor-1', 'authoring/upload-short-lease', 'file.pdf',
       'application/pdf', 10, '${HASH}', 'DELETE_PENDING',
       NOW() + INTERVAL '1 day', NULL, NOW(), NOW() + INTERVAL '5 minutes',
       'worker-1', 1, NOW(), 'OBJECT_NOT_FOUND', NULL, NOW()`,
    ),
  ).rejects.toBeDefined();
});

it('enforces the universal Program team range after migration', async () => {
  await expect(
    inProgramAuthoringFixtureSchema(
      prisma,
      SCHEMA,
      (transaction) =>
        transaction.$executeRaw`UPDATE "Program" SET "teamMinSize" = 3, "teamMaxSize" = 2 WHERE "id" = 'program-1'`,
    ),
  ).rejects.toBeDefined();
});

it.each([
  [
    'ATTACHED without attachment metadata',
    `'upload-attached', 'actor-1', 'authoring/upload-attached', 'file.pdf',
     'application/pdf', 10, '${HASH}', 'ATTACHED', NOW() + INTERVAL '1 day',
     NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, NOW()`,
  ],
  [
    'DELETED without deletedAt',
    `'upload-deleted', 'actor-1', 'authoring/upload-deleted', 'file.pdf',
     'application/pdf', 10, '${HASH}', 'DELETED', NOW() + INTERVAL '1 day',
     NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, NOW()`,
  ],
  [
    'partial delete claim',
    `'upload-claim', 'actor-1', 'authoring/upload-claim', 'file.pdf',
     'application/pdf', 10, '${HASH}', 'DELETE_PENDING', NOW() + INTERVAL '1 day',
     NULL, NOW(), NULL, 'worker-1', 0, NOW(), NULL, NULL, NOW()`,
  ],
  [
    'unbounded retry and provider detail',
    `'upload-retry', 'actor-1', 'authoring/upload-retry', 'file.pdf',
     'application/pdf', 10, '${HASH}', 'DELETE_PENDING', NOW() + INTERVAL '1 day',
     NULL, NULL, NULL, NULL, 7, NOW(), 'provider object missing: raw detail', NULL, NOW()`,
  ],
] as const)('rejects %s lifecycle rows', async (_case, values) => {
  await expect(insertUpload(values)).rejects.toBeDefined();
});

it('links ATTACHED uploads to a same-actor create request', async () => {
  await expect(
    columnExists(prisma, SCHEMA, 'ProgramAuthoringUpload', 'createRequestId'),
  ).resolves.toBe(true);

  await inProgramAuthoringFixtureSchema(prisma, SCHEMA, (transaction) =>
    transaction.$executeRawUnsafe(`
      INSERT INTO "ProgramCreateRequest" (
        "id", "actorId", "idempotencyKey", "payloadHash", "programId"
      ) VALUES ('request-1', 'actor-1', 'request-key', '${HASH}', 'program-1')
    `),
  );

  await expect(
    inProgramAuthoringFixtureSchema(prisma, SCHEMA, (transaction) =>
      transaction.$executeRawUnsafe(`
        INSERT INTO "ProgramAuthoringUpload" (
          "id", "actorId", "storageKey", "originalFileName", "mimeType", "sizeBytes",
          "sha256", "lifecycle", "expiresAt", "attachedAt", "createRequestId",
          "createRequestActorId", "deleteAttemptCount", "updatedAt"
        ) VALUES (
          'upload-valid', 'actor-1', 'authoring/upload-valid', 'file.pdf',
          'application/pdf', 10, '${HASH}', 'ATTACHED', NOW() + INTERVAL '1 day',
          NOW(), 'request-1', 'actor-1', 0, NOW()
        )
      `),
    ),
  ).resolves.toBe(1);

  await expect(
    inProgramAuthoringFixtureSchema(prisma, SCHEMA, (transaction) =>
      transaction.$executeRawUnsafe(`
        INSERT INTO "ProgramAuthoringUpload" (
          "id", "actorId", "storageKey", "originalFileName", "mimeType", "sizeBytes",
          "sha256", "lifecycle", "expiresAt", "attachedAt", "createRequestId",
          "createRequestActorId", "deleteAttemptCount", "updatedAt"
        ) VALUES (
          'upload-foreign', 'actor-2', 'authoring/upload-foreign', 'file.pdf',
          'application/pdf', 10, '${HASH}', 'ATTACHED', NOW() + INTERVAL '1 day',
          NOW(), 'request-1', 'actor-1', 0, NOW()
        )
      `),
    ),
  ).rejects.toBeDefined();
});
