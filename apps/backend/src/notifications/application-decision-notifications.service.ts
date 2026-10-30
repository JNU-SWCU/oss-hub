import { Inject, Injectable } from '@nestjs/common';
import { DomainException } from '../platform/error-code.error';
import {
  NOTIFICATIONS_ERROR_CODES,
  NotificationsErrorCode,
} from './notifications-error-code.error';
import {
  NotificationSettingsRepository,
  type NotificationSettingsRepositoryPort,
  ApplicationDecisionNotificationsRepository,
  type ApplicationDecisionNotificationsRepositoryPort,
  type StoredApplicationDecisionNotification,
} from './application-decision-notifications.repository';
import type {
  NotificationSettings,
  UpdateNotificationEmailInput,
  ApplicationDecisionNotification,
  TeamDeletionNotification,
} from './notifications.types';
import { ApplicationStatus } from '@prisma/client';

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

@Injectable()
export class ApplicationDecisionNotificationsService {
  constructor(
    @Inject(ApplicationDecisionNotificationsRepository)
    private readonly repository: ApplicationDecisionNotificationsRepositoryPort,
  ) {}

  async listUnread(
    githubId: bigint,
  ): Promise<readonly ApplicationDecisionNotification[]> {
    const stored = await this.repository.listUnread(githubId);
    return stored.flatMap((notification) => {
      const parsed = parseApplicationDecisionNotification(notification);
      return parsed ? [parsed] : [];
    });
  }

  async listUnreadTeamDeletions(
    githubId: bigint,
  ): Promise<readonly TeamDeletionNotification[]> {
    const stored = await this.repository.listUnreadTeamDeletions(githubId);
    return stored.flatMap((notification) => {
      const parsed = parseTeamDeletionNotification(notification);
      return parsed ? [parsed] : [];
    });
  }

  markTeamDeletionRead(
    githubId: bigint,
    notificationId: string,
  ): Promise<void> {
    return this.repository.markTeamDeletionRead(githubId, notificationId);
  }

  markRead(githubId: bigint, notificationId: string): Promise<void> {
    return this.repository.markRead(githubId, notificationId);
  }
}

function parseApplicationDecisionNotification(
  notification: StoredApplicationDecisionNotification,
): ApplicationDecisionNotification | null {
  const payload = notification.payload;
  if (
    payload === null ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  ) {
    return null;
  }
  const {
    schemaVersion,
    applicationId,
    programId,
    programName,
    decision,
    decidedAt,
  } = payload;
  if (
    schemaVersion !== 1 ||
    typeof applicationId !== 'string' ||
    applicationId.length === 0 ||
    typeof programId !== 'string' ||
    programId.length === 0 ||
    typeof programName !== 'string' ||
    programName.trim().length === 0 ||
    (decision !== ApplicationStatus.APPROVED &&
      decision !== ApplicationStatus.REJECTED &&
      decision !== ApplicationStatus.SUBMITTED) ||
    typeof decidedAt !== 'string'
  ) {
    return null;
  }
  const parsedDate = new Date(decidedAt);
  if (Number.isNaN(parsedDate.getTime())) return null;
  return {
    id: notification.id,
    applicationId,
    programId,
    programName,
    decision,
    decidedAt: parsedDate,
  };
}

function parseTeamDeletionNotification(
  notification: StoredApplicationDecisionNotification,
): TeamDeletionNotification | null {
  const payload = notification.payload;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload))
    return null;
  const {
    schemaVersion,
    teamId,
    teamName,
    programId,
    programName,
    message,
    deletedAt,
  } = payload;
  if (
    schemaVersion !== 1 ||
    typeof teamId !== 'string' ||
    !teamId ||
    typeof teamName !== 'string' ||
    !teamName.trim() ||
    typeof programId !== 'string' ||
    !programId ||
    typeof programName !== 'string' ||
    !programName.trim() ||
    (message !== null && typeof message !== 'string') ||
    typeof deletedAt !== 'string'
  )
    return null;
  const parsedDate = new Date(deletedAt);
  if (Number.isNaN(parsedDate.getTime())) return null;
  return {
    id: notification.id,
    teamId,
    teamName,
    programId,
    programName,
    message,
    deletedAt: parsedDate,
  };
}
