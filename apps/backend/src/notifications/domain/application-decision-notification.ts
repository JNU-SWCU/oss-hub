import type { ApplicationStatus } from '@prisma/client';

export interface ApplicationDecisionNotification {
  readonly id: string;
  readonly applicationId: string;
  readonly programId: string;
  readonly programName: string;
  readonly decision:
    typeof ApplicationStatus.APPROVED | typeof ApplicationStatus.REJECTED;
  readonly decidedAt: Date;
}
