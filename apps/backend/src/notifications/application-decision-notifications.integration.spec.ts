import { Role } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ApplicationDecisionNotificationsRepository } from './application-decision-notifications.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const repository = new ApplicationDecisionNotificationsRepository(prisma);
const USER_IDS = [
  'synthetic-decision-notification-user-a',
  'synthetic-decision-notification-user-b',
] as const;
const GITHUB_IDS = [8_800_000_000_044n, 8_800_000_000_045n] as const;
const NOTIFICATION_IDS = {
  target: 'synthetic-decision-notification-target',
  otherUser: 'synthetic-decision-notification-other-user',
  otherType: 'synthetic-decision-notification-other-type',
  otherChannel: 'synthetic-decision-notification-other-channel',
  otherStatus: 'synthetic-decision-notification-other-status',
} as const;

function payload(applicationId: string): object {
  return {
    schemaVersion: 1,
    applicationId,
    programId: 'synthetic-program',
    programName: '합성 프로그램',
    decision: 'APPROVED',
    decidedAt: '2026-08-09T00:00:00.000Z',
  };
}

describe('ApplicationDecisionNotificationsRepository integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.createMany({
      data: USER_IDS.map((id, index) => {
        const githubId = GITHUB_IDS[index];
        if (githubId === undefined) {
          throw new TypeError('missing synthetic notification github id');
        }
        return {
          id,
          githubId,
          nickname: `${id}-login`,
          role: Role.STUDENT,
        };
      }),
    });
    await prisma.notification.createMany({
      data: [
        {
          id: NOTIFICATION_IDS.target,
          userId: USER_IDS[0],
          type: 'APPLICATION_DECISION',
          channel: 'IN_APP',
          status: 'UNREAD',
          payload: payload('target-application'),
        },
        {
          id: NOTIFICATION_IDS.otherUser,
          userId: USER_IDS[1],
          type: 'APPLICATION_DECISION',
          channel: 'IN_APP',
          status: 'UNREAD',
          payload: payload('other-user-application'),
        },
        {
          id: NOTIFICATION_IDS.otherType,
          userId: USER_IDS[0],
          type: 'DEADLINE_DIGEST',
          channel: 'IN_APP',
          status: 'UNREAD',
          payload: payload('other-type-application'),
        },
        {
          id: NOTIFICATION_IDS.otherChannel,
          userId: USER_IDS[0],
          type: 'APPLICATION_DECISION',
          channel: 'EMAIL',
          status: 'UNREAD',
          payload: payload('other-channel-application'),
        },
        {
          id: NOTIFICATION_IDS.otherStatus,
          userId: USER_IDS[0],
          type: 'APPLICATION_DECISION',
          channel: 'IN_APP',
          status: 'FAILED',
          payload: payload('other-status-application'),
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({
      where: { userId: { in: [...USER_IDS] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [...USER_IDS] } } });
    await prisma.$disconnect();
  });

  it('lists and marks read only the current user in-app unread decision', async () => {
    const unread = await repository.listUnread(GITHUB_IDS[0]);
    expect(unread.map(({ id }) => id)).toEqual([NOTIFICATION_IDS.target]);

    await repository.markRead(GITHUB_IDS[1], NOTIFICATION_IDS.target);
    await expect(
      prisma.notification.findUniqueOrThrow({
        where: { id: NOTIFICATION_IDS.target },
      }),
    ).resolves.toMatchObject({ status: 'UNREAD' });

    await repository.markRead(GITHUB_IDS[0], NOTIFICATION_IDS.otherType);
    await repository.markRead(GITHUB_IDS[0], NOTIFICATION_IDS.otherChannel);
    await repository.markRead(GITHUB_IDS[0], NOTIFICATION_IDS.otherStatus);
    await repository.markRead(GITHUB_IDS[0], NOTIFICATION_IDS.target);
    await repository.markRead(GITHUB_IDS[0], NOTIFICATION_IDS.target);

    await expect(repository.listUnread(GITHUB_IDS[0])).resolves.toEqual([]);

    const sources = await prisma.notification.findMany({
      where: { id: { in: Object.values(NOTIFICATION_IDS) } },
      orderBy: { id: 'asc' },
      select: { id: true, status: true },
    });
    expect(
      Object.fromEntries(sources.map(({ id, status }) => [id, status])),
    ).toEqual({
      [NOTIFICATION_IDS.target]: 'UNREAD',
      [NOTIFICATION_IDS.otherUser]: 'UNREAD',
      [NOTIFICATION_IDS.otherType]: 'UNREAD',
      [NOTIFICATION_IDS.otherChannel]: 'UNREAD',
      [NOTIFICATION_IDS.otherStatus]: 'FAILED',
    });

    const acknowledgements = await prisma.notification.findMany({
      where: {
        userId: USER_IDS[0],
        type: 'APPLICATION_DECISION_ACKNOWLEDGED',
      },
      select: { channel: true, status: true, payload: true },
    });
    expect(acknowledgements).toEqual([
      {
        channel: 'IN_APP',
        status: 'READ',
        payload: {
          schemaVersion: 1,
          notificationId: NOTIFICATION_IDS.target,
        },
      },
    ]);
  });
});
