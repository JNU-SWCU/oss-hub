import { Inject, Injectable } from '@nestjs/common';
import { DomainException } from '../common/error-code';
import {
  NOTIFICATIONS_ERROR_CODES,
  NotificationsErrorCode,
} from './notifications-error-code.enum';
import { NotificationSettingsRepository } from './notification-settings.repository';
import type {
  NotificationSettings,
  NotificationSettingsRepositoryPort,
} from './notification-settings.repository';

export interface UpdateNotificationEmailInput {
  readonly notificationEmail: string;
  readonly notifyEnabled: boolean;
}

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
