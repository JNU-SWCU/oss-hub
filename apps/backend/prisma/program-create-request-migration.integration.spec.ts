import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService } from '../src/platform/prisma.service';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import {
  columnExists,
  executeProgramAuthoringMigration,
  inProgramAuthoringFixtureSchema,
  migrationStatements,
  relationExists,
  resetProgramAuthoringFixture,
} from './program-authoring-migration-test-support';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const schema = 'program_absorption_fixture';
const hash = 'a'.repeat(64);
const migration = readFileSync(
  resolve(
    __dirname,
    'migrations/20261104050000_prepare_program_absorption/migration.sql',
  ),
  'utf8',
);
const retirement = readFileSync(
  resolve(
    __dirname,
    'migrations/20261104050100_retire_program_creation_request/migration.sql',
  ),
  'utf8',
);

beforeEach(async () => {
  await resetProgramAuthoringFixture(prisma, schema);
  await inProgramAuthoringFixtureSchema(prisma, schema, async (tx) => {
    await executeProgramAuthoringMigration(tx);
    await tx.$executeRawUnsafe(
      `CREATE TYPE "ProgramLifecycle" AS ENUM ('PUBLISHED', 'ARCHIVED')`,
    );
    await tx.$executeRawUnsafe(
      `ALTER TABLE "Program" ADD COLUMN lifecycle "ProgramLifecycle" NOT NULL DEFAULT 'PUBLISHED'`,
    );
    await tx.$executeRaw`
      INSERT INTO "ProgramCreateRequest" (id, "actorId", "idempotencyKey", "payloadHash", "programId")
      VALUES ('request-1', 'actor-1', 'original-key', ${hash}, 'program-1')
    `;
    await tx.$executeRaw`
      INSERT INTO "ProgramAuthoringUpload" (
        id, "actorId", "storageKey", "originalFileName", "mimeType", "sizeBytes",
        sha256, lifecycle, "expiresAt", "attachedAt", "createRequestActorId", "createRequestId", "updatedAt"
      ) VALUES (
        'upload-1', 'actor-1', 'migration/upload-1', 'template.pdf', 'application/pdf', 10,
        ${hash}, 'ATTACHED', NOW() + INTERVAL '1 day', NOW(), 'actor-1', 'request-1', NOW()
      )
    `;
  });
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await prisma.$disconnect();
});

async function prepare() {
  await inProgramAuthoringFixtureSchema(prisma, schema, async (tx) => {
    for (const statement of migrationStatements(migration)) {
      await tx.$executeRawUnsafe(statement);
    }
  });
}

async function retire() {
  await inProgramAuthoringFixtureSchema(prisma, schema, async (tx) => {
    for (const statement of migrationStatements(retirement)) {
      await tx.$executeRawUnsafe(statement);
    }
  });
}

it('preserves creation facts and attachment identity while the old app remains writable', async () => {
  await prepare();

  await inProgramAuthoringFixtureSchema(prisma, schema, async (tx) => {
    await expect(tx.$queryRaw`
      SELECT "createdBy"::text AS "createdBy", "createdById", "idempotencyKey", "payloadHash" FROM "Program" WHERE id = 'program-1'
    `).resolves.toEqual([
      {
        createdBy: 'USER',
        createdById: 'actor-1',
        idempotencyKey: 'original-key',
        payloadHash: hash,
      },
    ]);
    await expect(tx.$queryRaw`
      SELECT id, "programId", "createRequestId" FROM "ProgramAuthoringUpload" WHERE id = 'upload-1'
    `).resolves.toEqual([
      { id: 'upload-1', programId: 'program-1', createRequestId: 'request-1' },
    ]);
    await tx.$executeRaw`
      UPDATE "ProgramCreateRequest" SET "payloadHash" = ${'b'.repeat(64)} WHERE id = 'request-1'
    `;
    await expect(
      tx.$queryRaw`SELECT "payloadHash" FROM "Program" WHERE id = 'program-1'`,
    ).resolves.toEqual([{ payloadHash: 'b'.repeat(64) }]);
  });
});

it('keeps unknown creator provenance explicit instead of fabricating a user', async () => {
  await inProgramAuthoringFixtureSchema(prisma, schema, async (tx) => {
    await tx.$executeRaw`DELETE FROM "ProgramAuthoringUpload"`;
    await tx.$executeRaw`DELETE FROM "ProgramCreateRequest"`;
  });
  await prepare();
  await inProgramAuthoringFixtureSchema(prisma, schema, async (tx) => {
    await expect(tx.$queryRaw`
      SELECT "createdBy"::text AS "createdBy", "createdById", "idempotencyKey", "payloadHash" FROM "Program"
    `).resolves.toEqual([
      {
        createdBy: 'LEGACY_UNKNOWN',
        createdById: null,
        idempotencyKey: null,
        payloadHash: null,
      },
    ]);
  });
});

