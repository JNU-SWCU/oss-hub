import { DomainException } from '../common/error-code';
import { DeadlineDigestTriggerService } from './deadline-digest-trigger.service';
import { NotificationsErrorCode } from './notifications-error-code.enum';

describe('DeadlineDigestTriggerService', () => {
  const findActiveStaffOrAdmin = jest.fn();
  const sendDeadlineDigests = jest.fn();
  const service = new DeadlineDigestTriggerService(
    { findActiveStaffOrAdmin },
    { sendDeadlineDigests },
  );
  const githubId = 42n;
  const now = new Date('2026-08-07T00:00:00.000Z');

  beforeEach(() => {
    findActiveStaffOrAdmin.mockReset();
    sendDeadlineDigests.mockReset().mockResolvedValue(undefined);
  });

  it('활성 STAFF·ADMIN이면 다이제스트 배치를 실행한다', async () => {
    findActiveStaffOrAdmin.mockResolvedValue(true);

    await service.triggerSend(githubId, now);

    expect(sendDeadlineDigests).toHaveBeenCalledWith(now);
  });

  it('학생이거나 비활성이면 STAFF_ONLY로 거부한다', async () => {
    findActiveStaffOrAdmin.mockResolvedValue(false);

    await expect(service.triggerSend(githubId, now)).rejects.toMatchObject({
      errorCode: { code: NotificationsErrorCode.STAFF_ONLY, status: 403 },
    });
    expect(sendDeadlineDigests).not.toHaveBeenCalled();
    await expect(service.triggerSend(githubId, now)).rejects.toBeInstanceOf(
      DomainException,
    );
  });
});
