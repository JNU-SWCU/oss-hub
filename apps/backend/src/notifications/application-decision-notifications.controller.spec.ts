import { GUARDS_METADATA } from '@nestjs/common/constants';
import { OriginGuard } from '../auth/origin.guard';
import { ApplicationDecisionNotificationsController } from './application-decision-notifications.controller';

function guards(
  method:
    | 'listUnread'
    | 'markRead'
    | 'listUnreadTeamDeletions'
    | 'markTeamDeletionRead',
): readonly unknown[] {
  const metadata: unknown = Reflect.getMetadata(
    GUARDS_METADATA,
    ApplicationDecisionNotificationsController.prototype[method],
  );
  return Array.isArray(metadata) ? metadata : [];
}

describe('ApplicationDecisionNotificationsController', () => {
  it('keeps reads session-scoped and writes origin-protected', () => {
    expect(guards('listUnread')).toEqual([]);
    expect(guards('markRead')).toEqual([OriginGuard]);
    expect(guards('listUnreadTeamDeletions')).toEqual([]);
    expect(guards('markTeamDeletionRead')).toEqual([OriginGuard]);
  });

  it('forwards the session identity instead of accepting a user id', async () => {
    const listUnread = jest.fn().mockResolvedValue([]);
    const markRead = jest.fn().mockResolvedValue(undefined);
    const controller = new ApplicationDecisionNotificationsController({
      listUnread,
      listUnreadTeamDeletions: jest.fn(),
      markTeamDeletionRead: jest.fn(),
      markRead,
    });

    await controller.listUnread({ sessionGithubId: 42n });
    await controller.markRead({ sessionGithubId: 42n }, 'notification-1');

    expect(listUnread).toHaveBeenCalledWith(42n);
    expect(markRead).toHaveBeenCalledWith(42n, 'notification-1');
  });
});