it('enforces direct Program ownership and keeps file metadata after byte deletion', async () => {
  await prepare();
  await expect(
    inProgramAuthoringFixtureSchema(
      prisma,
      schema,
      (tx) =>
        tx.$executeRaw`
      INSERT INTO "ProgramAuthoringUpload" (
        id, "actorId", "programId", "storageKey", "originalFileName", "mimeType",
        "sizeBytes", sha256, lifecycle, "expiresAt", "attachedAt", "updatedAt"
      ) VALUES (
        'foreign-upload', 'actor-2', 'program-1', 'migration/foreign-upload', 'template.pdf',
        'application/pdf', 10, ${hash}, 'ATTACHED', NOW() + INTERVAL '1 day', NOW(), NOW()
      )
    `,
    ),
  ).rejects.toMatchObject({ code: 'P2010', meta: { code: '23503' } });
  await inProgramAuthoringFixtureSchema(prisma, schema, async (tx) => {
    await tx.$executeRaw`
      UPDATE "ProgramAuthoringUpload" SET lifecycle = 'DELETE_PENDING', "attachedAt" = NULL,
        "nextDeleteAttemptAt" = NOW() WHERE id = 'upload-1'
    `;
    await tx.$executeRaw`
      UPDATE "ProgramAuthoringUpload" SET lifecycle = 'DELETED', "deletedAt" = NOW(),
        "nextDeleteAttemptAt" = NULL WHERE id = 'upload-1'
    `;
    await expect(tx.$queryRaw`
      SELECT id, "programId", lifecycle::text AS lifecycle FROM "ProgramAuthoringUpload" WHERE id = 'upload-1'
    `).resolves.toEqual([
      { id: 'upload-1', programId: 'program-1', lifecycle: 'DELETED' },
    ]);
  });
});

it.each([
  ['USER without creator', `"createdBy" = 'USER', "createdById" = NULL`],
  [
    'LEGACY_UNKNOWN with creator',
    `"createdBy" = 'LEGACY_UNKNOWN', "createdById" = 'actor-1'`,
  ],
  ['key without hash', `"idempotencyKey" = 'key', "payloadHash" = NULL`],
  ['hash without key', `"idempotencyKey" = NULL, "payloadHash" = '${hash}'`],
  ['empty key', `"idempotencyKey" = ''`],
  ['invalid hash', `"payloadHash" = 'invalid'`],
] as const)(
  'rejects %s as a Program creation CHECK violation',
  async (_name, assignment) => {
    await prepare();
    await expect(
      inProgramAuthoringFixtureSchema(prisma, schema, (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE "Program" SET ${assignment} WHERE id = 'program-1'`,
        ),
      ),
    ).rejects.toMatchObject({ code: 'P2010', meta: { code: '23514' } });
  },
);

it('allows a known creator without inventing an idempotency key for the legacy endpoint', async () => {
  await prepare();
  await inProgramAuthoringFixtureSchema(prisma, schema, async (tx) => {
    await tx.$executeRaw`
      UPDATE "Program" SET "idempotencyKey" = NULL, "payloadHash" = NULL WHERE id = 'program-1'
    `;
    await expect(tx.$queryRaw`
      SELECT "createdBy"::text AS "createdBy", "createdById", "idempotencyKey", "payloadHash" FROM "Program"
    `).resolves.toEqual([
      {
        createdBy: 'USER',
        createdById: 'actor-1',
        idempotencyKey: null,
        payloadHash: null,
      },
    ]);
  });
});

it('keeps the previous app purge writable between prepare migration and app replacement', async () => {
  await prepare();
  await expect(
    inProgramAuthoringFixtureSchema(prisma, schema, async (tx) => {
      await tx.$executeRaw`
        UPDATE "ProgramAuthoringUpload"
        SET lifecycle = 'DELETE_PENDING', "attachedAt" = NULL,
          "createRequestId" = NULL, "createRequestActorId" = NULL,
          "nextDeleteAttemptAt" = NOW()
        WHERE id = 'upload-1'
      `;
      await tx.$executeRaw`DELETE FROM "ProgramCreateRequest" WHERE id = 'request-1'`;
      await tx.$executeRaw`DELETE FROM "Milestone" WHERE "programId" = 'program-1'`;
      return tx.$executeRaw`DELETE FROM "Program" WHERE id = 'program-1'`;
    }),
  ).resolves.toBe(1);
});

it('retires only the old request structure while preserving Program facts and upload identity', async () => {
  await prepare();
  await retire();

  await expect(
    relationExists(prisma, schema, 'ProgramCreateRequest'),
  ).resolves.toBe(false);
  for (const column of ['createRequestId', 'createRequestActorId']) {
    await expect(
      columnExists(prisma, schema, 'ProgramAuthoringUpload', column),
    ).resolves.toBe(false);
  }
  await inProgramAuthoringFixtureSchema(prisma, schema, async (tx) => {
    await expect(tx.$queryRaw`
      SELECT id, "createdBy"::text AS "createdBy", "createdById", "idempotencyKey", "payloadHash"
      FROM "Program"
    `).resolves.toEqual([
      {
        id: 'program-1',
        createdBy: 'USER',
        createdById: 'actor-1',
        idempotencyKey: 'original-key',
        payloadHash: hash,
      },
    ]);
    await expect(tx.$queryRaw`
      SELECT id, "programId", "actorId" FROM "ProgramAuthoringUpload"
    `).resolves.toEqual([
      { id: 'upload-1', programId: 'program-1', actorId: 'actor-1' },
    ]);
  });
});

it('refuses retirement without dropping anything when copied creation facts disagree', async () => {
  await prepare();
  await inProgramAuthoringFixtureSchema(
    prisma,
    schema,
    (tx) =>
      tx.$executeRaw`UPDATE "Program" SET "payloadHash" = ${'b'.repeat(64)} WHERE id = 'program-1'`,
  );

  await expect(retire()).rejects.toMatchObject({
    code: 'P2010',
    meta: { code: 'P0001' },
  });
  await expect(
    relationExists(prisma, schema, 'ProgramCreateRequest'),
  ).resolves.toBe(true);
  await expect(
    columnExists(prisma, schema, 'ProgramAuthoringUpload', 'createRequestId'),
  ).resolves.toBe(true);
});
