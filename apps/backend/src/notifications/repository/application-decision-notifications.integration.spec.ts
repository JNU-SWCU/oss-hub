import { ApplicationStatus, ProgramCategory } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../../test/integration-database.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ApplicationDecisionNotificationsService } from '../service/application-decision-notifications.service';
import { ApplicationDecisionNotificationsRepository } from './application-decision-notifications.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const repository = new ApplicationDecisionNotificationsRepository(prisma);
const service = new ApplicationDecisionNotificationsService(repository);
const USER_IDS = ['synthetic-notice-a', 'synthetic-notice-b'] as const;
const GITHUB_IDS = [8_800_000_000_044n, 8_800_000_000_045n] as const;
const PROGRAM_ID = 'synthetic-notice-program';
const APPLICATION_ID = 'synthetic-notice-application';
const TIMES = [
  '2026-08-09T01:00:00.000Z',
  '2026-08-09T02:00:00.000Z',
  '2026-08-09T03:00:00.000Z',
] as const;

async function createApplication(status: ApplicationStatus): Promise<void> {
  await prisma.team.create({
    data: {
      id: 'synthetic-notice-team',
      name: '합성 팀',
      programId: PROGRAM_ID,
      joinCodeDigest: 'synthetic-notice-digest',
      leaderId: USER_IDS[0],
    },
  });
  await prisma.application.create({
    data: {
      id: APPLICATION_ID,
      programId: PROGRAM_ID,
      teamId: 'synthetic-notice-team',
      applicantId: USER_IDS[0],
      answers: {},
      applicationTemplateVersion: 1,
      status,
      submittedAt: new Date('2026-08-01T00:00:00.000Z'),
    },
  });
}

function decision(id: string, status: ApplicationStatus, index: 0 | 1 | 2) {
  return {
    id,
    userId: USER_IDS[0],
    type: 'APPLICATION_DECISION',
    channel: 'IN_APP',
    status: 'UNREAD',
    createdAt: new Date(TIMES[index]),
    payload: {
      schemaVersion: 1,
      applicationId: APPLICATION_ID,
      programId: PROGRAM_ID,
      programName: '합성 프로그램',
      decision: status,
      decidedAt: TIMES[index],
    },
  };
}

async function clearFixtures(): Promise<void> {
  await prisma.notification.deleteMany({
    where: { userId: { in: [...USER_IDS] } },
  });
  await prisma.application.deleteMany({ where: { programId: PROGRAM_ID } });
  await prisma.team.deleteMany({ where: { programId: PROGRAM_ID } });
}

