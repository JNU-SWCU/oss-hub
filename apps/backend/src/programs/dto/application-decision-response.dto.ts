import type {
  ApplicationStatus,
  RepositoryProvisionJobStatus,
} from '@prisma/client';
import type { ApplicationDecisionResult } from '../application-decision.policy';

export class ApplicationDecisionResponseDto {
  declare readonly applicationId: string;
  declare readonly status: ApplicationStatus;
  declare readonly repositoryProvisioning?: {
    readonly enabled: boolean;
    readonly eventId: string | null;
    readonly jobStatus: RepositoryProvisionJobStatus | null;
  };
  declare readonly rejectionReason?: string;

  static from(
    result: ApplicationDecisionResult,
  ): ApplicationDecisionResponseDto {
    switch (result.kind) {
      case 'APPROVED':
        return {
          applicationId: result.applicationId,
          status: result.status,
          repositoryProvisioning: result.repositoryProvisioning,
        };
      case 'REJECTED':
        return {
          applicationId: result.applicationId,
          status: result.status,
          rejectionReason: result.rejectionReason,
        };
      case 'REVERTED':
        return {
          applicationId: result.applicationId,
          status: result.status,
        };
    }
  }
}
