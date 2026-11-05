import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { canonicalUserCreateFromLabel } from '../users/canonical-user-fixture';
import { PlatformRepository } from '../platform/platform.repository';
import { ProgramTeamRepositoryEvidenceRepository } from './program-team-repository-evidence.repository';
import { TeamRepository } from './team.repository';
import { TeamHistoryRepository } from './team-history.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const prefix = 'synthetic-dead-columns-team:';
const now = new Date('2026-08-10T00:00:00Z');
const program = {
  id: prefix,
  name: 'Synthetic program',
  organizer: 'Synthetic organizer',
  category: 'BASIC' as const,
  applicationTemplateKey: 'capstone-v1',
  applicationTemplateVersion: 1,
  applicationStartAt: new Date('2026-08-01T00:00:00Z'),
  applicationEndAt: new Date('2026-08-31T00:00:00Z'),
  startAt: new Date('2026-08-01T00:00:00Z'),
  endAt: new Date('2026-12-31T00:00:00Z'),
  description: 'Synthetic integration fixture',
};

describe('program storage invariants', () => {
  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    await prisma.user.create({
      data: canonicalUserCreateFromLabel('STUDENT', {
        id: prefix,
        githubId: 991003n,
        nickname: prefix,
        name: 'Synthetic student',
      }),
    });
  });
  afterEach(async () => {
    await prisma.submissionFile.deleteMany({ where: { uploaderId: prefix } });
    await prisma.milestoneDocumentTemplateFile.deleteMany({
      where: { uploadedById: prefix },
    });
    await prisma.milestoneDocument.deleteMany({
      where: { milestone: { programId: prefix } },
    });
    await prisma.teamMember.deleteMany({ where: { programId: prefix } });
    await prisma.team.deleteMany({ where: { programId: prefix } });
    await prisma.milestone.deleteMany({ where: { programId: prefix } });
    await prisma.program.deleteMany({ where: { id: prefix } });
    await prisma.user.deleteMany({ where: { id: prefix } });
  });

  it('uses the composite primary key after the preceding app release stopped using old columns', async () => {
    const primaryKeys = await prisma.$queryRaw<{ columns: string[] }[]>`
      SELECT array_agg(a.attname ORDER BY k.ordinality)::text[] AS columns
      FROM pg_constraint c
      CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ordinality)
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.conrelid = '"TeamMember"'::regclass AND c.contype = 'p'
    `;
    expect(primaryKeys).toEqual([{ columns: ['teamId', 'userId'] }]);

    const legacyColumns = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND (
          (table_name = 'TeamMember' AND column_name IN ('id', 'name', 'email', 'department'))
          OR (table_name = 'Team' AND column_name = 'joinCodeDigest')
          OR (table_name = 'TeamInvitation' AND column_name = 'invitedAt')
        )
    `;
    expect(legacyColumns).toEqual([]);
  });

  it('leaves a team whose membership was inserted without a surrogate ID', async () => {
    await prisma.program.create({ data: program });
    await prisma.$executeRaw`
      INSERT INTO "Team" ("id", "programId", "name", "leaderId", "updatedAt")
      VALUES (${prefix}, ${prefix}, 'Synthetic team', ${prefix}, ${now})
    `;
    await prisma.$executeRaw`
      INSERT INTO "TeamMember" ("teamId", "programId", "userId")
      VALUES (${prefix}, ${prefix}, ${prefix})
    `;
    const repository = new TeamRepository(
      prisma,
      new ProgramTeamRepositoryEvidenceRepository(prisma),
      new PlatformRepository(),
      new TeamHistoryRepository(),
    );
    const events: string[] = [];

    const result = await repository.leave(prefix, prefix, (_, event) => {
      events.push(event.operation);
      return Promise.resolve();
    });

    expect(result).toBe('removed');
    expect(events).toEqual(['LEAVE']);
    expect(
      await prisma.teamMember.count({ where: { programId: prefix } }),
    ).toBe(0);
  });

  it('rejects duplicate storage keys at the database boundary', async () => {
    const file = {
      uploaderId: prefix,
      storageKey: prefix,
      originalFileName: 'synthetic.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1,
      lifecycle: 'DELETE_PENDING' as const,
    };
    await prisma.submissionFile.create({ data: file });

    await expect(
      prisma.submissionFile.create({ data: file }),
    ).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it('rejects a template storage key already owned by another requirement', async () => {
    await prisma.program.create({ data: program });
    await prisma.milestone.create({
      data: {
        id: prefix,
        programId: prefix,
        name: 'Synthetic milestone',
        startAt: program.startAt,
        dueAt: program.endAt,
      },
    });
    const document = {
      milestoneId: prefix,
      name: 'Synthetic requirement',
      required: true,
      sortOrder: 1,
      templateFile: {
        create: {
          storageKey: prefix,
          originalFileName: 'synthetic.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1,
          uploadedById: prefix,
        },
      },
    };
    await prisma.milestoneDocument.create({ data: document });

    await expect(
      prisma.milestoneDocument.create({ data: document }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('keeps milestone writes inside the program schedule', async () => {
    await prisma.program.create({ data: program });
    await prisma.milestone.create({
      data: {
        id: prefix,
        programId: prefix,
        name: 'Synthetic milestone',
        startAt: program.startAt,
        dueAt: program.endAt,
      },
    });

    await expect(prisma.$executeRaw`
      UPDATE "Milestone" SET "startAt" = TIMESTAMP '2026-07-31' WHERE id = ${prefix}
    `).rejects.toMatchObject({ code: 'P2010', meta: { code: '23514' } });
    await expect(prisma.$executeRaw`
      UPDATE "Milestone" SET "dueAt" = TIMESTAMP '2027-01-01' WHERE id = ${prefix}
    `).rejects.toMatchObject({ code: 'P2010', meta: { code: '23514' } });
  });

  it('rejects a Program sentinel startAt instead of rewriting it', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO "Program" (
          "id", "name", "organizer", "category", "applicationTemplateKey",
          "applicationTemplateVersion", "applicationStartAt", "applicationEndAt",
          "startAt", "endAt", "description", "updatedAt"
        ) VALUES (
          ${prefix}, 'Synthetic program', 'Synthetic organizer', 'BASIC', 'capstone-v1',
          1, ${program.applicationStartAt}, ${program.applicationEndAt},
          TIMESTAMP '0001-01-01', ${program.endAt}, 'Synthetic fixture', ${now}
        )
      `,
    ).rejects.toMatchObject({ code: 'P2010', meta: { code: '23514' } });
  });

  it('rejects a Milestone sentinel startAt instead of rewriting it', async () => {
    await prisma.program.create({ data: program });

    await expect(
      prisma.$executeRaw`
        INSERT INTO "Milestone" ("id", "programId", "name", "startAt", "dueAt", "updatedAt")
        VALUES (${prefix}, ${prefix}, 'Synthetic milestone',
          TIMESTAMP '0001-01-01', TIMESTAMP '2026-09-01', ${now})
      `,
    ).rejects.toMatchObject({ code: 'P2010', meta: { code: '23514' } });
  });
});
