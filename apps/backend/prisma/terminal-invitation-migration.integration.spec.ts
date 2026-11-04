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
const schema = 'terminal_invitation_migration_fixture';
const migration = readFileSync(
  resolve(
    __dirname,
    'migrations/20261104160000_retire_terminal_invitations/migration.sql',
  ),
  'utf8',
);
const historyDDL = readFileSync(
  resolve(
    __dirname,
    'migrations/20261104140000_prepare_team_history/migration.sql',
  ),
  'utf8',
);
const within = <T>(
  operation: Parameters<typeof inProgramAuthoringFixtureSchema<T>>[2],
) => inProgramAuthoringFixtureSchema(prisma, schema, operation);

async function apply() {
  await within(async (tx) => {
    for (const statement of migrationStatements(migration))
      await tx.$executeRawUnsafe(statement);
  });
}
async function counts() {
  return within(
    (tx) => tx.$queryRaw`
    SELECT (SELECT count(*)::int FROM "TeamInvitation") AS invitations,
           (SELECT count(*)::int FROM "TeamHistory") AS histories`,
  );
}
beforeEach(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await within(async (tx) => {
    await tx.$executeRawUnsafe(
      `CREATE TYPE "HistorySource" AS ENUM ('APPLICATION','MIGRATION','BOOTSTRAP')`,
    );
    await tx.$executeRawUnsafe(
      `CREATE TYPE "TeamInvitationStatus" AS ENUM ('PENDING','ACCEPTED','DECLINED','EXPIRED')`,
    );
    await tx.$executeRawUnsafe(
      `CREATE TABLE "ApplicationPreparation" (id TEXT PRIMARY KEY)`,
    );
    await tx.$executeRawUnsafe(
      `CREATE TABLE "ApplicationPreparationParticipant" (id TEXT PRIMARY KEY)`,
    );
    await tx.$executeRawUnsafe(
      `CREATE TABLE "Team" (id TEXT PRIMARY KEY, "programId" TEXT NOT NULL)`,
    );
    await tx.$executeRawUnsafe(
      `CREATE TABLE "TeamMember" ("teamId" TEXT NOT NULL REFERENCES "Team"(id), "userId" TEXT PRIMARY KEY)`,
    );
    await tx.$executeRawUnsafe(`CREATE TABLE "TeamInvitation" (
      id TEXT PRIMARY KEY, "teamId" TEXT NOT NULL REFERENCES "Team"(id),
      "programId" TEXT NOT NULL, "inviteeId" TEXT NOT NULL, "invitedById" TEXT NOT NULL,
      status "TeamInvitationStatus" NOT NULL DEFAULT 'PENDING',
      "createdAt" TIMESTAMP(3) NOT NULL, "respondedAt" TIMESTAMP(3),
      "updatedAt" TIMESTAMP(3) NOT NULL
    )`);
    for (const statement of migrationStatements(historyDDL))
      await tx.$executeRawUnsafe(statement);
    await tx.$executeRawUnsafe(
      `ALTER TYPE "TeamHistoryEvent" ADD VALUE 'INVITATION_ARCHIVED'`,
    );
    await tx.$executeRaw`INSERT INTO "Team" VALUES ('team','program')`;
    await tx.$executeRaw`
      INSERT INTO "Team" SELECT 'team-' || n, 'program' FROM generate_series(2,40) n`;
    await tx.$executeRaw`
      INSERT INTO "TeamMember" SELECT 'team', 'member-' || n FROM generate_series(1,72) n`;
    await tx.$executeRaw`
      INSERT INTO "TeamInvitation"
      SELECT 'invitation-' || n, 'team', 'program', 'invitee-' || n, 'inviter',
        (CASE WHEN n <= 20 THEN 'ACCEPTED' WHEN n <= 25 THEN 'DECLINED' ELSE 'PENDING' END)::"TeamInvitationStatus",
        '2026-08-01T01:02:03.456'::TIMESTAMP,
        CASE WHEN n <= 25 THEN '2026-08-02T04:05:06.789'::TIMESTAMP ELSE NULL END,
        '2026-08-02T04:05:06.789'::TIMESTAMP
      FROM generate_series(1,28) n`;
  });
});
afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await prisma.$disconnect();
});

