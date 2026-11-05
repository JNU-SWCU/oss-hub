import type { ApplicationStatus } from '@prisma/client';
import type { ApplicationDecisionNotification } from '../application-decision-notifications.repository';

export class ApplicationDecisionNotificationResponseDto {
  declare readonly id: string;
  declare readonly teamId: string;
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
      teamId: notification.teamId,
      programId: notification.programId,
      programName: notification.programName,
      decision: notification.decision,
      decidedAt: notification.decidedAt.toISOString(),
    };
  }
}