describe('ApplicationDecisionNotificationsRepository integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.createMany({
      data: USER_IDS.map((id, index) => {
        const githubId = GITHUB_IDS[index];
        if (githubId === undefined)
          throw new TypeError('missing synthetic github id');
        return { id, githubId, nickname: id };
      }),
    });
    await prisma.program.create({
      data: {
        id: PROGRAM_ID,
        name: '합성 프로그램',
        organizer: '합성 조직',
        category: ProgramCategory.BASIC,
        applicationTemplateKey: 'synthetic',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
        applicationEndAt: new Date('2026-12-31T00:00:00.000Z'),
        description: '합성 프로그램',
      },
    });
  });
  beforeEach(clearFixtures);
  afterAll(async () => {
    await clearFixtures();
    await prisma.program.delete({ where: { id: PROGRAM_ID } });
    await prisma.user.deleteMany({ where: { id: { in: [...USER_IDS] } } });
    await prisma.$disconnect();
  });

  it('scopes unread decisions and acknowledgements to the current account and channel', async () => {
    await createApplication(ApplicationStatus.APPROVED);
    const target = decision('synthetic-target', ApplicationStatus.APPROVED, 0);
    await prisma.notification.createMany({
      data: [
        target,
        { ...target, id: 'synthetic-other-user', userId: USER_IDS[1] },
        { ...target, id: 'synthetic-other-type', type: 'DEADLINE_DIGEST' },
        { ...target, id: 'synthetic-email', channel: 'EMAIL' },
      ],
    });

    expect(
      (await repository.listUnread(GITHUB_IDS[0])).map(({ id }) => id),
    ).toEqual([target.id]);
    await repository.markRead(GITHUB_IDS[1], target.id);
    expect(
      (await repository.listUnread(GITHUB_IDS[0])).map(({ id }) => id),
    ).toEqual([target.id]);
    await repository.markRead(GITHUB_IDS[0], target.id);
    await repository.markRead(GITHUB_IDS[0], target.id);
    expect(await repository.listUnread(GITHUB_IDS[0])).toEqual([]);
    expect(
      await prisma.notification.count({
        where: {
          userId: USER_IDS[0],
          type: 'APPLICATION_DECISION_ACKNOWLEDGED',
        },
      }),
    ).toBe(1);
    expect(
      await prisma.notification.findUniqueOrThrow({ where: { id: target.id } }),
    ).toMatchObject({ status: 'UNREAD' });
  });

  it('shows the current reverted decision while retaining the historical approval row', async () => {
    await createApplication(ApplicationStatus.SUBMITTED);
    await prisma.notification.createMany({
      data: [
        decision('synthetic-approval', ApplicationStatus.APPROVED, 0),
        decision('synthetic-revert', ApplicationStatus.SUBMITTED, 1),
      ],
    });

    const notices = await service.listUnread(GITHUB_IDS[0]);

    expect(notices).toMatchObject([
      { id: 'synthetic-revert', decision: 'SUBMITTED' },
    ]);
    expect(
      await prisma.notification.count({
        where: { userId: USER_IDS[0], status: 'UNREAD' },
      }),
    ).toBe(2);
  });

  it('shows only the new approval after approval, revert, and reapproval', async () => {
    await createApplication(ApplicationStatus.APPROVED);
    await prisma.notification.createMany({
      data: [
        decision('synthetic-z-old-approval', ApplicationStatus.APPROVED, 0),
        decision('synthetic-y-revert', ApplicationStatus.SUBMITTED, 1),
        decision('synthetic-a-new-approval', ApplicationStatus.APPROVED, 2),
      ],
    });

    const notices = await service.listUnread(GITHUB_IDS[0]);

    expect(notices.map(({ id }) => id)).toEqual(['synthetic-a-new-approval']);
    expect(
      await prisma.notification.count({
        where: { userId: USER_IDS[0], status: 'UNREAD' },
      }),
    ).toBe(3);
  });

  it('does not resurface old unread approvals after the newest decision was acknowledged', async () => {
    await createApplication(ApplicationStatus.APPROVED);
    await prisma.notification.createMany({
      data: [
        decision('synthetic-old', ApplicationStatus.APPROVED, 0),
        decision('synthetic-revert', ApplicationStatus.SUBMITTED, 1),
        decision('synthetic-new', ApplicationStatus.APPROVED, 2),
      ],
    });
    await repository.markRead(GITHUB_IDS[0], 'synthetic-new');

    expect(await service.listUnread(GITHUB_IDS[0])).toEqual([]);
    expect(
      await prisma.notification.count({
        where: { userId: USER_IDS[0], status: 'UNREAD' },
      }),
    ).toBe(3);
  });

  it('hides a stale decision when the live application has a different state', async () => {
    await createApplication(ApplicationStatus.REJECTED);
    await prisma.notification.create({
      data: decision('synthetic-stale', ApplicationStatus.APPROVED, 0),
    });

    expect(await service.listUnread(GITHUB_IDS[0])).toEqual([]);
  });

  it('hides a reverted notice after a newer submission starts another review', async () => {
    await createApplication(ApplicationStatus.SUBMITTED);
    await prisma.notification.create({
      data: decision('synthetic-old-revert', ApplicationStatus.SUBMITTED, 0),
    });
    await prisma.application.update({
      where: { id: APPLICATION_ID },
      data: { submittedAt: new Date(TIMES[2]) },
    });

    expect(await service.listUnread(GITHUB_IDS[0])).toEqual([]);
  });

  it('returns historical unread team deletions and acknowledges only the selected owned notice', async () => {
    const deleted = {
      userId: USER_IDS[0],
      type: 'TEAM_DELETED',
      channel: 'IN_APP',
      status: 'UNREAD',
      payload: {
        schemaVersion: 1,
        teamId: 'already-deleted-team',
        teamName: '삭제된 합성 팀',
        programId: PROGRAM_ID,
        programName: '합성 프로그램',
        message: '중복 팀 정리',
        deletedAt: TIMES[0],
      },
      createdAt: new Date(TIMES[0]),
    };
    await prisma.notification.createMany({
      data: [
        { ...deleted, id: 'synthetic-deleted-a' },
        { ...deleted, id: 'synthetic-deleted-b' },
        { ...deleted, id: 'synthetic-deleted-other', userId: USER_IDS[1] },
        { ...deleted, id: 'synthetic-deleted-email', channel: 'EMAIL' },
      ],
    });

    expect(await service.listUnreadTeamDeletions(GITHUB_IDS[0])).toMatchObject([
      {
        id: 'synthetic-deleted-a',
        message: '중복 팀 정리',
        deletedAt: new Date(TIMES[0]),
      },
      { id: 'synthetic-deleted-b' },
    ]);
    await repository.markTeamDeletionRead(GITHUB_IDS[1], 'synthetic-deleted-a');
    await repository.markTeamDeletionRead(GITHUB_IDS[0], 'synthetic-deleted-a');
    expect(
      (await service.listUnreadTeamDeletions(GITHUB_IDS[0])).map(
        ({ id }) => id,
      ),
    ).toEqual(['synthetic-deleted-b']);
    expect(
      await prisma.notification.count({
        where: { userId: { in: [...USER_IDS] }, type: 'TEAM_DELETED' },
      }),
    ).toBe(4);
    expect(
      await prisma.notification.findUniqueOrThrow({
        where: { id: 'synthetic-deleted-other' },
      }),
    ).toMatchObject({ status: 'UNREAD' });
  });
});
