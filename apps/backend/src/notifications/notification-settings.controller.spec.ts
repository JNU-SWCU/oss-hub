import { GUARDS_METADATA } from '@nestjs/common/constants';
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { NotificationSettingsController } from './notification-settings.controller';
import type { NotificationSettingsService } from './notification-settings.service';
import { UpdateNotificationEmailRequestDto } from './dto/update-notification-email-request.dto';

function readGuards(
  methodName: 'getMyNotificationSettings' | 'updateMyNotificationEmail',
): unknown[] {
  const method: unknown = Object.getOwnPropertyDescriptor(
    NotificationSettingsController.prototype,
    methodName,
  )?.value;
  if (typeof method !== 'function') return [];
  const guards: unknown = Reflect.getMetadata(GUARDS_METADATA, method);
  return Array.isArray(guards) ? guards : [];
}

describe('NotificationSettingsController', () => {
  it('PATCH를 SessionGuard·OriginGuard로 보호한다(역할 무관 본인 설정)', () => {
    expect(readGuards('updateMyNotificationEmail')).toEqual([
      SessionGuard,
      OriginGuard,
    ]);
  });

  it('GET을 SessionGuard로 보호한다(OriginGuard 없음)', () => {
    expect(readGuards('getMyNotificationSettings')).toEqual([SessionGuard]);
  });

  it('세션 githubId와 입력으로 service를 호출하고 응답 DTO로 변환한다', async () => {
    const updateMyNotificationEmail = jest.fn().mockResolvedValue({
      notificationEmail: 'staff@example.com',
      notifyEnabled: true,
    });
    const service: Pick<
      NotificationSettingsService,
      'getMyNotificationSettings' | 'updateMyNotificationEmail'
    > = { getMyNotificationSettings: jest.fn(), updateMyNotificationEmail };
    const controller = new NotificationSettingsController(service);
    const body = Object.assign(new UpdateNotificationEmailRequestDto(), {
      notificationEmail: 'staff@example.com',
      notifyEnabled: true,
    });

    const result = await controller.updateMyNotificationEmail(
      { sessionGithubId: 42n },
      body,
    );

    expect(updateMyNotificationEmail).toHaveBeenCalledWith(42n, {
      notificationEmail: 'staff@example.com',
      notifyEnabled: true,
    });
    expect(result).toEqual({
      notificationEmail: 'staff@example.com',
      notifyEnabled: true,
    });
  });
});