it('moves all original facts, retains pending rows and is idempotent', async () => {
  await expect(counts()).resolves.toEqual([{ invitations: 28, histories: 0 }]);
  const before = await within(
    (tx) =>
      tx.$queryRaw<
        {
          id: string;
          teamId: string;
          programId: string;
          inviteeId: string;
          invitedById: string;
          status: string;
          createdAt: Date;
          respondedAt: Date | null;
          updatedAt: Date;
        }[]
      >`SELECT * FROM "TeamInvitation" WHERE status <> 'PENDING' ORDER BY id`,
  );
  await apply();
  await expect(counts()).resolves.toEqual([{ invitations: 3, histories: 25 }]);
  await expect(
    within(
      (tx) => tx.$queryRaw`
      SELECT (SELECT count(*)::int FROM "Team") AS teams,
             (SELECT count(*)::int FROM "TeamMember") AS members,
             (SELECT count(*)::int FROM "TeamInvitation" WHERE status = 'PENDING') AS pending,
             (SELECT count(*)::int FROM "TeamHistory" WHERE source = 'MIGRATION') AS inserted`,
    ),
  ).resolves.toEqual([{ teams: 40, members: 72, pending: 3, inserted: 25 }]);
  const histories = await within(
    (tx) =>
      tx.$queryRaw<
        {
          teamId: string;
          programId: string;
          actorId: string | null;
          event: string;
          source: string;
          sourceId: string;
          occurredAt: Date;
          data: { schemaVersion: number; invitation: Record<string, unknown> };
        }[]
      >`SELECT * FROM "TeamHistory" ORDER BY "sourceId"`,
  );
  for (const [index, row] of before.entries()) {
    expect(histories[index]).toMatchObject({
      teamId: row.teamId,
      programId: row.programId,
      actorId: null,
      event: 'INVITATION_ARCHIVED',
      source: 'MIGRATION',
      sourceId: row.id,
      data: {
        schemaVersion: 1,
        invitation: {
          id: row.id,
          inviteeId: row.inviteeId,
          invitedById: row.invitedById,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
          respondedAt: row.respondedAt?.toISOString() ?? null,
          updatedAt: row.updatedAt.toISOString(),
        },
      },
    });
  }
  await apply();
  await expect(
    within(
      (tx) => tx.$queryRaw`SELECT * FROM "TeamHistory" ORDER BY "sourceId"`,
    ),
  ).resolves.toEqual(histories);
  await expect(
    within(
      (tx) => tx.$executeRaw`
    UPDATE "TeamInvitation" SET status = 'DECLINED', "respondedAt" = now() WHERE id = 'invitation-26'`,
    ),
  ).rejects.toThrow('TeamInvitation_pending_only');
});

it('rolls back inserted histories when a recorded close reduces approved inserts', async () => {
  await within(
    (tx) => tx.$executeRaw`
    INSERT INTO "TeamHistory" (id,"teamId","programId","actorId",event,"occurredAt",source,"sourceTable","sourceId",data)
    SELECT 'known', "teamId","programId","inviteeId",'INVITATION_ACCEPTED',"respondedAt",
      'APPLICATION','TeamInvitation',id,
      jsonb_build_object('schemaVersion',1,'invitation',jsonb_build_object(
        'id',id,'inviteeId',"inviteeId",'invitedById',"invitedById",
        'createdAt','2026-08-01T01:02:03.456Z'))
    FROM "TeamInvitation" WHERE id = 'invitation-1'`,
  );
  const original = await within(
    (tx) => tx.$queryRaw`SELECT * FROM "TeamHistory" WHERE id = 'known'`,
  );
  await expect(apply()).rejects.toThrow(
    'Invitation approval insert count mismatch',
  );
  await expect(counts()).resolves.toEqual([{ invitations: 28, histories: 1 }]);
  await expect(
    within(
      (tx) => tx.$queryRaw`SELECT * FROM "TeamHistory" WHERE id = 'known'`,
    ),
  ).resolves.toEqual(original);
});

