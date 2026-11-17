import type { UnreadNotificationPage } from '../application-decision-notifications.service';
import type { ApplicationStatus } from '@prisma/client';
import type { ApplicationDecisionNotification } from '../application-decision-notifications.repository';

export class ApplicationDecisionNotificationResponseDto {
  declare readonly id: string;
  declare readonly programId: string;
  declare readonly programName: string;
  declare readonly decision:
    | typeof ApplicationStatus.APPROVED
    | typeof ApplicationStatus.REJECTED
    | typeof ApplicationStatus.SUBMITTED;
  declare readonly decidedAt: string;

  static from(
    notification: ApplicationDecisionNotification,
  ): ApplicationDecisionNotificationResponseDto {
    return {
      id: notification.id,
      programId: notification.programId,
      programName: notification.programName,
      decision: notification.decision,
      decidedAt: notification.decidedAt.toISOString(),
    };
  }
}

export class ApplicationDecisionNotificationPageResponseDto {
  declare readonly items: ApplicationDecisionNotificationResponseDto[];
  declare readonly hasMore: boolean;

  static from(
    page: UnreadNotificationPage<ApplicationDecisionNotification>,
  ): ApplicationDecisionNotificationPageResponseDto {
    return {
      items: page.items.map((item) =>
        ApplicationDecisionNotificationResponseDto.from(item),
      ),
      hasMore: page.hasMore,
    };
  }
}
