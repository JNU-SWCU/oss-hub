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

  it('현재 설정을 조회한다', async () => {
    const readService = new NotificationSettingsService({
      findByGithubId: jest.fn().mockResolvedValue({
        notificationEmail: 'staff@example.com',
        notifyEnabled: true,
      }),
      updateByGithubId: jest.fn(),
    } as unknown as NotificationSettingsRepositoryPort);

    await expect(readService.getMyNotificationSettings(42n)).resolves.toEqual({
      notificationEmail: 'staff@example.com',
      notifyEnabled: true,
    });
  });

  it('조회 대상 사용자가 없으면 USER_NOT_FOUND를 던진다', async () => {
    const readService = new NotificationSettingsService({
      findByGithubId: jest.fn().mockResolvedValue(null),
      updateByGithubId: jest.fn(),
    } as unknown as NotificationSettingsRepositoryPort);

    await expect(
      readService.getMyNotificationSettings(1n),
    ).rejects.toBeInstanceOf(DomainException);
  });
});