it('keeps unknown response times without inventing a closer', async () => {
  await within(
    (tx) => tx.$executeRaw`
    UPDATE "TeamInvitation" SET "respondedAt" = NULL WHERE id = 'invitation-1'`,
  );
  await apply();
  await expect(
    within(
      (tx) => tx.$queryRaw`
    SELECT "actorId", event::text, data->'invitation'->>'status' AS status,
      data->'invitation'->'respondedAt' AS response
    FROM "TeamHistory" WHERE "sourceId" = 'invitation-1'`,
    ),
  ).resolves.toEqual([
    {
      actorId: null,
      event: 'INVITATION_ARCHIVED',
      status: 'ACCEPTED',
      response: null,
    },
  ]);
});

it.each([24, 26])(
  'rejects %i terminal rows before changing invitations or histories',
  async (terminalCount) => {
    await within(async (tx) => {
      if (terminalCount === 24) {
        await tx.$executeRaw`DELETE FROM "TeamInvitation" WHERE id = 'invitation-1'`;
      } else {
        await tx.$executeRaw`
          INSERT INTO "TeamInvitation"
          SELECT 'invitation-29', "teamId", "programId", 'invitee-29', "invitedById",
            status, "createdAt", "respondedAt", "updatedAt"
          FROM "TeamInvitation" WHERE id = 'invitation-1'`;
      }
    });
    const invitations = await within(
      (tx) =>
        tx.$queryRaw`SELECT to_jsonb(i) AS row FROM "TeamInvitation" i ORDER BY id`,
    );
    const histories = await within(
      (tx) =>
        tx.$queryRaw`SELECT to_jsonb(h) AS row FROM "TeamHistory" h ORDER BY id`,
    );

    await expect(apply()).rejects.toThrow('Invitation approval count mismatch');

    await expect(
      within(
        (tx) =>
          tx.$queryRaw`SELECT to_jsonb(i) AS row FROM "TeamInvitation" i ORDER BY id`,
      ),
    ).resolves.toEqual(invitations);
    await expect(
      within(
        (tx) =>
          tx.$queryRaw`SELECT to_jsonb(h) AS row FROM "TeamHistory" h ORDER BY id`,
      ),
    ).resolves.toEqual(histories);
    await expect(
      within(
        (tx) => tx.$queryRaw`
        SELECT count(*)::int AS constraints FROM pg_constraint
        WHERE conrelid = '"TeamInvitation"'::regclass
          AND conname = 'TeamInvitation_pending_only'`,
      ),
    ).resolves.toEqual([{ constraints: 0 }]);
  },
);

it.each([
  "UPDATE \"TeamInvitation\" SET status = 'DECLINED' WHERE id = 'invitation-1'",
  "UPDATE \"TeamInvitation\" SET status = 'ACCEPTED' WHERE id = 'invitation-21'",
  "UPDATE \"TeamInvitation\" SET status = 'EXPIRED' WHERE id = 'invitation-1'",
  'DELETE FROM "TeamInvitation" WHERE id = \'invitation-26\'',
  `INSERT INTO "TeamInvitation"
   SELECT 'invitation-29', "teamId", "programId", 'invitee-29', "invitedById",
     status, "createdAt", "respondedAt", "updatedAt"
   FROM "TeamInvitation" WHERE id = 'invitation-26'`,
  `DELETE FROM "Team" WHERE id = 'team-40'`,
  `INSERT INTO "Team" VALUES ('team-41', 'program')`,
  `DELETE FROM "TeamMember" WHERE "userId" = 'member-72'`,
  `INSERT INTO "TeamMember" VALUES ('team', 'member-73')`,
])(
  'rejects an unapproved status split or inventory count: %s',
  async (change) => {
    await within((tx) => tx.$executeRawUnsafe(change));
    const before = await counts();

    await expect(apply()).rejects.toThrow('Invitation approval count mismatch');

    await expect(counts()).resolves.toEqual(before);
  },
);

