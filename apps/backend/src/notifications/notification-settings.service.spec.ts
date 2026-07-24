import { DomainException } from '../common/error-code';
import { NotificationSettingsService } from './notification-settings.service';
import type { NotificationSettingsRepositoryPort } from './notification-settings.repository';

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
});
