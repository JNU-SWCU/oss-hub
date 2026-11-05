import type {
  ApplicationStatus,
  RepositoryProvisionJobStatus,
} from '@prisma/client';
import type { ApplicationDecisionResult } from '../team.repository';

export class ApplicationDecisionResponseDto {
  declare readonly teamId: string;
  declare readonly status: ApplicationStatus;
  declare readonly repositoryProvisioning?: {
    readonly enabled: boolean;
    readonly eventId: string | null;
    readonly jobStatus: RepositoryProvisionJobStatus | null;
  };
  declare readonly rejectionReason?: string | null;

  static from(
    result: ApplicationDecisionResult,
  ): ApplicationDecisionResponseDto {
    switch (result.kind) {
      case 'APPROVED':
        return {
          teamId: result.teamId,
          status: result.status,
          repositoryProvisioning: result.repositoryProvisioning,
        };
      case 'REJECTED':
        return {
          teamId: result.teamId,
          status: result.status,
          rejectionReason: result.rejectionReason,
        };
      case 'REVERTED':
        return {
          teamId: result.teamId,
          status: result.status,
        };
    }
  }
}
