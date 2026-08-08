import type { ApplicationStatus } from '@prisma/client';
import type { ApplicationDecisionNotification } from '../application-decision-notifications.service';

export class ApplicationDecisionNotificationResponseDto {
  readonly id: string;
  readonly applicationId: string;
  readonly programId: string;
  readonly programName: string;
  readonly decision:
    typeof ApplicationStatus.APPROVED | typeof ApplicationStatus.REJECTED;
  readonly decidedAt: string;

  constructor(notification: ApplicationDecisionNotification) {
    this.id = notification.id;
    this.applicationId = notification.applicationId;
    this.programId = notification.programId;
    this.programName = notification.programName;
    this.decision = notification.decision;
    this.decidedAt = notification.decidedAt.toISOString();
  }
}
