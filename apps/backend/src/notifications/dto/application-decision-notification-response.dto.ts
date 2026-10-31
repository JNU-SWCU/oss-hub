import type { ApplicationStatus } from '@prisma/client';
import type { ApplicationDecisionNotification } from '../notifications.types';

export class ApplicationDecisionNotificationResponseDto {
  declare readonly id: string;
  declare readonly applicationId: string;
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
      applicationId: notification.applicationId,
      programId: notification.programId,
      programName: notification.programName,
      decision: notification.decision,
      decidedAt: notification.decidedAt.toISOString(),
    };
  }
}