it('installs the pending-only constraint on a fresh empty database without data writes', async () => {
  await within(async (tx) => {
    await tx.$executeRaw`DELETE FROM "TeamInvitation"`;
    await tx.$executeRaw`DELETE FROM "TeamMember"`;
    await tx.$executeRaw`DELETE FROM "Team"`;
  });

  await apply();

  await expect(counts()).resolves.toEqual([{ invitations: 0, histories: 0 }]);
  await expect(
    within(
      (tx) => tx.$queryRaw`
      SELECT convalidated FROM pg_constraint
      WHERE conrelid = '"TeamInvitation"'::regclass
        AND conname = 'TeamInvitation_pending_only'`,
    ),
  ).resolves.toEqual([{ convalidated: true }]);
  await apply();
  await expect(counts()).resolves.toEqual([{ invitations: 0, histories: 0 }]);
});

it('rejects an unmarked pending-only inventory rather than treating it as replay', async () => {
  await within(
    (tx) =>
      tx.$executeRaw`DELETE FROM "TeamInvitation" WHERE status <> 'PENDING'`,
  );

  await expect(apply()).rejects.toThrow('Invitation approval count mismatch');

  await expect(counts()).resolves.toEqual([{ invitations: 3, histories: 0 }]);
});

it('fails atomically on conflicting existing history', async () => {
  await within(
    (tx) => tx.$executeRaw`
    INSERT INTO "TeamHistory" (id,"teamId","programId",event,source,"sourceTable","sourceId",data)
    VALUES ('conflict','wrong-team','program','INVITATION_DECLINED','APPLICATION','TeamInvitation','invitation-1',
      '{"schemaVersion":1,"invitation":{"id":"invitation-1","inviteeId":"wrong","invitedById":"inviter","createdAt":"2026-08-01T01:02:03.456Z"}}')`,
  );
  await expect(apply()).rejects.toThrow('Invitation history mismatch');
  await expect(counts()).resolves.toEqual([{ invitations: 28, histories: 1 }]);
});

it.each(['ApplicationPreparation', 'ApplicationPreparationParticipant'])(
  'fails closed for nonempty %s',
  async (table) => {
    await within((tx) =>
      tx.$executeRawUnsafe(`INSERT INTO "${table}" VALUES ('late')`),
    );
    await expect(apply()).rejects.toThrow('Preparation must remain empty');
    await expect(counts()).resolves.toEqual([
      { invitations: 28, histories: 0 },
    ]);
  },
);

it('refuses an unexpected incoming relation instead of silently losing its data', async () => {
  await within((tx) =>
    tx.$executeRawUnsafe(
      `CREATE TABLE "UnexpectedReference" ("invitationId" TEXT REFERENCES "TeamInvitation"(id))`,
    ),
  );
  await expect(apply()).rejects.toThrow('incoming foreign keys');
  await expect(counts()).resolves.toEqual([{ invitations: 28, histories: 0 }]);
});

it('rolls back on an unrelated archive id collision', async () => {
  await within(
    (tx) => tx.$executeRaw`
    INSERT INTO "TeamHistory" (id,"teamId","programId",event,source,data)
    VALUES ('team-invitation:invitation-1','other','program','INVITATION_DECLINED','APPLICATION',
      '{"schemaVersion":1,"invitation":{"id":"other","inviteeId":"other","invitedById":"inviter","createdAt":"2026-08-01T01:02:03.456Z"}}')`,
  );
  await expect(apply()).rejects.toThrow('archive key collision');
  await expect(counts()).resolves.toEqual([{ invitations: 28, histories: 1 }]);
});
