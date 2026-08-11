import { Inject, Injectable } from '@nestjs/common';
import { ApplicationStatus, type Prisma } from '@prisma/client';
import {
  ApplicationDecisionNotificationsRepository,
  type ApplicationDecisionNotificationsRepositoryPort,
  type StoredApplicationDecisionNotification,
} from './application-decision-notifications.repository';

export type { ApplicationDecisionNotificationsRepositoryPort } from './application-decision-notifications.repository';

export interface ApplicationDecisionNotification {
  readonly id: string;
  readonly applicationId: string;
  readonly programId: string;
  readonly programName: string;
  readonly decision:
    typeof ApplicationStatus.APPROVED | typeof ApplicationStatus.REJECTED;
  readonly decidedAt: Date;
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

  markRead(githubId: bigint, notificationId: string): Promise<void> {
    return this.repository.markRead(githubId, notificationId);
  }
}

function parseApplicationDecisionNotification(
  notification: StoredApplicationDecisionNotification,
): ApplicationDecisionNotification | null {
  const payload: Prisma.JsonValue = notification.payload;
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
      decision !== ApplicationStatus.REJECTED) ||
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
