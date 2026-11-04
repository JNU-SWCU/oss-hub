import { TeamHistoryRepository } from './team-history.repository';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PlatformRepository } from '../platform/platform.repository';
import { PrismaService } from '../platform/prisma.service';
import { canonicalUserCreateFromLabel } from '../users/canonical-user-fixture';
import { TeamInvitationsRepository } from './team-invitations.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const prefix = 'synthetic-dead-columns-invitation:';
const now = new Date('2026-08-10T00:00:00Z');

describe('team invitation without legacy team columns', () => {
  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());
  afterEach(async () => {
    await prisma.teamInvitation.deleteMany({ where: { programId: prefix } });
    await prisma.teamMember.deleteMany({ where: { programId: prefix } });
    await prisma.team.deleteMany({ where: { programId: prefix } });
    await prisma.program.deleteMany({ where: { id: prefix } });
    await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
  });

  it('accepts an invitation using the team and user key without a join code', async () => {
    for (const [name, githubId] of [
      ['leader', 991001n],
      ['invitee', 991002n],
    ] as const) {
      await prisma.user.create({
        data: canonicalUserCreateFromLabel('STUDENT', {
          id: prefix + name,
          githubId,
          nickname: prefix + name,
          name: 'Synthetic student',
        }),
      });
    }
    await prisma.program.create({
      data: {
        id: prefix,
        name: 'Synthetic program',
        organizer: 'Synthetic organizer',
        category: 'BASIC',
        applicationTemplateKey: 'capstone-v1',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-08-01T00:00:00Z'),
        applicationEndAt: new Date('2026-08-31T00:00:00Z'),
        startAt: new Date('2026-08-01T00:00:00Z'),
        endAt: new Date('2026-12-31T00:00:00Z'),
        teamMaxSize: 2,
        description: 'Synthetic integration fixture',
      },
    });
    await prisma.$executeRaw`
      INSERT INTO "Team" ("id", "programId", "name", "leaderId", "updatedAt")
      VALUES (${prefix}, ${prefix}, 'Synthetic team', ${prefix + 'leader'}, ${now})
    `;
    await prisma.$executeRaw`
      INSERT INTO "TeamMember" ("teamId", "programId", "userId")
      VALUES (${prefix}, ${prefix}, ${prefix + 'leader'})
    `;
    await prisma.teamInvitation.create({
      data: {
        id: prefix,
        teamId: prefix,
        programId: prefix,
        inviteeId: prefix + 'invitee',
        invitedById: prefix + 'leader',
        createdAt: now,
      },
    });
    const repository = new TeamInvitationsRepository(
      new TeamHistoryRepository(),
      prisma,
      new PlatformRepository(),
    );

    const result = await repository.acceptTeamInvitationTransaction(
      prisma,
      prefix,
      prefix + 'invitee',
      now,
    );

    expect(result).toEqual({ kind: 'ok', teamId: prefix, programId: prefix });
    expect(
      await prisma.teamMember.findUnique({
        where: {
          teamId_userId: { teamId: prefix, userId: prefix + 'invitee' },
        },
        select: { userId: true },
      }),
    ).toEqual({ userId: prefix + 'invitee' });
  });
});
