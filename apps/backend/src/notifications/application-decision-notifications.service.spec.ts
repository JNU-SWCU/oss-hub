import { DomainException } from '../platform/error-code.error';
import {
  NotificationSettingsService,
  ApplicationDecisionNotificationsService,
} from './application-decision-notifications.service';
import type {
  NotificationSettingsRepositoryPort,
  ApplicationDecisionNotificationsRepositoryPort,
} from './application-decision-notifications.repository';
import { ApplicationStatus } from '@prisma/client';

describe('notification-settings.service', () => {
  describe('NotificationSettingsService', () => {
    const updateByGithubId = jest.fn();
    const repository = {
      updateByGithubId,
    } as unknown as NotificationSettingsRepositoryPort;
    const service = new NotificationSettingsService(repository);

    beforeEach(() => updateByGithubId.mockReset());

    it('수신 이메일·on/off를 저장하고 갱신된 설정을 반환한다', async () => {
      updateByGithubId.mockResolvedValue({
        notificationEmail: 'staff@example.com',
        notifyEnabled: false,
      });

      const result = await service.updateMyNotificationEmail(42n, {
        notificationEmail: 'staff@example.com',
        notifyEnabled: false,
      });

      expect(updateByGithubId).toHaveBeenCalledWith(42n, {
        notificationEmail: 'staff@example.com',
        notifyEnabled: false,
      });
      expect(result).toEqual({
        notificationEmail: 'staff@example.com',
        notifyEnabled: false,
      });
    });

    it('대상 사용자가 없으면 USER_NOT_FOUND를 던진다', async () => {
      updateByGithubId.mockResolvedValue(null);

      await expect(
        service.updateMyNotificationEmail(1n, {
          notificationEmail: 'x@example.com',
          notifyEnabled: true,
        }),
      ).rejects.toBeInstanceOf(DomainException);
    });

    it('현재 설정을 조회한다', async () => {
      const readService = new NotificationSettingsService({
        findByGithubId: jest.fn().mockResolvedValue({
          notificationEmail: 'staff@example.com',
          notifyEnabled: true,
        }),
        updateByGithubId: jest.fn(),
      });

      await expect(readService.getMyNotificationSettings(42n)).resolves.toEqual(
        {
          notificationEmail: 'staff@example.com',
          notifyEnabled: true,
        },
      );
    });

    it('조회 대상 사용자가 없으면 USER_NOT_FOUND를 던진다', async () => {
      const readService = new NotificationSettingsService({
        findByGithubId: jest.fn().mockResolvedValue(null),
        updateByGithubId: jest.fn(),
      });

      await expect(
        readService.getMyNotificationSettings(1n),
      ).rejects.toBeInstanceOf(DomainException);
    });
  });
});

describe('ApplicationDecisionNotificationsService', () => {
  it.each([
    ApplicationStatus.APPROVED,
    ApplicationStatus.REJECTED,
    ApplicationStatus.SUBMITTED,
  ])('returns well-formed unread %s decisions', async (decision) => {
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
            decision,
            decidedAt: '2026-08-08T23:59:00.000Z',
          },
        },
        {
          id: 'notification-broken',
          createdAt: new Date('2026-08-09T00:00:01.000Z'),
          payload: { decision: 'APPROVED' },
        },
      ]),
      listUnreadTeamDeletions: jest.fn(),
      markTeamDeletionRead: jest.fn(),
      markRead: jest.fn(),
    };
    const service = new ApplicationDecisionNotificationsService(repository);

    await expect(service.listUnread(42n)).resolves.toEqual([
      {
        id: 'notification-1',
        applicationId: 'application-1',
        programId: 'program-1',
        programName: '합성 프로그램',
        decision,
        decidedAt: new Date('2026-08-08T23:59:00.000Z'),
      },
    ]);
  });

  it('marks a notification read only through the current-user repository scope', async () => {
    const markRead = jest.fn().mockResolvedValue(undefined);
    const service = new ApplicationDecisionNotificationsService({
      listUnread: jest.fn(),
      listUnreadTeamDeletions: jest.fn(),
      markTeamDeletionRead: jest.fn(),
      markRead,
    });

    await service.markRead(42n, 'notification-1');

    expect(markRead).toHaveBeenCalledWith(42n, 'notification-1');
  });
});
