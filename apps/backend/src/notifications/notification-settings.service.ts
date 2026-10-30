import { Inject, Injectable } from '@nestjs/common';
import { DomainException } from '../platform/error-code.error';
import {
  NOTIFICATIONS_ERROR_CODES,
  NotificationsErrorCode,
} from './notifications-error-code.error';
import { NotificationSettingsRepository } from './notification-settings.repository';
import type { NotificationSettingsRepositoryPort } from './notification-settings.repository';
import type {
  NotificationSettings,
  UpdateNotificationEmailInput,
} from './notification-settings.types';

@Injectable()
export class NotificationSettingsService {
  constructor(
    @Inject(NotificationSettingsRepository)
    private readonly repository: NotificationSettingsRepositoryPort,
  ) {}

  async getMyNotificationSettings(
    githubId: bigint,
  ): Promise<NotificationSettings> {
    const settings = await this.repository.findByGithubId(githubId);
    if (!settings) {
      throw new DomainException(
        NOTIFICATIONS_ERROR_CODES[NotificationsErrorCode.USER_NOT_FOUND],
      );
    }
    return settings;
  }

  async updateMyNotificationEmail(
    githubId: bigint,
    input: UpdateNotificationEmailInput,
  ): Promise<NotificationSettings> {
    const updated = await this.repository.updateByGithubId(githubId, input);
    if (!updated) {
      throw new DomainException(
        NOTIFICATIONS_ERROR_CODES[NotificationsErrorCode.USER_NOT_FOUND],
      );
    }
    return updated;
  }
}
