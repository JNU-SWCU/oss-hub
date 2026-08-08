import { ApplicationStatus } from '@prisma/client';
import {
  ApplicationDecisionNotificationsService,
  type ApplicationDecisionNotificationsRepositoryPort,
} from './application-decision-notifications.service';

describe('ApplicationDecisionNotificationsService', () => {
  it('returns only well-formed unread application decisions', async () => {
    const repository: ApplicationDecisionNotificationsRepositoryPort = {
      listUnread: jest.fn().mockResolvedValue([
        {
          id: 'notification-1',
          createdAt: new Date('2026-08-09T00:00:00.000Z'),
          payload: {
            schemaVersion: 1,
            applicationId: 'application-1',
            programId: 'program-1',
            programName: '합성 프로그램',
            decision: ApplicationStatus.APPROVED,
            decidedAt: '2026-08-08T23:59:00.000Z',
          },
        },
        {
          id: 'notification-broken',
          createdAt: new Date('2026-08-09T00:00:01.000Z'),
          payload: { decision: 'APPROVED' },
        },
      ]),
      markRead: jest.fn(),
    };
    const service = new ApplicationDecisionNotificationsService(repository);

    await expect(service.listUnread(42n)).resolves.toEqual([
      {
        id: 'notification-1',
        applicationId: 'application-1',
        programId: 'program-1',
        programName: '합성 프로그램',
        decision: ApplicationStatus.APPROVED,
        decidedAt: new Date('2026-08-08T23:59:00.000Z'),
      },
    ]);
  });

  it('marks a notification read only through the current-user repository scope', async () => {
    const markRead = jest.fn().mockResolvedValue(undefined);
    const service = new ApplicationDecisionNotificationsService({
      listUnread: jest.fn(),
      markRead,
    });

    await service.markRead(42n, 'notification-1');

    expect(markRead).toHaveBeenCalledWith(42n, 'notification-1');
  });
});
