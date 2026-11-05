import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService } from '../src/platform/prisma.service';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import {
  inProgramAuthoringFixtureSchema,
  migrationStatements,
} from './program-authoring-migration-test-support';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const prisma = new PrismaService();
const schema = 'retired_invitation_schema_fixture';
const migration = readFileSync(
  resolve(
    __dirname,
    'migrations/20261105030000_retire_invitation_status_and_preparations/migration.sql',
  ),
  'utf8',
);
const within = <T>(
  operation: Parameters<typeof inProgramAuthoringFixtureSchema<T>>[2],
) => inProgramAuthoringFixtureSchema(prisma, schema, operation);

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await within(async (tx) => {
    await tx.$executeRawUnsafe(
      `CREATE TYPE "TeamInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED')`,
    );
    await tx.$executeRawUnsafe(
      `CREATE TABLE "ApplicationPreparation" (id TEXT PRIMARY KEY)`,
    );
    await tx.$executeRawUnsafe(`CREATE TABLE "ApplicationPreparationParticipant" (
      id TEXT PRIMARY KEY, "preparationId" TEXT REFERENCES "ApplicationPreparation"(id),
      status "TeamInvitationStatus" NOT NULL DEFAULT 'PENDING'
    )`);
    await tx.$executeRawUnsafe(`CREATE TABLE "TeamInvitation" (
      id TEXT PRIMARY KEY, "teamId" TEXT NOT NULL, "inviteeId" TEXT NOT NULL,
      status "TeamInvitationStatus" NOT NULL DEFAULT 'PENDING', "respondedAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT '2026-08-01',
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT '2026-08-02',
      CONSTRAINT "TeamInvitation_pending_only" CHECK (status = 'PENDING')
    )`);
    await tx.$executeRawUnsafe(
      `CREATE UNIQUE INDEX "TeamInvitation_teamId_inviteeId_pending_key" ON "TeamInvitation"("teamId", "inviteeId") WHERE status = 'PENDING'`,
    );
    await tx.$executeRawUnsafe(
      `CREATE INDEX "TeamInvitation_inviteeId_status_idx" ON "TeamInvitation"("inviteeId", status)`,
    );
    await tx.$executeRawUnsafe(
      `CREATE TABLE "TeamHistory" (id TEXT PRIMARY KEY, data JSONB NOT NULL)`,
    );
    await tx.$executeRaw`INSERT INTO "TeamInvitation" (id, "teamId", "inviteeId")
      SELECT 'invitation-' || n, 'team', 'invitee-' || n FROM generate_series(1,3) n`;
    await tx.$executeRaw`INSERT INTO "TeamHistory" VALUES ('archived', '{"invitation":{"status":"ACCEPTED","respondedAt":"2026-08-02"}}'::jsonb)`;
  });
});
afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await prisma.$disconnect();
});

function apply() {
  return within(async (tx) => {
    for (const statement of migrationStatements(migration))
      await tx.$executeRawUnsafe(statement);
  });
}

function invitations() {
  return within(
    (tx) =>
      tx.$queryRaw`SELECT to_jsonb(t) AS row FROM "TeamInvitation" t ORDER BY id`,
  );
}

it('drops only retired schema while preserving pending rows and archived facts', async () => {
  const expected = await within(
    (tx) =>
      tx.$queryRaw`SELECT to_jsonb(t) - 'status' - 'respondedAt' AS row FROM "TeamInvitation" t ORDER BY id`,
  );
  const history = await within(
    (tx) => tx.$queryRaw`SELECT * FROM "TeamHistory"`,
  );

  await apply();

  await expect(invitations()).resolves.toEqual(expected);
  await within(async (tx) => {
    await expect(tx.$queryRaw`SELECT * FROM "TeamHistory"`).resolves.toEqual(
      history,
    );
    await expect(tx.$queryRaw`SELECT
      to_regclass('"ApplicationPreparation"')::text AS parent,
      to_regclass('"ApplicationPreparationParticipant"')::text AS participant,
      to_regtype('"TeamInvitationStatus"')::text AS status`).resolves.toEqual([
      { parent: null, participant: null, status: null },
    ]);
    await expect(tx.$queryRaw`SELECT column_name FROM information_schema.columns
      WHERE table_schema = ${schema} AND table_name = 'TeamInvitation'
      AND column_name IN ('status', 'respondedAt')`).resolves.toEqual([]);
  });
  await expect(
    within(
      (tx) =>
        tx.$executeRaw`INSERT INTO "TeamInvitation" (id, "teamId", "inviteeId") VALUES ('duplicate', 'team', 'invitee-1')`,
    ),
  ).rejects.toMatchObject({ code: 'P2010', meta: { code: '23505' } });
  await expect(
    within(
      (tx) =>
        tx.$executeRaw`INSERT INTO "TeamInvitation" (id, "teamId", "inviteeId") VALUES ('new', 'team', 'invitee-new')`,
    ),
  ).resolves.toBe(1);
});

it.each(['ApplicationPreparation', 'ApplicationPreparationParticipant'])(
  'aborts without deleting rows when %s is not empty',
  async (table) => {
    await within((tx) =>
      tx.$executeRawUnsafe(`INSERT INTO "${table}" (id) VALUES ('retained')`),
    );
    const before = await invitations();

    await expect(apply()).rejects.toThrow(
      'Preparation retirement requires empty tables',
    );

    await expect(invitations()).resolves.toEqual(before);
    await expect(
      within((tx) =>
        tx.$queryRawUnsafe(`SELECT count(*)::int AS count FROM "${table}"`),
      ),
    ).resolves.toEqual([{ count: 1 }]);
  },
);

it.each(['ACCEPTED', 'DECLINED', 'EXPIRED'])(
  'aborts without dropping schema when a %s row remains',
  async (status) => {
    await within(async (tx) => {
      await tx.$executeRawUnsafe(
        'ALTER TABLE "TeamInvitation" DROP CONSTRAINT "TeamInvitation_pending_only"',
      );
      await tx.$executeRaw`UPDATE "TeamInvitation" SET status = ${status}::"TeamInvitationStatus" WHERE id = 'invitation-1'`;
    });
    const before = await invitations();

    await expect(apply()).rejects.toThrow(
      'Invitation retirement requires pending-only rows',
    );

    await expect(invitations()).resolves.toEqual(before);
  },
);

it('aborts rather than losing an unexpected response timestamp', async () => {
  await within(
    (tx) =>
      tx.$executeRaw`UPDATE "TeamInvitation" SET "respondedAt" = '2026-08-02' WHERE id = 'invitation-1'`,
  );
  const before = await invitations();

  await expect(apply()).rejects.toThrow(
    'Invitation retirement requires pending-only rows',
  );

  await expect(invitations()).resolves.toEqual(before);
});

it('requires the validated preceding pending-only constraint', async () => {
  await within((tx) =>
    tx.$executeRawUnsafe(
      'ALTER TABLE "TeamInvitation" DROP CONSTRAINT "TeamInvitation_pending_only"',
    ),
  );
  const before = await invitations();

  await expect(apply()).rejects.toThrow('validated pending-only constraint');

  await expect(invitations()).resolves.toEqual(before);
});

it('supports a fresh empty database without inventing invitation rows', async () => {
  await within((tx) => tx.$executeRaw`DELETE FROM "TeamInvitation"`);

  await apply();

  await expect(invitations()).resolves.toEqual([]);
});
